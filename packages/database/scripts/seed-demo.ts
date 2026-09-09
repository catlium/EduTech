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
  const [row] = await db
    .insert(users)
    .values({ email, name, passwordHash })
    .returning();
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

  const [row] = await db
    .insert(memberships)
    .values({ userId, instituteId })
    .returning();
  if (!row) throw new Error(`failed to create membership for ${userId}`);
  return row;
}

async function ensureRole(db: ReturnType<typeof createDatabase>, membershipId: string, role: string) {
  await db.insert(membershipRoles).values({ membershipId, role }).onConflictDoNothing();
}

async function upsertSubject(db: ReturnType<typeof createDatabase>, instituteId: string) {
  const existing = await db
    .select()
    .from(subjects)
    .where(and(eq(subjects.instituteId, instituteId), eq(subjects.slug, 'mathematics')))
    .limit(1);
  if (existing.length > 0) return existing[0]!;

  const [row] = await db
    .insert(subjects)
    .values({ instituteId, name: 'Mathematics', slug: 'mathematics' })
    .returning();
  if (!row) throw new Error('failed to create demo subject');
  return row;
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

  const teacher = await upsertUser(db, 'teacher@catlium.dev', 'Demo Teacher');
  const teacherMembership = await upsertMembership(db, teacher.id, institute.id);
  await ensureRole(db, teacherMembership.id, 'INSTITUTE_ADMIN');
  await ensureRole(db, teacherMembership.id, 'TEACHER');

  const student = await upsertUser(db, 'student@catlium.dev', 'Demo Student');
  const studentMembership = await upsertMembership(db, student.id, institute.id);
  await ensureRole(db, studentMembership.id, 'STUDENT');

  await upsertSubject(db, institute.id);
  await seedValidationFixtures(db);

  console.log(
    `Seeded institute=${JSON.stringify({ id: institute.id, name: institute.name })}\n` +
      `  teacher@catlium.dev / ${PASSWORD}  (INSTITUTE_ADMIN, TEACHER)\n` +
      `  student@catlium.dev / ${PASSWORD}  (STUDENT)\n` +
      `  subject: Mathematics`,
  );
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});