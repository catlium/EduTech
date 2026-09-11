"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import type {
  NotePayload,
  SummaryPayload,
  FlashcardSetPayload,
  ImportantConceptsPayload,
  CornellNotePayload,
} from "@catlium/contracts";

const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;

type BlockEditorDraft = {
  id: string;
  type: "heading" | "paragraph" | "list";
  text: string;
};

export type ContentType =
  | "NOTE"
  | "SUMMARY"
  | "FLASHCARD_SET"
  | "IMPORTANT_CONCEPTS"
  | "CORNELL_NOTE";

function StringListEditor({
  values,
  onChange,
  addLabel,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {values.map((v, i) => (
        <div key={i} className="flex items-start gap-2">
          <Textarea
            value={v}
            className="min-h-10"
            onChange={(e) => {
              const next = [...values];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...values, ""])}>
        <Plus className="mr-1 size-3.5" /> {addLabel}
      </Button>
    </div>
  );
}

function NoteEditor({
  draft,
  setDraft,
}: {
  draft: BlockEditorDraft[];
  setDraft: (d: BlockEditorDraft[]) => void;
}) {
  return (
    <div className="space-y-3">
      {draft.map((block, i) => (
        <div key={block.id} className="grid gap-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Select
              value={block.type}
              onValueChange={(v) => {
                const next = [...draft];
                next[i] = { ...next[i], type: v as BlockEditorDraft["type"] };
                setDraft(next);
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="heading">Heading</SelectItem>
                <SelectItem value="paragraph">Paragraph</SelectItem>
                <SelectItem value="list">List</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 ml-auto"
              onClick={() => setDraft(draft.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          <Textarea
            value={block.text}
            placeholder={block.type === "list" ? "One list item per line" : "Block text"}
            className="min-h-20"
            onChange={(e) => {
              const next = [...draft];
              next[i] = { ...next[i], text: e.target.value };
              setDraft(next);
            }}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          setDraft([...draft, { id: crypto.randomUUID(), type: "paragraph", text: "" }])
        }
      >
        <Plus className="mr-1 size-3.5" /> Add block
      </Button>
    </div>
  );
}

function FlashcardEditor({
  payload,
  onChange,
}: {
  payload: FlashcardSetPayload;
  onChange: (p: FlashcardSetPayload) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Label>Description</Label>
        <Textarea
          value={payload.description ?? ""}
          onChange={(e) => onChange({ ...payload, description: e.target.value })}
          className="min-h-16"
        />
      </div>
      {payload.cards.map((card, i) => (
        <div key={card.id} className="grid gap-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Card {i + 1}</span>
            <div className="ml-auto flex items-center gap-2">
              <Select
                value={card.difficulty ?? "MEDIUM"}
                onValueChange={(v) => {
                  const next = { ...payload, cards: [...payload.cards] };
                  next.cards[i] = { ...card, difficulty: v as (typeof DIFFICULTIES)[number] };
                  onChange(next);
                }}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIFFICULTIES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() =>
                  onChange({ ...payload, cards: payload.cards.filter((_, j) => j !== i) })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`fc-front-${i}`}>Front</Label>
            <Textarea
              id={`fc-front-${i}`}
              value={card.front}
              className="min-h-16"
              onChange={(e) => {
                const next = { ...payload, cards: [...payload.cards] };
                next.cards[i] = { ...card, front: e.target.value };
                onChange(next);
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`fc-back-${i}`}>Back</Label>
            <Textarea
              id={`fc-back-${i}`}
              value={card.back}
              className="min-h-16"
              onChange={(e) => {
                const next = { ...payload, cards: [...payload.cards] };
                next.cards[i] = { ...card, back: e.target.value };
                onChange(next);
              }}
            />
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange({
            ...payload,
            cards: [
              ...payload.cards,
              { id: crypto.randomUUID(), front: "", back: "", difficulty: "MEDIUM" },
            ],
          })
        }
      >
        <Plus className="mr-1 size-3.5" /> Add card
      </Button>
    </div>
  );
}

export function ContentPayloadEditor({
  type,
  payload,
  onChange,
}: {
  type: ContentType;
  payload: Record<string, unknown>;
  onChange: (payload: Record<string, unknown>) => void;
}) {
  if (type === "NOTE") {
    const draft: BlockEditorDraft[] = (payload.blocks as NotePayload["blocks"])
      ?.map((b) =>
        b.type === "list"
          ? { id: b.id, type: b.type, text: b.items.join("\n") }
          : { id: b.id, type: b.type, text: b.content },
      )
      .filter((b) => b) ?? [{ id: crypto.randomUUID(), type: "paragraph", text: "" }];

    return (
      <NoteEditor
        draft={draft}
        setDraft={(next) => {
          const cleaned: NotePayload["blocks"] = next
            .filter((b) => b.text.trim())
            .map((b) =>
              b.type === "list"
                ? {
                    id: b.id,
                    type: "list",
                    items: b.text.split("\n").map((t) => t.trim()).filter(Boolean),
                  }
                : { id: b.id, type: b.type, content: b.text },
            );
          onChange({ ...payload, blocks: cleaned });
        }}
      />
    );
  }

  if (type === "SUMMARY") {
    const p = payload as unknown as SummaryPayload;
    return (
      <div className="space-y-4">
        <div className="grid gap-2">
          <Label>Summary</Label>
          <Textarea
            value={p.summary ?? ""}
            className="min-h-32"
            onChange={(e) => onChange({ ...payload, summary: e.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label>Key concepts</Label>
          <StringListEditor
            values={p.keyConcepts ?? []}
            onChange={(v) => onChange({ ...payload, keyConcepts: v.filter((s) => s.trim()) })}
            addLabel="Add concept"
          />
        </div>
        <div className="grid gap-2">
          <Label>Important points</Label>
          <StringListEditor
            values={p.importantPoints ?? []}
            onChange={(v) => onChange({ ...payload, importantPoints: v.filter((s) => s.trim()) })}
            addLabel="Add point"
          />
        </div>
      </div>
    );
  }

  if (type === "FLASHCARD_SET") {
    const p = payload as unknown as FlashcardSetPayload;
    return (
      <FlashcardEditor
        payload={p}
        onChange={(next) => onChange(next as unknown as Record<string, unknown>)}
      />
    );
  }

  if (type === "IMPORTANT_CONCEPTS") {
    const p = payload as unknown as ImportantConceptsPayload;
    return (
      <div className="space-y-3">
        {p.concepts?.map((c, i) => (
          <div key={i} className="grid gap-2 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Concept {i + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 ml-auto"
                onClick={() =>
                  onChange({ ...payload, concepts: p.concepts.filter((_, j) => j !== i) })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <Input
              value={c.name ?? ""}
              placeholder="Concept name"
              onChange={(e) => {
                const next = [...p.concepts];
                next[i] = { ...c, name: e.target.value };
                onChange({ ...payload, concepts: next });
              }}
            />
            <Textarea
              value={c.description ?? ""}
              placeholder="Concept description"
              className="min-h-20"
              onChange={(e) => {
                const next = [...p.concepts];
                next[i] = { ...c, description: e.target.value };
                onChange({ ...payload, concepts: next });
              }}
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({ ...payload, concepts: [...p.concepts, { name: "", description: "" }] })
          }
        >
          <Plus className="mr-1 size-3.5" /> Add concept
        </Button>
      </div>
    );
  }

  const p = payload as unknown as CornellNotePayload;
  return (
    <div className="space-y-3">
      {p.sections?.map((s, i) => (
        <div key={s.id} className="grid gap-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Section {i + 1}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 ml-auto"
              onClick={() =>
                onChange({ ...payload, sections: p.sections.filter((_, j) => j !== i) })
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          <Input
            value={s.cue ?? ""}
            placeholder="Cue / question"
            onChange={(e) => {
              const next = [...p.sections];
              next[i] = { ...s, cue: e.target.value };
              onChange({ ...payload, sections: next });
            }}
          />
          <Textarea
            value={s.notes ?? ""}
            placeholder="Notes"
            className="min-h-24"
            onChange={(e) => {
              const next = [...p.sections];
              next[i] = { ...s, notes: e.target.value };
              onChange({ ...payload, sections: next });
            }}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange({ ...payload, sections: [...p.sections, { id: crypto.randomUUID(), cue: "", notes: "" }] })
        }
      >
        <Plus className="mr-1 size-3.5" /> Add section
      </Button>
      <div className="grid gap-2">
        <Label>Summary</Label>
        <Textarea
          value={p.summary ?? ""}
          className="min-h-24"
          onChange={(e) => onChange({ ...payload, summary: e.target.value })}
        />
      </div>
    </div>
  );
}