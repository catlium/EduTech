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

import { materials } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import { resolveScopeChain } from '../common/utils/scope-resolver.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { Job } from '../jobs/jobs.service.js';
import { STORAGE_PROVIDER } from './storage/storage-provider.interface.js';
import type { StorageProvider } from './storage/storage-provider.interface.js';
import { ALLOWED_FILE_TYPES } from './materials.constants.js';

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
    const chain = await resolveScopeChain(
      { db: this.db, instituteId, requireSubject: true },
      input,
    );

    const [material] = await this.db
      .insert(materials)
      .values({
        instituteId,
        subjectId: chain.subjectId,
        chapterId: chain.chapterId,
        topicId: chain.topicId,
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
    const chain = await resolveScopeChain(
      { db: this.db, instituteId, requireSubject: true },
      input,
    );

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
          subjectId: chain.subjectId,
          chapterId: chain.chapterId,
          topicId: chain.topicId,
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
    const material = await this.assertMaterialExists(instituteId, materialId);
    const job = await this.jobsService.latestMaterialJob(instituteId, materialId);
    return {
      ...material,
      processError: job?.error?.message ?? null,
      processStartedAt: job?.startedAt ?? null,
      processCompletedAt: job?.completedAt ?? null,
    };
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
    return this.enqueueProcessing(instituteId, materialId, 'process');
  }

  async retryMaterial(instituteId: string, materialId: string) {
    return this.enqueueProcessing(instituteId, materialId, 'retry');
  }

  /**
   * Single enqueue path for both initial processing and retries. One job row
   * equals one processing attempt, so a retry always creates a NEW job — a
   * FAILED job is never mutated back to queued/processing/completed.
   *
   * Retry accepts FAILED (normal) and QUEUED (recovery: the material sat
   * queued because its message died with the worker; only allowed when no
   * job row is still queued/processing — otherwise the pending consumer is
   * already handling it and a duplicate would double-process).
   */
  private async enqueueProcessing(
    instituteId: string,
    materialId: string,
    action: 'process' | 'retry',
  ) {
    let was: string | null = null;
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

      was = locked.processingStatus;

      const verb = action === 'retry' ? 'retried' : 'processed';

      if (locked.status === 'ARCHIVED') {
        throw new ConflictException(`Archived materials cannot be ${verb}`);
      }

      if (locked.sourceType === 'TEXT') {
        throw new ConflictException('Text materials are already READY and need no processing');
      }

      if (locked.processingStatus === 'PROCESSING') {
        throw new ConflictException('Material is already being processed');
      }

      if (locked.processingStatus === 'QUEUED' && action !== 'retry') {
        throw new ConflictException('Material is already queued for processing');
      }

      if (action === 'retry') {
        if (locked.processingStatus === 'FAILED' || locked.processingStatus === 'QUEUED') {
          if (locked.processingStatus === 'QUEUED') {
            // Only safe when the previous message is genuinely gone.
            const live = await this.jobsService.latestMaterialJob(instituteId, materialId);
            if (live && ['queued', 'processing'].includes(live.status)) {
              throw new ConflictException('Material is already queued for processing');
            }
          }
        } else {
          if (locked.processingStatus === 'READY') {
            throw new ConflictException('Material is already READY and needs no processing');
          }
          throw new ConflictException(
            `Only failed or interrupted materials can be retried (current: ${locked.processingStatus})`,
          );
        }
      } else if (locked.processingStatus !== 'UPLOADED') {
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

      if (was !== null) {
        await this.db
          .update(materials)
          .set({ processingStatus: was, updatedAt: new Date() })
          .where(
            and(
              eq(materials.id, materialId),
              eq(materials.instituteId, instituteId),
              eq(materials.processingStatus, 'QUEUED'),
            ),
          );
      }

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
