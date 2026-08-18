import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { memberships, membershipRoles } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';

export interface MembershipWithRoles {
  id: string;
  userId: string;
  instituteId: string;
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

    const roles = await this.db
      .select()
      .from(membershipRoles)
      .where(eq(membershipRoles.membershipId, membership[0]!.id));

    return {
      id: membership[0]!.id,
      userId: membership[0]!.userId,
      instituteId: membership[0]!.instituteId,
      status: membership[0]!.status,
      roles: roles.map((r) => r.role),
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

  async addRole(membershipId: string, role: string): Promise<void> {
    await this.db.insert(membershipRoles).values({ membershipId, role });
  }
}
