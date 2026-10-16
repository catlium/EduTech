import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and, asc, isNull } from 'drizzle-orm';
import {
  academicYears,
  classes,
  classSubjects,
  divisions,
  subjects,
} from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';

const UNIQUE_VIOLATION = '23505';

interface YearInput {
  name: string;
  sortOrder?: number;
  status?: 'active' | 'archived';
}
type YearPatch = Partial<YearInput>;

interface ClassInput {
  name: string;
  sortOrder?: number;
  status?: 'active' | 'archived';
}
type ClassPatch = Partial<ClassInput>;

interface DivisionInput {
  academicYearId: string;
  classId: string;
  name: string;
  sortOrder?: number;
}
type DivisionPatch = Partial<Pick<DivisionInput, 'name' | 'sortOrder'>>;

export interface DivisionListOptions {
  academicYearId?: string;
  classId?: string;
}

// Academic structure layer (Phase E, revised D4/§16): academic years, classes,
// class-subject offerings and divisions (student grouping). Every entity is
// institute-scoped — cross-institute reads miss, foreign IDs in relationships
// are rejected, and duplicates are blocked at the DB level (unique rows below).
@Injectable()
export class AcademicStructureService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  // ── Academic years ──────────────────────────

  async listAcademicYears(instituteId: string) {
    return this.db
      .select()
      .from(academicYears)
      .where(eq(academicYears.instituteId, instituteId))
      .orderBy(asc(academicYears.sortOrder), asc(academicYears.name));
  }

  async createAcademicYear(instituteId: string, input: YearInput) {
    try {
      const [row] = await this.db
        .insert(academicYears)
        .values({ ...input, instituteId })
        .returning();
      return row!;
    } catch (error) {
      this.throwIfUniqueViolation(error, 'An academic year with this name already exists');
      throw error;
    }
  }

  async updateAcademicYear(instituteId: string, academicYearId: string, patch: YearPatch) {
    await this.getAcademicYear(instituteId, academicYearId);

    try {
      const [row] = await this.db
        .update(academicYears)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(eq(academicYears.id, academicYearId), eq(academicYears.instituteId, instituteId)),
        )
        .returning();
      return row!;
    } catch (error) {
      this.throwIfUniqueViolation(error, 'An academic year with this name already exists');
      throw error;
    }
  }

  private async getAcademicYear(instituteId: string, academicYearId: string) {
    const [row] = await this.db
      .select()
      .from(academicYears)
      .where(
        and(eq(academicYears.id, academicYearId), eq(academicYears.instituteId, instituteId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Academic year not found');
    return row;
  }

  // ── Classes ─────────────────────────────────

  async listClasses(instituteId: string) {
    return this.db
      .select()
      .from(classes)
      .where(eq(classes.instituteId, instituteId))
      .orderBy(asc(classes.sortOrder), asc(classes.name));
  }

  async createClass(instituteId: string, input: ClassInput) {
    try {
      const [row] = await this.db
        .insert(classes)
        .values({ ...input, instituteId })
        .returning();
      return row!;
    } catch (error) {
      this.throwIfUniqueViolation(error, 'A class with this name already exists');
      throw error;
    }
  }

  async updateClass(instituteId: string, classId: string, patch: ClassPatch) {
    await this.getClass(instituteId, classId);

    try {
      const [row] = await this.db
        .update(classes)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(classes.id, classId), eq(classes.instituteId, instituteId)))
        .returning();
      return row!;
    } catch (error) {
      this.throwIfUniqueViolation(error, 'A class with this name already exists');
      throw error;
    }
  }

  /** Removes a class. Cascade removes its class_subjects + divisions; any
   *  syllabus linked to the class keeps its row with `class_id` set to NULL. */
  async deleteClass(instituteId: string, classId: string) {
    await this.getClass(instituteId, classId);
    await this.db
      .delete(classes)
      .where(and(eq(classes.id, classId), eq(classes.instituteId, instituteId)));
  }

  private async getClass(instituteId: string, classId: string) {
    const [row] = await this.db
      .select()
      .from(classes)
      .where(and(eq(classes.id, classId), eq(classes.instituteId, instituteId)))
      .limit(1);
    if (!row) throw new NotFoundException('Class not found');
    return row;
  }

  // ── Class-subject offerings ─────────────────

  async listClassSubjects(instituteId: string, classId: string) {
    await this.getClass(instituteId, classId);

    const rows = await this.db
      .select({ subject: subjects, classSubjectId: classSubjects.id })
      .from(classSubjects)
      .innerJoin(subjects, eq(classSubjects.subjectId, subjects.id))
      .where(
        and(
          eq(classSubjects.classId, classId),
          eq(subjects.instituteId, instituteId),
          isNull(subjects.deletedAt),
        ),
      )
      .orderBy(asc(subjects.sortOrder), asc(subjects.name));

    // Q.3: expose the offering id so the teacher-assignment console can target
    // an assignment at the exact class-subject offering it renders.
    return rows.map((r) => ({ ...r.subject, classSubjectId: r.classSubjectId }));
  }

  async addClassSubject(instituteId: string, classId: string, subjectId: string) {
    await this.getClass(instituteId, classId);

    const [subject] = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, subjectId), eq(subjects.instituteId, instituteId)))
      .limit(1);
    if (!subject) throw new NotFoundException('Subject not found');

    try {
      await this.db.insert(classSubjects).values({ classId, subjectId });
    } catch (error) {
      this.throwIfUniqueViolation(error, 'Subject already offered in this class');
      throw error;
    }

    return { offered: true, classId, subjectId };
  }

  async removeClassSubject(instituteId: string, classId: string, subjectId: string) {
    // Tenancy: only an offering belonging to a class in *this* institute can be
    // removed (same guard as addClassSubject).
    await this.getClass(instituteId, classId);
    await this.db
      .delete(classSubjects)
      .where(and(eq(classSubjects.classId, classId), eq(classSubjects.subjectId, subjectId)));
  }

  // ── Divisions ───────────────────────────────

  async listDivisions(instituteId: string, options: DivisionListOptions = {}) {
    const conditions = [eq(divisions.instituteId, instituteId)];
    if (options.academicYearId) conditions.push(eq(divisions.academicYearId, options.academicYearId));
    if (options.classId) conditions.push(eq(divisions.classId, options.classId));

    return this.db
      .select()
      .from(divisions)
      .where(and(...conditions))
      .orderBy(asc(divisions.sortOrder), asc(divisions.name));
  }

  async createDivision(instituteId: string, input: DivisionInput) {
    // Reject foreign IDs for relationships: the year and class must belong to
    // this institute before a division can reference them.
    await this.getAcademicYear(instituteId, input.academicYearId);
    await this.getClass(instituteId, input.classId);

    try {
      const [row] = await this.db
        .insert(divisions)
        .values({ ...input, instituteId })
        .returning();
      return row!;
    } catch (error) {
      this.throwIfUniqueViolation(
        error,
        'A division with this name already exists for the class',
      );
      throw error;
    }
  }

  async updateDivision(instituteId: string, divisionId: string, patch: DivisionPatch) {
    await this.getDivision(instituteId, divisionId);

    try {
      const [row] = await this.db
        .update(divisions)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(divisions.id, divisionId), eq(divisions.instituteId, instituteId)))
        .returning();
      return row!;
    } catch (error) {
      this.throwIfUniqueViolation(
        error,
        'A division with this name already exists for the class',
      );
      throw error;
    }
  }

  async deleteDivision(instituteId: string, divisionId: string) {
    await this.getDivision(instituteId, divisionId);
    await this.db
      .delete(divisions)
      .where(and(eq(divisions.id, divisionId), eq(divisions.instituteId, instituteId)));
  }

  private async getDivision(instituteId: string, divisionId: string) {
    const [row] = await this.db
      .select()
      .from(divisions)
      .where(and(eq(divisions.id, divisionId), eq(divisions.instituteId, instituteId)))
      .limit(1);
    if (!row) throw new NotFoundException('Division not found');
    return row;
  }

  private throwIfUniqueViolation(error: unknown, message: string): void {
    const code =
      typeof error === 'object' && error !== null && 'cause' in error
        ? (error.cause as { code?: string })?.code
        : (error as { code?: string })?.code;

    if (code === UNIQUE_VIOLATION) {
      throw new ConflictException(message);
    }
  }
}