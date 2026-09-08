import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import * as bcryptjs from 'bcryptjs';
import { eq, and } from 'drizzle-orm';

import { createDatabase } from '../src/index.js';
import { institutes, users, memberships, membershipRoles, subjects } from '../src/index.js';

// Idempotent demo seed. Re-running is safe: every insert is guarded by a
// unique-key check or conflict clause. Uses a fixed, dedicated demo institute
// UUID (distinct from the pre-existing E2E fixture institutes) that the demo,
// syllabus, and attempts E2E scripts share.
//   Demo institute:  99999999-9999-9999-9999-999999999999 (catlium-demo)

loadEnvFile(resolve(process.cwd(), '../../.env'));

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