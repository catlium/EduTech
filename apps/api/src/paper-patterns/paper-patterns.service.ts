import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@catlium/database';
import { materials, paperPatterns, paperPatternSubjects, subjects } from '@catlium/database';
import { normalizePaperPatternStructure, type PaperPatternStructure } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { resolveScopeChain } from '../common/utils/scope-resolver.js';
import { JobsService, type Job } from '../jobs/jobs.service.js';
import { MaterialsService } from '../materials/materials.service.js';
import { ExaminationsService } from '../examinations/examinations.service.js';
import { QuestionGenerationService } from '../questions/question-generation.service.js';
import { isUniqueViolation } from '../common/utils/db-errors.util.js';
import { validatePaperPatternStructure } from './paper-patterns.validation.js';
import { buildSubjectIds, foreignSubjectIds } from './paper-pattern-subjects.js';

const OPERATION = 'AI_GENERATE_BLUEPRINT';

interface AnalyzeSource {
  type: 'TEXT' | 'MATERIAL' | 'PREVIOUS_YEAR_PAPER';
  id?: string;
  text?: string;
}

@Injectable()
export class PaperPatternsService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    private readonly jobs: JobsService,
    private readonly materials: MaterialsService,
    private readonly examinations: ExaminationsService,
    private readonly generation: QuestionGenerationService,
  ) {}

  // ── CRUD ──────────────────────────────────

  async createPattern(
    instituteId: string,
    userId: string,
    input: {
      title: string;
      subjectIds?: string[];
      subjectId?: string;
      description?: string;
      structure?: unknown;
    },
  ) {
    const subjectIds = await this.resolveSubjectIds(instituteId, input);

    const [created] = await this.db
      .insert(paperPatterns)
      .values({
        instituteId,
        title: input.title,
        description: input.description ?? null,
        sourceType: 'MANUAL',
        structure: input.structure !== undefined ? this.parseStructure(input.structure) : null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();

    if (!created) throw new InternalServerErrorException('Failed to create paper pattern');
    if (subjectIds.length > 0) {
      await this.replaceSubjectAssociations(created.id, subjectIds);
    }

    return (await this.attachSubjectIds([created]))[0]!;
  }

  async listPatterns(instituteId: string) {
    const rows = await this.db
      .select()
      .from(paperPatterns)
      .where(eq(paperPatterns.instituteId, instituteId))
      .orderBy(desc(paperPatterns.createdAt));
    return this.attachSubjectIds(rows.map(this.normalizeRowStructure.bind(this)));
  }

  async getPattern(instituteId: string, patternId: string) {
    const row = await this.requirePattern(instituteId, patternId);
    return (await this.attachSubjectIds([this.normalizeRowStructure(row)]))[0]!;
  }

  async updatePattern(
    instituteId: string,
    userId: string,
    patternId: string,
    input: {
      title?: string;
      description?: string;
      structure?: unknown;
      subjectIds?: string[];
      version?: number;
    },
  ) {
    const row = await this.requirePattern(instituteId, patternId);
    // The lock guards structure/data edits, not naming: renaming a pattern
    // (title/description) stays allowed while locked so typo fixes don't need
    // an unlock.
    const touchesStructure = input.structure !== undefined || input.subjectIds !== undefined;
    if (row.isLocked && touchesStructure) {
      throw new ConflictException(
        'Paper pattern is locked — unlock it before editing its structure',
      );
    }
    if (input.version !== undefined && input.version !== row.version) {
      throw new ConflictException('Paper pattern has been modified — refresh and retry');
    }

    const updates: Record<string, unknown> = {
      updatedBy: userId,
      updatedAt: new Date(),
      version: row.version + 1,
    };
    if (input.title !== undefined) updates['title'] = input.title;
    if (input.description !== undefined) updates['description'] = input.description;

    if (input.structure !== undefined) {
      const structure = this.parseStructure(input.structure);
      updates['structure'] = structure;
      // Record the last time the stored structure passed deterministic validation.
      if (validatePaperPatternStructure(structure).length === 0) {
        updates['validatedAt'] = new Date();
      }
    }

    const subjectIdsToSet =
      input.subjectIds !== undefined
        ? await this.assertSubjectsInInstitute(instituteId, input.subjectIds)
        : undefined;

    const updated = await this.db.transaction(async (tx) => {
      const [patched] = await tx
        .update(paperPatterns)
        .set(updates)
        .where(and(eq(paperPatterns.id, patternId), eq(paperPatterns.instituteId, instituteId)))
        .returning();
      if (patched && subjectIdsToSet !== undefined) {
        await tx.delete(paperPatternSubjects).where(eq(paperPatternSubjects.patternId, patternId));
        if (subjectIdsToSet.length > 0) {
          await tx
            .insert(paperPatternSubjects)
            .values(subjectIdsToSet.map((subjectId) => ({ patternId, subjectId })));
        }
      }
      return patched;
    });

    return (await this.attachSubjectIds([updated!]))[0]!;
  }

  async deletePattern(instituteId: string, patternId: string) {
    // requirePattern gives 404 + tenant scope and the lock guard; junction +
    // assessment-blueprint FKs self-clean on delete.
    const row = await this.requirePattern(instituteId, patternId);
    if (row.isLocked) {
      throw new ConflictException('Paper pattern is locked — unlock it before deleting');
    }
    // Guard against concurrent worker operations: if a blueprint analysis
    // job is queued or running, refuse deletion rather than race with the
    // worker. Check-then-delete has a small window; concurrent jobs that
    // land after the DELETE will simply fail to find the pattern (harmless).
    // ponytail: same check-then-delete as syllabus; per-pattern lock only
    // matters at >1 req/s per pattern, upgrade to SELECT FOR UPDATE if seen.
    if (await this.jobs.hasActivePatternJob(instituteId, patternId)) {
      throw new ConflictException('A blueprint analysis is still running for this paper pattern');
    }

    await this.db
      .delete(paperPatterns)
      .where(and(eq(paperPatterns.id, patternId), eq(paperPatterns.instituteId, instituteId)));
    return { deleted: true };
  }

  // ── AI analysis ───────────────────────────

  async analyze(instituteId: string, userId: string, patternId: string, source: AnalyzeSource) {
    const row = await this.requirePattern(instituteId, patternId);
    if (row.status === 'APPROVED') {
      throw new ConflictException('Approved paper patterns cannot be re-analyzed');
    }
    const subjectIds = (await this.attachSubjectIds([row]))[0]!.subjectIds;

    const sourceMaterialId = await this.resolveSourceMaterial(
      instituteId,
      userId,
      row.title,
      subjectIds,
      source,
      row.sourceMaterialId,
    );

    const payload = {
      operation: OPERATION,
      source: { type: 'MATERIAL', id: sourceMaterialId },
      patternId: row.id,
      requestedBy: userId,
    };

    // Partial unique index (active generation per institute + source + operation)
    // blocks a second concurrent analysis of the same pattern; maps to 409.
    let job: Job;
    try {
      job = await this.jobs.insertJob(instituteId, OPERATION, payload);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A blueprint analysis is already in progress');
      }
      throw error;
    }

    try {
      await this.jobs.publishJob(job);
    } catch {
      await this.jobs.updateJobStatus(job.id, 'failed', undefined, {
        message: 'Failed to enqueue blueprint analysis',
      });
      throw new InternalServerErrorException('Failed to enqueue blueprint analysis');
    }

    return {
      jobId: job.id,
      operation: OPERATION,
      sourceType: 'MATERIAL' as const,
      sourceId: sourceMaterialId,
      patternId: row.id,
      status: 'QUEUED' as const,
    };
  }

  async getAnalysisJob(instituteId: string, patternId: string, jobId: string): Promise<Job> {
    const job = await this.jobs.getJob(jobId, instituteId);
    if (
      job.type !== OPERATION ||
      (job.payload as Record<string, unknown> | null)?.patternId !== patternId
    ) {
      throw new BadRequestException('This job is not a blueprint-analysis job for this pattern');
    }
    return job;
  }

  // ── Validation / approval ─────────────────

  async validate(instituteId: string, patternId: string) {
    const row = await this.requirePattern(instituteId, patternId);
    if (!row.structure) {
      return { valid: false as const, errors: ['Paper pattern has no structure yet'] };
    }
    const errors = validatePaperPatternStructure(this.asStructure(row.structure));
    return { valid: errors.length === 0, errors } as const;
  }

  async approve(instituteId: string, userId: string, patternId: string) {
    const row = await this.requirePattern(instituteId, patternId);
    // DRAFT / REVIEW approve as before; an APPROVED pattern re-approves after
    // an unlock (the structure was edited and needs re-validation). A locked
    // APPROVED pattern stays immutable.
    if (row.status === 'APPROVED' && row.isLocked) {
      throw new ConflictException('Paper pattern is already approved and locked');
    }
    if (!row.structure) {
      throw new BadRequestException('Paper pattern has no structure to approve');
    }
    const errors = validatePaperPatternStructure(this.asStructure(row.structure));
    if (errors.length > 0) {
      throw new BadRequestException(`Paper pattern is not valid: ${errors.join('; ')}`);
    }

    const [approved] = await this.db
      .update(paperPatterns)
      .set({
        status: 'APPROVED',
        isLocked: true,
        validatedAt: new Date(),
        approvedAt: new Date(),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(paperPatterns.id, patternId), eq(paperPatterns.instituteId, instituteId)))
      .returning();

    return (await this.attachSubjectIds([this.normalizeRowStructure(approved!)]))[0]!;
  }

  /** Lock or unlock a pattern. Approving auto-locks; locking is an explicit
   *  accidental-mutation guard, not a status change. */
  async setLocked(instituteId: string, userId: string, patternId: string, isLocked: boolean) {
    await this.requirePattern(instituteId, patternId);
    const [updated] = await this.db
      .update(paperPatterns)
      .set({ isLocked, updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(paperPatterns.id, patternId), eq(paperPatterns.instituteId, instituteId)))
      .returning();
    return (await this.attachSubjectIds([this.normalizeRowStructure(updated!)]))[0]!;
  }

  // ── Assessment creation ───────────────────

  async createAssessmentFromBlueprint(
    instituteId: string,
    userId: string,
    patternId: string,
    input: {
      title?: string;
      description?: string;
      subjectId?: string;
      chapterId?: string;
      topicId?: string;
    },
  ) {
    const row = await this.requirePattern(instituteId, patternId);
    if (row.status !== 'APPROVED' || !row.structure) {
      throw new BadRequestException('Only an approved paper pattern can create an assessment');
    }
    const errors = validatePaperPatternStructure(this.asStructure(row.structure));
    if (errors.length > 0) {
      throw new BadRequestException(`Paper pattern is not currently valid: ${errors.join('; ')}`);
    }

    const structure = this.asStructure(row.structure);

    // The scope is the authoritative source of questions. The pattern never
    // supplies it, so a missing subject hard-blocks creation.
    const scope = await resolveScopeChain(
      { db: this.db, instituteId, requireSubject: true },
      input,
    );
    if (!scope.subjectId) throw new BadRequestException('A question scope requires a subject');

    // Never create an assessment the bank cannot fully supply within the scope.
    const coverage = await this.generation.ensurePatternCoverage(instituteId, userId, row.id, {
      subjectId: scope.subjectId,
      chapterId: scope.chapterId ?? undefined,
      topicId: scope.topicId ?? undefined,
    });
    if (!coverage.covered) {
      if (coverage.status === 'GENERATING') {
        return {
          status: coverage.status,
          patternId: row.id,
          totalDeficit: coverage.totalDeficit,
          totalExisting: coverage.totalExisting,
          buckets: coverage.buckets,
          batchId: coverage.batchId,
          jobIds: coverage.jobIds,
        };
      }
      throw new BadRequestException(
        coverage.status === 'AWAITING_APPROVAL'
          ? `${coverage.totalDeficit} generated question${coverage.totalDeficit === 1 ? ' is' : 's are'} still awaiting approval — approve them in the Question Bank, then create the assessment again.`
          : 'The question bank has too few questions for this pattern to generate the missing ones automatically.',
      );
    }

    const assessment = await this.examinations.createAssessment(instituteId, userId, {
      title: input.title ?? `${row.title} — Blueprint`,
      description: input.description ?? row.description ?? undefined,
      durationMinutes: structure.durationMinutes,
      maxMarks: structure.totalMarks,
      instructions: { text: structure.instructions.join('. ') },
      blueprintId: row.id,
      subjectId: scope.subjectId,
      chapterId: scope.chapterId ?? undefined,
      topicId: scope.topicId ?? undefined,
    });
    return assessment;
  }

  // ── Internals ─────────────────────────────

  private async requirePattern(instituteId: string, patternId: string) {
    const [row] = await this.db
      .select()
      .from(paperPatterns)
      .where(and(eq(paperPatterns.id, patternId), eq(paperPatterns.instituteId, instituteId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Paper pattern not found');
    }
    return row;
  }

  /** Merge the legacy single subjectId into the subjectIds set and reject any
   * association that is not tenant-owned (cross-institute isolation). */
  private async resolveSubjectIds(
    instituteId: string,
    input: { subjectIds?: string[]; subjectId?: string },
  ): Promise<string[]> {
    const subjectIds = buildSubjectIds(input.subjectIds, input.subjectId);
    return this.assertSubjectsInInstitute(instituteId, subjectIds);
  }

  // Rejects cross-institute subject associations up front. Empty sets (a
  // General pattern) are always valid.
  private async assertSubjectsInInstitute(instituteId: string, subjectIds: string[]) {
    if (subjectIds.length === 0) return subjectIds;
    const ids = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(
        and(
          eq(subjects.instituteId, instituteId),
          isNull(subjects.deletedAt),
          inArray(subjects.id, subjectIds),
        ),
      );
    const ownedIds = new Set(ids.map((s) => s.id));
    const foreign = foreignSubjectIds(subjectIds, ownedIds);
    if (foreign.length > 0) {
      throw new BadRequestException(`Subject(s) ${foreign.join(', ')} not found in this institute`);
    }
    return subjectIds;
  }

  /** Replace the full association set for a pattern (empty set = General). */
  private async replaceSubjectAssociations(patternId: string, subjectIds: string[]) {
    await this.db.transaction(async (tx) => {
      await tx.delete(paperPatternSubjects).where(eq(paperPatternSubjects.patternId, patternId));
      if (subjectIds.length > 0) {
        await tx
          .insert(paperPatternSubjects)
          .values(subjectIds.map((subjectId) => ({ patternId, subjectId })));
      }
    });
  }

  /** Batch-load association rows and attach `subjectIds` to each pattern. */
  private async attachSubjectIds<T extends { id: string }>(patterns: T[]) {
    if (patterns.length === 0) return patterns as (T & { subjectIds: string[] })[];
    const links = await this.db
      .select({
        patternId: paperPatternSubjects.patternId,
        subjectId: paperPatternSubjects.subjectId,
      })
      .from(paperPatternSubjects)
      .where(
        inArray(
          paperPatternSubjects.patternId,
          patterns.map((p) => p.id),
        ),
      );
    const byPattern = new Map<string, string[]>();
    for (const link of links) {
      const list = byPattern.get(link.patternId) ?? [];
      list.push(link.subjectId);
      byPattern.set(link.patternId, list);
    }
    return patterns.map((p) => ({ ...p, subjectIds: byPattern.get(p.id) ?? [] }));
  }

  /** Normalize a DB row's structure to the nested shape before it crosses the
   *  API boundary, so every consumer (web builder, selection, export) sees the
   *  canonical format even for rows written before the migration. */
  private normalizeRowStructure<T extends { structure?: unknown }>(row: T): T {
    if (row.structure == null) return row;
    return { ...row, structure: normalizePaperPatternStructure(row.structure) };
  }

  /**
   * Resolve the material an analysis reads from:
   *  - MATERIAL / PREVIOUS_YEAR_PAPER: an existing, processed, ACTIVE material
   *    with extracted text (uploaded/OCR'd or imported — always by id).
   *  - TEXT: an existing TEXT-sourced material is reused (provenance kept, at
   *    most one TEXT material per pattern); otherwise one is created from the
   *    pasted text, scoped to the pattern's subject.
   */
  private async resolveSourceMaterial(
    instituteId: string,
    userId: string,
    patternTitle: string,
    subjectIds: string[],
    source: AnalyzeSource,
    existingSourceMaterialId: string | null,
  ): Promise<string> {
    if (source.type === 'MATERIAL' || source.type === 'PREVIOUS_YEAR_PAPER') {
      if (!source.id) {
        throw new BadRequestException(`${source.type} source requires an existing material id`);
      }
      const [material] = await this.db
        .select()
        .from(materials)
        .where(
          and(
            eq(materials.id, source.id),
            eq(materials.instituteId, instituteId),
            isNull(materials.deletedAt),
          ),
        )
        .limit(1);
      if (!material) {
        throw new NotFoundException('Source material not found in this institute');
      }
      if (
        material.status !== 'ACTIVE' ||
        material.processingStatus !== 'READY' ||
        !material.textContent
      ) {
        throw new BadRequestException('Source material has no processed text yet');
      }
      return material.id;
    }

    if (!source.text) {
      throw new BadRequestException('TEXT source requires the text to analyze');
    }

    // A pasted-text source material is scoped to a subject (the materials
    // table requires it). A General pattern has no subject to scope to, so
    // the teacher must analyze it from an existing subject-scoped material.
    const scopeSubjectId = subjectIds[0];
    if (!scopeSubjectId) {
      throw new BadRequestException(
        'Pasted-text analysis needs a subject — assign at least one subject to the pattern or analyze from an existing material',
      );
    }

    if (existingSourceMaterialId) {
      const [existing] = await this.db
        .select()
        .from(materials)
        .where(
          and(
            eq(materials.id, existingSourceMaterialId),
            eq(materials.instituteId, instituteId),
            eq(materials.materialType, 'TEXT'),
            isNull(materials.deletedAt),
          ),
        )
        .limit(1);
      if (existing) {
        return existing.id;
      }
    }

    const created = await this.materials.createTextMaterial(instituteId, userId, {
      title: `${patternTitle} — Source text`,
      text: source.text,
      subjectId: scopeSubjectId,
    });
    return created.id;
  }

  private parseStructure(structure: unknown): PaperPatternStructure {
    try {
      return normalizePaperPatternStructure(structure);
    } catch {
      throw new BadRequestException('Invalid paper pattern structure');
    }
  }

  // Drizzle jsonb reads as an opaque object type; the stored structure has
  // already passed PaperPatternStructureSchema on write (legacy flat rows are
  // normalized here), so this is a validation-safe cast, not a blind trust of
  // arbitrary bytes.
  private asStructure(value: unknown): PaperPatternStructure {
    return normalizePaperPatternStructure(value);
  }
}
