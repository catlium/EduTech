import { StatusBadge } from "./status-badge";
import type { MaterialProcessingStatus } from "@catlium/contracts";

export function ProcessingStatus({
  processingStatus,
  jobId,
}: {
  processingStatus: MaterialProcessingStatus;
  jobId?: string | null;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <StatusBadge status={processingStatus} />
      {(processingStatus === "PROCESSING" || processingStatus === "QUEUED") && jobId && (
        <span className="text-muted-foreground">Job {jobId.slice(0, 8)}</span>
      )}
    </div>
  );
}