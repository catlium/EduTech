import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { and, count, eq, isNull } from 'drizzle-orm';

import { users, authSessions, roles, platformUserRoles } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { PermissionCheckService } from '../authorization/permission-check.service.js';
import {
  isPlatformRoleGrantableToUser,
  resolveGrantedKeys,
  SUPER_ADMIN,
  type PermissionDomain,
  type RoleKind,
  type RoleState,
} from '../authorization/permission-catalogue.js';
import {
  PlatformAuditService,
  PLATFORM_AUDIT_ACTIONS,
} from './platform-audit.service.js';

export interface PlatformUserRoleView {
  id: string;
  key: string;
}

export interface PlatformUserSummary {
  id: string;
  email: string;
  name: string;
  status: string;
  roles: string[];
  /** Roles with their ids — the console's revoke surface (DELETE
   *  /:userId/roles/:roleId) needs the UUID, and the reads previously only
   *  exposed keys (P.2-FE contract fix, additive). */
  platformRoles: PlatformUserRoleView[];
  createdAt: Date;
}

export interface PlatformUserDetail extends PlatformUserSummary {
  /** The caller's platform grants are irrelevant — this is the TARGET's own grant set (console probe analog). */
  platformPermissions: string[];
}

export interface PlatformUserRoleResult {
  userId: string;
  roleId: string;
  roleKey: string;
}

export interface PlatformUserRevokeResult extends PlatformUserRoleResult {
  /** Post-mutation active SUPER_ADMIN count — proves the §10 last-guard held. */
  activeSuperAdminsAfter: number;
}

export interface PlatformUserLifecycleResult {
  userId: string;
  status: string;
  sessionsRevoked?: number;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Platform-user lifecycle (platform-user-lifecycle §4/§5/§6/§9/§10/§11/§12) —
 * platform plane only (AccessTokenGuard → PlatformGuard, never TenantGuard /
 * x-institute-id). Every mutation is one transaction whose audit event is
 * appended LAST, so an event exists iff the mutation committed (identical to
 * the institute lifecycle precedent). Each leaf mutation is either narrow
 * (platform_user_roles only: role grant/revoke) or broad (users.status +
 * same-tx session revocation: suspend/reactivate). Memberships are never
 * written anywhere in this class — planes stay independent.
 */
@Injectable()
export class PlatformUsersService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly permissionCheck: PermissionCheckService,
    private readonly audit: PlatformAuditService,
  ) {}

  // ── Reads (§12) ─────────────────────────────────────────────────────────

  /** Platform users = users holding ≥1 platform_user_roles row; optional status filter. */
  async list(status?: string): Promise<PlatformUserSummary[]> {
    if (status !== undefined && status !== 'active' && status !== 'deactivated') {
      throw new BadRequestException("status must be 'active' or 'deactivated'");
    }
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        status: users.status,
        createdAt: users.createdAt,
        roleId: roles.id,
        roleKey: roles.key,
      })
      .from(platformUserRoles)
      .innerJoin(users, eq(users.id, platformUserRoles.userId))
      .innerJoin(roles, eq(roles.id, platformUserRoles.roleId))
      .where(status ? eq(users.status, status) : undefined);

    const byUser = new Map<string, PlatformUserSummary>();
    for (const row of rows) {
      const summary = byUser.get(row.id) ?? {
        id: row.id,
        email: row.email,
        name: row.name,
        status: row.status,
        createdAt: row.createdAt,
        roles: [],
        platformRoles: [],
      };
      summary.roles.push(row.roleKey);
      summary.platformRoles.push({ id: row.roleId, key: row.roleKey });
      byUser.set(row.id, summary);
    }
    const out = [...byUser.values()];
    out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return out;
  }

  /** Detail: account + held platform roles + the user's own DB-fresh platform grant set. */
  async get(userId: string): Promise<PlatformUserDetail> {
    const [user] = await this.db
      .select({ id: users.id, email: users.email, name: users.name, status: users.status, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new NotFoundException('User not found');

    const roleRows = await this.db
      .select({ id: roles.id, key: roles.key })
      .from(platformUserRoles)
      .innerJoin(roles, eq(roles.id, platformUserRoles.roleId))
      .where(eq(platformUserRoles.userId, userId));

    const platformRoles = roleRows.sort((a, b) => a.key.localeCompare(b.key));
    const platformPermissions = [...resolveGrantedKeys(await this.permissionCheck.platformGrantKeysForUser(userId), 'platform')].sort();
    return { ...user, roles: platformRoles.map((r) => r.key), platformRoles, platformPermissions };
  }

  // ── Role grant / revoke (§4) — narrow, platform_user_roles only ────────

  /**
   * Grant a platform role (§4.1). Validity gate is `isPlatformRoleGrantableToUser`
   * (platform-domain, system-kind, global — today that is exactly SUPER_ADMIN);
   * an institute/custom/unknown role is structurally un-grantable → 400.
   * Duplicate grant is an idempotent no-op (`ON CONFLICT DO NOTHING`), so the
   * audit event is written only when a row was actually added. Granting to a
   * suspended user is allowed — status gates authentication, not role storage.
   */
  async grantRole(userId: string, roleKey: string, actorUserId: string): Promise<PlatformUserRoleResult> {
    if (typeof roleKey !== 'string' || roleKey.length === 0) {
      throw new BadRequestException('roleKey is required');
    }
    const [user] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundException('User not found');

    const [role] = await this.db
      .select({ id: roles.id, key: roles.key, kind: roles.kind, domain: roles.domain, instituteId: roles.instituteId })
      .from(roles)
      .where(eq(roles.key, roleKey))
      .limit(1);
    if (!role || !isPlatformRoleGrantableToUser(toRoleState(role))) {
      throw new BadRequestException(`Unknown or non-grantable platform role '${roleKey}'`);
    }

    return this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(platformUserRoles)
        .values({ userId, roleId: role.id })
        .onConflictDoNothing()
        .returning({ roleId: platformUserRoles.roleId });
      if (!inserted) return { userId, roleId: role.id, roleKey: role.key };
      await this.audit.record(tx, {
        actorUserId,
        action: PLATFORM_AUDIT_ACTIONS.PLATFORM_USER_ATTACH,
        resourceType: 'platform_user',
        resourceId: userId,
        instituteId: null,
        metadata: { userId, roleKey: role.key, roleId: role.id },
      });
      return { userId, roleId: role.id, roleKey: role.key };
    });
  }

  /**
   * Revoke a platform role (§4.2). Narrow: deletes the platform_user_roles row
   * only — sessions stay live and the account keeps working on the institute
   * plane (grants resolve DB-fresh, so the next platform request is denied).
   * Guards: self-revoke of SUPER_ADMIN → 400 (§9); the §10 last-guard runs
   * inside the tx on the mirrored post-delete state. 0-row delete → 404, no event.
   */
  async revokeRole(userId: string, roleId: string, actorUserId: string): Promise<PlatformUserRevokeResult> {
    return this.db.transaction(async (tx) => {
      const [role] = await tx
        .select({ id: roles.id, key: roles.key, kind: roles.kind, domain: roles.domain, instituteId: roles.instituteId })
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);

      const revokingSuperAdmin = role !== undefined && role.key === SUPER_ADMIN;
      if (revokingSuperAdmin && actorUserId === userId) {
        throw new BadRequestException('You cannot revoke your own Super Admin role');
      }

      const [deleted] = await tx
        .delete(platformUserRoles)
        .where(and(eq(platformUserRoles.userId, userId), eq(platformUserRoles.roleId, roleId)))
        .returning({ roleId: platformUserRoles.roleId });
      if (!deleted) {
        throw new NotFoundException('The user does not hold this platform role');
      }

      const activeSuperAdminsAfter = revokingSuperAdmin ? await this.countActiveSuperAdmins(tx) : -1;
      if (revokingSuperAdmin && activeSuperAdminsAfter === 0) {
        throw new BadRequestException('Cannot remove the last active Super Admin');
      }

      await this.audit.record(tx, {
        actorUserId,
        action: PLATFORM_AUDIT_ACTIONS.PLATFORM_USER_DETACH,
        resourceType: 'platform_user',
        resourceId: userId,
        instituteId: null,
        metadata: { userId, roleKey: role!.key, roleId, activeSuperAdminsAfter },
      });
      return { userId, roleId, roleKey: role!.key, activeSuperAdminsAfter };
    });
  }

  // ── Suspend / reactivate (§5) — broad, users.status + same-tx sessions ──

  /**
   * Global suspension (§5.4): `users.status='deactivated'` and every live
   * auth_sessions row of the target revoked in the SAME transaction (defense-
   * in-depth — AccessTokenGuard would 401 anyway on the next request, but the
   * sticky revocation means a reactivated account must sign in afresh). Self-
   * suspend → 400 (§9); §10 last-guard runs inside the tx; identity
   * preservation: memberships and platform_user_roles are untouched.
   */
  async suspend(userId: string, actorUserId: string): Promise<PlatformUserLifecycleResult> {
    if (actorUserId === userId) {
      throw new BadRequestException('You cannot suspend your own account');
    }

    const result = await this.db.transaction(async (tx) => {
      // One-row conditional UPDATE doubles as the transition guard (0 rows →
      // 404/409, no event). Count runs AFTER our own write so the tx's repeat
      // reads see every concurrent committed remove too.
      const [row] = await tx
        .update(users)
        .set({ status: 'deactivated', updatedAt: new Date() })
        .where(and(eq(users.id, userId), eq(users.status, 'active')))
        .returning({ id: users.id, status: users.status });
      if (!row) return undefined;

      if ((await this.countActiveSuperAdmins(tx)) === 0) {
        throw new BadRequestException('Cannot suspend the last active Super Admin');
      }

      const sessions = await tx
        .update(authSessions)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
        .returning({ id: authSessions.id });

      await this.audit.record(tx, {
        actorUserId,
        action: PLATFORM_AUDIT_ACTIONS.PLATFORM_USER_SUSPEND,
        resourceType: 'platform_user',
        resourceId: userId,
        instituteId: null,
        metadata: { userId, status: 'deactivated', sessionsRevoked: sessions.length },
      });
      return { userId: row.id, status: row.status, sessionsRevoked: sessions.length };
    });

    if (result) return result;
    return this.rejectTransition(userId, 'already deactivated');
  }

  /**
   * Reactivation (§5.4): `users.status='active'`. Sessions intentionally NOT
   * restored — what suspend revoked stays revoked; the user signs in afresh.
   * Grants and memberships come back exactly as before suspension.
   */
  async reactivate(userId: string, actorUserId: string): Promise<PlatformUserLifecycleResult> {
    const result = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ status: 'active', updatedAt: new Date() })
        .where(and(eq(users.id, userId), eq(users.status, 'deactivated')))
        .returning({ id: users.id, status: users.status });
      if (!row) return undefined;
      await this.audit.record(tx, {
        actorUserId,
        action: PLATFORM_AUDIT_ACTIONS.PLATFORM_USER_REACTIVATE,
        resourceType: 'platform_user',
        resourceId: userId,
        instituteId: null,
        metadata: { userId, status: 'active' },
      });
      return { userId: row.id, status: row.status };
    });

    if (result) return result;
    return this.rejectTransition(userId, 'already active');
  }

  // ── Shared helpers ──────────────────────────────────────────────────────

  /** Active (`users.status='active'`) holders of SUPER_ADMIN — the §10 count. */
  private async countActiveSuperAdmins(tx: Tx): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(users)
      .innerJoin(platformUserRoles, eq(platformUserRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, platformUserRoles.roleId))
      .where(and(eq(roles.key, SUPER_ADMIN), eq(users.status, 'active')));
    return row ? Number(row.n) : 0;
    // ponytail: plain count inside the tx (READ COMMITTED) — a truly concurrent
    // in-flight flip on another session is not re-read, so the last-guard is a
    // statistical defense for the handful-of-admins population, exactly the
    // §10 budget. Upgrade: SELECT ... FOR UPDATE on the SUPER_ADMIN user rows
    // or a serializable round when the admin set ever scales.
  }

  private async rejectTransition(userId: string, reason: string): Promise<never> {
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!existing) throw new NotFoundException('User not found');
    throw new ConflictException(`User is ${reason}`);
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