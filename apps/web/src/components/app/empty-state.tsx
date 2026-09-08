import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export function EmptyState({
  icon,
  title,
  description,
  children,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <p className="text-sm font-medium">{title}</p>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}