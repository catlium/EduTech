'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronRight, ChevronDown, Plus, FileText, Circle } from 'lucide-react';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from './status-badge';
import type { ChapterResponse, TopicResponse } from '@catlium/contracts';

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
          {isTeacher && ' Add chapters to organize topics.'}
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
  const [newTopicName, setNewTopicName] = useState('');
  const [adding, setAdding] = useState(false);
  const [topicCounts, setTopicCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!expanded || topics.length > 0) return;
    let cancelled = false;
    setLoading(true);
    api<{ topics: TopicResponse[] }>(`/academic/chapters/${chapter.id}/topics`)
      .then(({ topics: t }) => {
        if (cancelled) return;
        setTopics(t);
        t.forEach((topic) => {
          api<{ materials: { id: string }[] }>(`/materials?topicId=${topic.id}`)
            .then(({ materials }) => {
              if (!cancelled) setTopicCounts((prev) => ({ ...prev, [topic.id]: materials.length }));
            })
            .catch(() => {
              /* count stays 0 */
            });
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, chapter.id, topics.length]);

  async function addTopic() {
    const name = newTopicName.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      const { topic } = await api<{ topic: TopicResponse }>(
        `/academic/chapters/${chapter.id}/topics`,
        { method: 'POST', body: { name, slug } },
      );
      setTopics((prev) => [...prev, topic]);
      setNewTopicName('');
    } catch {
      /* toast handled by caller or leave silent */
    } finally {
      setAdding(false);
    }
  }

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
        <StatusBadge status={chapter.status} className="ml-1" />
        <span className="ml-auto text-xs text-muted-foreground">
          {expanded ? `${topics.length} topic${topics.length !== 1 ? 's' : ''}` : '...'}
        </span>
      </button>
      {expanded && (
        <div className="border-t bg-muted/30 px-4 py-2 space-y-2">
          {loading ? (
            <div className="space-y-2 py-2">
              <div className="h-6 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-6 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          ) : topics.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No topics. {isTeacher ? 'Add topics to this chapter.' : ''}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {topics
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((topic) => (
                  <li key={topic.id}>
                    <Link
                      href={`/subjects/${subjectId}/topics/${topic.id}`}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/70"
                    >
                      <Circle className="size-1.5 shrink-0 fill-muted-foreground text-muted-foreground" />
                      <span className="truncate">{topic.name}</span>
                      <StatusBadge status={topic.status} />
                      {topicCounts[topic.id] !== undefined && topicCounts[topic.id] > 0 && (
                        <span className="ml-auto rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {topicCounts[topic.id]} material{topicCounts[topic.id] !== 1 ? 's' : ''}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
            </ul>
          )}
          {isTeacher && (
            <div className="flex gap-2 pt-1">
              <Input
                value={newTopicName}
                onChange={(e) => setNewTopicName(e.target.value)}
                placeholder="New topic name..."
                className="h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void addTopic();
                  }
                }}
              />
              <Button
                size="sm"
                className="h-8"
                disabled={adding || !newTopicName.trim()}
                onClick={() => void addTopic()}
              >
                <Plus className="mr-1 size-3" /> Add
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
