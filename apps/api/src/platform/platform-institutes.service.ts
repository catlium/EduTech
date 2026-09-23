import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { and, asc, count, desc, eq } from 'drizzle-orm';
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
  platformAuditEvents,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import { normalizeEmail } from '@catlium/shared';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { RoleAssignmentService } from '../authorization/role-assignment.service.js';
import { INSTITUTE_ADMIN } from '../authorization/permission-catalogue.js';
import { isUniqueViolation } from '../common/utils/db-errors.util.js';
import {
  PlatformAuditService,
  PLATFORM_AUDIT_ACTIONS,
} from './platform-audit.service.js';
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

export interface PlatformAuditEventView {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  instituteId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  actor: { userId: string; email: string; name: string } | null;
}

export interface PlatformAuditEventPage {
  events: PlatformAuditEventView[];
  total: number;
  limit: number;
  offset: number;
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

export interface PlatformPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
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
    private readonly audit: PlatformAuditService,
  ) {}

  // ── Lifecycle mutations (§7) ─────────────────────────────────────────

  /**
   * Deactivate an institute. The conditional UPDATE doubles as the
   * state-transition guard; the `institute.deactivate` audit event is written
   * in the same transaction, ONLY on the changed-row success path — a 0-row
   * update (invalid transition) throws 409/404 and no event survives.
   */
  async deactivate(id: string, actorUserId: string): Promise<InstituteLifecycleResult> {
    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(institutes)
        .set({ status: 'deactivated', deactivatedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(institutes.id, id), eq(institutes.status, 'active')))
        .returning({
          id: institutes.id,
          status: institutes.status,
          deactivatedAt: institutes.deactivatedAt,
        });
      if (!row) return undefined;
      await this.audit.record(tx, {
        actorUserId,
        action: PLATFORM_AUDIT_ACTIONS.INSTITUTE_DEACTIVATE,
        resourceType: 'institute',
        resourceId: id,
        instituteId: id,
        metadata: { status: 'deactivated' },
      });
      return row;
    });
    if (updated) return updated;
    return this.rejectTransition(id, 'already deactivated');
  }

  /**
   * Reactivate an institute — mirror of `deactivate` (event only on the
   * changed-row success path).
   */
  async reactivate(id: string, actorUserId: string): Promise<InstituteLifecycleResult> {
    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(institutes)
        .set({ status: 'active', deactivatedAt: null, updatedAt: new Date() })
        .where(and(eq(institutes.id, id), eq(institutes.status, 'deactivated')))
        .returning({
          id: institutes.id,
          status: institutes.status,
          deactivatedAt: institutes.deactivatedAt,
        });
      if (!row) return undefined;
      await this.audit.record(tx, {
        actorUserId,
        action: PLATFORM_AUDIT_ACTIONS.INSTITUTE_REACTIVATE,
        resourceType: 'institute',
        resourceId: id,
        instituteId: id,
        metadata: { status: 'active' },
      });
      return row;
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
  async create(dto: CreateInstituteDto, actorUserId: string): Promise<InstituteDetail> {
    const slug = dto.slug ?? this.slugify(dto.name);
    const effectivePlanCode = dto.planCode ?? 'starter';
    const plan = await this.resolveActivePlanId(effectivePlanCode);

    let instituteId: string;
    try {
      instituteId = await this.db.transaction(async (tx) => {
        const [inst] = await tx
          .insert(institutes)
          .values({ name: dto.name, slug })
          .returning({ id: institutes.id });
        await tx.insert(instituteSubscriptions).values({ instituteId: inst.id, planId: plan.id });
        await this.audit.record(tx, {
          actorUserId,
          action: PLATFORM_AUDIT_ACTIONS.INSTITUTE_CREATE,
          resourceType: 'institute',
          resourceId: inst.id,
          instituteId: inst.id,
          metadata: { name: dto.name, slug, planCode: effectivePlanCode },
        });
        if (dto.primaryAdmin) {
          const attached = await this.attachPrimaryAdmin(tx, inst.id, dto.primaryAdmin);
          await this.audit.record(tx, {
            actorUserId,
            action: PLATFORM_AUDIT_ACTIONS.INSTITUTE_PRIMARY_ADMIN_ATTACH,
            resourceType: 'institute',
            resourceId: inst.id,
            instituteId: inst.id,
            metadata: {
              email: attached.email,
              provisionedUser: attached.provisionedUser,
              userId: attached.userId,
              membershipId: attached.membershipId,
              role: INSTITUTE_ADMIN,
            },
          });
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
  async update(id: string, dto: UpdateInstituteDto, actorUserId: string): Promise<InstituteSummary> {
    const patch: Partial<typeof institutes.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.slug !== undefined) patch.slug = dto.slug;

    try {
      const row = await this.db.transaction(async (tx) => {
        const [before] = await tx
          .select({ name: institutes.name, slug: institutes.slug })
          .from(institutes)
          .where(eq(institutes.id, id))
          .limit(1);
        if (!before) throw new NotFoundException('Institute not found');

        const [updated] = await tx
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

        // Only the fields that changed end up in `before`/`after`; an empty
        // PATCH is a no-op event.
        const beforeChanges: Record<string, string> = {};
        const afterChanges: Record<string, string> = {};
        if (dto.name !== undefined) {
          beforeChanges.name = before.name;
          afterChanges.name = patch.name!;
        }
        if (dto.slug !== undefined) {
          beforeChanges.slug = before.slug;
          afterChanges.slug = patch.slug!;
        }
        await this.audit.record(tx, {
          actorUserId,
          action: PLATFORM_AUDIT_ACTIONS.INSTITUTE_UPDATE,
          resourceType: 'institute',
          resourceId: id,
          instituteId: id,
          metadata: { changes: { before: beforeChanges, after: afterChanges } },
        });
        return updated;
      });
      return row!;
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

  // ── Audit trail read surface (platform-audit-trail §10) ─────────────

  /**
   * Audit events for a platform institute (audit-trail §10). Strictly scoped
   * to the requested institute; newest-first; limit/offset pagination following
   * the API list conventions. Actors are joined to users — user rows are never
   * deleted, so a deactivated/renamed operator still resolves; null rows are
   * automated/system actors. Metadata is rendered verbatim by clients: it
   * carries the documented per-action payload (§5), never DB internals.
   */
  async listAuditEvents(
    id: string,
    limit: number,
    offset: number,
  ): Promise<PlatformAuditEventPage> {
    const [exists] = await this.db
      .select({ id: institutes.id })
      .from(institutes)
      .where(eq(institutes.id, id))
      .limit(1);
    if (!exists) throw new NotFoundException('Institute not found');

    const [totalRow, rows] = await Promise.all([
      this.db
        .select({ n: count() })
        .from(platformAuditEvents)
        .where(eq(platformAuditEvents.instituteId, id)),
      this.db
        .select({
          id: platformAuditEvents.id,
          action: platformAuditEvents.action,
          resourceType: platformAuditEvents.resourceType,
          resourceId: platformAuditEvents.resourceId,
          instituteId: platformAuditEvents.instituteId,
          metadata: platformAuditEvents.metadata,
          createdAt: platformAuditEvents.createdAt,
          actorUserId: users.id,
          actorEmail: users.email,
          actorName: users.name,
        })
        .from(platformAuditEvents)
        .leftJoin(users, eq(users.id, platformAuditEvents.actorUserId))
        .where(eq(platformAuditEvents.instituteId, id))
        // createdAt is effectively monotonic, but a batch mutation commits one
        // tx/one now(); id desc keeps same-timestamp rows deterministic.
        .orderBy(desc(platformAuditEvents.createdAt), desc(platformAuditEvents.id))
        .limit(limit)
        .offset(offset),
    ]);

    return {
      events: rows.map((row) => ({
        id: row.id,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        instituteId: row.instituteId,
        metadata: row.metadata,
        createdAt: row.createdAt,
        actor: row.actorUserId
          ? { userId: row.actorUserId, email: row.actorEmail ?? '', name: row.actorName ?? '' }
          : null,
      })),
      total: Number(totalRow[0]?.n ?? 0),
      limit,
      offset,
    };
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
  async updateSubscription(id: string, input: { planCode: string }, actorUserId: string): Promise<InstituteSubscriptionResult> {
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
    // The previous plan is read inside the tx (before the upsert) so the audit
    // `fromPlanCode` is exactly what this mutation replaced; null only in the
    // exotic no-ledger first-assignment case (create always seeds the ledger).
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ planCode: plans.code })
        .from(instituteSubscriptions)
        .innerJoin(plans, eq(instituteSubscriptions.planId, plans.id))
        .where(eq(instituteSubscriptions.instituteId, id))
        .limit(1);
      await tx
        .insert(instituteSubscriptions)
        .values({ instituteId: id, planId: plan.id })
        .onConflictDoUpdate({
          target: instituteSubscriptions.instituteId,
          set: { planId: plan.id, updatedAt: new Date() },
        });
      await this.audit.record(tx, {
        actorUserId,
        action: PLATFORM_AUDIT_ACTIONS.INSTITUTE_PLAN_CHANGE,
        resourceType: 'institute',
        resourceId: id,
        instituteId: id,
        metadata: { fromPlanCode: current?.planCode ?? null, toPlanCode: input.planCode },
      });
    });

    return this.getSubscription(id);
  }

  // ── Plan catalog (§9) ─────────────────────────────────────────────

  /** Assignable plans for the console's create/update surfaces — active plans
   *  only, exactly the set `resolveActivePlanId` accepts. No billing/limit
   *  fields: the ledger has none, so nothing internal is exposed. */
  async listPlans(): Promise<PlatformPlan[]> {
    return this.db
      .select({
        id: plans.id,
        code: plans.code,
        name: plans.name,
        description: plans.description,
      })
      .from(plans)
      .where(eq(plans.isActive, true))
      .orderBy(asc(plans.code));
  }

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
   * role). Returns the disposition details needed by the audit attach event.
   */
  private async attachPrimaryAdmin(
    tx: Tx,
    instituteId: string,
    admin: PrimaryAdminDto,
  ): Promise<{ email: string; provisionedUser: boolean; userId: string; membershipId: string; role: string }> {
    const email = normalizeEmail(admin.email);
    const [existing] = await tx.select().from(users).where(eq(users.email, email)).limit(1);

    let userId: string;
    let provisionedUser = false;
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
      provisionedUser = true;
    }

    const [membership] = await tx.insert(memberships).values({ userId, instituteId }).returning();
    if (!membership) throw new Error('failed to create membership');
    const roleId = await this.roleAssignment.resolveRoleId(instituteId, INSTITUTE_ADMIN);
    await tx.insert(membershipRoles).values({ membershipId: membership.id, roleId });
    return { email, provisionedUser, userId: membership.userId, membershipId: membership.id, role: INSTITUTE_ADMIN };
  }

  private slugify(name: string): string {
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || `institute-${randomUUID().slice(0, 8)}`;
  }
}