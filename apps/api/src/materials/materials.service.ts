import {
  Inject,
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

import { materials, subjects, chapters, topics } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { Job } from '../jobs/jobs.service.js';
import { STORAGE_PROVIDER } from './storage/storage-provider.interface.js';
import type { StorageProvider } from './storage/storage-provider.interface.js';
import { MAX_FILE_SIZE, ALLOWED_FILE_TYPES } from './materials.constants.js';

type ScopeKind = 'subject' | 'chapter' | 'topic';
type MaterialStatus = 'ACTIVE' | 'ARCHIVED';

interface CreateTextMaterialInput {
  title: string;
  description?: string;
  text: string;
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
}

interface CreateFileMaterialInput {
  title: string;
  description?: string;
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
}

interface ListMaterialFilters {
  materialType?: string;
  sourceType?: string;
  processingStatus?: string;
  status?: MaterialStatus;
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
}

@Injectable()
export class MaterialsService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly jobsService: JobsService,
  ) {}

  // ── Create ────────────────────────────────

  async createTextMaterial(instituteId: string, createdBy: string, input: CreateTextMaterialInput) {
    const scope = this.resolveScope(input);
    await this.assertScopeInInstitute(instituteId, scope.kind, scope.id);

    const [material] = await this.db
      .insert(materials)
      .values({
        instituteId,
        subjectId: scope.kind === 'subject' ? scope.id : null,
        chapterId: scope.kind === 'chapter' ? scope.id : null,
        topicId: scope.kind === 'topic' ? scope.id : null,
        title: input.title,
        description: input.description,
        materialType: 'TEXT',
        sourceType: 'TEXT',
        textContent: input.text,
        processingStatus: 'READY',
        status: 'ACTIVE',
        createdBy,
        updatedBy: createdBy,
      })
      .returning();

    return material!;
  }

  async createFileMaterial(
    instituteId: string,
    createdBy: string,
    input: CreateFileMaterialInput,
    file: Express.Multer.File,
  ) {
    const scope = this.resolveScope(input);
    await this.assertScopeInInstitute(instituteId, scope.kind, scope.id);

    const validated = this.validateFile(file);
    const materialId = randomUUID();
    const extension = this.extensionFromName(file.originalname);
    const storageKey = `materials/${instituteId}/${materialId}/${randomUUID()}${extension ? `.${extension}` : ''}`;

    await this.storage.save({ key: storageKey, data: file.buffer });

    try {
      const [material] = await this.db
        .insert(materials)
        .values({
          id: materialId,
          instituteId,
          subjectId: scope.kind === 'subject' ? scope.id : null,
          chapterId: scope.kind === 'chapter' ? scope.id : null,
          topicId: scope.kind === 'topic' ? scope.id : null,
          title: input.title,
          description: input.description,
          materialType: validated.materialType,
          sourceType: 'UPLOAD',
          fileName: basename(file.originalname).slice(0, 255),
          mimeType: file.mimetype,
          fileSize: file.size,
          storageProvider: 'local',
          storageKey,
          processingStatus: 'UPLOADED',
          status: 'ACTIVE',
          createdBy,
          updatedBy: createdBy,
        })
        .returning();

      return material!;
    } catch (error) {
      await this.storage.delete(storageKey);
      throw error;
    }
  }

  // ── Read ──────────────────────────────────

  async listMaterials(instituteId: string, filters: ListMaterialFilters) {
    const conditions: SQL[] = [eq(materials.instituteId, instituteId)];

    if (filters.materialType) conditions.push(eq(materials.materialType, filters.materialType));
    if (filters.sourceType) conditions.push(eq(materials.sourceType, filters.sourceType));
    if (filters.processingStatus) {
      conditions.push(eq(materials.processingStatus, filters.processingStatus));
    }
    if (filters.status) conditions.push(eq(materials.status, filters.status));
    if (filters.subjectId) conditions.push(eq(materials.subjectId, filters.subjectId));
    if (filters.chapterId) conditions.push(eq(materials.chapterId, filters.chapterId));
    if (filters.topicId) conditions.push(eq(materials.topicId, filters.topicId));

    return this.db
      .select()
      .from(materials)
      .where(and(...conditions))
      .orderBy(desc(materials.createdAt));
  }

  async getMaterial(instituteId: string, materialId: string) {
    return this.assertMaterialExists(instituteId, materialId);
  }

  // ── Update ────────────────────────────────

  async updateMaterial(
    instituteId: string,
    userId: string,
    materialId: string,
    input: { title?: string; description?: string },
  ) {
    const updates: Record<string, unknown> = {
      updatedBy: userId,
      updatedAt: new Date(),
    };

    if (input.title !== undefined) updates['title'] = input.title;
    if (input.description !== undefined) updates['description'] = input.description;

    const [updated] = await this.db
      .update(materials)
      .set(updates)
      .where(and(eq(materials.id, materialId), eq(materials.instituteId, instituteId)))
      .returning();

    if (!updated) {
      throw new NotFoundException('Material not found');
    }

    return updated;
  }

  // ── Status ────────────────────────────────

  async setStatus(instituteId: string, materialId: string, status: MaterialStatus) {
    const [updated] = await this.db
      .update(materials)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(materials.id, materialId), eq(materials.instituteId, instituteId)))
      .returning();

    if (!updated) {
      throw new NotFoundException('Material not found');
    }

    return updated;
  }

  // ── Processing ────────────────────────────

  async processMaterial(instituteId: string, materialId: string) {
    await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(materials)
        .where(and(eq(materials.id, materialId), eq(materials.instituteId, instituteId)))
        .for('update')
        .limit(1);

      if (!locked) {
        throw new NotFoundException('Material not found');
      }

      if (locked.status === 'ARCHIVED') {
        throw new ConflictException('Archived materials cannot be processed');
      }

      if (locked.sourceType === 'TEXT') {
        throw new ConflictException('Text materials are already READY and need no processing');
      }

      if (locked.processingStatus === 'QUEUED' || locked.processingStatus === 'PROCESSING') {
        throw new ConflictException('Material is already being processed');
      }

      if (locked.processingStatus !== 'UPLOADED') {
        throw new ConflictException(
          `Material cannot be processed from state ${locked.processingStatus}`,
        );
      }

      await tx
        .update(materials)
        .set({ processingStatus: 'QUEUED', updatedAt: new Date() })
        .where(eq(materials.id, materialId));
    });

    let job: Job | null = null;

    try {
      job = await this.jobsService.insertJob(instituteId, 'MATERIAL_PROCESS', { materialId });
      await this.jobsService.publishJob(job);
    } catch (error) {
      if (job) {
        try {
          await this.jobsService.updateJobStatus(job.id, 'failed', undefined, {
            message: 'Failed to enqueue material processing',
          });
        } catch {
          // Best-effort cleanup; the material revert below is the source of truth.
        }
      }

      await this.db
        .update(materials)
        .set({ processingStatus: 'UPLOADED', updatedAt: new Date() })
        .where(
          and(
            eq(materials.id, materialId),
            eq(materials.instituteId, instituteId),
            eq(materials.processingStatus, 'QUEUED'),
          ),
        );

      throw error;
    }

    return {
      materialId,
      jobId: job.id,
      processingStatus: 'QUEUED',
    } as const;
  }

  // ── Helpers ───────────────────────────────

  private validateFile(file: Express.Multer.File): { materialType: string } {
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('File exceeds the 20 MB limit');
    }

    const allowed = ALLOWED_FILE_TYPES.get(file.mimetype);
    if (!allowed) {
      throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
    }

    const extension = this.extensionFromName(file.originalname);
    if (extension && !allowed.extensions.includes(extension)) {
      throw new BadRequestException(
        `File extension ".${extension}" does not match MIME type ${file.mimetype}`,
      );
    }

    return { materialType: allowed.materialType };
  }

  private extensionFromName(name: string): string | null {
    const index = name.lastIndexOf('.');
    if (index === -1 || index === name.length - 1) return null;
    return name.slice(index + 1).toLowerCase();
  }

  private resolveScope(input: { subjectId?: string; chapterId?: string; topicId?: string }): {
    kind: ScopeKind;
    id: string;
  } {
    const provided = [
      input.subjectId !== undefined ? { kind: 'subject' as const, id: input.subjectId } : null,
      input.chapterId !== undefined ? { kind: 'chapter' as const, id: input.chapterId } : null,
      input.topicId !== undefined ? { kind: 'topic' as const, id: input.topicId } : null,
    ].filter((x): x is { kind: ScopeKind; id: string } => x !== null);

    if (provided.length !== 1) {
      throw new BadRequestException(
        'Exactly one of subjectId, chapterId, topicId must be provided',
      );
    }

    return provided[0];
  }

  private async assertScopeInInstitute(
    instituteId: string,
    kind: ScopeKind,
    id: string,
  ): Promise<void> {
    if (kind === 'subject') {
      const [row] = await this.db
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(eq(subjects.id, id), eq(subjects.instituteId, instituteId)))
        .limit(1);

      if (!row) throw new NotFoundException('Subject not found');
      return;
    }

    if (kind === 'chapter') {
      const [row] = await this.db
        .select({ id: chapters.id })
        .from(chapters)
        .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
        .where(and(eq(chapters.id, id), eq(subjects.instituteId, instituteId)))
        .limit(1);

      if (!row) throw new NotFoundException('Chapter not found');
      return;
    }

    const [row] = await this.db
      .select({ id: topics.id })
      .from(topics)
      .innerJoin(chapters, eq(topics.chapterId, chapters.id))
      .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
      .where(and(eq(topics.id, id), eq(subjects.instituteId, instituteId)))
      .limit(1);

    if (!row) throw new NotFoundException('Topic not found');
  }

  private async assertMaterialExists(instituteId: string, materialId: string) {
    const [material] = await this.db
      .select()
      .from(materials)
      .where(and(eq(materials.id, materialId), eq(materials.instituteId, instituteId)))
      .limit(1);

    if (!material) {
      throw new NotFoundException('Material not found');
    }

    return material;
  }
}
