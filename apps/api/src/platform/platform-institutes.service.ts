import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { institutes } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';

export interface InstituteLifecycleResult {
  id: string;
  status: string;
  deactivatedAt: Date | null;
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
}
