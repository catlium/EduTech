import type { MaterialResponse } from '@catlium/contracts';

import { Progress } from '@/components/ui/progress';

// Aggregate chunk/page progress written by the coordinator to
// `materials.progress`. Shown only while the material is being processed.
export function MaterialProgress({ material }: { material: MaterialResponse }) {
  const progress = material.progress;
  if (!progress || material.processingStatus !== 'PROCESSING') return null;

  const failed = progress.failedChunks > 0;
  const retrying = progress.retryingChunks > 0;

  return (
    <div className="mt-1.5 flex items-center gap-2">
      <Progress value={progress.percent} className="h-1.5 w-24" />
      <span className="text-xs text-muted-foreground">
        Page {progress.pagesProcessed} of {progress.pagesTotal} ·{' '}
        {progress.chunksCompleted}/{progress.chunksTotal} chunks
        {failed ? ` · ${progress.failedChunks} failed` : ''}
        {retrying ? ` · ${progress.retryingChunks} retrying` : ''}
      </span>
    </div>
  );
}