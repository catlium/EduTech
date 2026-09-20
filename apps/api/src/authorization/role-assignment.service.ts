import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { memberships, membershipRoles, roles } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import {
  isMembershipRoleEligible,
  membershipRoleUsableIn,
  type PermissionDomain,
  type RoleKind,
  type RoleState,
} from './permission-catalogue.js';

/**
 * The backend abstraction for assigning/removing institute roles on
 * memberships (Phase C / D2 §14). Enforces, against CURRENT DB state:
 *   - a platform role (SUPER_ADMIN) can never be a membership role;
 *   - a custom (institute-kind) role only belongs to the institute that owns
 *     it — cross-institute assignment is rejected;
 *   - unknown roles are rejected;
 *   - built-in (system) institute roles resolve by key ahead of any
 *     hypothetical same-key custom row (system identity is never confused
 *     with custom identity).
 * Key-based resolution (`resolveRoleId`) keeps the legacy key-string callers
 * (user provisioning) on the new model; roleId-based `assign`/`remove` are the
 * primitives custom-role management will build on later.
 */
@Injectable()
export class RoleAssignmentService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  /** Resolve a role key to the role id usable by a membership of `instituteId`. */
  async resolveRoleId(instituteId: string, key: string): Promise<string> {
    const [row] = await this.db
      .select({
        id: roles.id,
        key: roles.key,
        kind: roles.kind,
        domain: roles.domain,
        instituteId: roles.instituteId,
      })
      .from(roles)
      .where(eq(roles.key, key))
      // A built-in (system) identity wins over a same-key custom row.
      .orderBy(sql`(${roles.kind} = 'system')::int DESC`)
      .limit(1);

    if (!row || !membershipRoleUsableIn(toRoleState(row), instituteId)) {
      throw new BadRequestException(`Unknown or invalid role '${key}' for this institute`);
    }
    return row.id;
  }

  /** Assign an institute role to a membership (idempotent). */
  async assign(membershipId: string, roleId: string): Promise<void> {
    const [membership] = await this.db
      .select({ instituteId: memberships.instituteId })
      .from(memberships)
      .where(eq(memberships.id, membershipId))
      .limit(1);
    if (!membership) throw new NotFoundException('Membership not found');

    const [row] = await this.db
      .select({ key: roles.key, kind: roles.kind, domain: roles.domain, instituteId: roles.instituteId })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1);
    if (!row) throw new BadRequestException('Unknown role');

    const role = toRoleState(row);
    if (!isMembershipRoleEligible(role)) {
      throw new BadRequestException('Platform roles cannot be assigned to institute memberships');
    }
    if (role.kind === 'institute' && role.instituteId !== membership.instituteId) {
      throw new BadRequestException('Role belongs to a different institute');
    }

    await this.db
      .insert(membershipRoles)
      .values({ membershipId, roleId })
      .onConflictDoNothing();
  }

  /** Remove an institute role from a membership. */
  async remove(membershipId: string, roleId: string): Promise<void> {
    await this.db
      .delete(membershipRoles)
      .where(and(eq(membershipRoles.membershipId, membershipId), eq(membershipRoles.roleId, roleId)));
  }
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