import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { and, eq, inArray, or } from 'drizzle-orm';

import { permissions, rolePermissions, roles } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import {
  invalidInstitutePermissionKeys,
  isBuiltinRoleKey,
  roleVisibleToInstitute,
  type PermissionDomain,
  type RoleKind,
  type RoleState,
} from './permission-catalogue.js';
import type { CreateRoleDto, UpdateRoleDto } from './roles.dto.js';

export interface InstituteRoleView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  kind: string;
  domain: string;
  permissionKeys: string[];
}

const ROLE_VIEW_COLUMNS = {
  id: roles.id,
  key: roles.key,
  name: roles.name,
  description: roles.description,
  kind: roles.kind,
  domain: roles.domain,
} as const;

const UNIQUE_VIOLATION = '23505';

/**
 * Institute-local custom role management (Phase C / D2 §14). Built-in system
 * roles are read/listed but never mutated; custom roles are kind=institute,
 * domain=institute, owned by exactly one institute; every permission granted
 * must be a catalogue institute-domain key. SUPER_ADMIN (platform) is never
 * visible as an institute role. Authorization is decided by the permission
 * layer (@RequiredPermission) — this service enforces the domain/ownership
 * rules against DB state.
 */
@Injectable()
export class RolesService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  /** System institute roles + the institute's own custom roles (never SUPER_ADMIN). */
  async listRoles(instituteId: string): Promise<InstituteRoleView[]> {
    const rows = await this.db
      .select({ ...ROLE_VIEW_COLUMNS })
      .from(roles)
      .where(
        and(
          eq(roles.domain, 'institute'),
          or(eq(roles.kind, 'system'), eq(roles.instituteId, instituteId)),
        ),
      );

    return rows
      .map((r) => toView(r))
      .sort((a, b) => (a.kind === 'system' && b.kind !== 'system' ? -1 : b.kind === 'system' && a.kind !== 'system' ? 1 : a.key.localeCompare(b.key)));
  }

  /** One visible role with its current permission keys. */
  async getRole(instituteId: string, roleId: string): Promise<InstituteRoleView> {
    const row = await this.requireVisibleRole(instituteId, roleId);
    return { ...toView(row), permissionKeys: await this.permissionKeysFor(roleId) };
  }

  /** Create an institute-local custom role (key + initial permission set atomically). */
  async createRole(instituteId: string, dto: CreateRoleDto): Promise<InstituteRoleView> {
    if (isBuiltinRoleKey(dto.key)) {
      throw new ConflictException(`Role key '${dto.key}' is reserved for a built-in role`);
    }
    const invalid = invalidInstitutePermissionKeys(dto.permissionKeys);
    if (invalid.length > 0) {
      throw new BadRequestException(`Unsupported or platform permission keys: ${invalid.join(', ')}`);
    }
    const keys = dedupe(dto.permissionKeys);

    try {
      const roleId = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(roles)
          .values({ key: dto.key, name: dto.name, description: dto.description, kind: 'institute', domain: 'institute', instituteId })
          .returning({ id: roles.id });
        if (!created) throw new Error('failed to create role');
        await this.replaceGrants(tx, created.id, keys);
        return created.id;
      });
      return { id: roleId, key: dto.key, name: dto.name, description: dto.description ?? null, kind: 'institute', domain: 'institute', permissionKeys: keys };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A role with this key already exists in the institute');
      }
      throw error;
    }
  }

  /** Update name/description of a custom role (key, kind, domain never change). */
  async updateRole(instituteId: string, roleId: string, dto: UpdateRoleDto): Promise<InstituteRoleView> {
    const row = await this.requireVisibleRole(instituteId, roleId);
    if (row.kind === 'system') throw new BadRequestException('System roles cannot be modified');

    await this.db
      .update(roles)
      .set({
        name: dto.name ?? row.name,
        description: dto.description === undefined ? row.description : dto.description,
        updatedAt: new Date(),
      })
      .where(eq(roles.id, roleId));

    return { ...toView(row), name: dto.name ?? row.name, description: dto.description === undefined ? row.description : dto.description };
  }

  /** Delete a custom role. Grants and membership bindings cascade. */
  async deleteRole(instituteId: string, roleId: string): Promise<void> {
    const row = await this.requireVisibleRole(instituteId, roleId);
    if (row.kind === 'system') throw new BadRequestException('System roles cannot be deleted');
    await this.db.delete(roles).where(eq(roles.id, roleId));
  }

  /**
   * Replace a custom role's permission set (deterministic set/replace). Only
   * catalogue institute-domain keys; the grant layer keeps default-deny. The
   * actor may never add permissions to a role they currently hold — that would
   * be self-escalation.
   */
  async setRolePermissions(instituteId: string, roleId: string, permissionKeys: string[], actorRoleKeys: string[]): Promise<InstituteRoleView> {
    const row = await this.requireVisibleRole(instituteId, roleId);
    if (row.kind === 'system') {
      throw new BadRequestException('System roles cannot be modified — their permissions are managed by the built-in sync');
    }
    if (actorRoleKeys.some((k) => k.toLowerCase() === row.key.toLowerCase())) {
      throw new BadRequestException('You cannot change permissions of a role you hold');
    }
    const invalid = invalidInstitutePermissionKeys(permissionKeys);
    if (invalid.length > 0) {
      throw new BadRequestException(`Unsupported or platform permission keys: ${invalid.join(', ')}`);
    }
    const keys = dedupe(permissionKeys);

    await this.db.transaction(async (tx) => {
      await this.replaceGrants(tx, roleId, keys);
    });

    return { ...toView(row), permissionKeys: keys };
  }

  /** Does `roleId` belong to `instituteId`'s visible role set? */
  private async requireVisibleRole(instituteId: string, roleId: string) {
    const [row] = await this.db
      .select({ ...ROLE_VIEW_COLUMNS, instituteId: roles.instituteId })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1);
    if (!row || !roleVisibleToInstitute(toRoleState(row), instituteId)) {
      throw new NotFoundException('Role not found');
    }
    return row;
  }

  private async permissionKeysFor(roleId: string): Promise<string[]> {
    const rows = await this.db
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, roleId));
    return rows.map((r) => r.key);
  }

  private async replaceGrants(
    tx: Pick<Database, 'insert' | 'delete' | 'select'>,
    roleId: string,
    keys: string[],
  ): Promise<void> {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (keys.length === 0) return;
    const rows = await tx
      .select({ id: permissions.id, key: permissions.key })
      .from(permissions)
      .where(inArray(permissions.key, keys));
    const idByKey = new Map(rows.map((p) => [p.key, p.id]));
    const grants: { roleId: string; permissionId: string }[] = [];
    for (const key of keys) {
      const permissionId = idByKey.get(key);
      if (!permissionId) throw new BadRequestException(`Permission '${key}' is missing from the database (re-run permission sync)`);
      grants.push({ roleId, permissionId });
    }
    await tx.insert(rolePermissions).values(grants).onConflictDoNothing();
  }
}

function toView(row: {
  id: string;
  key: string;
  name: string;
  description: string | null;
  kind: string;
  domain: string;
  permissionKeys?: string[];
}): InstituteRoleView {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    kind: row.kind,
    domain: row.domain,
    permissionKeys: row.permissionKeys ?? [],
  };
}

function toRoleState(row: {
  key: string;
  kind: string;
  domain: string;
  instituteId: string | null;
}): RoleState {
  return {
    key: row.key,
    kind: row.kind as RoleKind,
    domain: row.domain as PermissionDomain,
    instituteId: row.instituteId,
  };
}

function dedupe(keys: string[]): string[] {
  return [...new Set(keys)];
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION;
}