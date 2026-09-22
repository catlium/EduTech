import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import {
  memberships,
  membershipRoles,
  roles,
  institutes,
  rolePermissions,
  permissions,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import { resolveGrantedKeys } from '../authorization/permission-catalogue.js';
import { DATABASE_TOKEN } from '../database/database.module.js';

export interface MembershipWithRoles {
  id: string;
  userId: string;
  instituteId: string;
  status: string;
  instituteStatus: string;
  roles: string[];
}

export interface MembershipListItem {
  instituteId: string;
  instituteName: string;
  slug: string;
  status: string;
  /** Institute status ('active' | 'deactivated') — deactivated institutes are
   *  unusable (TenantGuard rejects) and shown as disabled in the picker. */
  instituteStatus: string;
  roles: string[];
  /** Institute-domain permission keys resolved from the membership's roles. */
  permissions: string[];
}

@Injectable()
export class TenancyService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async getMembership(userId: string, instituteId: string): Promise<MembershipWithRoles | null> {
    const membership = await this.db
      .select({
        id: memberships.id,
        userId: memberships.userId,
        instituteId: memberships.instituteId,
        status: memberships.status,
        instituteStatus: institutes.status,
      })
      .from(memberships)
      .innerJoin(institutes, eq(institutes.id, memberships.instituteId))
      .where(and(eq(memberships.userId, userId), eq(memberships.instituteId, instituteId)))
      .limit(1);

    if (membership.length === 0) return null;

    // Phase C: roles resolve through the membership_roles → roles FK (D2 §14);
    // `key` is what the existing RolesGuard / @RequiredRoles still consume.
    const roleRows = await this.db
      .select({ roleKey: roles.key })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(eq(membershipRoles.membershipId, membership[0]!.id));

    return {
      id: membership[0]!.id,
      userId: membership[0]!.userId,
      instituteId: membership[0]!.instituteId,
      status: membership[0]!.status,
      instituteStatus: membership[0]!.instituteStatus,
      roles: roleRows.map((r) => r.roleKey),
    };
  }

  /** List every membership a user holds, with institute info + roles (institute picker). */
  async listMemberships(userId: string): Promise<MembershipListItem[]> {
    const rows = await this.db
      .select({
        membershipId: memberships.id,
        membershipStatus: memberships.status,
        instituteId: institutes.id,
        instituteName: institutes.name,
        instituteStatus: institutes.status,
        slug: institutes.slug,
      })
      .from(memberships)
      .innerJoin(institutes, eq(institutes.id, memberships.instituteId))
      .where(eq(memberships.userId, userId));

    if (rows.length === 0) return [];

    const membershipIds = rows.map((r) => r.membershipId);
    const roleRows = await this.db
      .select({ membershipId: membershipRoles.membershipId, roleKey: roles.key })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(inArray(membershipRoles.membershipId, membershipIds));

    // Resolved grants (Phase B, D1): membership → membership_roles → roles →
    // role_permissions → permissions, filtered to the institute domain. The raw
    // keys power the frontend's `*.manage` implication UI checks; only the pure
    // catalogue layer decides "can" — no permissions ever ride in JWTs.
    const grantRows = await this.db
      .select({ membershipId: membershipRoles.membershipId, key: permissions.key })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(inArray(membershipRoles.membershipId, membershipIds));

    const grantedFor = (membershipId: string): string[] => {
      const keys = grantRows.filter((g) => g.membershipId === membershipId).map((g) => g.key);
      return [...resolveGrantedKeys(keys, 'institute')].sort();
    };

    return rows.map((r) => ({
      instituteId: r.instituteId,
      instituteName: r.instituteName,
      slug: r.slug,
      status: r.membershipStatus,
      instituteStatus: r.instituteStatus,
      roles: roleRows.filter((rr) => rr.membershipId === r.membershipId).map((rr) => rr.roleKey),
      permissions: grantedFor(r.membershipId),
    }));
  }
}
