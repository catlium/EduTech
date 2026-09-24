import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import * as bcryptjs from 'bcryptjs';

import { users, memberships, membershipRoles, roles } from '@catlium/database';
import type { Database } from '@catlium/database';
import { normalizeEmail } from '@catlium/shared';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { RoleAssignmentService } from '../authorization/role-assignment.service.js';
import type { CreateUserDto, UpdateUserStatusDto } from './users.dto.js';

export interface InstituteUser {
  id: string;
  email: string;
  name: string;
  // Institute-local membership id — exposed (Q.3) so the teacher-assignment
  // console's roster can target assign/create by membershipId.
  membershipId: string;
  roles: string[];
  status: string;
  createdAt: Date;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly roleAssignment: RoleAssignmentService,
  ) {}

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

    const membershipIds = [...new Set(rows.map((r) => r.membershipId))];
    const roleRows = await this.db
      .select({ membershipId: membershipRoles.membershipId, roleKey: roles.key })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(inArray(membershipRoles.membershipId, membershipIds));

    const perMembership = new Map<string, string[]>();
    for (const r of roleRows) {
      const list = perMembership.get(r.membershipId) ?? [];
      list.push(r.roleKey);
      perMembership.set(r.membershipId, list);
    }

    return rows
      .map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        membershipId: r.membershipId,
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
        // platform-user-lifecycle §8 — shared attach gate, kept byte-identical
        // to PlatformInstitutesService.attachPrimaryAdmin. A suspended account
        // must not be re-seated into an organization through any route.
        if (existing.status !== 'active') {
          throw new BadRequestException('Primary admin user is not active');
        }
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

      // Phase C: the legacy key-string role resolves to a role_id via the
      // assignment service (built-in-first, same-institute enforced).
      const roleId = await this.roleAssignment.resolveRoleId(instituteId, dto.role);
      await tx.insert(membershipRoles).values({ membershipId: membership.id, roleId });

      return {
        id: userId,
        email,
        name: existing?.name ?? dto.name,
        membershipId: membership.id,
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
    const roleRows = await this.db
      .select({ roleKey: roles.key })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(eq(membershipRoles.membershipId, membership[0]!.id));

    return {
      id: userId,
      email: user!.email,
      name: user!.name,
      membershipId: membership[0]!.id,
      roles: roleRows.map((r) => r.roleKey),
      status: dto.status,
      createdAt: user!.createdAt,
    };
  }

  /**
   * Replace a user's membership role set (Phase C). Same-institute enforced,
   * platform/cross-institute roles rejected by RoleAssignmentService; the
   * actor may never rewrite their own roles (self-escalation).
   */
  async setMembershipRoles(
    instituteId: string,
    actorMembershipId: string,
    userId: string,
    roleIds: string[],
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
      throw new BadRequestException('You cannot change your own membership roles');
    }

    await this.roleAssignment.replaceMembershipRoles(instituteId, membership[0]!.id, roleIds);

    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    const roleRows = await this.db
      .select({ roleKey: roles.key })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(eq(membershipRoles.membershipId, membership[0]!.id));

    return {
      id: userId,
      email: user!.email,
      name: user!.name,
      membershipId: membership[0]!.id,
      roles: roleRows.map((r) => r.roleKey),
      status: membership[0]!.status,
      createdAt: user!.createdAt,
    };
  }
}
