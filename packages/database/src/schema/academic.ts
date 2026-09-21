import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, integer, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core';

import { institutes } from './institutes.js';
import { memberships } from './memberships.js';

export const subjects = pgTable(
  'subjects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    description: varchar('description', { length: 1000 }),
    sortOrder: integer('sort_order').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('subjects_institute_slug_unique').on(table.instituteId, table.slug)],
);

export const chapters = pgTable(
  'chapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    description: varchar('description', { length: 1000 }),
    sortOrder: integer('sort_order').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('chapters_subject_slug_unique').on(table.subjectId, table.slug)],
);

export const topics = pgTable(
  'topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    description: varchar('description', { length: 1000 }),
    sortOrder: integer('sort_order').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('topics_chapter_slug_unique').on(table.chapterId, table.slug)],
);

// Academic structure layer (Phase E, D4/§16 — revised model): academic years,
// classes (stable curriculum levels, year-independent), class-subject offerings
// (subjects belong to a Class — NOT a division), and divisions (student
// grouping within one Academic Year + Class). Syllabus scope is Academic Year +
// Class (see syllabi.academic_year_id / class_id). No teacher/student
// assignments and no assessment targeting exist yet (Phases F/G).
export const academicYears = pgTable(
  'academic_years',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('academic_years_institute_name_unique').on(table.instituteId, table.name)],
);

export const classes = pgTable(
  'classes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('classes_institute_name_unique').on(table.instituteId, table.name)],
);

export const classSubjects = pgTable(
  'class_subjects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('class_subjects_class_subject_unique').on(table.classId, table.subjectId)],
);

// Phase F — teacher academic assignments: a TEACHER membership (Teacher =
// institute member) is assigned to ONE canonical `class_subjects` offering
// (Teacher → Class Subject). NOT division-specific (no `division_subjects`),
// NOT duplicated from the offering, and it does NOT need class/subject column
// copies. One assignment per (offering, teacher) while active, so an inactive
// (historical) row can be replaced by a fresh assignment on re-assignment.
export const teacherAssignments = pgTable(
  'teacher_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    classSubjectId: uuid('class_subject_id')
      .notNull()
      .references(() => classSubjects.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('teacher_assignments_active_unique')
      .on(table.classSubjectId, table.membershipId)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const divisions = pgTable(
  'divisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('divisions_academic_year_class_name_unique').on(
      table.academicYearId,
      table.classId,
      table.name,
    ),
  ],
);

// Phase G — student academic placements: a STUDENT membership is placed into
// ONE division per academic year (Student → Division → Class + Academic Year).
// The division carries its year + class, so `class_id` is never mirrored here;
// `academic_year_id` is written server-side from the division (never
// client-supplied) purely so the partial unique index can enforce "one ACTIVE
// placement per (student, year)". Deactivation is soft (`status='inactive'`,
// row retained as history; re-placement and promotions add fresh rows). A
// division groups students ONLY — no `division_subjects`: curriculum stays
// class-scoped via `class_subjects`, shared by every division of the class.
export const studentPlacements = pgTable(
  'student_placements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    divisionId: uuid('division_id')
      .notNull()
      .references(() => divisions.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('student_placements_active_unique')
      .on(table.academicYearId, table.membershipId)
      .where(sql`${table.status} = 'active'`),
  ],
);

// Phase H — student subject enrollments: per-student subject SCOPE overrides
// (D5/§17, D6/§18). Students inherit their class's subject set (placement →
// division → class → class_subjects); this table lets an institute EXCLUDE a
// subject from one student or ENROLL them into a subject NOT offered by their
// class (elective). One row per (placement, subject) — the unique key makes a
// subject's ENROLLED and EXCLUDED states mutually exclusive for a placement,
// and OVERRIDE history within a placement is irrelevant (a deleted row simply
// reverts to the class default). No rows are ever auto-created; overrides are
// admin-invoked. The placement row already pins institute/year/class, so no
// copies of those live here.
export const studentSubjectEnrollments = pgTable(
  'student_subject_enrollments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    placementId: uuid('placement_id')
      .notNull()
      .references(() => studentPlacements.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 20 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('student_subject_enrollments_placement_subject_unique').on(
      table.placementId,
      table.subjectId,
    ),
  ],
);
