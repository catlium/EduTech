import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as bcryptjs from 'bcryptjs';
import { eq, and, inArray } from 'drizzle-orm';

import { createDatabase } from '../src/index.js';
import {
  institutes,
  users,
  memberships,
  membershipRoles,
  roles,
  platformUserRoles,
  academicYears,
  classes,
  classSubjects,
  divisions,
  studentPlacements,
  subjects,
  chapters,
  topics,
  materials,
  questions,
  paperPatterns,
  paperPatternSubjects,
  assessments,
  assessmentQuestions,
  attempts,
  practiceSessions,
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
  roleKey: string,
) {
  // Phase C: membership roles bind by role_id (D2 §14). The built-in system
  // roles are seeded by migration 0040 and the API boot sync.
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, roleKey)).limit(1);
  if (!role) throw new Error(`seed: role ${roleKey} not found; apply migration 0040 / boot the API first`);
  await db.insert(membershipRoles).values({ membershipId, roleId: role.id }).onConflictDoNothing();
}

async function ensurePlatformRole(
  db: ReturnType<typeof createDatabase>,
  userId: string,
  roleKey: string,
) {
  // Phase D (D3/§15): the sole route to platform authority is
  // platform_user_roles, and only system/global platform roles may be linked.
  const [role] = await db.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
  if (!role || role.domain !== 'platform' || role.kind !== 'system' || role.instituteId !== null) {
    throw new Error(`seed: platform role ${roleKey} is not a system platform role; boot the API first`);
  }
  await db.insert(platformUserRoles).values({ userId, roleId: role.id }).onConflictDoNothing();
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

// ── Phase 20b — demo student placement ───────────────────────────────────────
// The demo curriculum is class-scoped: a student only ever sees subjects via
// their placement (placement → division → class → class_subjects). Without a
// placement the scope is an empty subject-set, so the demo student's "My
// Subjects" page shows "No subjects in your scope". Seed the full chain so the
// browser demo has subjects to walk through. Idempotent (unique keys on name,
// class+subject, year+class+division, and the active-per-(year, member)
// placement index all conflict-no-op).
async function upsertAcademicYear(
  db: ReturnType<typeof createDatabase>,
  instituteId: string,
  name: string,
  sortOrder: number,
) {
  const existing = await db
    .select()
    .from(academicYears)
    .where(and(eq(academicYears.instituteId, instituteId), eq(academicYears.name, name)))
    .limit(1);
  if (existing.length > 0) return existing[0]!;
  const [row] = await db
    .insert(academicYears)
    .values({ instituteId, name, sortOrder })
    .returning();
  if (!row) throw new Error(`failed to create academic year ${name}`);
  return row;
}

async function upsertClass(
  db: ReturnType<typeof createDatabase>,
  instituteId: string,
  name: string,
  sortOrder: number,
) {
  const existing = await db
    .select()
    .from(classes)
    .where(and(eq(classes.instituteId, instituteId), eq(classes.name, name)))
    .limit(1);
  if (existing.length > 0) return existing[0]!;
  const [row] = await db.insert(classes).values({ instituteId, name, sortOrder }).returning();
  if (!row) throw new Error(`failed to create class ${name}`);
  return row;
}

async function upsertDivision(
  db: ReturnType<typeof createDatabase>,
  instituteId: string,
  academicYearId: string,
  classId: string,
  name: string,
  sortOrder: number,
) {
  const existing = await db
    .select()
    .from(divisions)
    .where(
      and(
        eq(divisions.academicYearId, academicYearId),
        eq(divisions.classId, classId),
        eq(divisions.name, name),
      ),
    )
    .limit(1);
  if (existing.length > 0) return existing[0]!;
  const [row] = await db
    .insert(divisions)
    .values({ instituteId, academicYearId, classId, name, sortOrder })
    .returning();
  if (!row) throw new Error(`failed to create division ${name}`);
  return row;
}

async function seedDemoPlacement(db: ReturnType<typeof createDatabase>, studentMembershipId: string) {
  const instituteId = DEMO_INSTITUTE_ID;
  const year = await upsertAcademicYear(db, instituteId, '2026-27', 0);
  const klass = await upsertClass(db, instituteId, 'B.Sc. Computer Science', 0);
  const division = await upsertDivision(db, instituteId, year.id, klass.id, 'Division A', 0);

  const demoSubjects = await db
    .select()
    .from(subjects)
    .where(
      and(
        eq(subjects.instituteId, instituteId),
        inArray(subjects.slug, DEMO_SUBJECTS.map((s) => s.slug)),
      ),
    );
  for (const subject of demoSubjects) {
    await db
      .insert(classSubjects)
      .values({ classId: klass.id, subjectId: subject.id })
      .onConflictDoNothing();
  }

  const existing = await db
    .select()
    .from(studentPlacements)
    .where(
      and(
        eq(studentPlacements.instituteId, instituteId),
        eq(studentPlacements.membershipId, studentMembershipId),
        eq(studentPlacements.academicYearId, year.id),
        eq(studentPlacements.status, 'active'),
      ),
    )
    .limit(1);
  if (existing.length > 0) return;
  await db
    .insert(studentPlacements)
    .values({ instituteId, membershipId: studentMembershipId, academicYearId: year.id, divisionId: division.id })
    .onConflictDoNothing();
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

// Demo tier maps to the NEP-2020 B.Sc. CS curriculum (4 subjects). The phased
// out Mathematics/Physics demo curriculum is removed deterministically on every
// seed run — cleanup is scoped to the demo institute by the old subject slugs,
// so production tenants are never touched.
const PHASED_OUT_DEMO_SLUGS = ['mathematics', 'physics'];

const DEMO_SUBJECTS: DemoSubject[] = [
  {
    name: 'Artificial Intelligence',
    slug: 'ai',
    syllabusText:
      '1. Basics of AI: intelligent agents, problem solving as search, knowledge representation.\n' +
      '2. Machine Learning Fundamentals: supervised and unsupervised learning, neural networks.\n\n' +
      'Examination scheme carries 13 marks over 45 minutes.',
    contentTopicSlug: 'introduction-to-ai',
    chapters: [
      {
        slug: 'basics-of-ai',
        name: 'Basics of AI',
        topics: [
          { slug: 'introduction-to-ai', name: 'Introduction to AI' },
          { slug: 'search-algorithms', name: 'Search Algorithms' },
          { slug: 'knowledge-representation', name: 'Knowledge Representation' },
        ],
      },
      {
        slug: 'ml-fundamentals',
        name: 'Machine Learning Fundamentals',
        topics: [
          { slug: 'supervised-learning', name: 'Supervised Learning' },
          { slug: 'unsupervised-learning', name: 'Unsupervised Learning' },
          { slug: 'neural-networks', name: 'Neural Networks' },
        ],
      },
    ],
    questions: [
      {
        chapterSlug: 'basics-of-ai',
        topicSlug: 'introduction-to-ai',
        stem: 'A rational agent in AI most notably acts to',
        type: 'MCQ',
        difficulty: 'EASY',
        explanation: 'A rational agent chooses actions expected to maximize performance.',
        payload: {
          choices: [
            { id: 'ai1', text: 'maximize its expected performance measure' },
            { id: 'ai2', text: 'mimic every human behavior exactly' },
            { id: 'ai3', text: 'store every possible input sequence' },
            { id: 'ai4', text: 'operate without any sensors' },
          ],
          correctChoiceId: 'ai1',
        },
      },
      {
        chapterSlug: 'basics-of-ai',
        topicSlug: 'search-algorithms',
        stem: 'The uninformed search algorithm that always expands the shallowest node first is',
        type: 'MCQ',
        difficulty: 'MEDIUM',
        explanation: 'Breadth-first search expands the shallowest frontier node first.',
        payload: {
          choices: [
            { id: 'ai5', text: 'breadth-first search' },
            { id: 'ai6', text: 'depth-first search' },
            { id: 'ai7', text: 'A* search' },
            { id: 'ai8', text: 'hill climbing' },
          ],
          correctChoiceId: 'ai5',
        },
      },
      {
        chapterSlug: 'basics-of-ai',
        topicSlug: 'knowledge-representation',
        stem: 'A production rule in a knowledge base has the logical form',
        type: 'FILL_IN_BLANK',
        difficulty: 'MEDIUM',
        explanation: 'Rules are typically written as "if condition then action/conclusion".',
        payload: { acceptableAnswers: ['if...then', 'IF...THEN', 'if then'] },
      },
      {
        chapterSlug: 'ml-fundamentals',
        topicSlug: 'supervised-learning',
        stem: 'Supervised learning requires training data that includes',
        type: 'MCQ',
        difficulty: 'MEDIUM',
        explanation: 'Supervised learning learns from labeled input-output pairs.',
        payload: {
          choices: [
            { id: 'ai9', text: 'labeled input-output pairs' },
            { id: 'ai10', text: 'only unlabeled examples' },
            { id: 'ai11', text: 'a pre-trained reward model' },
            { id: 'ai12', text: 'no data at all' },
          ],
          correctChoiceId: 'ai9',
        },
      },
      {
        chapterSlug: 'ml-fundamentals',
        topicSlug: 'unsupervised-learning',
        stem: 'Clustering is an example of ________ learning.',
        type: 'FILL_IN_BLANK',
        difficulty: 'EASY',
        explanation: 'Clustering groups unlabeled data, so it is unsupervised.',
        payload: { acceptableAnswers: ['unsupervised'] },
      },
      {
        chapterSlug: 'ml-fundamentals',
        topicSlug: 'neural-networks',
        stem: 'A neural network with no hidden layers can only learn linearly separable functions.',
        type: 'TRUE_FALSE',
        difficulty: 'HARD',
        explanation: 'A single-layer perceptron cannot separate non-linearly separable classes.',
        payload: { correctAnswer: true },
      },
    ],
    patternTitle: 'Artificial Intelligence — Term Blueprint',
    assessmentTitle: 'Artificial Intelligence — End of Term Quiz',
  },
  {
    name: 'Cyber and Information Security',
    slug: 'cyber-security',
    syllabusText:
      '1. Cyber threats and defence: threat landscape, malware, firewalls and intrusion detection.\n' +
      '2. Information security foundations: cryptography basics and authentication.\n\n' +
      'Examination scheme carries 13 marks over 45 minutes.',
    contentTopicSlug: 'cryptography-basics',
    chapters: [
      {
        slug: 'cyber-threats',
        name: 'Cyber Threats and Defence',
        topics: [
          { slug: 'threat-landscape', name: 'Threat Landscape' },
          { slug: 'malware', name: 'Malware' },
          { slug: 'firewalls-ids', name: 'Firewalls and IDS' },
        ],
      },
      {
        slug: 'info-security-foundations',
        name: 'Information Security Foundations',
        topics: [
          { slug: 'cryptography-basics', name: 'Cryptography Basics' },
          { slug: 'authentication', name: 'Authentication' },
        ],
      },
    ],
    questions: [
      {
        chapterSlug: 'cyber-threats',
        topicSlug: 'threat-landscape',
        stem: 'A social engineering attack that tricks a user into revealing credentials is known as',
        type: 'MCQ',
        difficulty: 'EASY',
        explanation: 'Phishing typically uses deceptive messages to obtain sensitive data.',
        payload: {
          choices: [
            { id: 'cs1', text: 'phishing' },
            { id: 'cs2', text: 'denial of service' },
            { id: 'cs3', text: 'sniffing' },
            { id: 'cs4', text: 'spoofing' },
          ],
          correctChoiceId: 'cs1',
        },
      },
      {
        chapterSlug: 'cyber-threats',
        topicSlug: 'malware',
        stem: 'Malware that replicates itself and spreads across hosts without user action is a',
        type: 'MCQ',
        difficulty: 'MEDIUM',
        explanation: 'A worm self-replicates and spreads automatically across the network.',
        payload: {
          choices: [
            { id: 'cs5', text: 'worm' },
            { id: 'cs6', text: 'trojan' },
            { id: 'cs7', text: 'adware' },
            { id: 'cs8', text: 'spyware' },
          ],
          correctChoiceId: 'cs5',
        },
      },
      {
        chapterSlug: 'cyber-threats',
        topicSlug: 'firewalls-ids',
        stem: 'A device that filters traffic between trusted and untrusted networks is a',
        type: 'FILL_IN_BLANK',
        difficulty: 'EASY',
        explanation: 'A firewall enforces network access policy at the boundary.',
        payload: { acceptableAnswers: ['firewall'] },
      },
      {
        chapterSlug: 'info-security-foundations',
        topicSlug: 'cryptography-basics',
        stem: 'Encryption that uses the same key for encryption and decryption is called',
        type: 'MCQ',
        difficulty: 'MEDIUM',
        explanation: 'Symmetric (secret-key) cryptography shares one key both ways.',
        payload: {
          choices: [
            { id: 'cs9', text: 'symmetric encryption' },
            { id: 'cs10', text: 'public-key encryption' },
            { id: 'cs11', text: 'quantum encryption' },
            { id: 'cs12', text: 'one-time-pad only' },
          ],
          correctChoiceId: 'cs9',
        },
      },
      {
        chapterSlug: 'info-security-foundations',
        topicSlug: 'authentication',
        stem: 'Multi-factor authentication combines at least two ________ evidence factors.',
        type: 'FILL_IN_BLANK',
        difficulty: 'MEDIUM',
        explanation: 'MFA mixes knowledge, possession, and/or inherence factors.',
        payload: { acceptableAnswers: ['independent'] },
      },
      {
        chapterSlug: 'info-security-foundations',
        topicSlug: 'cryptography-basics',
        stem: 'Hashing is reversible with the correct key.',
        type: 'TRUE_FALSE',
        difficulty: 'EASY',
        explanation: 'Hash functions are one-way; they cannot be reversed to recover input.',
        payload: { correctAnswer: false },
      },
    ],
    patternTitle: 'Cyber and Information Security — Term Blueprint',
    assessmentTitle: 'Cyber and Information Security — End of Term Quiz',
  },
  {
    name: 'Indian Knowledge Systems in Computational System',
    slug: 'iks-computational',
    syllabusText:
      '1. Traditional knowledge systems: introduction to Indian Knowledge Systems and computational framing.\n' +
      '2. Heritage numeracy: ancient algorithms and positional numerals.\n\n' +
      'Examination scheme carries 13 marks over 45 minutes.',
    contentTopicSlug: 'introduction-to-iks',
    chapters: [
      {
        slug: 'traditional-knowledge',
        name: 'Traditional Knowledge Systems',
        topics: [
          { slug: 'introduction-to-iks', name: 'Introduction to IKS' },
          { slug: 'computational-frameworks', name: 'Computational Frameworks' },
        ],
      },
      {
        slug: 'heritage-numeracy',
        name: 'Heritage Numeracy',
        topics: [
          { slug: 'ancient-algorithms', name: 'Ancient Algorithms' },
          { slug: 'positional-numerals', name: 'Positional Numerals' },
        ],
      },
    ],
    questions: [
      {
        chapterSlug: 'traditional-knowledge',
        topicSlug: 'introduction-to-iks',
        stem: 'Indian Knowledge Systems (IKS) primarily emphasizes',
        type: 'MCQ',
        difficulty: 'EASY',
        explanation: 'IKS centers indigenous knowledge rooted in Indian tradition and texts.',
        payload: {
          choices: [
            { id: 'ik1', text: 'indigenous knowledge from Indian tradition' },
            { id: 'ik2', text: 'only modern western science' },
            { id: 'ik3', text: 'strictly oral folklore' },
            { id: 'ik4', text: 'hardware-only design' },
          ],
          correctChoiceId: 'ik1',
        },
      },
      {
        chapterSlug: 'heritage-numeracy',
        topicSlug: 'positional-numerals',
        stem: 'The invention of the decimal place-value numeral system is attributed to Indian mathematics.',
        type: 'TRUE_FALSE',
        difficulty: 'EASY',
        explanation: 'The decimal position-place system originates in Indian mathematics.',
        payload: { correctAnswer: true },
      },
      {
        chapterSlug: 'heritage-numeracy',
        topicSlug: 'ancient-algorithms',
        stem: 'The square-root algorithm described in the Sulba Sutras predates modern digit-by-digit methods.',
        type: 'TRUE_FALSE',
        difficulty: 'HARD',
        explanation: 'Sulba Sutra geometry includes an ancient iterative square-root procedure.',
        payload: { correctAnswer: true },
      },
      {
        chapterSlug: 'heritage-numeracy',
        topicSlug: 'positional-numerals',
        stem: 'In place-value notation, the value of a digit depends on its ________.',
        type: 'FILL_IN_BLANK',
        difficulty: 'EASY',
        explanation: 'Place determines weight in a positional system.',
        payload: { acceptableAnswers: ['position', 'place'] },
      },
      {
        chapterSlug: 'traditional-knowledge',
        topicSlug: 'computational-frameworks',
        stem: 'A modern computational framework for studying IKS heritage methods is best described as',
        type: 'MCQ',
        difficulty: 'MEDIUM',
        explanation: 'Formalizing classical methods into algorithms lets software reproduce them.',
        payload: {
          choices: [
            { id: 'ik5', text: 'encoding classical procedures as algorithms' },
            { id: 'ik6', text: 'discarding ancient methods entirely' },
            { id: 'ik7', text: 'translating texts into prose only' },
            { id: 'ik8', text: 'replacing IKS with spreadsheet models' },
          ],
          correctChoiceId: 'ik5',
        },
      },
    ],
    patternTitle: 'IKS in Computational System — Term Blueprint',
    assessmentTitle: 'IKS in Computational System — End of Term Quiz',
  },
  {
    name: 'Software Testing and Quality Assurance',
    slug: 'software-testing',
    syllabusText:
      '1. Testing foundations: test principles and test case design.\n' +
      '2. Test management: defect lifecycle and test automation basics.\n\n' +
      'Examination scheme carries 13 marks over 45 minutes.',
    contentTopicSlug: 'testing-principles',
    chapters: [
      {
        slug: 'testing-foundations',
        name: 'Testing Foundations',
        topics: [
          { slug: 'testing-principles', name: 'Testing Principles' },
          { slug: 'test-case-design', name: 'Test Case Design' },
        ],
      },
      {
        slug: 'test-management',
        name: 'Test Management',
        topics: [
          { slug: 'defect-lifecycle', name: 'Defect Lifecycle' },
          { slug: 'test-automation', name: 'Test Automation Basics' },
        ],
      },
    ],
    questions: [
      {
        chapterSlug: 'testing-foundations',
        topicSlug: 'testing-principles',
        stem: 'Testing can prove that a program is completely free of defects.',
        type: 'TRUE_FALSE',
        difficulty: 'EASY',
        explanation: 'Testing shows the presence of defects, never their absence.',
        payload: { correctAnswer: false },
      },
      {
        chapterSlug: 'testing-foundations',
        topicSlug: 'test-case-design',
        stem: 'Partitioning inputs into classes that should be handled equivalently is called',
        type: 'MCQ',
        difficulty: 'MEDIUM',
        explanation:
          'Equivalence partitioning reduces the input space into representative classes.',
        payload: {
          choices: [
            { id: 'st1', text: 'equivalence partitioning' },
            { id: 'st2', text: 'boundary value analysis' },
            { id: 'st3', text: 'fuzz testing' },
            { id: 'st4', text: 'mutation testing' },
          ],
          correctChoiceId: 'st1',
        },
      },
      {
        chapterSlug: 'testing-foundations',
        topicSlug: 'test-case-design',
        stem: 'Testing just above and below the edges of equivalence classes is called ________ value analysis.',
        type: 'FILL_IN_BLANK',
        difficulty: 'EASY',
        explanation: 'Boundary value analysis checks the limits of input ranges.',
        payload: { acceptableAnswers: ['boundary'] },
      },
      {
        chapterSlug: 'test-management',
        topicSlug: 'defect-lifecycle',
        stem: 'The first state of the defect lifecycle before any validation is',
        type: 'MCQ',
        difficulty: 'MEDIUM',
        explanation: 'A reported defect is typically opened or "new" at the start.',
        payload: {
          choices: [
            { id: 'st5', text: 'new' },
            { id: 'st6', text: 'resolved' },
            { id: 'st7', text: 'verified' },
            { id: 'st8', text: 'closed' },
          ],
          correctChoiceId: 'st5',
        },
      },
      {
        chapterSlug: 'test-management',
        topicSlug: 'test-automation',
        stem: 'Automated test scripts are best suited to repeatable, ________ regression scenarios.',
        type: 'FILL_IN_BLANK',
        difficulty: 'MEDIUM',
        explanation: 'Automation shines for frequent repeatable regression checks.',
        payload: { acceptableAnswers: ['frequent', 'repetitive', 'repeatable'] },
      },
    ],
    patternTitle: 'Software Testing and QA — Term Blueprint',
    assessmentTitle: 'Software Testing and QA — End of Term Quiz',
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

// The scope-chain CHECKs (migration 0020) require subject_id always, plus
// chapter_id whenever topic_id is set. Resolve the full chain from a topic so
// seed inserts never write a leaf-only scope.
async function scopeChainFromTopic(
  db: ReturnType<typeof createDatabase>,
  topicId: string,
): Promise<{ chapterId: string; subjectId: string }> {
  const [topic] = await db.select().from(topics).where(eq(topics.id, topicId)).limit(1);
  if (!topic) throw new Error(`failed to resolve scope chain: topic ${topicId} not found`);
  const [chapter] = await db
    .select()
    .from(chapters)
    .where(eq(chapters.id, topic.chapterId))
    .limit(1);
  if (!chapter)
    throw new Error(`failed to resolve scope chain: chapter ${topic.chapterId} not found`);
  return { chapterId: chapter.id, subjectId: chapter.subjectId };
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
  const chain = args.topicId ? await scopeChainFromTopic(db, args.topicId) : undefined;
  const [row] = await db
    .insert(materials)
    .values({
      instituteId: args.instituteId,
      title: args.title,
      subjectId: chain?.subjectId ?? args.subjectId,
      chapterId: chain?.chapterId,
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
  const chain = await scopeChainFromTopic(db, args.topicId);
  const [row] = await db
    .insert(questions)
    .values({
      instituteId: args.instituteId,
      subjectId: chain.subjectId,
      chapterId: chain.chapterId,
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
        questionTypes: [
          {
            id: crypto.randomUUID(),
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
        ],
      },
      {
        id: crypto.randomUUID(),
        name: `${subjectName} — Section B: True or False`,
        questionTypes: [
          {
            id: crypto.randomUUID(),
            questionType: 'TRUE_FALSE',
            count: 3,
            marksPerQuestion: 1,
            totalMarks: 3,
            compulsory: true,
            attemptCount: null,
            difficultyDistribution: { EASY: 50, MEDIUM: 50, HARD: 0 },
            topicDistribution: null,
          },
        ],
      },
      {
        id: crypto.randomUUID(),
        name: `${subjectName} — Section C: Fill in the Blank`,
        questionTypes: [
          {
            id: crypto.randomUUID(),
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
    .where(
      and(eq(paperPatterns.instituteId, args.instituteId), eq(paperPatterns.title, args.title)),
    )
    .limit(1);
  if (existing.length > 0) {
    // Idempotency: make sure the subject association exists.
    await db
      .insert(paperPatternSubjects)
      .values({ patternId: existing[0]!.id, subjectId: args.subjectId })
      .onConflictDoNothing();
    return existing[0]!;
  }
  const now = new Date();
  const [row] = await db
    .insert(paperPatterns)
    .values({
      instituteId: args.instituteId,
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
  await db
    .insert(paperPatternSubjects)
    .values({ patternId: row.id, subjectId: args.subjectId })
    .onConflictDoNothing();
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
  const chain = await scopeChainFromTopic(db, args.topicId);
  const [row] = await db
    .insert(contentItems)
    .values({
      instituteId: args.instituteId,
      subjectId: chain.subjectId,
      chapterId: chain.chapterId,
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

// Deterministically remove any leftover data from the demo curriculum that has
// been phased out. Scoped to the demo institute by the old subject slugs, so
// production tenants are untouched. Delete order follows the FK graph:
// attempts and practice sessions (restrict on source ids) first, then
// assessments (cascade assessment_questions), patterns, and finally the
// subjects, whose cascades clean up chapters/topics/materials/questions/content
// items.
async function cleanupPhasedOutDemoData(db: ReturnType<typeof createDatabase>) {
  const subjectRows = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(
      and(
        eq(subjects.instituteId, DEMO_INSTITUTE_ID),
        inArray(subjects.slug, PHASED_OUT_DEMO_SLUGS),
      ),
    );
  if (subjectRows.length === 0) return;
  const subjectIds = subjectRows.map((r) => r.id);

  const [patternRows, contentRows, topicRows] = await Promise.all([
    db
      .select({ patternId: paperPatternSubjects.patternId })
      .from(paperPatternSubjects)
      .innerJoin(paperPatterns, eq(paperPatterns.id, paperPatternSubjects.patternId))
      .where(inArray(paperPatternSubjects.subjectId, subjectIds)),
    db
      .select({ id: contentItems.id })
      .from(contentItems)
      .where(inArray(contentItems.subjectId, subjectIds)),
    db
      .select({ id: topics.id })
      .from(topics)
      .innerJoin(chapters, eq(topics.chapterId, chapters.id))
      .where(inArray(chapters.subjectId, subjectIds)),
  ]);
  const patternIds = patternRows.map((r) => r.patternId);
  const contentIds = contentRows.map((r) => r.id);
  const topicIds = topicRows.map((r) => r.id);

  const assessmentRows = patternIds.length
    ? await db
        .select({ id: assessments.id })
        .from(assessments)
        .where(inArray(assessments.blueprintId, patternIds))
    : [];
  const assessmentIds = assessmentRows.map((r) => r.id);

  // Practice sessions snapshot source ids; delete them first or the subject
  // cascade fails on the restrict FKs (content_id / topic_id).
  const sessionIds = [
    ...(contentIds.length
      ? await db
          .select({ id: practiceSessions.id })
          .from(practiceSessions)
          .where(inArray(practiceSessions.contentId, contentIds))
      : []),
    ...(topicIds.length
      ? await db
          .select({ id: practiceSessions.id })
          .from(practiceSessions)
          .where(inArray(practiceSessions.topicId, topicIds))
      : []),
  ].map((r) => r.id);

  if (sessionIds.length)
    await db.delete(practiceSessions).where(inArray(practiceSessions.id, sessionIds));
  if (assessmentIds.length) {
    await db.delete(attempts).where(inArray(attempts.assessmentId, assessmentIds));
    await db.delete(assessments).where(inArray(assessments.id, assessmentIds));
  }
  if (patternIds.length)
    await db.delete(paperPatterns).where(inArray(paperPatterns.id, patternIds));
  await db.delete(subjects).where(inArray(subjects.id, subjectIds));
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

  await cleanupPhasedOutDemoData(db);
  await seedDemoCurriculum(db);
  await seedDemoPlacement(db, studentMembership.id);
  await seedValidationFixtures(db);

  // Phase D: a demo platform SUPER_ADMIN (D3/§15) — platform_user_roles, NOT a
  // membership role. Carries no institute membership and holds all platform
  // permissions (ocr-workers.*, institutes.*) from the boot sync.
  const superAdmin = await upsertUser(db, 'superadmin@catlium.dev', 'Platform Super Admin');
  await ensurePlatformRole(db, superAdmin.id, 'SUPER_ADMIN');

  console.log(
    `Seeded institute=${JSON.stringify({ id: institute.id, name: institute.name })}\n` +
      `  admin@catlium.dev / ${PASSWORD}   (INSTITUTE_ADMIN)\n` +
      `  teacher@catlium.dev / ${PASSWORD}  (INSTITUTE_ADMIN, TEACHER)\n` +
      `  student@catlium.dev / ${PASSWORD}  (STUDENT)\n` +
      `  superadmin@catlium.dev / ${PASSWORD}  (SUPER_ADMIN — platform plane, no institute)\n` +
      `  curriculum: NEP-2020 B.Sc. CS — AI, Cyber & Information Security,\n` +
      `    IKS in Computational System, Software Testing & QA (chapters/topics,\n` +
      `    syllabus + reading materials, approved questions, approved paper\n` +
      `    pattern, active assessment per subject; phased-out Mathematics/Physics\n` +
      `    demo data removed deterministically)\n` +
      `  placement: student@catlium.dev → B.Sc. Computer Science / 2026-27 / Division A\n` +
      `    (offers the 4 demo subjects so the student scope is non-empty)`
  );
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
