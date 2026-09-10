import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as bcryptjs from 'bcryptjs';
import { eq, and } from 'drizzle-orm';

import { createDatabase } from '../src/index.js';
import {
  institutes,
  users,
  memberships,
  membershipRoles,
  subjects,
  chapters,
  topics,
  materials,
  questions,
  paperPatterns,
  assessments,
  assessmentQuestions,
  contentItems,
  contentVersions,
} from '../src/index.js';

// Idempotent demo seed. Re-running is safe: every insert is guarded by a
// unique-key check or conflict clause. Uses a fixed, dedicated demo institute
// UUID (distinct from the pre-existing E2E fixture institutes) that the demo,
// syllabus, and attempts E2E scripts share.
//   Demo institute:  99999999-9999-9999-9999-999999999999 (catlium-demo)

// Load the repo .env when present (host runs). In the container the DB config
// comes from compose `environment` instead, so a missing .env is fine.
const envPath = resolve(process.cwd(), '../../.env');
if (existsSync(envPath)) loadEnvFile(envPath);

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) throw new Error('DATABASE_URL is required to seed');

const PASSWORD = 'Password123!';
const DEMO_INSTITUTE_ID = '99999999-9999-9999-9999-999999999999';

async function upsertInstitute(db: ReturnType<typeof createDatabase>) {
  const existing = await db
    .select()
    .from(institutes)
    .where(eq(institutes.slug, 'catlium-demo'))
    .limit(1);
  if (existing.length > 0) return existing[0]!;

  const [row] = await db
    .insert(institutes)
    .values({
      id: DEMO_INSTITUTE_ID,
      name: 'CatLium Demo Institute',
      slug: 'catlium-demo',
    })
    .returning();
  if (!row) throw new Error('failed to create demo institute');
  return row;
}

async function upsertUser(db: ReturnType<typeof createDatabase>, email: string, name: string) {
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) return existing[0]!;

  const passwordHash = await bcryptjs.hash(PASSWORD, 12);
  const [row] = await db.insert(users).values({ email, name, passwordHash }).returning();
  if (!row) throw new Error(`failed to create user ${email}`);
  return row;
}

async function upsertMembership(
  db: ReturnType<typeof createDatabase>,
  userId: string,
  instituteId: string,
) {
  const existing = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.instituteId, instituteId)))
    .limit(1);
  if (existing.length > 0) return existing[0]!;

  const [row] = await db.insert(memberships).values({ userId, instituteId }).returning();
  if (!row) throw new Error(`failed to create membership for ${userId}`);
  return row;
}

async function ensureRole(
  db: ReturnType<typeof createDatabase>,
  membershipId: string,
  role: string,
) {
  await db.insert(membershipRoles).values({ membershipId, role }).onConflictDoNothing();
}

async function upsertSubject(
  db: ReturnType<typeof createDatabase>,
  instituteId: string,
  slug: string,
  name: string,
) {
  const existing = await db
    .select()
    .from(subjects)
    .where(and(eq(subjects.instituteId, instituteId), eq(subjects.slug, slug)))
    .limit(1);
  if (existing.length > 0) return existing[0]!;

  const [row] = await db.insert(subjects).values({ instituteId, name, slug }).returning();
  if (!row) throw new Error('failed to create demo subject');
  return row;
}

// ── Phase 20 — demo curriculum ──────────────────────────────────────────────
// A self-contained, idempotent set of chapters/topics, syllabus + reading
// materials, approved questions, one approved paper pattern and one active
// assessment per subject. All inserted directly (mirrors the live API DTOs so
// the teacher/student browser journeys have real data to walk through).

type DemoQuestion = {
  chapterSlug: string;
  topicSlug: string;
  stem: string;
  type: 'MCQ' | 'TRUE_FALSE' | 'FILL_IN_BLANK';
  payload: Record<string, unknown>;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  explanation?: string;
};

type DemoSubject = {
  name: string;
  slug: string;
  syllabusText: string;
  contentTopicSlug: string; // first topic of the first chapter gets a reading material + notes + flashcards
  chapters: { slug: string; name: string; topics: { slug: string; name: string }[] }[];
  questions: DemoQuestion[];
  patternTitle: string;
  assessmentTitle: string;
};

const DEMO_SUBJECTS: DemoSubject[] = [
  {
    name: 'Mathematics',
    slug: 'mathematics',
    syllabusText:
      '1. Number Systems: rational and irrational numbers, real number line.\n2. Algebra: linear equations, quadratic equations, polynomials.\n3. Geometry: triangles, circles and their properties.\n\nExamination scheme carries 13 marks over 45 minutes.',
    contentTopicSlug: 'linear-equations',
    chapters: [
      {
        slug: 'algebra',
        name: 'Algebra',
        topics: [
          { slug: 'linear-equations', name: 'Linear Equations' },
          { slug: 'quadratic-equations', name: 'Quadratic Equations' },
          { slug: 'polynomials', name: 'Polynomials' },
        ],
      },
      {
        slug: 'geometry',
        name: 'Geometry',
        topics: [
          { slug: 'triangles', name: 'Triangles' },
          { slug: 'circles', name: 'Circles' },
        ],
      },
      {
        slug: 'number-systems',
        name: 'Number Systems',
        topics: [
          { slug: 'rational-numbers', name: 'Rational Numbers' },
          { slug: 'real-numbers', name: 'Real Numbers' },
        ],
      },
    ],
    questions: [
      {
        chapterSlug: 'algebra',
        topicSlug: 'linear-equations',
        stem: 'The solution of 2x + 3 = 7 is',
        type: 'MCQ',
        difficulty: 'EASY',
        explanation: 'Subtract 3 from both sides, then divide by 2: x = 2.',
        payload: {
          choices: [
            { id: 'ma1', text: 'x = 1' },
            { id: 'ma2', text: 'x = 2' },
            { id: 'ma3', text: 'x = 3' },
            { id: 'ma4', text: 'x = 5' },
          ],
          correctChoiceId: 'ma2',
        },
      },
      {
        chapterSlug: 'algebra',
        topicSlug: 'linear-equations',
        stem: 'If 3x − 5 = x + 3, then x equals',
        type: 'MCQ',
        difficulty: 'MEDIUM',
        explanation: 'Bring x terms to one side: 2x = 8, so x = 4.',
        payload: {
          choices: [
            { id: 'mb1', text: 'x = 2' },
            { id: 'mb2', text: 'x = 3' },
            { id: 'mb3', text: 'x = 4' },
            { id: 'mb4', text: 'x = 6' },
          ],
          correctChoiceId: 'mb3',
        },
      },
      {
        chapterSlug: 'algebra',
        topicSlug: 'quadratic-equations',
        stem: 'The roots of x² − 5x + 6 = 0 are',
        type: 'MCQ',
        difficulty: 'MEDIUM',
        explanation: 'Factorise as (x − 2)(x − 3): roots are 2 and 3.',
        payload: {
          choices: [
            { id: 'mc1', text: 'x = 1 or x = 6' },
            { id: 'mc2', text: 'x = 2 or x = 3' },
            { id: 'mc3', text: 'x = −2 or x = −3' },
            { id: 'mc4', text: 'x = 5 or x = 1' },
          ],
          correctChoiceId: 'mc2',
        },
      },
      {
        chapterSlug: 'algebra',
        topicSlug: 'polynomials',
        stem: 'The degree of the polynomial 3x⁴ − 2x² + 1 is',
        type: 'MCQ',
        difficulty: 'MEDIUM',
        explanation: 'The degree is the highest power of the variable, which is 4.',
        payload: {
          choices: [
            { id: 'md1', text: '1' },
            { id: 'md2', text: '2' },
            { id: 'md3', text: '3' },
            { id: 'md4', text: '4' },
          ],
          correctChoiceId: 'md4',
        },
      },
      {
        chapterSlug: 'algebra',
        topicSlug: 'quadratic-equations',
        stem: 'Which statement is true for every quadratic equation ax² + bx + c = 0?',
        type: 'MCQ',
        difficulty: 'HARD',
        explanation: 'The discriminant b² − 4ac determines the nature of the roots.',
        payload: {
          choices: [
            { id: 'me1', text: 'It always has two distinct real roots' },
            { id: 'me2', text: 'Its roots are always integers' },
            { id: 'me3', text: 'The nature of its roots depends on b² − 4ac' },
            { id: 'me4', text: 'It never has real roots' },
          ],
          correctChoiceId: 'me3',
        },
      },
      {
        chapterSlug: 'geometry',
        topicSlug: 'triangles',
        stem: 'The sum of the interior angles of a triangle is 180°.',
        type: 'TRUE_FALSE',
        difficulty: 'EASY',
        explanation: 'This is a fundamental property of triangles.',
        payload: { correctAnswer: true },
      },
      {
        chapterSlug: 'geometry',
        topicSlug: 'circles',
        stem: 'Opposite angles of a cyclic quadrilateral are',
        type: 'MCQ',
        difficulty: 'HARD',
        explanation:
          'Opposite angles of a cyclic quadrilateral sum to 180°, so they are supplementary.',
        payload: {
          choices: [
            { id: 'mf1', text: 'supplementary' },
            { id: 'mf2', text: 'complementary' },
            { id: 'mf3', text: 'equal' },
            { id: 'mf4', text: 'acute' },
          ],
          correctChoiceId: 'mf1',
        },
      },
      {
        chapterSlug: 'number-systems',
        topicSlug: 'rational-numbers',
        stem: 'Write 0.5 as a fraction in simplest form.',
        type: 'FILL_IN_BLANK',
        difficulty: 'EASY',
        explanation: '0.5 = 5/10 = 1/2.',
        payload: { acceptableAnswers: ['1/2', '0.5/1'] },
      },
      {
        chapterSlug: 'number-systems',
        topicSlug: 'real-numbers',
        stem: 'The number √2 belongs to the set of ________ numbers.',
        type: 'MCQ',
        difficulty: 'MEDIUM',
        explanation: '√2 cannot be written as a ratio of two integers, so it is irrational.',
        payload: {
          choices: [
            { id: 'mg1', text: 'rational' },
            { id: 'mg2', text: 'irrational' },
            { id: 'mg3', text: 'whole' },
            { id: 'mg4', text: 'integer' },
          ],
          correctChoiceId: 'mg2',
        },
      },
      {
        chapterSlug: 'number-systems',
        topicSlug: 'real-numbers',
        stem: 'The decimal expansion of 1/3 is ________ (one word).',
        type: 'FILL_IN_BLANK',
        difficulty: 'MEDIUM',
        explanation: '1/3 = 0.333... which is a non-terminating, repeating decimal.',
        payload: {
          acceptableAnswers: [
            'non-terminating repeating',
            'repeating',
            'non-terminating and repeating',
          ],
        },
      },
    ],
    patternTitle: 'Mathematics — Term Blueprint',
    assessmentTitle: 'Mathematics — End of Term Quiz',
  },
  {
    name: 'Physics',
    slug: 'physics',
    syllabusText:
      "1. Mechanics: kinematics, Newton's laws of motion, work and energy.\n2. Optics: reflection, refraction and lenses.\n\nExamination scheme carries 10 marks over 40 minutes.",
    contentTopicSlug: 'kinematics',
    chapters: [
      {
        slug: 'mechanics',
        name: 'Mechanics',
        topics: [
          { slug: 'kinematics', name: 'Kinematics' },
          { slug: 'newtons-laws', name: "Newton's Laws" },
          { slug: 'work-energy', name: 'Work and Energy' },
        ],
      },
      {
        slug: 'optics',
        name: 'Optics',
        topics: [
          { slug: 'reflection-refraction', name: 'Reflection and Refraction' },
          { slug: 'lenses', name: 'Lenses' },
        ],
      },
    ],
    questions: [
      {
        chapterSlug: 'mechanics',
        topicSlug: 'kinematics',
        stem: 'The SI unit of speed is',
        type: 'MCQ',
        difficulty: 'EASY',
        explanation: 'Speed is measured distance per time: metre per second (m/s).',
        payload: {
          choices: [
            { id: 'pa1', text: 'm/s' },
            { id: 'pa2', text: 'm/s²' },
            { id: 'pa3', text: 'newton' },
            { id: 'pa4', text: 'joule' },
          ],
          correctChoiceId: 'pa1',
        },
      },
      {
        chapterSlug: 'mechanics',
        topicSlug: 'kinematics',
        stem: 'Acceleration is the rate of change of',
        type: 'MCQ',
        difficulty: 'MEDIUM',
        explanation: 'Acceleration measures how quickly velocity changes with time.',
        payload: {
          choices: [
            { id: 'pb1', text: 'displacement' },
            { id: 'pb2', text: 'speed' },
            { id: 'pb3', text: 'velocity' },
            { id: 'pb4', text: 'momentum' },
          ],
          correctChoiceId: 'pb3',
        },
      },
      {
        chapterSlug: 'mechanics',
        topicSlug: 'kinematics',
        stem: 'Speed in a particular direction is called ________.',
        type: 'FILL_IN_BLANK',
        difficulty: 'EASY',
        explanation: 'Velocity is speed together with direction.',
        payload: { acceptableAnswers: ['velocity'] },
      },
      {
        chapterSlug: 'mechanics',
        topicSlug: 'newtons-laws',
        stem: 'The force that opposes the motion of a body across a surface is called',
        type: 'MCQ',
        difficulty: 'EASY',
        explanation: 'Friction resists the relative motion between two surfaces.',
        payload: {
          choices: [
            { id: 'pc1', text: 'gravity' },
            { id: 'pc2', text: 'friction' },
            { id: 'pc3', text: 'tension' },
            { id: 'pc4', text: 'normal force' },
          ],
          correctChoiceId: 'pc2',
        },
      },
      {
        chapterSlug: 'mechanics',
        topicSlug: 'newtons-laws',
        stem: 'A body at rest stays at rest unless acted on by an unbalanced force.',
        type: 'TRUE_FALSE',
        difficulty: 'MEDIUM',
        explanation: "This is Newton's first law of motion.",
        payload: { correctAnswer: true },
      },
      {
        chapterSlug: 'mechanics',
        topicSlug: 'work-energy',
        stem: 'The SI unit of energy is the',
        type: 'MCQ',
        difficulty: 'EASY',
        explanation: 'Energy is measured in joules (J) in the SI system.',
        payload: {
          choices: [
            { id: 'pd1', text: 'joule' },
            { id: 'pd2', text: 'watt' },
            { id: 'pd3', text: 'newton' },
            { id: 'pd4', text: 'pascal' },
          ],
          correctChoiceId: 'pd1',
        },
      },
      {
        chapterSlug: 'mechanics',
        topicSlug: 'work-energy',
        stem: 'One joule of work is done when a force of one newton moves a body through one ________.',
        type: 'FILL_IN_BLANK',
        difficulty: 'MEDIUM',
        explanation: 'Work = force × distance, so the distance unit completes the definition.',
        payload: { acceptableAnswers: ['metre', 'meter'] },
      },
      {
        chapterSlug: 'optics',
        topicSlug: 'reflection-refraction',
        stem: 'The angle of incidence equals the angle of',
        type: 'MCQ',
        difficulty: 'MEDIUM',
        explanation: 'The law of reflection states i = r.',
        payload: {
          choices: [
            { id: 'pe1', text: 'refraction' },
            { id: 'pe2', text: 'reflection' },
            { id: 'pe3', text: 'diffraction' },
            { id: 'pe4', text: 'deviation' },
          ],
          correctChoiceId: 'pe2',
        },
      },
      {
        chapterSlug: 'optics',
        topicSlug: 'lenses',
        stem: 'A convex lens converges light rays that pass through it.',
        type: 'TRUE_FALSE',
        difficulty: 'HARD',
        explanation: 'A convex (converging) lens bends light rays towards the principal axis.',
        payload: { correctAnswer: true },
      },
    ],
    patternTitle: 'Physics — Term Blueprint',
    assessmentTitle: 'Physics — End of Term Quiz',
  },
];

async function upsertChapter(
  db: ReturnType<typeof createDatabase>,
  subjectId: string,
  slug: string,
  name: string,
  sortOrder: number,
) {
  const existing = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.subjectId, subjectId), eq(chapters.slug, slug)))
    .limit(1);
  if (existing.length > 0) return existing[0]!;
  const [row] = await db.insert(chapters).values({ subjectId, name, slug, sortOrder }).returning();
  if (!row) throw new Error(`failed to create chapter ${slug}`);
  return row;
}

async function upsertTopic(
  db: ReturnType<typeof createDatabase>,
  chapterId: string,
  slug: string,
  name: string,
  sortOrder: number,
) {
  const existing = await db
    .select()
    .from(topics)
    .where(and(eq(topics.chapterId, chapterId), eq(topics.slug, slug)))
    .limit(1);
  if (existing.length > 0) return existing[0]!;
  const [row] = await db.insert(topics).values({ chapterId, name, slug, sortOrder }).returning();
  if (!row) throw new Error(`failed to create topic ${slug}`);
  return row;
}

async function upsertMaterial(
  db: ReturnType<typeof createDatabase>,
  args: {
    instituteId: string;
    title: string;
    createdBy: string;
    text: string;
    subjectId?: string;
    topicId?: string;
  },
) {
  const existing = await db
    .select()
    .from(materials)
    .where(and(eq(materials.instituteId, args.instituteId), eq(materials.title, args.title)))
    .limit(1);
  if (existing.length > 0) return existing[0]!;
  const [row] = await db
    .insert(materials)
    .values({
      instituteId: args.instituteId,
      title: args.title,
      subjectId: args.subjectId,
      topicId: args.topicId,
      materialType: 'TEXT',
      sourceType: 'TEXT',
      textContent: args.text,
      processingStatus: 'READY',
      status: 'ACTIVE',
      createdBy: args.createdBy,
      updatedBy: args.createdBy,
    })
    .returning();
  if (!row) throw new Error(`failed to create material ${args.title}`);
  return row;
}

function toAttemptablePayload(q: DemoQuestion): Record<string, unknown> {
  if (q.type !== 'MCQ') return q.payload;
  const map = new Map<string, string>();
  for (const c of q.payload['choices'] as { id: string }[]) map.set(c.id, crypto.randomUUID());
  return {
    choices: (q.payload['choices'] as { id: string; text: string }[]).map((c) => ({
      id: map.get(c.id),
      text: c.text,
    })),
    correctChoiceId: map.get(q.payload['correctChoiceId'] as string),
  };
}

async function upsertQuestion(
  db: ReturnType<typeof createDatabase>,
  args: {
    instituteId: string;
    topicId: string;
    createdBy: string;
    q: DemoQuestion;
  },
) {
  const existing = await db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.instituteId, args.instituteId),
        eq(questions.topicId, args.topicId),
        eq(questions.stem, args.q.stem),
      ),
    )
    .limit(1);
  if (existing.length > 0) return existing[0]!;
  const [row] = await db
    .insert(questions)
    .values({
      instituteId: args.instituteId,
      topicId: args.topicId,
      stem: args.q.stem,
      questionType: args.q.type,
      difficulty: args.q.difficulty,
      explanation: args.q.explanation,
      // Attempts require UUID choice ids, so map the readable seed ids to real
      // UUIDs at insert time (idempotent: re-runs skip by stem).
      payload: toAttemptablePayload(args.q),
      source: 'MANUAL',
      approvalStatus: 'APPROVED',
      status: 'ACTIVE',
      createdBy: args.createdBy,
      updatedBy: args.createdBy,
    })
    .returning();
  if (!row) throw new Error('failed to create question');
  return row;
}

function patternStructure(subjectName: string, topicNames: string[]) {
  return {
    totalMarks: 13,
    durationMinutes: 45,
    instructions: ['Answer all questions.', 'Marks are shown next to each section.'],
    sections: [
      {
        id: crypto.randomUUID(),
        name: `${subjectName} — Section A: Multiple Choice`,
        questionType: 'MCQ',
        count: 6,
        marksPerQuestion: 1,
        totalMarks: 6,
        compulsory: true,
        attemptCount: null,
        difficultyDistribution: { EASY: 40, MEDIUM: 40, HARD: 20 },
        topicDistribution: topicNames.slice(0, 3).map((n, i) => ({
          name: n,
          percentage: i === 0 ? 40 : 30,
        })),
      },
      {
        id: crypto.randomUUID(),
        name: `${subjectName} — Section B: True or False`,
        questionType: 'TRUE_FALSE',
        count: 3,
        marksPerQuestion: 1,
        totalMarks: 3,
        compulsory: true,
        attemptCount: null,
        difficultyDistribution: { EASY: 50, MEDIUM: 50, HARD: 0 },
        topicDistribution: null,
      },
      {
        id: crypto.randomUUID(),
        name: `${subjectName} — Section C: Fill in the Blank`,
        questionType: 'FILL_IN_BLANK',
        count: 2,
        marksPerQuestion: 2,
        totalMarks: 4,
        compulsory: true,
        attemptCount: null,
        difficultyDistribution: { EASY: 40, MEDIUM: 40, HARD: 20 },
        topicDistribution: null,
      },
    ],
  };
}

async function upsertPattern(
  db: ReturnType<typeof createDatabase>,
  args: {
    instituteId: string;
    subjectId: string;
    teacherId: string;
    title: string;
    description: string;
    topicNames: string[];
  },
) {
  const existing = await db
    .select()
    .from(paperPatterns)
    .where(and(eq(paperPatterns.subjectId, args.subjectId), eq(paperPatterns.title, args.title)))
    .limit(1);
  if (existing.length > 0) return existing[0]!;
  const now = new Date();
  const [row] = await db
    .insert(paperPatterns)
    .values({
      instituteId: args.instituteId,
      subjectId: args.subjectId,
      title: args.title,
      description: args.description,
      status: 'APPROVED',
      version: 1,
      sourceType: 'MANUAL',
      structure: patternStructure(args.title, args.topicNames),
      createdBy: args.teacherId,
      updatedBy: args.teacherId,
      validatedAt: now,
      approvedAt: now,
    })
    .returning();
  if (!row) throw new Error(`failed to create pattern ${args.title}`);
  return row;
}

async function upsertAssessment(
  db: ReturnType<typeof createDatabase>,
  args: {
    instituteId: string;
    teacherId: string;
    title: string;
    description: string;
    blueprintId: string;
    questionRows: { id: string; questionType: string }[];
  },
) {
  const existing = await db
    .select()
    .from(assessments)
    .where(and(eq(assessments.instituteId, args.instituteId), eq(assessments.title, args.title)))
    .limit(1);
  if (existing.length > 0) {
    await linkAssessmentQuestions(db, existing[0]!.id, args.questionRows);
    return existing[0]!;
  }
  const startsAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const endsAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(assessments)
    .values({
      instituteId: args.instituteId,
      title: args.title,
      description: args.description,
      durationMinutes: 45,
      maxMarks: args.questionRows.reduce(
        (sum, q) => sum + (q.questionType === 'FILL_IN_BLANK' ? 2 : 1),
        0,
      ),
      instructions: { text: 'Read each question carefully. Answer all questions.' },
      startsAt,
      endsAt,
      status: 'ACTIVE',
      blueprintId: args.blueprintId,
      createdBy: args.teacherId,
      updatedBy: args.teacherId,
    })
    .returning();
  if (!row) throw new Error(`failed to create assessment ${args.title}`);
  await linkAssessmentQuestions(db, row.id, args.questionRows);
  return row;
}

async function linkAssessmentQuestions(
  db: ReturnType<typeof createDatabase>,
  assessmentId: string,
  questionRows: { id: string; questionType: string }[],
) {
  await db
    .insert(assessmentQuestions)
    .values(
      questionRows.map((q, i) => ({
        assessmentId,
        questionId: q.id,
        sortOrder: i,
        marks: q.questionType === 'FILL_IN_BLANK' ? 2 : 1,
      })),
    )
    .onConflictDoNothing();
}

async function ensureContentItem(
  db: ReturnType<typeof createDatabase>,
  args: {
    instituteId: string;
    topicId: string;
    teacherId: string;
    type: 'NOTE' | 'FLASHCARD_SET';
    title: string;
    payload: Record<string, unknown>;
  },
) {
  const existing = await db
    .select()
    .from(contentItems)
    .where(
      and(
        eq(contentItems.instituteId, args.instituteId),
        eq(contentItems.topicId, args.topicId),
        eq(contentItems.type, args.type),
        eq(contentItems.title, args.title),
      ),
    )
    .limit(1);
  if (existing.length > 0) return existing[0]!;
  const [row] = await db
    .insert(contentItems)
    .values({
      instituteId: args.instituteId,
      topicId: args.topicId,
      type: args.type,
      title: args.title,
      status: 'ACTIVE',
      source: 'MANUAL',
      currentVersion: 1,
      createdBy: args.teacherId,
      updatedBy: args.teacherId,
    })
    .returning();
  if (!row) throw new Error(`failed to create content ${args.title}`);
  await db
    .insert(contentVersions)
    .values({
      contentId: row.id,
      version: 1,
      payload: args.payload,
      changeType: 'CREATION',
      createdBy: args.teacherId,
    })
    .onConflictDoNothing();
  return row;
}

async function seedDemoCurriculum(db: ReturnType<typeof createDatabase>) {
  const instituteId = DEMO_INSTITUTE_ID;
  const teacher = await upsertUser(db, 'teacher@catlium.dev', 'Demo Teacher');

  for (const spec of DEMO_SUBJECTS) {
    const subject = await upsertSubject(db, instituteId, spec.slug, spec.name);
    const chaptersOut: { slug: string; topicsOut: { slug: string; id: string }[] }[] = [];

    for (const [ci, c] of spec.chapters.entries()) {
      const ch = await upsertChapter(db, subject.id, c.slug, c.name, ci);
      const topicsOut: { slug: string; id: string }[] = [];
      for (const [ti, t] of c.topics.entries()) {
        const topic = await upsertTopic(db, ch.id, t.slug, t.name, ti);
        topicsOut.push({ slug: t.slug, id: topic.id });
      }
      chaptersOut.push({ slug: c.slug, topicsOut });
    }
    const topicsById = new Map(
      chaptersOut.flatMap((c) => c.topicsOut.map((t) => [t.slug, t.id] as const)),
    );
    const topicFor = (slug: string) => topicsById.get(slug);
    const topicNameFor = (slug: string) =>
      spec.chapters.flatMap((c) => c.topics).find((t) => t.slug === slug)?.name ?? slug;
    const allTopicNames = spec.chapters.flatMap((c) => c.topics.map((t) => t.name));

    await upsertMaterial(db, {
      instituteId,
      title: `${spec.name} — Syllabus`,
      createdBy: teacher.id,
      subjectId: subject.id,
      text: spec.syllabusText,
    });

    const contentTopicId = topicFor(spec.contentTopicSlug);
    if (contentTopicId) {
      await upsertMaterial(db, {
        instituteId,
        title: `${spec.name} — ${topicNameFor(spec.contentTopicSlug)} Reading`,
        createdBy: teacher.id,
        topicId: contentTopicId,
        text: `${topicNameFor(spec.contentTopicSlug)}: core ideas, worked examples and practice.`,
      });
      await ensureContentItem(db, {
        instituteId,
        topicId: contentTopicId,
        teacherId: teacher.id,
        type: 'NOTE',
        title: `${topicNameFor(spec.contentTopicSlug)} — Study Notes`,
        payload: {
          title: `${topicNameFor(spec.contentTopicSlug)} — Study Notes`,
          blocks: [
            { id: 'block-1', type: 'heading', content: topicNameFor(spec.contentTopicSlug) },
            {
              id: 'block-2',
              type: 'paragraph',
              content: `This topic introduces the key ideas you need for ${spec.name}. Read the material first, then try the quick questions.`,
            },
            {
              id: 'block-3',
              type: 'list',
              items: [
                'Understand the definitions and units',
                'Work through the examples step by step',
                'Attempt the practice questions before the quiz',
              ],
            },
          ],
        },
      });
      await ensureContentItem(db, {
        instituteId,
        topicId: contentTopicId,
        teacherId: teacher.id,
        type: 'FLASHCARD_SET',
        title: `${topicNameFor(spec.contentTopicSlug)} — Flashcards`,
        payload: {
          title: `${topicNameFor(spec.contentTopicSlug)} — Flashcards`,
          cards: [
            {
              id: 'f1',
              front: 'Define the core concept',
              back: 'A short, precise definition with one example.',
              difficulty: 'EASY',
            },
            {
              id: 'f2',
              front: 'What is the key formula/rule?',
              back: 'State it, then note when it applies.',
              difficulty: 'MEDIUM',
            },
            {
              id: 'f3',
              front: 'Common mistake for this topic?',
              back: 'Mixing up direction/units — always check the units.',
              difficulty: 'MEDIUM',
            },
            {
              id: 'f4',
              front: 'Apply the rule to a quick example',
              back: 'One fully worked example with the answer highlighted.',
              difficulty: 'HARD',
            },
          ],
        },
      });
    }

    const questionRows: { id: string; questionType: string }[] = [];
    for (const q of spec.questions) {
      const topicId = topicFor(q.topicSlug);
      if (!topicId) throw new Error(`unknown topic slug ${q.topicSlug} in ${spec.slug}`);
      const row = await upsertQuestion(db, {
        instituteId,
        topicId,
        createdBy: teacher.id,
        q,
      });
      questionRows.push({ id: row.id, questionType: row.questionType });
    }

    const pattern = await upsertPattern(db, {
      instituteId,
      subjectId: subject.id,
      teacherId: teacher.id,
      title: spec.patternTitle,
      description: `Approved ${spec.name} blueprint covering ${allTopicNames.join(', ').toLowerCase()}.`,
      topicNames: allTopicNames,
    });

    await upsertAssessment(db, {
      instituteId,
      teacherId: teacher.id,
      title: spec.assessmentTitle,
      description: `Active ${spec.name} quiz created from the term blueprint.`,
      blueprintId: pattern.id,
      questionRows,
    });
  }
}

// ── Phase 8 (p8_e2e.sh) validation fixtures ────────────────────────────────
// The p8 suite hardcodes these exact UUIDs/emails (reconstructed from
// docs/user-validation.md Phase 8 block). Seeding them here keeps the whole
// E2E harness reproducible from a single `docker compose up --build` + seed.
const P8_INST_A = '11111111-1111-1111-1111-111111111111';
const P8_INST_B = '55555555-5555-5555-5555-555555555555';
const P8_SUBJECT = '324428a6-8d42-4926-9540-9b8a83943a24';
const P8_TOPIC = '10df37f8-acd5-4406-9a36-eb631c4c54f3';

async function seedValidationFixtures(db: ReturnType<typeof createDatabase>) {
  async function ensureInstitute(id: string, name: string, slug: string) {
    await db.insert(institutes).values({ id, name, slug }).onConflictDoNothing();
  }
  await ensureInstitute(P8_INST_A, 'Validation Institute', 'validation-inst');
  await ensureInstitute(P8_INST_B, 'Validation Institute B', 'validation-inst-b');

  const teacher = await upsertUser(db, 'p8.teacher@catlium.dev', 'P8 Teacher');
  const other = await upsertUser(db, 'p8.other@catlium.dev', 'P8 Other');
  const student = await upsertUser(db, 'p8student1788584106@test.com', 'P8 Student');

  const teacherMem = await upsertMembership(db, teacher.id, P8_INST_A);
  await ensureRole(db, teacherMem.id, 'INSTITUTE_ADMIN');

  const otherMem = await upsertMembership(db, other.id, P8_INST_B);
  await ensureRole(db, otherMem.id, 'TEACHER');

  const studentMem = await upsertMembership(db, student.id, P8_INST_A);
  await ensureRole(db, studentMem.id, 'STUDENT');

  // Academic scope for p8 (institute A): subject math -> chapter -> the topic
  // UUID the suite passes as topicId.
  await db
    .insert(subjects)
    .values({ id: P8_SUBJECT, instituteId: P8_INST_A, name: 'Mathematics', slug: 'math' })
    .onConflictDoNothing();
  await db
    .insert(chapters)
    .values({
      id: '0e3dd9c1-3fc1-4640-8f31-0000000000c1',
      subjectId: P8_SUBJECT,
      name: 'Linear Equations',
      slug: 'linear-equations',
    })
    .onConflictDoNothing();
  await db
    .insert(topics)
    .values({
      id: P8_TOPIC,
      chapterId: '0e3dd9c1-3fc1-4640-8f31-0000000000c1',
      name: 'Linear Equations',
      slug: 'linear-equations',
    })
    .onConflictDoNothing();
}

async function main() {
  const db = createDatabase(DATABASE_URL);

  const institute = await upsertInstitute(db);

  const admin = await upsertUser(db, 'admin@catlium.dev', 'Demo Institute Admin');
  const adminMembership = await upsertMembership(db, admin.id, institute.id);
  await ensureRole(db, adminMembership.id, 'INSTITUTE_ADMIN');

  const teacher = await upsertUser(db, 'teacher@catlium.dev', 'Demo Teacher');
  const teacherMembership = await upsertMembership(db, teacher.id, institute.id);
  await ensureRole(db, teacherMembership.id, 'INSTITUTE_ADMIN');
  await ensureRole(db, teacherMembership.id, 'TEACHER');

  const student = await upsertUser(db, 'student@catlium.dev', 'Demo Student');
  const studentMembership = await upsertMembership(db, student.id, institute.id);
  await ensureRole(db, studentMembership.id, 'STUDENT');

  await seedDemoCurriculum(db);
  await seedValidationFixtures(db);

  console.log(
    `Seeded institute=${JSON.stringify({ id: institute.id, name: institute.name })}\n` +
      `  admin@catlium.dev / ${PASSWORD}   (INSTITUTE_ADMIN)\n` +
      `  teacher@catlium.dev / ${PASSWORD}  (INSTITUTE_ADMIN, TEACHER)\n` +
      `  student@catlium.dev / ${PASSWORD}  (STUDENT)\n` +
      `  curriculum: Mathematics + Physics (chapters/topics, syllabus + reading materials,\n` +
      `    approved questions, approved paper pattern, active assessment per subject)`,
  );
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
