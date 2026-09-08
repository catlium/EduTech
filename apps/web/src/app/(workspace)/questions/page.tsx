"use client";

import { useEffect, useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { useTenant, canManage } from "@/lib/tenant";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { QuestionListItem } from "@catlium/contracts";
import { GenerateQuestionsRequestSchema } from "@catlium/contracts";
import type { GenerateQuestionsRequest, GenerateQuestionsResponse } from "@catlium/contracts";

const QUESTION_TYPES = ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK"] as const;

type Generation = {
  status: string;
  error?: { message?: string } | null;
};

export default function QuestionsListPage() {
  const { institute } = useTenant();
  const isTeacher = canManage(institute);
  const [questions, setQuestions] = useState<QuestionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingJob, setGeneratingJob] = useState(false);

  const form = useForm<GenerateQuestionsRequest>({
    resolver: zodResolver(GenerateQuestionsRequestSchema),
    defaultValues: { topicId: "", questionType: "MCQ", count: 5 },
  });

  useEffect(() => {
    if (!institute) return;
    const ctrl = new AbortController();
    api<{ questions: QuestionListItem[] }>("/questions", { signal: ctrl.signal })
      .then(({ questions }) => setQuestions(questions))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [institute]);

  async function refresh() {
    if (!institute) return;
    const { questions } = await api<{ questions: QuestionListItem[] }>("/questions");
    setQuestions(questions);
  }

  async function onApprove(id: string) {
    try {
      await api(`/questions/${id}/approve`, { method: "POST" });
      toast.success("Question approved");
      void refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to approve question");
    }
  }

  async function onReject(id: string) {
    try {
      await api(`/questions/${id}/reject`, { method: "POST" });
      toast.success("Question rejected");
      void refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to reject question");
    }
  }

  async function onGenerate(values: GenerateQuestionsRequest) {
    if (!institute) return;
    setGenerating(true);
    try {
      const { generation } = await api<{ generation: GenerateQuestionsResponse }>("/questions/generate", {
        method: "POST",
        body: values,
      });
      toast.success("Generation started");
      setGeneratingJob(true);
      pollGeneration(generation.jobId);
      form.reset();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to start generation");
      setGenerating(false);
    }
  }

  // ponytail: manual 2s polling rather than waitForJob — the generation
  // endpoint returns {generation:{...}} not {job:{...}} so waitForJob's
  // shape doesn't match. Inline loop keeps it simple.
  async function pollGeneration(jobId: string) {
    try {
      const { generation } = await api<{ generation: Generation }>(`/questions/generate/${jobId}`);
      if (generation.status === "completed") {
        toast.success("Questions generated");
        setGeneratingJob(false);
        setGenerating(false);
        void refresh();
      } else if (generation.status === "failed") {
        toast.error(generation.error?.message ?? "Generation failed");
        setGeneratingJob(false);
        setGenerating(false);
      } else {
        setTimeout(() => pollGeneration(jobId), 2000);
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to check generation status");
      setGeneratingJob(false);
      setGenerating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Questions"
        description={`${questions.length} question${questions.length !== 1 ? "s" : ""}`}
        actions={
          isTeacher && (
            <Button size="sm" onClick={() => setGenerating((v) => !v)}>
              <Sparkles className="mr-1 size-3.5" /> Generate AI Questions
            </Button>
          )
        }
      />

      {generating && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Generate AI Questions</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onGenerate)} className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="topicId">Topic ID</Label>
                <Input
                  id="topicId"
                  placeholder="topic uuid"
                  {...form.register("topicId")}
                />
                {form.formState.errors.topicId && (
                  <p className="text-sm text-destructive">{form.formState.errors.topicId.message}</p>
                )}
              </div>
              <div className="grid gap-2">
                <Label>Question Type</Label>
                <Select
                  value={form.watch("questionType")}
                  onValueChange={(v) => form.setValue("questionType", v as GenerateQuestionsRequest["questionType"])}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    {QUESTION_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="count">Count</Label>
                <Input
                  id="count"
                  type="number"
                  min={1}
                  max={50}
                  {...form.register("count", { valueAsNumber: true })}
                />
                {form.formState.errors.count && (
                  <p className="text-sm text-destructive">{form.formState.errors.count.message}</p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setGenerating(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={generatingJob}>
                  {generatingJob ? "Generating..." : "Generate"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : questions.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="size-8" />}
          title="No questions yet"
          description="Generate questions from a topic to get started."
        />
      ) : (
        <div className="space-y-4">
          {questions.map((question) => (
            <Card key={question.id}>
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{question.questionType}</Badge>
                  <StatusBadge status={question.approvalStatus} />
                  <StatusBadge status={question.difficulty} />
                </div>
                <p className="mt-2 text-sm line-clamp-2">
                  {question.stem.length > 80 ? `${question.stem.slice(0, 80)}…` : question.stem}
                </p>
                {isTeacher && question.approvalStatus === "PENDING" && (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => onApprove(question.id)}>
                      <Check className="mr-1 size-3.5" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onReject(question.id)}>
                      <X className="mr-1 size-3.5" /> Reject
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
