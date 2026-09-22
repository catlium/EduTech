import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { institutes, plans, instituteSubscriptions } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';

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

/**
 * Institute lifecycle mutations (institute-lifecycle §7) — platform plane
 * only. The conditional UPDATE doubles as the state-transition guard: a row
 * only flips when it is in the expected source state, so a repeat call (or a
 * concurrent opposite flip) updates 0 rows and we distinguish 404 from 409
 * with one existence probe. Memberships, institute data, and auth sessions
 * are never touched; TenantGuard reads `status` DB-fresh on the next request.
 */
@Injectable()
export class PlatformInstitutesService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

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
    const [plan] = await this.db
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.code, input.planCode), eq(plans.isActive, true)))
      .limit(1);
    if (!plan) throw new BadRequestException(`Plan '${input.planCode}' is unknown or not active`);
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
}
