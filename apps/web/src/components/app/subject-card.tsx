import Link from "next/link";
import { BookOpen, ArrowRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "./status-badge";
import type { SubjectResponse } from "@catlium/contracts";

export function SubjectCard({ subject }: { subject: SubjectResponse }) {
  return (
    <Link href={`/subjects/${subject.id}`} className="group block">
      <Card className="transition-shadow group-hover:shadow-md">
        <CardContent className="flex items-start gap-4 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpen className="size-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-medium">{subject.name}</h3>
              <StatusBadge status={subject.status} />
            </div>
            <p className="line-clamp-1 text-xs text-muted-foreground">
              {subject.description ?? subject.slug}
            </p>
          </div>
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </CardContent>
      </Card>
    </Link>
  );
}
