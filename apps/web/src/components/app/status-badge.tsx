import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const variantMap: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 hover:bg-emerald-50",
  active: "bg-emerald-50 text-emerald-700 hover:bg-emerald-50",
  READY: "bg-emerald-50 text-emerald-700 hover:bg-emerald-50",
  PUBLISHED: "bg-blue-50 text-blue-700 hover:bg-blue-50",
  APPROVED: "bg-emerald-50 text-emerald-700 hover:bg-emerald-50",
  COMPLETED: "bg-blue-50 text-blue-700 hover:bg-blue-50",
  DRAFT: "bg-zinc-100 text-zinc-600 hover:bg-zinc-100",
  PENDING: "bg-amber-50 text-amber-700 hover:bg-amber-50",
  QUEUED: "bg-amber-50 text-amber-700 hover:bg-amber-50",
  PROCESSING: "bg-blue-50 text-blue-700 hover:bg-blue-50",
  UPLOADED: "bg-zinc-100 text-zinc-600 hover:bg-zinc-100",
  FAILED: "bg-red-50 text-red-700 hover:bg-red-50",
  ARCHIVED: "bg-zinc-100 text-zinc-600 hover:bg-zinc-100",
  REJECTED: "bg-red-50 text-red-700 hover:bg-red-50",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="secondary" className={cn(variantMap[status] ?? "")}>
      {status}
    </Badge>
  );
}