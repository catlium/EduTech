// Chunked upload support for large files over the Cloudflare Tunnel: a client
// slices a file and POSTs each part to the SAME endpoint, one request per part
// (each well under the Cloudflare 100s origin budget). Parts are stored on the
// chunk storage prefix; the final part reassembles them into the full buffer
// that the normal single-shot path would have received, then cleans up.
//
// No resumability, no dedup state — an interrupted upload just leaves orphan
// parts until the uploadId is reused (then they are overwritten) or manually
// cleaned. `ponytail: worst case orphaned parts sit on disk; a storage sweep
// can delete parts older than N hours if upload-abandonment becomes common.`
import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from './storage/storage-provider.interface.js';

const UPLOAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 20MB cap / ~300KB minimum part = 64 upper bound prevents runaway part counts.
const MAX_CHUNKS = 64;

export interface ChunkUpload {
  uploadId: string;
  index: number;
  total: number;
}

@Injectable()
export class UploadChunksService {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  /** Parse the chunk headers. Absent (all undefined) → single-shot upload.
   *  Present but malformed → BadRequest. */
  parse(
    uploadId: string | undefined,
    chunkIndexRaw: string | undefined,
    chunkTotalRaw: string | undefined,
  ): ChunkUpload | null {
    if (uploadId === undefined && chunkIndexRaw === undefined && chunkTotalRaw === undefined) {
      return null;
    }
    const index = Number(chunkIndexRaw);
    const total = Number(chunkTotalRaw);
    if (
      !UPLOAD_ID_RE.test(uploadId ?? '') ||
      !Number.isInteger(index) ||
      !Number.isInteger(total) ||
      index < 1 ||
      total < 1 ||
      index > total ||
      total > MAX_CHUNKS
    ) {
      throw new BadRequestException('Invalid chunk upload headers');
    }
    return { uploadId: uploadId!, index, total };
  }

  /** Persist one part. Returns null while parts are still coming; returns the
   *  reassembled buffer (parts cleaned up) when the final part lands. */
  async acceptOrAssemble(
    chunks: ChunkUpload,
    instituteId: string,
    data: Buffer,
  ): Promise<Buffer | null> {
    await this.storage.save({
      key: this.partKey(instituteId, chunks.uploadId, chunks.index),
      data,
    });
    if (chunks.index < chunks.total) return null;

    const parts: Buffer[] = [];
    try {
      for (let i = 1; i <= chunks.total; i++) {
        parts.push(await this.storage.read(this.partKey(instituteId, chunks.uploadId, i)));
      }
    } catch {
      await this.cleanup(instituteId, chunks.uploadId, chunks.total);
      throw new BadRequestException('Chunked upload is missing one or more parts — re-upload');
    }
    await this.cleanup(instituteId, chunks.uploadId, chunks.total);
    return Buffer.concat(parts);
  }

  private async cleanup(instituteId: string, uploadId: string, total: number): Promise<void> {
    for (let i = 1; i <= total; i++) {
      await this.storage.delete(this.partKey(instituteId, uploadId, i)).catch(() => undefined);
    }
  }

  private partKey(instituteId: string, uploadId: string, index: number): string {
    return `upload-chunks/${instituteId}/${uploadId}/${index}`;
  }
}