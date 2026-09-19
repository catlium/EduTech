'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, FileUp, Plus, ScanSearch, Type } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { api, ApiError, uploadFileWithChunks } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useTenant, canManage } from '@/lib/tenant';
import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/app/empty-state';
import { StatusBadge } from '@/components/app/status-badge';
import { SkeletonCards } from '@/components/app/loading';
import { ErrorState } from '@/components/app/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import type { PaperPattern, SubjectResponse } from '@catlium/contracts';
import type { ExtractPaperPatternResponse } from '@catlium/contracts';

export default function PaperPatternsListPage() {
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const router = useRouter();
  const [patterns, setPatterns] = useState<PaperPattern[]>([]);
  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [extractOpen, setExtractOpen] = useState(false);
  const [extractMode, setExtractMode] = useState<'text' | 'file'>('text');
  const [extractText, setExtractText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);

  const load = useCallback(() => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    Promise.all([
      api<{ patterns: PaperPattern[] }>('/paper-patterns', { signal: ctrl.signal }),
      api<{ subjects: SubjectResponse[] }>('/academic/subjects', { signal: ctrl.signal }),
    ])
      .then(([p, s]) => {
        setPatterns(p.patterns);
        setSubjects(s.subjects);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof ApiError ? err.message : 'Failed to load paper patterns');
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute]);

  useEffect(() => {
    return load();
  }, [load]);

  const subjectMap = Object.fromEntries(subjects.map((s) => [s.id, s.name]));
  const filtered =
    subjectFilter === 'all'
      ? patterns
      : patterns.filter((p) => p.subjectIds.length === 0 || p.subjectIds.includes(subjectFilter));

  function patternSubjects(pattern: PaperPattern) {
    if (pattern.subjectIds.length === 0)
      return <span className="text-muted-foreground">General</span>;
    return (
      <span className="text-muted-foreground">
        {pattern.subjectIds.map((id) => subjectMap[id] ?? 'Unknown subject').join(', ')}
      </span>
    );
  }

  async function submitExtraction() {
    if (!institute || extracting) return;
    let response: ExtractPaperPatternResponse;
    try {
      if (extractMode === 'text') {
        if (!extractText.trim()) {
          toast.error('Paste the paper text first');
          return;
        }
        response = await api<ExtractPaperPatternResponse>('/paper-patterns/extract-text', {
          method: 'POST',
          body: { text: extractText },
        });
      } else {
        const file = fileRef.current?.files?.[0];
        if (!file) {
          toast.error('Choose the paper source file first');
          return;
        }
        response = await uploadFileWithChunks<ExtractPaperPatternResponse>(
          '/paper-patterns/extract-file',
          file,
          {},
        );
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to start extraction');
      return;
    }

    setExtracting(true);
    toast.dismiss();
    try {
      // Resource-first: the pattern exists now — land on its page and let the
      // progress banner track the background extraction (or show the reuse).
      toast.success(
        response.extraction.reused ? 'Extraction already done' : 'Extraction started',
      );
      router.push(
        `/paper-patterns/${response.extraction.patternId}?extraction=${response.extraction.jobId}`,
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to open extraction');
    } finally {
      setExtracting(false);
      setExtractOpen(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Paper Patterns"
        description={
          patterns.length > 0
            ? `${patterns.length} pattern${patterns.length !== 1 ? 's' : ''}`
            : undefined
        }
        actions={
          isTeacher && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setExtractOpen(true)}>
                <ScanSearch className="mr-1 size-3.5" /> Extract from Source
              </Button>
              <Button size="sm" asChild>
                <Link href="/paper-patterns/new">
                  <Plus className="mr-1 size-3.5" /> New Pattern
                </Link>
              </Button>
            </div>
          )
        }
      />

      <Dialog open={extractOpen} onOpenChange={(open) => !extracting && setExtractOpen(open)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Extract Paper Pattern</DialogTitle>
            <DialogDescription>
              Paste the exam paper text or upload a PDF/image of it. Only the structure and
              evaluation rules are extracted — ready for your review.
            </DialogDescription>
          </DialogHeader>
          <Tabs
            value={extractMode}
            onValueChange={(v) => setExtractMode(v === 'file' ? 'file' : 'text')}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="text">
                <Type className="mr-1 size-3.5" /> Paste text
              </TabsTrigger>
              <TabsTrigger value="file">
                <FileUp className="mr-1 size-3.5" /> Upload file
              </TabsTrigger>
            </TabsList>
            <TabsContent value="text" className="space-y-3">
              <Label htmlFor="extract-text">Exam paper text</Label>
              <Textarea
                id="extract-text"
                rows={10}
                value={extractText}
                onChange={(e) => setExtractText(e.target.value)}
                placeholder={'Total Marks: 80\nTime: 3 hours\nSection A — MCQ (20 marks)\n…'}
              />
            </TabsContent>
            <TabsContent value="file" className="space-y-3">
              <Label htmlFor="extract-file">PDF or image (PNG/JPEG/WebP)</Label>
              <Input
                id="extract-file"
                ref={fileRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
              />
              <p className="text-xs text-muted-foreground">
                The file is OCR&rsquo;d on upload; printed or photographed past papers work.
                Handwritten-only pages may extract poorly.
              </p>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button onClick={submitExtraction} disabled={extracting} className="w-full sm:w-auto">
              <ScanSearch className="mr-1 size-3.5" />
              {extracting ? 'Extracting…' : 'Extract Pattern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!loading && patterns.length > 0 && (
        <div className="mb-4">
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All subjects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {loading ? (
        <SkeletonCards />
      ) : error ? (
        <ErrorState onRetry={load} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-8" />}
          title="No paper patterns yet"
          description="Create a pattern manually or extract one from an existing paper."
        >
          {isTeacher && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setExtractOpen(true)}>
                <ScanSearch className="mr-1 size-3.5" /> Extract from Source
              </Button>
              <Button size="sm" asChild>
                <Link href="/paper-patterns/new">Create Pattern</Link>
              </Button>
            </div>
          )}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {filtered.map((pattern) => (
            <Card
              key={pattern.id}
              className="cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => router.push(`/paper-patterns/${pattern.id}`)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{pattern.title || 'Untitled pattern'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={pattern.status} />
                  {pattern.structure && (
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">
                      {pattern.structure.totalMarks ?? '—'} marks
                    </span>
                  )}
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">
                    {pattern.sourceType}
                  </span>
                  {patternSubjects(pattern)}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>Updated {formatDate(pattern.updatedAt)}</span>
                  {pattern.validatedAt && <span>Validated {formatDate(pattern.validatedAt)}</span>}
                  {pattern.approvedAt && <span>Approved {formatDate(pattern.approvedAt)}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
