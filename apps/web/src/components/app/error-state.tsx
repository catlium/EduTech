import { AlertTriangle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this content. Please try again.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <Alert variant="destructive" className="max-w-lg">
      <AlertTriangle className="size-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>{description}</span>
        {onRetry && (
          <Button size="sm" variant="destructive" type="button" onClick={onRetry}>
            <RefreshCw className="mr-1.5 size-3.5" /> Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}