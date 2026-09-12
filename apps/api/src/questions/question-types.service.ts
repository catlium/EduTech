import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { eq, and, or, isNull, asc } from 'drizzle-orm';
import { questionTypes } from '@catlium/database';
import type { Database } from '@catlium/database';
import type { QuestionTypeDefinition } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';

export interface CreateQuestionTypeInput {
  name: string;
  code?: string;
  description?: string;
  instructions?: string;
  answerFormat: string;
  kind: string;
  defaultMarks?: number;
  allowedDifficulties?: string[];
  evaluationConfig?: Record<string, unknown>;
}

function toDefinition(row: typeof questionTypes.$inferSelect): QuestionTypeDefinition {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    answerFormat: row.answerFormat as QuestionTypeDefinition['answerFormat'],
    kind: row.kind as QuestionTypeDefinition['kind'],
    defaultMarks: row.defaultMarks,
    allowedDifficulties: (row.allowedDifficulties as QuestionTypeDefinition['allowedDifficulties']) ?? null,
    evaluationConfig: row.evaluationConfig,
    isGlobal: row.instituteId === null,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const SLUG_KEEP = /[^a-zA-Z0-9]+/g;

@Injectable()
export class QuestionTypesService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  /** Global predefined templates + this institute's custom types. */
  async list(instituteId: string): Promise<QuestionTypeDefinition[]> {
    const rows = await this.db
      .select()
      .from(questionTypes)
      .where(or(isNull(questionTypes.instituteId), eq(questionTypes.instituteId, instituteId)))
      .orderBy(asc(questionTypes.name), asc(questionTypes.code));

    return rows.map(toDefinition);
  }

  /** Institute-custom wins over the global predefined template for the code. */
  async findByCode(instituteId: string, code: string) {
    const [scoped] = await this.db
      .select()
      .from(questionTypes)
      .where(and(eq(questionTypes.code, code), eq(questionTypes.instituteId, instituteId)))
      .limit(1);
    if (scoped) return toDefinition(scoped);

    const [globalRow] = await this.db
      .select()
      .from(questionTypes)
      .where(and(eq(questionTypes.code, code), isNull(questionTypes.instituteId)))
      .limit(1);
    if (globalRow) return toDefinition(globalRow);

    throw new NotFoundException(`Question type '${code}' does not exist`);
  }

  async create(instituteId: string, userId: string, input: CreateQuestionTypeInput) {
    const base =
      input.code?.trim().toUpperCase() ||
      input.name
        .trim()
        .toUpperCase()
        .replace(SLUG_KEEP, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);

    const candidate = base || 'CUSTOM_TYPE';
    let code = candidate;
    let suffix = 2;
    for (;;) {
      const existing = await this.db
        .select({ id: questionTypes.id, instituteId: questionTypes.instituteId })
        .from(questionTypes)
        .where(
          and(
            eq(questionTypes.code, code),
            or(
              isNull(questionTypes.instituteId),
              eq(questionTypes.instituteId, instituteId),
            ),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]);

      if (!existing) break;
      if (existing.instituteId === null) {
        // A global predefined template owns this code — custom types may not
        // shadow it. Derive a suffixed variant instead.
        code = `${base.slice(0, 60)}_${suffix}`;
        suffix += 1;
        continue;
      }
      // Collides with another custom type of this institute.
      code = `${base.slice(0, 60)}_${suffix}`;
      suffix += 1;
    }

    const [row] = await this.db
      .insert(questionTypes)
      .values({
        instituteId,
        code,
        name: input.name,
        description: input.description ?? null,
        instructions: input.instructions ?? null,
        answerFormat: input.answerFormat,
        kind: input.kind,
        defaultMarks: input.defaultMarks ?? null,
        allowedDifficulties: input.allowedDifficulties ?? ['EASY', 'MEDIUM', 'HARD'],
        evaluationConfig: input.evaluationConfig ?? null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();

    return toDefinition(row!);
  }
}