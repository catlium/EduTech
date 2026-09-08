import Link from "next/link";
import { BookOpen } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "./status-badge";
import type { SubjectResponse } from "@catlium/contracts";

export function SubjectCard({ subject }: { subject: SubjectResponse }) {
  return (
    <Link href={`/subjects/${subject.id}`} className="group block">
      <Card className="transition-shadow group-hover:shadow-md">
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="mt-0.5 size-4 text-muted-foreground" />
            <CardTitle className="text-base font-medium">{subject.name}</CardTitle>
          </div>
          <StatusBadge status={subject.status} />
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-sm text-muted-foreground truncate">
            {subject.description ?? subject.slug}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}