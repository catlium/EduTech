import { Injectable } from '@nestjs/common';

import { platformAuditEvents } from '@catlium/database';
import type { Database } from '@catlium/database';

/**
 * Platform audit event vocabulary (docs/architecture/platform-audit-trail.md
 * §4). Dot-notation, one constant per committed mutation; the analogue of
 * PERMISSION_CATALOGUE — `record` receives a compile-time-checked action, so
 * an unknown action cannot be emitted by accident. Not DB CHECK-constrained:
 * the catalogue grows (platform-user lifecycle, OCR fleet registry) without a
 * migration.
 */
export const PLATFORM_AUDIT_ACTIONS = {
  INSTITUTE_CREATE: 'institute.create',
  INSTITUTE_UPDATE: 'institute.update',
  INSTITUTE_DEACTIVATE: 'institute.deactivate',
  INSTITUTE_REACTIVATE: 'institute.reactivate',
  INSTITUTE_PRIMARY_ADMIN_ATTACH: 'institute.primary_admin.attach',
  INSTITUTE_PLAN_CHANGE: 'institute.plan.change',
  // platform-user lifecycle (platform-user-lifecycle §11) — account-scoped
  // events, institute_id NULL, same-tx semantics as every other action.
  PLATFORM_USER_ATTACH: 'platform_user.attach',
  PLATFORM_USER_DETACH: 'platform_user.detach',
  PLATFORM_USER_SUSPEND: 'platform_user.suspend',
  PLATFORM_USER_REACTIVATE: 'platform_user.reactivate',
} as const;

export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[keyof typeof PLATFORM_AUDIT_ACTIONS];

export interface PlatformAuditEventInput {
  /** null = reserved automated/system actor (scheduled deactivation, future). */
  actorUserId: string | null;
  action: PlatformAuditAction;
  resourceType: string;
  resourceId: string;
  instituteId: string | null;
  /** Per-action fixed shape (§5); no credentials ever. */
  metadata: Record<string, unknown>;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Append-only platform audit writer (§6). `record` executes the event INSERT
 * on the SAME transaction the caller's mutation runs in, so an event row
 * exists iff the mutation committed — success/failure falls out of transaction
 * atomicity. Always called with the open tx client; never opens its own
 * connection/transaction.
 */
@Injectable()
export class PlatformAuditService {
  async record(tx: Tx, event: PlatformAuditEventInput): Promise<void> {
    await tx.insert(platformAuditEvents).values(event);
  }
}