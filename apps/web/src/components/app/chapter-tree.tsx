"use client";

import { useState, useEffect } from "react";
import { ChevronRight, ChevronDown, Plus, FileText } from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./status-badge";
import type { ChapterResponse, TopicResponse } from "@catlium/contracts";

export function ChapterTree({
  subjectId,
  isTeacher,
  chapters: initialChapters,
}: {
  subjectId: string;
  isTeacher: boolean;
  chapters: ChapterResponse[];
}) {
  return (
    <div className="space-y-1">
      {initialChapters.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          No chapters yet.
          {isTeacher && " Add chapters to organize topics."}
        </p>
      )}
      {initialChapters
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((chapter) => (
          <ChapterItem
            key={chapter.id}
            subjectId={subjectId}
            chapter={chapter}
            isTeacher={isTeacher}
          />
        ))}
    </div>
  );
}

function ChapterItem({
  subjectId,
  chapter,
  isTeacher,
}: {
  subjectId: string;
  chapter: ChapterResponse;
  isTeacher: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [topics, setTopics] = useState<TopicResponse[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!expanded || topics.length > 0) return;
    setLoading(true);
    api<{ topics: TopicResponse[] }>(`/academic/chapters/${chapter.id}/topics`)
      .then(({ topics }) => setTopics(topics))
      .finally(() => setLoading(false));
  }, [expanded, chapter.id, topics.length]);

  return (
    <div className="rounded-md border">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium truncate">{chapter.name}</span>
        <StatusBadge status={chapter.status} />
        {isTeacher && (
          <span className="ml-auto text-xs text-muted-foreground">
            {expanded ? topics.length : "..."}
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t bg-muted/30 px-4 py-2">
          {loading ? (
            <p className="text-xs text-muted-foreground py-2">Loading topics...</p>
          ) : topics.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No topics. {isTeacher ? "Add topics to this chapter." : ""}
            </p>
          ) : (
            <ul className="space-y-1">
              {topics
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((topic) => (
                  <li
                    key={topic.id}
                    className="flex items-center gap-2 rounded px-2 py-1 text-sm"
                  >
                    <span className="truncate">{topic.name}</span>
                    <StatusBadge status={topic.status} />
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}