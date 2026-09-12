"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { X, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";

export interface ScopeCascade {
  subjectId: string;
  chapterId: string;
  topicId: string;
}

export function emptyCascade(): ScopeCascade {
  return { subjectId: "", chapterId: "", topicId: "" };
}

export function ScopeBreadcrumb({
  subjectId,
  chapterId,
  topicId,
}: {
  subjectId?: string | null;
  chapterId?: string | null;
  topicId?: string | null;
}) {
  const [names, setNames] = useState<{ subject?: string; chapter?: string; topic?: string }>({});

  useEffect(() => {
    let cancelled = false;
    const fetchName = (kind: "subject" | "chapter" | "topic", id?: string | null) => {
      if (!id) return Promise.resolve(undefined);
      return api<Record<string, { name: string }>>(`/academic/${kind}s/${id}`)
        .then((r) => r[kind]?.name)
        .catch(() => undefined);
    };
    Promise.all([
      fetchName("subject", subjectId),
      fetchName("chapter", chapterId),
      fetchName("topic", topicId),
    ]).then(([subject, chapter, topic]) => {
      if (!cancelled) setNames({ subject, chapter, topic });
    });
    return () => {
      cancelled = true;
    };
  }, [subjectId, chapterId, topicId]);

  const crumbs = [names.subject, names.chapter, names.topic].filter(Boolean) as string[];
  if (crumbs.length === 0) return null;

  return (
    <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
      {crumbs.map((c, i) => (
        <span key={c} className="inline-flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="size-3.5" />}
          {c}
        </span>
      ))}
    </p>
  );
}

export function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium">
      {label}
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground"
        onClick={onClear}
        aria-label={`Clear ${label}`}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

export function ScopeCascade({
  cascade,
  subjects,
  chapters,
  topics,
  onChange,
  disabled,
}: {
  cascade: ScopeCascade;
  subjects: { id: string; name: string }[];
  chapters: { id: string; name: string; subjectId: string }[];
  topics: { id: string; name: string; chapterId: string }[];
  onChange: (next: ScopeCascade) => void;
  disabled?: boolean;
}) {
  const chapterOptions = chapters.filter((c) => c.subjectId === cascade.subjectId);
  const topicOptions = topics.filter((t) => t.chapterId === cascade.chapterId);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="grid gap-2">
        <Label>Subject</Label>
        <Select
          value={cascade.subjectId}
          onValueChange={(v) => onChange({ subjectId: v, chapterId: "", topicId: "" })}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select subject" />
          </SelectTrigger>
          <SelectContent>
            {subjects.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label>Chapter</Label>
        <Select
          value={cascade.chapterId}
          onValueChange={(v) => onChange({ ...cascade, chapterId: v, topicId: "" })}
          disabled={disabled || !cascade.subjectId}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select chapter" />
          </SelectTrigger>
          <SelectContent>
            {chapterOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label>Topic</Label>
        <Select
          value={cascade.topicId}
          onValueChange={(v) => onChange({ ...cascade, topicId: v })}
          disabled={disabled || !cascade.chapterId}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select topic" />
          </SelectTrigger>
          <SelectContent>
            {topicOptions.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
