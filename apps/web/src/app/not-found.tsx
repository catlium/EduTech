import { Compass } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <EmptyState
        icon={<Compass className="size-5" />}
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved."
      >
        <Button size="sm" asChild>
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </EmptyState>
    </div>
  );
}