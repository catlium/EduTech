import { test } from "node:test";
import assert from "node:assert/strict";

import { validatePaperPatternStructure } from "../../../api/src/paper-patterns/paper-patterns.validation.ts";
import {
  type Section,
  flattenSections,
  parseBackendSections,
  computeTotals,
  collectIssues,
} from "./paper-pattern-builder.ts";

function section(name: string, overrides: Partial<Section> = {}): Section {
  return {
    id: crypto.randomUUID(),
    name,
    compulsory: true,
    attemptCount: null,
    rules: [],
    ...overrides,
  };
}

test("flatten emits one backend section per rule with derived names", () => {
  const sections: Section[] = [
    section("Section A", {
      compulsory: true,
      rules: [
        {
          id: "r1",
          questionType: "MCQ",
          count: 10,
          marksPerQuestion: 2,
          difficulty: { EASY: 30, MEDIUM: 50, HARD: 20 },
          topics: [{ name: "Algebra", percentage: 60 }, { name: "Geometry", percentage: 40 }],
        },
        {
          id: "r2",
          questionType: "FILL_IN_BLANK",
          count: 5,
          marksPerQuestion: 1,
          difficulty: { EASY: "", MEDIUM: "", HARD: "" },
          topics: [],
        },
      ],
    }),
    section("Section B", {
      compulsory: false,
      attemptCount: 4,
      rules: [
        {
          id: "r3",
          questionType: "TRUE_FALSE",
          count: 8,
          marksPerQuestion: 1,
          difficulty: { EASY: "", MEDIUM: "", HARD: "" },
          topics: [],
        },
      ],
    }),
  ];

  const flat = flattenSections(sections);
  assert.equal(flat.length, 3);
  assert.equal(flat[0]!.name, "Section A — MCQ");
  assert.equal(flat[1]!.name, "Section A — FILL_IN_BLANK");
  assert.equal(flat[2]!.name, "Section B — TRUE_FALSE");
  assert.equal(flat[0]!.questionType, "MCQ");
  assert.deepEqual(flat[0]!.count, 10);
  assert.deepEqual(flat[0]!.marksPerQuestion, 2);
  assert.deepEqual(flat[0]!.difficultyDistribution, { EASY: 30, MEDIUM: 50, HARD: 20 });
  assert.equal(flat[2]!.compulsory, false);
  assert.deepEqual(flat[2]!.attemptCount, 4);

  const totals = computeTotals(sections);
  assert.equal(totals.questions, 23);
  assert.equal(totals.marks, 10 * 2 + 5 * 1 + 8 * 1);
  assert.equal(totals.uncertain, false);

  const structure = {
    totalMarks: totals.marks,
    durationMinutes: 90,
    instructions: [] as string[],
    sections: flat,
  };
  assert.deepEqual(validatePaperPatternStructure(structure), []);
});

test("parse regroups flattened sections back into rules", () => {
  const sections: Section[] = [
    section("Section A", { rules: [
      {
        id: "a",
        questionType: "MCQ",
        count: 10,
        marksPerQuestion: 2,
        difficulty: { EASY: 30, MEDIUM: 50, HARD: 20 },
        topics: [{ name: "Algebra", percentage: 60 }],
      },
      {
        id: "b",
        questionType: "FILL_IN_BLANK",
        count: 5,
        marksPerQuestion: 1,
        difficulty: { EASY: "", MEDIUM: "", HARD: "" },
        topics: [],
      },
      {
        id: "c",
        questionType: "MCQ",
        count: 3,
        marksPerQuestion: 2,
        difficulty: { EASY: "", MEDIUM: "", HARD: "" },
        topics: [],
      },
    ]}),
  ];
  const flat = flattenSections(sections);
  assert.deepEqual(flat.map((f) => f.name), [
    "Section A — MCQ",
    "Section A — FILL_IN_BLANK",
    "Section A — MCQ · 2",
  ]);

  const round = parseBackendSections(flat);
  assert.equal(round.length, 1);
  assert.equal(round[0]!.name, "Section A");
  assert.equal(round[0]!.rules.length, 3);
  assert.equal(round[0]!.rules[2]!.count, 3);

  const totals = computeTotals(round);
  assert.equal(totals.questions, 18);
  assert.equal(totals.marks, 10 * 2 + 5 * 1 + 3 * 2);
});

test("reordering rules and sections survives a round trip", () => {
  const sections: Section[] = [
    section("Alpha", { rules: [
      { id: "a1", questionType: "TRUE_FALSE", count: 4, marksPerQuestion: 1, difficulty: { EASY: "", MEDIUM: "", HARD: "" }, topics: [] },
      { id: "a2", questionType: "MCQ", count: 6, marksPerQuestion: 2, difficulty: { EASY: "", MEDIUM: "", HARD: "" }, topics: [] },
    ]}),
    section("Beta", { rules: [
      { id: "b1", questionType: "FILL_IN_BLANK", count: 2, marksPerQuestion: 3, difficulty: { EASY: "", MEDIUM: "", HARD: "" }, topics: [] },
    ]}),
  ];
  sections[0]!.rules.reverse();
  sections.reverse();

  const flat = flattenSections(sections);
  const round = parseBackendSections(flat);
  assert.deepEqual(
    round.map((s) => s.rules.map((r) => [r.questionType, r.count, r.marksPerQuestion])),
    [
      [["FILL_IN_BLANK", 2, 3]],
      [["MCQ", 6, 2], ["TRUE_FALSE", 4, 1]],
    ],
  );
});

test("collectIssues flags difficulty/topic sums and optional count", () => {
  const sections: Section[] = [
    section("S1", { rules: [
      {
        id: "x",
        questionType: "MCQ",
        count: 10,
        marksPerQuestion: 1,
        difficulty: { EASY: 40, MEDIUM: 40, HARD: 0 },
        topics: [{ name: "A", percentage: 50 }, { name: "B", percentage: "" }],
      },
    ]}),
    section("S2", { compulsory: false, attemptCount: null, rules: [
      {
        id: "y",
        questionType: "TRUE_FALSE",
        count: 5,
        marksPerQuestion: 1,
        difficulty: { EASY: "", MEDIUM: "", HARD: "" },
        topics: [],
      },
    ]}),
  ];
  const issues = collectIssues(sections);
  assert.equal(issues.length, 3);
  assert.match(issues[0]!, /difficulty/);
  assert.match(issues[1]!, /topic distribution/);
  assert.match(issues[2]!, /optional section/);
});