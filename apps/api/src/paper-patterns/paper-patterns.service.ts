import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '@catlium/database';
import { materials, paperPatterns, subjects } from '@catlium/database';
import {
  PaperPatternStructureSchema,
  type PaperPatternStructure,
} from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { JobsService, type Job } from '../jobs/jobs.service.js';
import { MaterialsService } from '../materials/materials.service.js';
import { ExaminationsService } from '../examinations/examinations.service.js';
import { isUniqueViolation } from '../common/utils/db-errors.util.js';
import { validatePaperPatternStructure } from './paper-patterns.validation.js';

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
  ) {}

  // ── CRUD ──────────────────────────────────

  async createPattern(
    instituteId: string,
    userId: string,
    input: {
      title: string;
      subjectId: string;
      description?: string;
      structure?: unknown;
    },
  ) {
    const subject = await this.assertSubjectInInstitute(instituteId, input.subjectId);

    const [created] = await this.db
      .insert(paperPatterns)
      .values({
        instituteId,
        subjectId: subject.id,
        title: input.title,
        description: input.description ?? null,
        sourceType: 'MANUAL',
        structure: input.structure !== undefined ? this.parseStructure(input.structure) : null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();

    return created!;
  }

  async listPatterns(instituteId: string) {
    return this.db
      .select()
      .from(paperPatterns)
      .where(eq(paperPatterns.instituteId, instituteId))
      .orderBy(desc(paperPatterns.createdAt));
  }

  async getPattern(instituteId: string, patternId: string) {
    return this.requirePattern(instituteId, patternId);
  }

  async updatePattern(
    instituteId: string,
    userId: string,
    patternId: string,
    input: {
      title?: string;
      description?: string;
      structure?: unknown;
      version?: number;
    },
  ) {
    const row = await this.requirePattern(instituteId, patternId);
    // APPROVED is immutable — an edited copy must be created instead.
    if (row.status === 'APPROVED') {
      throw new ConflictException('Approved paper patterns cannot be edited');
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

    const [updated] = await this.db
      .update(paperPatterns)
      .set(updates)
      .where(and(eq(paperPatterns.id, patternId), eq(paperPatterns.instituteId, instituteId)))
      .returning();

    return updated!;
  }

  // ── AI analysis ───────────────────────────

  async analyze(
    instituteId: string,
    userId: string,
    patternId: string,
    source: AnalyzeSource,
  ) {
    const row = await this.requirePattern(instituteId, patternId);
    if (row.status === 'APPROVED') {
      throw new ConflictException('Approved paper patterns cannot be re-analyzed');
    }

    const sourceMaterialId = await this.resolveSourceMaterial(
      instituteId,
      userId,
      row.title,
      row.subjectId,
      source,
      row.sourceMaterialId,
    );

    const payload = {
      operation: OPERATION,
      source: { type: 'MATERIAL', id: sourceMaterialId },
      patternId: row.id,
      subjectId: row.subjectId,
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
    if (row.status !== 'DRAFT' && row.status !== 'REVIEW') {
      throw new ConflictException(`Paper pattern is already ${row.status}`);
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
        validatedAt: new Date(),
        approvedAt: new Date(),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(paperPatterns.id, patternId), eq(paperPatterns.instituteId, instituteId)))
      .returning();

    return approved!;
  }

  // ── Assessment creation ───────────────────

  async createAssessmentFromBlueprint(
    instituteId: string,
    userId: string,
    patternId: string,
    input: { title?: string; description?: string },
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
    const assessment = await this.examinations.createAssessment(instituteId, userId, {
      title: input.title ?? `${row.title} — Blueprint`,
      description: input.description ?? row.description ?? undefined,
      durationMinutes: structure.durationMinutes,
      maxMarks: structure.totalMarks,
      instructions: { text: structure.instructions.join('. ') },
      blueprintId: row.id,
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

  private async assertSubjectInInstitute(instituteId: string, subjectId: string) {
    const [subject] = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, subjectId), eq(subjects.instituteId, instituteId)))
      .limit(1);
    if (!subject) {
      throw new NotFoundException('Subject not found in this institute');
    }
    return subject;
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
    subjectId: string,
    source: AnalyzeSource,
    existingSourceMaterialId: string | null,
  ): Promise<string> {
    if (source.type === 'MATERIAL' || source.type === 'PREVIOUS_YEAR_PAPER') {
      if (!source.id) {
        throw new BadRequestException(
          `${source.type} source requires an existing material id`,
        );
      }
      const [material] = await this.db
        .select()
        .from(materials)
        .where(and(eq(materials.id, source.id), eq(materials.instituteId, instituteId)))
        .limit(1);
      if (!material) {
        throw new NotFoundException('Source material not found in this institute');
      }
      if (material.status !== 'ACTIVE' || material.processingStatus !== 'READY' || !material.textContent) {
        throw new BadRequestException('Source material has no processed text yet');
      }
      return material.id;
    }

    if (!source.text) {
      throw new BadRequestException('TEXT source requires the text to analyze');
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
      subjectId,
    });
    return created.id;
  }

  private parseStructure(structure: unknown): PaperPatternStructure {
    try {
      return PaperPatternStructureSchema.parse(structure);
    } catch {
      throw new BadRequestException('Invalid paper pattern structure');
    }
  }

  // Drizzle jsonb reads as an opaque object type; the stored structure has
  // already passed PaperPatternStructureSchema on write, so this is a
  // validation-safe cast, not a blind trust of arbitrary bytes.
  private asStructure(value: unknown): PaperPatternStructure {
    return value as PaperPatternStructure;
  }
}