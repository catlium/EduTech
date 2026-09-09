import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "violet";

const toneMap: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "bg-red-500/10 text-red-700 dark:text-red-400",
  info: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  violet: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
};

const statusTone: Record<string, Tone> = {
  ACTIVE: "success",
  active: "success",
  READY: "success",
  APPROVED: "success",
  COMPLETED: "info",
  SUBMITTED: "info",
  EXPIRED: "neutral",
  IN_PROGRESS: "info",
  DRAFT: "neutral",
  REVIEW: "warning",
  PENDING: "warning",
  PENDING_REVIEW: "warning",
  QUEUED: "warning",
  PROCESSING: "info",
  UPLOADED: "neutral",
  FAILED: "danger",
  REJECTED: "danger",
  ARCHIVED: "neutral",
  PUBLISHED: "info",
  CONFIRMED: "success",
  MANUAL: "success",
  AI_GENERATED: "violet",
};

export function StatusBadge({
  status,
  tone,
  className,
}: {
  status: string;
  tone?: Tone;
  className?: string;
}) {
  const resolved = tone ?? statusTone[status] ?? "neutral";
  return (
    <Badge
      variant="secondary"
      className={cn("font-medium", toneMap[resolved], className)}
    >
      {status.replace(/_/g, " ")}
    </Badge>
  );
}