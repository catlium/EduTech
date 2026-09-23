'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Building2, History, ShieldAlert, UserRound } from 'lucide-react';
import { toast } from 'sonner';

import { api, ApiError } from '@/lib/api';
import { usePlatform } from '@/lib/platform';
import {
  auditActionLabel,
  auditEventSummary,
  formatDate,
  formatDateTime,
  planName,
  type InstituteAdmin,
  type InstituteDetail,
  type PlatformAuditEventPage,
  type PlatformAuditEventView,
  type PlatformPlan,
} from '@/lib/platform-scope';
import { PageHeader } from '@/components/app/page-header';
import { ErrorState } from '@/components/app/error-state';
import { EmptyState } from '@/components/app/empty-state';
import { SkeletonRows } from '@/components/app/loading';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { StatusBadge } from '@/components/app/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export default function PlatformInstituteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = usePlatform();
  const [detail, setDetail] = useState<InstituteDetail | null>(null);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [admins, setAdmins] = useState<InstituteAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lifecycleConfirm, setLifecycleConfirm] = useState<'deactivate' | 'reactivate' | null>(
    null,
  );
  const [changingPlan, setChangingPlan] = useState(false);

  const AUDIT_PAGE_SIZE = 20;
  const [auditEvents, setAuditEvents] = useState<PlatformAuditEventView[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const loadAudit = useCallback(
    async (offset: number) => {
      setAuditLoading(true);
      setAuditError(null);
      try {
        const page = await api<PlatformAuditEventPage>(
          `/platform/institutes/${id}/audit-events?limit=${AUDIT_PAGE_SIZE}&offset=${offset}`,
        );
        setAuditEvents(page.events);
        setAuditTotal(page.total);
        setAuditOffset(page.offset);
      } catch (err) {
        setAuditError(err instanceof ApiError ? err.message : 'Failed to load audit trail');
      } finally {
        setAuditLoading(false);
      }
    },
    [id],
  );

  const canReadAudit = can('institutes.manage');

  useEffect(() => {
    if (canReadAudit) loadAudit(0);
  }, [canReadAudit, loadAudit]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, catalog, adminRows] = await Promise.all([
        api<InstituteDetail>(`/platform/institutes/${id}`),
        api<PlatformPlan[]>('/platform/plans'),
        api<InstituteAdmin[]>(`/platform/institutes/${id}/admins`),
      ]);
      setDetail(d);
      setPlans(catalog);
      setAdmins(adminRows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load institute');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function setPlan(planCode: string) {
    if (!detail || planCode === detail.subscription?.planCode) return;
    setChangingPlan(true);
    try {
      await api(`/platform/institutes/${id}/subscription`, { method: 'PUT', body: { planCode } });
      toast.success(`Plan switched to ${planName(plans, planCode)}`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update plan');
    } finally {
      setChangingPlan(false);
    }
  }

  async function flipLifecycle() {
    if (!lifecycleConfirm) return;
    const action = lifecycleConfirm;
    try {
      await api(`/platform/institutes/${id}/${action}`, { method: 'POST' });
      toast.success(action === 'deactivate' ? 'Institute deactivated' : 'Institute reactivated');
      setLifecycleConfirm(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update institute status');
    }
  }

  if (loading) return <SkeletonRows rows={4} />;
  if (error)
    return <ErrorState title="Couldn't load institute" description={error} onRetry={load} />;
  if (!detail) return null;

  const currentPlanCode = detail.subscription?.planCode;
  const canManagePlan = can('institutes.manage');
  const canLifecycle = can('institutes.update');

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/platform/institutes">
          <ArrowLeft className="mr-1.5 size-4" /> All institutes
        </Link>
      </Button>

      <PageHeader
        title={detail.name}
        description={<span className="text-muted-foreground">/ {detail.slug}</span>}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={detail.status} />
            {canLifecycle &&
              (detail.status === 'active' ? (
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setLifecycleConfirm('deactivate')}
                >
                  Deactivate
                </Button>
              ) : (
                <Button onClick={() => setLifecycleConfirm('reactivate')}>Reactivate</Button>
              ))}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-4 text-muted-foreground" /> Overview
            </CardTitle>
            <CardDescription>Identity, members & lifecycle</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <DetailRow label="Status" value={<StatusBadge status={detail.status} />} />
            <DetailRow label="Members" value={detail.memberCount} />
            <DetailRow label="Created" value={formatDate(detail.createdAt)} />
            <DetailRow label="Deactivated" value={formatDate(detail.deactivatedAt)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subscription</CardTitle>
            <CardDescription>The plan attached to this institute</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Current plan</span>
              <Badge variant="secondary" className="font-medium">
                {currentPlanCode
                  ? `${planName(plans, currentPlanCode)} (${currentPlanCode})`
                  : 'No plan'}
              </Badge>
            </div>
            {canManagePlan && (
              <>
                <Separator />
                <div className="space-y-1.5">
                  <span className="text-sm text-muted-foreground">Switch plan</span>
                  <Select
                    value={currentPlanCode ?? undefined}
                    onValueChange={setPlan}
                    disabled={changingPlan || plans.length === 0}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a plan" />
                    </SelectTrigger>
                    <SelectContent>
                      {plans.map((plan) => (
                        <SelectItem key={plan.code} value={plan.code}>
                          {plan.name} — {plan.description}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="size-4 text-muted-foreground" /> Primary / institute admins
          </CardTitle>
          <CardDescription>
            Members holding the INSTITUTE_ADMIN role. More admins are added later through the
            institute&apos;s own users administration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {admins.length === 0 ? (
            <EmptyState
              icon={<UserRound className="size-5" />}
              title="No admin yet"
              description="Add one at provision time or through the institute's own users administration."
              className="py-8"
            />
          ) : (
            <div className="space-y-2">
              {admins.map((admin) => (
                <div
                  key={admin.id}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{admin.name || '—'}</p>
                    <p className="truncate text-xs text-muted-foreground">{admin.email}</p>
                  </div>
                  <StatusBadge status={admin.status.toLowerCase()} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-muted-foreground" /> Audit trail
          </CardTitle>
          <CardDescription>
            Platform actions on this institute, newest first. Requires the{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">institutes.manage</code>{' '}
            permission.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!canReadAudit ? (
            <EmptyState
              icon={<History className="size-5" />}
              title="Admin access required"
              description="Only platform admins with institutes.manage can view the audit trail."
              className="py-8"
            />
          ) : auditError ? (
            <div className="space-y-3 py-4 text-center">
              <p className="text-sm text-destructive">{auditError}</p>
              <Button variant="outline" size="sm" onClick={() => loadAudit(auditOffset)}>
                Retry
              </Button>
            </div>
          ) : auditLoading && auditEvents.length === 0 ? (
            <SkeletonRows rows={3} />
          ) : auditEvents.length === 0 ? (
            <EmptyState
              icon={<History className="size-5" />}
              title="No audit events yet"
              description="Platform actions on this institute will appear here once recorded."
              className="py-8"
            />
          ) : (
            <div className="space-y-2">
              {auditEvents.map((event) => {
                const summary = auditEventSummary(event);
                const actor = event.actor ? event.actor.name || event.actor.email : 'System';
                return (
                  <div
                    key={event.id}
                    className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium">{auditActionLabel(event.action)}</p>
                      {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
                      <p className="text-xs text-muted-foreground">
                        {actor} · {formatDateTime(event.createdAt)}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {event.resourceId.slice(0, 8)}
                    </span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between gap-3 pt-1 text-xs text-muted-foreground">
                <span>
                  Showing {auditOffset + 1}–
                  {Math.min(auditOffset + auditEvents.length, auditTotal)} of {auditTotal}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={auditLoading || auditOffset === 0}
                    onClick={() => loadAudit(Math.max(auditOffset - AUDIT_PAGE_SIZE, 0))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={auditLoading || auditOffset + AUDIT_PAGE_SIZE >= auditTotal}
                    onClick={() => loadAudit(auditOffset + AUDIT_PAGE_SIZE)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={lifecycleConfirm !== null}
        onOpenChange={(open) => !open && setLifecycleConfirm(null)}
        title={
          lifecycleConfirm === 'deactivate' ? 'Deactivate institute?' : 'Reactivate institute?'
        }
        description={
          lifecycleConfirm === 'deactivate'
            ? 'The institute becomes inactive immediately. Its members lose tenant access on their next request; no data is deleted.'
            : 'The institute becomes active again. Its members regain tenant access on their next request.'
        }
        confirmLabel={lifecycleConfirm === 'deactivate' ? 'Deactivate' : 'Reactivate'}
        destructive={lifecycleConfirm === 'deactivate'}
        onConfirm={flipLifecycle}
      />
    </div>
  );
}
