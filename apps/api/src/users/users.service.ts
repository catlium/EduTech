import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import * as bcryptjs from 'bcryptjs';

import { users, memberships, membershipRoles } from '@catlium/database';
import type { Database } from '@catlium/database';
import { normalizeEmail } from '@catlium/shared';
import { DATABASE_TOKEN } from '../database/database.module.js';
import type { CreateUserDto, UpdateUserStatusDto } from './users.dto.js';

export interface InstituteUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
  status: string;
  createdAt: Date;
}

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async listInstituteUsers(instituteId: string): Promise<InstituteUser[]> {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        createdAt: users.createdAt,
        membershipId: memberships.id,
        membershipStatus: memberships.status,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.instituteId, instituteId));

    if (rows.length === 0) return [];

    const roleIds = [...new Set(rows.map((r) => r.membershipId))];
    const roleRows = await this.db
      .select()
      .from(membershipRoles)
      .where(inArray(membershipRoles.membershipId, roleIds));

    const perMembership = new Map<string, string[]>();
    for (const r of roleRows) {
      const list = perMembership.get(r.membershipId) ?? [];
      list.push(r.role);
      perMembership.set(r.membershipId, list);
    }

    return rows
      .map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        roles: perMembership.get(r.membershipId) ?? [],
        status: r.membershipStatus,
        createdAt: r.createdAt,
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async createInstituteUser(instituteId: string, dto: CreateUserDto): Promise<InstituteUser> {
    const email = normalizeEmail(dto.email);

    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(users).where(eq(users.email, email)).limit(1);

      let userId: string;
      if (existing) {
        const [already] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.userId, existing.id), eq(memberships.instituteId, instituteId)))
          .limit(1);
        if (already) {
          throw new ConflictException('This user is already a member of the institute');
        }
        userId = existing.id;
      } else {
        const passwordHash = await bcryptjs.hash(dto.password, 12);
        const [created] = await tx
          .insert(users)
          .values({ email, name: dto.name, passwordHash })
          .returning();
        if (!created) throw new Error('failed to create user');
        userId = created.id;
      }

      const [membership] = await tx.insert(memberships).values({ userId, instituteId }).returning();
      if (!membership) throw new Error('failed to create membership');

      await tx.insert(membershipRoles).values({ membershipId: membership.id, role: dto.role });

      return {
        id: userId,
        email,
        name: existing?.name ?? dto.name,
        roles: [dto.role],
        status: membership.status,
        createdAt: existing?.createdAt ?? new Date(),
      };
    });
  }

  async setMembershipStatus(
    instituteId: string,
    actorMembershipId: string,
    userId: string,
    dto: UpdateUserStatusDto,
  ): Promise<InstituteUser> {
    const membership = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.instituteId, instituteId)))
      .limit(1);

    if (membership.length === 0) {
      throw new NotFoundException('User is not a member of this institute');
    }
    if (membership[0]!.id === actorMembershipId) {
      throw new BadRequestException('You cannot change your own membership status');
    }

    await this.db
      .update(memberships)
      .set({ status: dto.status, updatedAt: new Date() })
      .where(eq(memberships.id, membership[0]!.id));

    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    const roles = await this.db
      .select()
      .from(membershipRoles)
      .where(eq(membershipRoles.membershipId, membership[0]!.id));

    return {
      id: userId,
      email: user!.email,
      name: user!.name,
      roles: roles.map((r) => r.role),
      status: dto.status,
      createdAt: user!.createdAt,
    };
  }
}
