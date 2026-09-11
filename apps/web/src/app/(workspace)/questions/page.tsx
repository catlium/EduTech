"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import {
  Archive,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleCheck,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { cn, formatDate } from "@/lib/utils";
import { useTenant, canManage } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { StatusBadge } from "@/components/app/status-badge";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { SkeletonRows } from "@/components/app/loading";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  QuestionListItem,
  QuestionType,
  QuestionDifficulty,
  SubjectResponse,
  ChapterResponse,
  TopicResponse,
  FillInBlankPayload,
  McqPayload,
  TrueFalsePayload,
} from "@catlium/contracts";
import {
  CreateQuestionRequestSchema,
  GenerateQuestionsRequestSchema,
  UpdateQuestionRequestSchema,
  type UpdateQuestionRequest,
} from "@catlium/contracts";

const QUESTION_TYPES = ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK"] as const;
const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;
const STATUS_TABS = ["all", "PENDING", "APPROVED", "REJECTED"] as const;

const DEFAULT_CASCADE = { subjectId: "", chapterId: "", topicId: "" };
type Cascade = typeof DEFAULT_CASCADE;

const ManualFormSchema = z.object({
  stem: z.string().min(1, "Stem is required"),
  questionType: z.enum(QUESTION_TYPES),
  difficulty: z.enum(DIFFICULTIES).or(z.literal("")),
  explanation: z.string().optional(),
});
type ManualFormValues = z.infer<typeof ManualFormSchema>;

const GenerateFormSchema = z.object({
  questionType: z.enum(QUESTION_TYPES),
  count: z.coerce.number().int().min(1, "Between 1 and 50").max(50, "Between 1 and 50"),
  difficulty: z.enum(DIFFICULTIES).or(z.literal("")),
});
type GenerateFormValues = z.infer<typeof GenerateFormSchema>;

interface GenerationStatus {
  status: string;
  error?: { message?: string } | null;
}

function QuestionPreview({ question }: { question: QuestionListItem }) {
  if (question.questionType === "MCQ") {
    const payload = question.payload as unknown as McqPayload;
    return (
      <div className="space-y-1.5">
        {payload.choices.map((choice) => {
          const correct = choice.id === payload.correctChoiceId;
          return (
            <div
              key={choice.id}
              className={cn(
                "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
                correct && "border-emerald-500/50 bg-emerald-500/5",
              )}
            >
              {correct ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <span className={cn(correct && "font-medium")}>{choice.text}</span>
              {correct && (
                <Badge className="ml-auto shrink-0 text-emerald-700 dark:text-emerald-400">
                  Correct
                </Badge>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  if (question.questionType === "TRUE_FALSE") {
    const payload = question.payload as unknown as TrueFalsePayload;
    return (
      <p className="text-sm">
        Answer: <span className="font-medium">{payload.correctAnswer ? "True" : "False"}</span>
      </p>
    );
  }
  const payload = question.payload as unknown as FillInBlankPayload;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">Acceptable answers</p>
      <div className="flex flex-wrap gap-1.5">
        {payload.acceptableAnswers.map((answer, i) => (
          <Badge key={i} variant="secondary">
            {answer}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function ScopeSelects({
  cascade,
  subjects,
  chapters,
  topics,
  onChange,
}: {
  cascade: Cascade;
  subjects: SubjectResponse[];
  chapters: ChapterResponse[];
  topics: TopicResponse[];
  onChange: (next: Cascade) => void;
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
          disabled={!cascade.subjectId}
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
          disabled={!cascade.chapterId}
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

function McqEditor({
  choices,
  correctId,
  setChoices,
  setCorrectId,
}: {
  choices: { id: string; text: string }[];
  correctId: string;
  setChoices: (c: { id: string; text: string }[]) => void;
  setCorrectId: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Choices</Label>
      {choices.map((choice, i) => (
        <div key={choice.id} className="flex items-center gap-2">
          <input
            type="radio"
            name="mcq-correct"
            className="size-4 shrink-0 accent-primary"
            checked={correctId === choice.id}
            onChange={() => setCorrectId(choice.id)}
            aria-label={`Mark choice ${i + 1} as correct`}
          />
          <Input
            value={choice.text}
            placeholder={`Choice ${i + 1}`}
            onChange={(e) => {
              const next = [...choices];
              next[i] = { ...choice, text: e.target.value };
              setChoices(next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={() => {
              const next = choices.filter((c) => c.id !== choice.id);
              setChoices(next);
              if (correctId === choice.id) setCorrectId(next[0]?.id ?? "");
            }}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setChoices([...choices, { id: crypto.randomUUID(), text: "" }])}
      >
        <Plus className="mr-1 size-3.5" /> Add choice
      </Button>
    </div>
  );
}

function FibEditor({
  answers,
  setAnswers,
}: {
  answers: string[];
  setAnswers: (a: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Acceptable answers</Label>
      {answers.map((answer, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={answer}
            placeholder={`Answer ${i + 1}`}
            onChange={(e) => {
              const next = [...answers];
              next[i] = e.target.value;
              setAnswers(next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={() => setAnswers(answers.filter((_, j) => j !== i))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setAnswers([...answers, ""])}
      >
        <Plus className="mr-1 size-3.5" /> Add answer
      </Button>
    </div>
  );
}

export default function QuestionsListPage() {
  const { institute } = useTenant();
  const isTeacher = canManage(institute);

  const [questions, setQuestions] = useState<QuestionListItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectResponse[]>([]);
  const [chapters, setChapters] = useState<ChapterResponse[]>([]);
  const [topics, setTopics] = useState<TopicResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [difficultyFilter, setDifficultyFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuestionListItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<QuestionListItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [createCascade, setCreateCascade] = useState<Cascade>(DEFAULT_CASCADE);
  const [generateCascade, setGenerateCascade] = useState<Cascade>(DEFAULT_CASCADE);

  const [mcqChoices, setMcqChoices] = useState([
    { id: crypto.randomUUID(), text: "" },
    { id: crypto.randomUUID(), text: "" },
  ]);
  const [mcqCorrectId, setMcqCorrectId] = useState("");
  const [tfAnswer, setTfAnswer] = useState(true);
  const [fibAnswers, setFibAnswers] = useState([""]);

  const [editChoices, setEditChoices] = useState<{ id: string; text: string }[]>([]);
  const [editCorrectId, setEditCorrectId] = useState("");
  const [editTfAnswer, setEditTfAnswer] = useState(true);
  const [editFibAnswers, setEditFibAnswers] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);

  const mountedRef = useRef(true);
  const generateOpenRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  useEffect(() => {
    generateOpenRef.current = generateOpen;
  }, [generateOpen]);

  const subjectName = useMemo(() => new Map(subjects.map((s) => [s.id, s.name])), [subjects]);
  const chapterName = useMemo(() => new Map(chapters.map((c) => [c.id, c.name])), [chapters]);
  const topicName = useMemo(() => new Map(topics.map((t) => [t.id, t.name])), [topics]);

  const manualForm = useForm<ManualFormValues>({
    resolver: zodResolver(ManualFormSchema),
    defaultValues: { stem: "", questionType: "MCQ", difficulty: "", explanation: "" },
  });

  const generateForm = useForm<GenerateFormValues>({
    resolver: zodResolver(GenerateFormSchema),
    defaultValues: { questionType: "MCQ", count: 5, difficulty: "" },
  });

  const editForm = useForm<ManualFormValues>({
    resolver: zodResolver(ManualFormSchema),
    defaultValues: { stem: "", questionType: "MCQ", difficulty: "", explanation: "" },
  });

  function openEdit(q: QuestionListItem) {
    setEditTarget(q);
    editForm.reset({
      stem: q.stem,
      questionType: q.questionType,
      difficulty: q.difficulty,
      explanation: q.explanation ?? "",
    });
    if (q.questionType === "MCQ") {
      const payload = q.payload as unknown as McqPayload;
      setEditChoices(payload.choices.map((c) => ({ id: c.id, text: c.text })));
      setEditCorrectId(payload.correctChoiceId);
    } else if (q.questionType === "TRUE_FALSE") {
      const payload = q.payload as unknown as TrueFalsePayload;
      setEditTfAnswer(payload.correctAnswer);
    } else {
      const payload = q.payload as unknown as FillInBlankPayload;
      setEditFibAnswers(payload.acceptableAnswers.map((a) => a));
    }
  }

  const refresh = useCallback(() => {
    if (!institute) return;
    void api<{ questions: QuestionListItem[] }>("/questions")
      .then(({ questions }) => setQuestions(questions))
      .catch(() => {});
  }, [institute]);

  const load = useCallback(() => {
    if (!institute) return;
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    api<{ questions: QuestionListItem[] }>("/questions", { signal: ctrl.signal })
      .then(({ questions }) => {
        if (ctrl.signal.aborted) return;
        setQuestions(questions);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) return;
        setError(err instanceof ApiError ? err.message : "Failed to load questions");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [institute]);

  useEffect(() => {
    return load();
  }, [load]);

  useEffect(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ subjects: SubjectResponse[] }>("/academic/subjects", { signal: ctrl.signal })
      .then(({ subjects }) => setSubjects(subjects))
      .catch(() => {});
    return () => ctrl.abort();
  }, [institute]);

  useEffect(() => {
    if (subjects.length === 0) return;
    const ctrl = new AbortController();
    Promise.all(
      subjects.map((s) =>
        api<{ chapters: ChapterResponse[] }>(`/academic/subjects/${s.id}/chapters`, {
          signal: ctrl.signal,
        }),
      ),
    )
      .then((results) => setChapters(results.flatMap((r) => r.chapters)))
      .catch(() => {});
    return () => ctrl.abort();
  }, [subjects]);

  useEffect(() => {
    if (chapters.length === 0) return;
    const ctrl = new AbortController();
    Promise.all(
      chapters.map((c) =>
        api<{ topics: TopicResponse[] }>(`/academic/chapters/${c.id}/topics`, {
          signal: ctrl.signal,
        }),
      ),
    )
      .then((results) => setTopics(results.flatMap((r) => r.topics)))
      .catch(() => {});
    return () => ctrl.abort();
  }, [chapters]);

  async function runAction(id: string, path: string, success: string) {
    try {
      await api(path, { method: "POST" });
      toast.success(success);
      void refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to ${success.toLowerCase()}`);
    }
  }

  function onApprove(q: QuestionListItem) {
    void runAction(q.id, `/questions/${q.id}/approve`, "Question approved");
  }
  function onReject(q: QuestionListItem) {
    void runAction(q.id, `/questions/${q.id}/reject`, "Question rejected");
  }
  function onArchive(q: QuestionListItem) {
    void runAction(q.id, `/questions/${q.id}/archive`, "Question archived");
  }
  function onActivate(q: QuestionListItem) {
    void runAction(q.id, `/questions/${q.id}/activate`, "Question activated");
  }

  async function onDelete() {
    if (!deleteTarget) return;
    try {
      await api(`/questions/${deleteTarget.id}`, { method: "DELETE" });
      toast.success("Question deleted");
      setDeleteTarget(null);
      if (expandedId === deleteTarget.id) setExpandedId(null);
      void refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete question");
    }
  }

  function resetPayload() {
    setMcqChoices([
      { id: crypto.randomUUID(), text: "" },
      { id: crypto.randomUUID(), text: "" },
    ]);
    setMcqCorrectId("");
    setTfAnswer(true);
    setFibAnswers([""]);
  }

  function buildPayload(
    questionType: QuestionType,
    choices: { id: string; text: string }[],
    correctId: string,
    tfValue: boolean,
    fib: string[],
  ): Record<string, unknown> | null {
    if (questionType === "MCQ") {
      const cleaned = choices.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text);
      if (cleaned.length < 2) {
        toast.error("Add at least 2 choices");
        return null;
      }
      if (!cleaned.some((c) => c.id === correctId)) {
        toast.error("Mark one choice as correct");
        return null;
      }
      return { choices: cleaned, correctChoiceId: correctId };
    }
    if (questionType === "TRUE_FALSE") {
      return { correctAnswer: tfValue };
    }
    const acceptableAnswers = fib.map((a) => a.trim()).filter(Boolean);
    if (acceptableAnswers.length === 0) {
      toast.error("Add at least 1 acceptable answer");
      return null;
    }
    return { acceptableAnswers };
  }

  async function onSaveEdit() {
    if (!editTarget) return;
    const values = editForm.getValues();
    const payload = buildPayload(
      editTarget.questionType,
      editChoices,
      editCorrectId,
      editTfAnswer,
      editFibAnswers,
    );
    if (!payload) return;
    const patch: UpdateQuestionRequest = {
      stem: values.stem,
      difficulty: values.difficulty || editTarget.difficulty,
      explanation: values.explanation || "",
      payload,
    };
    const parsed = UpdateQuestionRequestSchema.safeParse(patch);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid question");
      return;
    }
    setSubmitting(true);
    try {
      await api(`/questions/${editTarget.id}`, { method: "PATCH", body: patch });
      toast.success("Question updated");
      setEditTarget(null);
      void refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update question");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = visible.length > 0 && visible.every((q) => next.has(q.id));
      for (const q of visible) {
        if (allSelected) next.delete(q.id);
        else next.add(q.id);
      }
      return next;
    });
  }

  async function runBatch(action: "approve" | "reject") {
    const ids = [...selected];
    if (ids.length === 0) return;
    setSubmitting(true);
    try {
      const { updated } = await api<{ updated: number }>(
        action === "approve" ? "/questions/batch-approve" : "/questions/batch-reject",
        { method: "POST", body: { questionIds: ids } },
      );
      toast.success(`${updated} question${updated !== 1 ? "s" : ""} ${action}ed`);
      setSelected(new Set());
      void refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to ${action} questions`);
    } finally {
      setSubmitting(false);
    }
  }

  function resetManual() {
    manualForm.reset();
    setCreateCascade(DEFAULT_CASCADE);
    resetPayload();
  }

  async function onCreateManual(values: ManualFormValues) {
    if (!createCascade.topicId) {
      toast.error("Select a topic");
      return;
    }
    let payload: Record<string, unknown>;
    if (values.questionType === "MCQ") {
      const choices = mcqChoices.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text);
      if (choices.length < 2) {
        toast.error("Add at least 2 choices");
        return;
      }
      if (!choices.some((c) => c.id === mcqCorrectId)) {
        toast.error("Mark one choice as correct");
        return;
      }
      payload = { choices, correctChoiceId: mcqCorrectId };
    } else if (values.questionType === "TRUE_FALSE") {
      payload = { correctAnswer: tfAnswer };
    } else {
      const acceptableAnswers = fibAnswers.map((a) => a.trim()).filter(Boolean);
      if (acceptableAnswers.length === 0) {
        toast.error("Add at least 1 acceptable answer");
        return;
      }
      payload = { acceptableAnswers };
    }

    const request = {
      stem: values.stem,
      questionType: values.questionType,
      difficulty: values.difficulty || undefined,
      explanation: values.explanation || undefined,
      source: "MANUAL" as const,
      payload,
      topicId: createCascade.topicId,
    };
    const parsed = CreateQuestionRequestSchema.safeParse(request);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid question");
      return;
    }

    setSubmitting(true);
    try {
      await api("/questions", { method: "POST", body: request });
      toast.success("Question created");
      setCreateOpen(false);
      resetManual();
      void refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create question");
    } finally {
      setSubmitting(false);
    }
  }

  async function onGenerate(values: GenerateFormValues) {
    if (!generateCascade.topicId) {
      toast.error("Select a topic");
      return;
    }
    const request = {
      topicId: generateCascade.topicId,
      questionType: values.questionType,
      count: values.count,
      difficulty: values.difficulty || undefined,
    };
    const parsed = GenerateQuestionsRequestSchema.safeParse(request);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid generation request");
      return;
    }

    setGenerating(true);
    try {
      const { generation } = await api<{ generation: { jobId: string } }>("/questions/generate", {
        method: "POST",
        body: request,
      });
      toast.success("Generation started");
      pollGeneration(generation.jobId);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to start generation");
      setGenerating(false);
    }
  }

  function pollGeneration(jobId: string) {
    if (!mountedRef.current || !generateOpenRef.current) return;
    pollRef.current = setTimeout(async () => {
      if (!mountedRef.current || !generateOpenRef.current) return;
      try {
        const { generation } = await api<{ generation: GenerationStatus }>(
          `/questions/generate/${jobId}`,
        );
        const status = generation.status.toUpperCase();
        if (status === "COMPLETED") {
          toast.success("Questions generated");
          setGenerating(false);
          setGenerateOpen(false);
          generateForm.reset();
          setGenerateCascade(DEFAULT_CASCADE);
          void refresh();
        } else if (status === "FAILED") {
          toast.error(generation.error?.message ?? "Generation failed");
          setGenerating(false);
        } else {
          pollGeneration(jobId);
        }
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Failed to check generation status");
        setGenerating(false);
      }
    }, 2000);
  }

  const pending = questions.filter((q) => q.approvalStatus === "PENDING").length;

  const visible = questions.filter(
    (q) =>
      (statusFilter === "all" || q.approvalStatus === statusFilter) &&
      (typeFilter === "all" || q.questionType === typeFilter) &&
      (difficultyFilter === "all" || q.difficulty === difficultyFilter) &&
      (!search.trim() || q.stem.toLowerCase().includes(search.trim().toLowerCase())),
  );

  const scopeLabel = (q: QuestionListItem): string => {
    if (q.topicId && topicName.has(q.topicId)) return topicName.get(q.topicId)!;
    if (q.chapterId && chapterName.has(q.chapterId)) return chapterName.get(q.chapterId)!;
    if (q.subjectId && subjectName.has(q.subjectId)) return subjectName.get(q.subjectId)!;
    return "—";
  };

  const rowActions = (q: QuestionListItem) => {
    const actions: { label: string; icon: React.ReactNode; onClick: () => void; destructive?: boolean }[] = [];
    actions.push({ label: "Edit", icon: <Pencil className="size-4" />, onClick: () => openEdit(q) });
    if (q.status === "ARCHIVED") {
      actions.push({ label: "Activate", icon: <CheckCircle2 className="size-4" />, onClick: () => onActivate(q) });
    } else if (q.approvalStatus === "PENDING") {
      actions.push({ label: "Approve", icon: <Check className="size-4" />, onClick: () => onApprove(q) });
      actions.push({ label: "Reject", icon: <X className="size-4" />, onClick: () => onReject(q) });
    } else if (q.approvalStatus === "APPROVED") {
      actions.push({ label: "Archive", icon: <Archive className="size-4" />, onClick: () => onArchive(q) });
    } else {
      actions.push({ label: "Activate", icon: <CheckCircle2 className="size-4" />, onClick: () => onActivate(q) });
    }
    actions.push({
      label: "Delete",
      icon: <Trash2 className="size-4" />,
      onClick: () => setDeleteTarget(q),
      destructive: true,
    });
    return actions;
  };

  if (error) {
    return (
      <div>
        <PageHeader title="Question Bank" />
        <ErrorState description={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Question Bank"
        description={`${questions.length} question${questions.length !== 1 ? "s" : ""} · ${pending} pending`}
        actions={
          isTeacher && (
            <>
              <Button size="sm" variant="outline" onClick={() => setGenerateOpen(true)}>
                <Sparkles className="mr-1 size-3.5" /> Ask AI
              </Button>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 size-3.5" /> Add Question
              </Button>
            </>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search questions…"
            className="h-8 w-56 pl-7"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            {STATUS_TABS.map((status) => (
              <TabsTrigger key={status} value={status}>
                {status === "all" ? "All" : status.replace(/_/g, " ")}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {QUESTION_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={difficultyFilter} onValueChange={setDifficultyFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All difficulties</SelectItem>
            {DIFFICULTIES.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isTeacher && visible.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-8"
            onClick={toggleAllVisible}
          >
            {selected.size > 0 && selected.size < visible.length
              ? "Clear visible"
              : visible.every((q) => selected.has(q.id))
                ? "Select none"
                : "Select all"}
          </Button>
        )}
      </div>

      {loading ? (
        <SkeletonRows rows={5} />
      ) : questions.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="size-8" />}
          title="No questions yet"
          description="Generate questions from a topic or add one manually."
        >
          {isTeacher && (
            <Button size="sm" onClick={() => setGenerateOpen(true)}>
              <Sparkles className="mr-1 size-3.5" /> Ask AI
            </Button>
          )}
        </EmptyState>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No questions match the current filters.</p>
      ) : (
        <div className="space-y-3">
          {isTeacher && selected.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-2.5">
              <p className="text-sm">
                <span className="font-medium">{selected.size}</span> selected
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => void runBatch("reject")}
                >
                  <X className="mr-1 size-3.5" /> Reject
                </Button>
                <Button size="sm" disabled={submitting} onClick={() => void runBatch("approve")}>
                  <Check className="mr-1 size-3.5" /> Approve
                </Button>
              </div>
            </div>
          )}
          {visible.map((q) => {
            const expanded = expandedId === q.id;
            return (
              <Card key={q.id}>
                <CardContent className="pt-5">
                  <div className="flex items-start gap-3">
                    {isTeacher && (
                      <Checkbox
                        className="mt-2 shrink-0"
                        checked={selected.has(q.id)}
                        onCheckedChange={() => toggleSelected(q.id)}
                        aria-label={`Select question ${q.stem.slice(0, 40)}`}
                      />
                    )}
                    <button
                      type="button"
                      className="flex-1 text-left"
                      onClick={() => setExpandedId(expanded ? null : q.id)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{q.questionType}</Badge>
                        <StatusBadge status={q.difficulty} />
                        <StatusBadge status={q.approvalStatus} />
                        <StatusBadge status={q.status} />
                        <span className="text-xs text-muted-foreground">{scopeLabel(q)}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(q.createdAt)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium line-clamp-3">{q.stem}</p>
                      <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                        {expanded ? "Hide answer" : "Show answer"}
                      </span>
                    </button>
                    {isTeacher && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8 shrink-0">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {rowActions(q).map((item) => (
                            <DropdownMenuItem
                              key={item.label}
                              onClick={item.onClick}
                              className={item.destructive ? "text-destructive" : undefined}
                            >
                              {item.icon}
                              <span className="ml-2">{item.label}</span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  {expanded && (
                    <div className="mt-4 border-t pt-4">
                      <QuestionPreview question={q} />
                      {q.explanation && (
                        <p className="mt-3 text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">Explanation:</span>{" "}
                          {q.explanation}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(o) => setCreateOpen(o)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Question</DialogTitle>
            <DialogDescription>Create a question manually.</DialogDescription>
          </DialogHeader>
          <form onSubmit={manualForm.handleSubmit(onCreateManual)} className="space-y-4">
            <div className="grid gap-2">
              <Label>Question Type</Label>
              <Select
                value={manualForm.watch("questionType")}
                onValueChange={(v) => {
                  manualForm.setValue("questionType", v as QuestionType);
                  resetPayload();
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ScopeSelects
              cascade={createCascade}
              subjects={subjects}
              chapters={chapters}
              topics={topics}
              onChange={setCreateCascade}
            />
            <div className="grid gap-2">
              <Label>Difficulty</Label>
              <Select
                value={manualForm.watch("difficulty")}
                onValueChange={(v) =>
                  manualForm.setValue("difficulty", v as ManualFormValues["difficulty"])
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No difficulty</SelectItem>
                  {DIFFICULTIES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual-stem">Stem *</Label>
              <Textarea
                id="manual-stem"
                placeholder="Enter the question stem"
                className="min-h-24"
                {...manualForm.register("stem")}
              />
              {manualForm.formState.errors.stem && (
                <p className="text-sm text-destructive">
                  {manualForm.formState.errors.stem.message}
                </p>
              )}
            </div>
            {manualForm.watch("questionType") === "MCQ" && (
              <McqEditor
                choices={mcqChoices}
                correctId={mcqCorrectId}
                setChoices={setMcqChoices}
                setCorrectId={setMcqCorrectId}
              />
            )}
            {manualForm.watch("questionType") === "TRUE_FALSE" && (
              <div className="grid gap-2">
                <Label>Correct answer</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={tfAnswer ? "default" : "outline"}
                    onClick={() => setTfAnswer(true)}
                  >
                    True
                  </Button>
                  <Button
                    type="button"
                    variant={!tfAnswer ? "default" : "outline"}
                    onClick={() => setTfAnswer(false)}
                  >
                    False
                  </Button>
                </div>
              </div>
            )}
            {manualForm.watch("questionType") === "FILL_IN_BLANK" && (
              <FibEditor answers={fibAnswers} setAnswers={setFibAnswers} />
            )}
            <div className="grid gap-2">
              <Label htmlFor="manual-explanation">Explanation</Label>
              <Textarea
                id="manual-explanation"
                placeholder="Optional explanation"
                {...manualForm.register("explanation")}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={generateOpen}
        onOpenChange={(o) => {
          setGenerateOpen(o);
          if (!o) {
            setGenerating(false);
            generateForm.reset();
            setGenerateCascade(DEFAULT_CASCADE);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ask AI</DialogTitle>
            <DialogDescription>Generate questions from a topic.</DialogDescription>
          </DialogHeader>
          <form onSubmit={generateForm.handleSubmit(onGenerate)} className="space-y-4">
            <ScopeSelects
              cascade={generateCascade}
              subjects={subjects}
              chapters={chapters}
              topics={topics}
              onChange={setGenerateCascade}
            />
            <div className="grid gap-2">
              <Label>Question Type</Label>
              <Select
                value={generateForm.watch("questionType")}
                onValueChange={(v) =>
                  generateForm.setValue("questionType", v as QuestionType)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="gen-count">Count</Label>
              <Input
                id="gen-count"
                type="number"
                min={1}
                max={50}
                disabled={generating}
                {...generateForm.register("count", { valueAsNumber: true })}
              />
              {generateForm.formState.errors.count && (
                <p className="text-sm text-destructive">
                  {generateForm.formState.errors.count.message}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label>Difficulty</Label>
              <Select
                value={generateForm.watch("difficulty")}
                onValueChange={(v) =>
                  generateForm.setValue("difficulty", v as GenerateFormValues["difficulty"])
                }
                disabled={generating}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No difficulty</SelectItem>
                  {DIFFICULTIES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setGenerateOpen(false)}
                disabled={generating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={generating}>
                {generating ? "Generating…" : "Generate"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete question"
        description="This permanently removes the question and cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={onDelete}
      />

      <Dialog
        open={editTarget !== null}
        onOpenChange={(o) => !o && setEditTarget(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit question</DialogTitle>
            <DialogDescription>
              Update the stem, difficulty, explanation, or answer payload. The question type and
              scope cannot be changed.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); void onSaveEdit(); }} className="space-y-4">
            <div className="grid gap-2">
              <Label>Question Type</Label>
              <Input value={editTarget?.questionType.replace(/_/g, " ")} disabled />
            </div>
            <div className="grid gap-2">
              <Label>Difficulty</Label>
              <Select
                value={editForm.watch("difficulty")}
                onValueChange={(v) =>
                  editForm.setValue("difficulty", v as ManualFormValues["difficulty"])
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No difficulty</SelectItem>
                  {DIFFICULTIES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-stem">Stem *</Label>
              <Textarea
                id="edit-stem"
                placeholder="Enter the question stem"
                className="min-h-24"
                {...editForm.register("stem")}
              />
              {editForm.formState.errors.stem && (
                <p className="text-sm text-destructive">
                  {editForm.formState.errors.stem.message}
                </p>
              )}
            </div>
            {editTarget?.questionType === "MCQ" && (
              <McqEditor
                choices={editChoices}
                correctId={editCorrectId}
                setChoices={setEditChoices}
                setCorrectId={setEditCorrectId}
              />
            )}
            {editTarget?.questionType === "TRUE_FALSE" && (
              <div className="grid gap-2">
                <Label>Correct answer</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={editTfAnswer ? "default" : "outline"}
                    onClick={() => setEditTfAnswer(true)}
                  >
                    True
                  </Button>
                  <Button
                    type="button"
                    variant={!editTfAnswer ? "default" : "outline"}
                    onClick={() => setEditTfAnswer(false)}
                  >
                    False
                  </Button>
                </div>
              </div>
            )}
            {editTarget?.questionType === "FILL_IN_BLANK" && (
              <FibEditor answers={editFibAnswers} setAnswers={setEditFibAnswers} />
            )}
            <div className="grid gap-2">
              <Label htmlFor="edit-explanation">Explanation</Label>
              <Textarea
                id="edit-explanation"
                placeholder="Optional explanation"
                {...editForm.register("explanation")}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}