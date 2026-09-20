import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { memberships, membershipRoles, roles, institutes } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';

export interface MembershipWithRoles {
  id: string;
  userId: string;
  instituteId: string;
  status: string;
  roles: string[];
}

export interface MembershipListItem {
  instituteId: string;
  instituteName: string;
  slug: string;
  status: string;
  roles: string[];
}

@Injectable()
export class TenancyService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async getMembership(userId: string, instituteId: string): Promise<MembershipWithRoles | null> {
    const membership = await this.db
      .select()
      .from(memberships)
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
      roles: roleRows.map((r) => r.roleKey),
    };
  }

  async createMembership(userId: string, instituteId: string): Promise<MembershipWithRoles> {
    const [membership] = await this.db
      .insert(memberships)
      .values({ userId, instituteId })
      .returning();

    return {
      id: membership!.id,
      userId: membership!.userId,
      instituteId: membership!.instituteId,
      status: membership!.status,
      roles: [],
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

    return rows.map((r) => ({
      instituteId: r.instituteId,
      instituteName: r.instituteName,
      slug: r.slug,
      status: r.membershipStatus,
      roles: roleRows.filter((rr) => rr.membershipId === r.membershipId).map((rr) => rr.roleKey),
    }));
  }
}
