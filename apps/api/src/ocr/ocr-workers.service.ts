import { Injectable, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';

import { ocrChunks, ocrWorkers } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../database/database.module.js';
import type {
  WorkerSummary,
  OcrWorkerCapabilities,
  RegisterWorkerRequest,
  UpdateWorkerRequest,
} from '@catlium/contracts';
import { deriveStatus, generateToken, hashToken } from './ocr-workers.util.js';

const OFFLINE_MS = (Number(process.env['WORKER_OFFLINE_SECONDS'] ?? '120') || 120) * 1000;

export type { WorkerSummary };

@Injectable()
export class OcrWorkersService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async list(): Promise<{ summary: Record<string, number>; workers: WorkerSummary[] }> {
    const rows = await this.db.select().from(ocrWorkers).orderBy(desc(ocrWorkers.createdAt));

    const chunkIds = rows
      .map((row) => row.currentChunkId)
      .filter((id): id is string => id !== null);

    const chunks = chunkIds.length
      ? await this.db
          .select({
            id: ocrChunks.id,
            chunkIndex: ocrChunks.chunkIndex,
            startPage: ocrChunks.startPage,
            endPage: ocrChunks.endPage,
            claimedBy: ocrChunks.claimedBy,
          })
          .from(ocrChunks)
          .where(sql`${ocrChunks.claimedBy} IS NOT NULL`)
      : [];

    const chunkByWorker = new Map<string, (typeof chunks)[number]>();
    for (const chunk of chunks) {
      if (chunk.claimedBy) chunkByWorker.set(chunk.claimedBy, chunk);
    }

    const summary: Record<string, number> = {
      online: 0,
      idle: 0,
      processing: 0,
      offline: 0,
      disabled: 0,
    };
    const workers: WorkerSummary[] = rows.map((row) => {
      const status = deriveStatus(row.enabled, row.currentChunkId, row.lastHeartbeatAt, OFFLINE_MS);
      summary[status]! += 1;
      summary['online']! += status === 'processing' || status === 'idle' ? 1 : 0;
      const chunk = row.currentChunkId ? chunkByWorker.get(row.currentChunkId) : undefined;
      return {
        id: row.id,
        name: row.name,
        status,
        currentChunkId: row.currentChunkId,
        currentChunkRange: chunk
          ? {
              index: chunk.chunkIndex,
              startPage: chunk.startPage,
              endPage: chunk.endPage,
            }
          : null,
        lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        version: row.version,
        capabilities: row.capabilities as OcrWorkerCapabilities | null,
      };
    });

    return { summary, workers };
  }

  async register(input: RegisterWorkerRequest): Promise<{ workerId: string; apiKey: string }> {
    const apiKey = generateToken();
    const [worker] = await this.db
      .insert(ocrWorkers)
      .values({
        name: input.name,
        tokenHash: hashToken(apiKey),
        version: input.version ?? null,
        capabilities: (input.capabilities as OcrWorkerCapabilities | undefined) ?? null,
      })
      .returning();

    return { workerId: worker!.id, apiKey };
  }

  async update(
    workerId: string,
    input: UpdateWorkerRequest,
  ): Promise<{ workerId: string; enabled: boolean; apiKey?: string }> {
    const [current] = await this.db
      .select()
      .from(ocrWorkers)
      .where(eq(ocrWorkers.id, workerId))
      .limit(1);

    if (!current) {
      throw new NotFoundException('Worker not found');
    }

    let apiKey: string | undefined;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.enabled !== undefined) updates['enabled'] = input.enabled;
    if (input.rotateToken) {
      apiKey = generateToken();
      updates['tokenHash'] = hashToken(apiKey);
    }

    const [worker] = await this.db
      .update(ocrWorkers)
      .set(updates)
      .where(eq(ocrWorkers.id, workerId))
      .returning();

    return {
      workerId: worker!.id,
      enabled: worker!.enabled,
      ...(apiKey ? { apiKey } : {}),
    };
  }
}