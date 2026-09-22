import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as bcryptjs from 'bcryptjs';

import {
  users,
  institutes,
  memberships,
  membershipRoles,
  roles,
  plans,
  instituteSubscriptions,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import { normalizeEmail } from '@catlium/shared';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { RoleAssignmentService } from '../authorization/role-assignment.service.js';
import { INSTITUTE_ADMIN } from '../authorization/permission-catalogue.js';
import { isUniqueViolation } from '../common/utils/db-errors.util.js';
import type { CreateInstituteDto, PrimaryAdminDto, UpdateInstituteDto } from './platform-institutes.dto.js';

export interface InstituteLifecycleResult {
  id: string;
  status: string;
  deactivatedAt: Date | null;
}

export interface InstituteSubscriptionResult {
  instituteId: string;
  planCode: string;
  planName: string;
  updatedAt: Date;
}

export interface InstituteSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstituteDetail extends InstituteSummary {
  memberCount: number;
  subscription: { planCode: string; planName: string } | null;
}

export interface InstituteAdmin {
  id: string;
  email: string;
  name: string;
  status: string;
  createdAt: Date;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Institute management (lifecycle mutations §7, subscription §9, provision
 * §5/§6, CRUD §11) — platform plane only. Deactivate/reactivate use the
 * conditional UPDATE as the state-transition guard; `create` provisions the
 * tenant shell + subscription ledger + optional primary admin in ONE
 * transaction; `update` is rename/metadata only (status transitions stay owned
 * by the lifecycle mutations); every surface reads/derives exactly the fields
 * the schema supports. Never touches TenantGuard / x-institute-id.
 */
@Injectable()
export class PlatformInstitutesService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly roleAssignment: RoleAssignmentService,
  ) {}

  // ── Lifecycle mutations (§7) ─────────────────────────────────────────

  async deactivate(id: string): Promise<InstituteLifecycleResult> {
    const [updated] = await this.db
      .update(institutes)
      .set({ status: 'deactivated', deactivatedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(institutes.id, id), eq(institutes.status, 'active')))
      .returning({
        id: institutes.id,
        status: institutes.status,
        deactivatedAt: institutes.deactivatedAt,
      });
    if (updated) return updated;
    return this.rejectTransition(id, 'already deactivated');
  }

  async reactivate(id: string): Promise<InstituteLifecycleResult> {
    const [updated] = await this.db
      .update(institutes)
      .set({ status: 'active', deactivatedAt: null, updatedAt: new Date() })
      .where(and(eq(institutes.id, id), eq(institutes.status, 'deactivated')))
      .returning({
        id: institutes.id,
        status: institutes.status,
        deactivatedAt: institutes.deactivatedAt,
      });
    if (updated) return updated;
    return this.rejectTransition(id, 'already active');
  }

  private async rejectTransition(id: string, reason: string): Promise<never> {
    const [existing] = await this.db
      .select({ id: institutes.id })
      .from(institutes)
      .where(eq(institutes.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException('Institute not found');
    throw new ConflictException(`Institute is ${reason}`);
  }

  // ── CRUD (§11) ───────────────────────────────────────────────────────

  /** List institutes, optionally filtered by status. */
  async list(status?: string): Promise<InstituteSummary[]> {
    if (status !== undefined && status !== 'active' && status !== 'deactivated') {
      throw new BadRequestException("status must be 'active' or 'deactivated'");
    }
    const fields = {
      id: institutes.id,
      name: institutes.name,
      slug: institutes.slug,
      status: institutes.status,
      deactivatedAt: institutes.deactivatedAt,
      createdAt: institutes.createdAt,
      updatedAt: institutes.updatedAt,
    };
    const q = this.db.select(fields).from(institutes).orderBy(desc(institutes.createdAt));
    if (status) return q.where(eq(institutes.status, status));
    return q;
  }

  /** Institute detail (+ member count + current plan, null subscription → no plan). */
  async get(id: string): Promise<InstituteDetail> {
    const [row] = await this.db
      .select({
        id: institutes.id,
        name: institutes.name,
        slug: institutes.slug,
        status: institutes.status,
        deactivatedAt: institutes.deactivatedAt,
        createdAt: institutes.createdAt,
        updatedAt: institutes.updatedAt,
      })
      .from(institutes)
      .where(eq(institutes.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Institute not found');

    const [countRow] = await this.db
      .select({ n: count() })
      .from(memberships)
      .where(eq(memberships.instituteId, id));
    const [sub] = await this.db
      .select({ planCode: plans.code, planName: plans.name })
      .from(instituteSubscriptions)
      .innerJoin(plans, eq(instituteSubscriptions.planId, plans.id))
      .where(eq(instituteSubscriptions.instituteId, id))
      .limit(1);

    return { ...row, memberCount: Number(countRow?.n ?? 0), subscription: sub ?? null };
  }

  /**
   * Provision a platform institute (institute-lifecycle §5/§6) in one
   * transaction: tenant shell (status 'active') + the write-one-time
   * subscription ledger row (planCode, default 'starter') + an optional
   * primary admin (existing email → attached; new email → provisioned via the
   * documented creation flow). No public/self-registration — platform plane
   * only. Duplicate slug → 409 (schema-unique).
   */
  async create(dto: CreateInstituteDto): Promise<InstituteDetail> {
    const slug = dto.slug ?? this.slugify(dto.name);
    const plan = await this.resolveActivePlanId(dto.planCode ?? 'starter');

    let instituteId: string;
    try {
      instituteId = await this.db.transaction(async (tx) => {
        const [inst] = await tx
          .insert(institutes)
          .values({ name: dto.name, slug })
          .returning({ id: institutes.id });
        await tx.insert(instituteSubscriptions).values({ instituteId: inst.id, planId: plan.id });
        if (dto.primaryAdmin) {
          await this.attachPrimaryAdmin(tx, inst.id, dto.primaryAdmin);
        }
        return inst.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Slug is schema-unique → 409 (design §5). A 23505 that is not the
        // slug is the users-email race on concurrent primary-admin provision.
        const [dupe] = await this.db
          .select({ id: institutes.id })
          .from(institutes)
          .where(eq(institutes.slug, slug))
          .limit(1);
        if (dupe) throw new ConflictException('An institute with this slug already exists');
        throw new ConflictException('Primary admin email is already in use');
      }
      throw error;
    }

    return this.get(instituteId);
  }

  /** Rename / metadata update only — status transitions belong to deactivate/reactivate. */
  async update(id: string, dto: UpdateInstituteDto): Promise<InstituteSummary> {
    const patch: Partial<typeof institutes.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.slug !== undefined) patch.slug = dto.slug;

    try {
      const [row] = await this.db
        .update(institutes)
        .set(patch)
        .where(eq(institutes.id, id))
        .returning({
          id: institutes.id,
          name: institutes.name,
          slug: institutes.slug,
          status: institutes.status,
          deactivatedAt: institutes.deactivatedAt,
          createdAt: institutes.createdAt,
          updatedAt: institutes.updatedAt,
        });
      if (!row) throw new NotFoundException('Institute not found');
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An institute with this slug already exists');
      }
      throw error;
    }
  }

  /** Memberships holding INSTITUTE_ADMIN on this institute (platform plane, §6 listing). */
  async listAdmins(id: string): Promise<InstituteAdmin[]> {
    const [exists] = await this.db
      .select({ id: institutes.id })
      .from(institutes)
      .where(eq(institutes.id, id))
      .limit(1);
    if (!exists) throw new NotFoundException('Institute not found');

    return this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        status: memberships.status,
        createdAt: users.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(and(eq(memberships.instituteId, id), eq(roles.key, INSTITUTE_ADMIN)))
      .orderBy(desc(users.createdAt));
  }

  // ── Subscription (§9) ────────────────────────────────────────────────

  /**
   * Current subscription of an institute (institute-lifecycle §9). Platform
   * plane, institutes.read. One row per institute (PK institute_id), joined to
   * the plan catalog for the human-readable code/name.
   */
  async getSubscription(id: string): Promise<InstituteSubscriptionResult> {
    const [row] = await this.db
      .select({
        instituteId: instituteSubscriptions.instituteId,
        planCode: plans.code,
        planName: plans.name,
        updatedAt: instituteSubscriptions.updatedAt,
      })
      .from(instituteSubscriptions)
      .innerJoin(plans, eq(instituteSubscriptions.planId, plans.id))
      .where(eq(instituteSubscriptions.instituteId, id))
      .limit(1);
    if (row) return row;
    const [existing] = await this.db
      .select({ id: institutes.id })
      .from(institutes)
      .where(eq(institutes.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException('Institute not found');
    throw new NotFoundException('Institute has no subscription');
  }

  /**
   * Attach/switch an institute's plan (institute-lifecycle §9). Platform plane,
   * institutes.manage. Validated against the seeded catalog; only is_active
   * plans are assignable. Upsert on the institute_id PK preserves the
   * one-row-per-institute invariant. The plan assignment is decoupled from the
   * institute lifecycle gate: institutes.status stays `active`/`deactivated`
   * exactly as the lifecycle mutations left it — switching a plan never
   * deactivates or reactivates an institute (TenantGuard remains the sole
   * tenant-access gate), and it works regardless of subscription state because
   * the ledger is untied to institute status.
   */
  async updateSubscription(id: string, input: { planCode: string }): Promise<InstituteSubscriptionResult> {
    if (typeof input?.planCode !== 'string' || input.planCode.length === 0) {
      throw new BadRequestException('planCode is required');
    }
    const plan = await this.resolveActivePlanId(input.planCode);
    const [existing] = await this.db
      .select({ id: institutes.id })
      .from(institutes)
      .where(eq(institutes.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException('Institute not found');

    // Upsert keeps exactly one subscription row per institute (PK invariant).
    await this.db.transaction(async (tx) => {
      await tx
        .insert(instituteSubscriptions)
        .values({ instituteId: id, planId: plan.id })
        .onConflictDoUpdate({
          target: instituteSubscriptions.instituteId,
          set: { planId: plan.id, updatedAt: new Date() },
        });
    });

    return this.getSubscription(id);
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private async resolveActivePlanId(code: string): Promise<{ id: string }> {
    const [plan] = await this.db
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.code, code), eq(plans.isActive, true)))
      .limit(1);
    if (!plan) throw new BadRequestException(`Plan '${code}' is unknown or not active`);
    return plan;
  }

  /**
   * Primary admin disposition (institute-lifecycle §6), inside the provision
   * transaction: existing email → attach (rejects a deactivated user, rejects
   * a duplicate membership defensively); new email → provision a user whose
   * password hash is a random unknown — the admin claims the account through
   * the existing password-reset seam (Phase K F5), so this API never hands out
   * credentials. Either way the INSTITUTE_ADMIN role is granted through
   * RoleAssignmentService (built-in-first, no platform role ever a membership
   * role).
   */
  private async attachPrimaryAdmin(tx: Tx, instituteId: string, admin: PrimaryAdminDto): Promise<void> {
    const email = normalizeEmail(admin.email);
    const [existing] = await tx.select().from(users).where(eq(users.email, email)).limit(1);

    let userId: string;
    if (existing) {
      if (existing.status !== 'active') {
        throw new BadRequestException('Primary admin user is not active');
      }
      const [already] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, existing.id), eq(memberships.instituteId, instituteId)))
        .limit(1);
      if (already) throw new ConflictException('This user is already a member of the institute');
      userId = existing.id;
    } else {
      if (!admin.name) {
        throw new BadRequestException('primaryAdmin.name is required to create a new primary admin user');
      }
      const passwordHash = await bcryptjs.hash(randomUUID(), 12);
      const [created] = await tx
        .insert(users)
        .values({ email, name: admin.name, passwordHash })
        .returning();
      if (!created) throw new Error('failed to create primary admin user');
      userId = created.id;
    }

    const [membership] = await tx.insert(memberships).values({ userId, instituteId }).returning();
    if (!membership) throw new Error('failed to create membership');
    const roleId = await this.roleAssignment.resolveRoleId(instituteId, INSTITUTE_ADMIN);
    await tx.insert(membershipRoles).values({ membershipId: membership.id, roleId });
  }

  private slugify(name: string): string {
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || `institute-${randomUUID().slice(0, 8)}`;
  }
}