import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { OcrWorkerAuthGuard } from './guards/ocr-worker-auth.guard.js';
import { OcrWorker } from './decorators/ocr-worker.decorator.js';
import type { OcrWorkerContext } from './guards/ocr-worker-auth.guard.js';
import { OcrCoordinatorService } from './ocr-coordinator.service.js';
import type {
  WorkerChunkFail,
  WorkerChunkResult,
  WorkerHeartbeatRequest,
} from '@catlium/contracts';

const WORKER_THROTTLE = {
  default: { limit: 300, ttl: 60_000 },
} as const;

// Worker-facing OCR protocol. Bearer owr_ auth only (no institute context, no
// CSRF); a single generous global limit — workers are trusted computation only.
@Controller('ocr/workers')
@UseGuards(OcrWorkerAuthGuard)
@Throttle(WORKER_THROTTLE)
export class OcrWorkerController {
  constructor(private readonly coordinator: OcrCoordinatorService) {}

  @Post(':workerId/heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(
    @OcrWorker() worker: OcrWorkerContext,
    @Param('workerId', ParseUUIDPipe) workerId: string,
    @Body() dto: WorkerHeartbeatRequest,
  ) {
    if (worker.workerId !== workerId) {
      return { ok: false };
    }
    await this.coordinator.heartbeat(workerId, dto.status);
    return { ok: true };
  }

  @Post(':workerId/claim')
  @HttpCode(HttpStatus.OK)
  async claim(
    @OcrWorker() worker: OcrWorkerContext,
    @Param('workerId', ParseUUIDPipe) workerId: string,
  ) {
    if (worker.workerId !== workerId) {
      return { chunk: null };
    }
    return this.coordinator.claim(workerId);
  }

  @Get(':workerId/source/:chunkId')
  async source(
    @OcrWorker() worker: OcrWorkerContext,
    @Param('workerId', ParseUUIDPipe) workerId: string,
    @Param('chunkId', ParseUUIDPipe) chunkId: string,
  ) {
    if (worker.workerId !== workerId) {
      throw new Error('Worker mismatch');
    }
    const { data, mimeType, fileName } = await this.coordinator.getSource(workerId, chunkId);
    return new StreamableFile(data, {
      type: mimeType,
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @Post(':workerId/chunks/:chunkId/result')
  @HttpCode(HttpStatus.OK)
  async submitResult(
    @OcrWorker() worker: OcrWorkerContext,
    @Param('workerId', ParseUUIDPipe) workerId: string,
    @Param('chunkId', ParseUUIDPipe) chunkId: string,
    @Body() dto: WorkerChunkResult,
  ) {
    if (worker.workerId !== workerId) {
      throw new Error('Worker mismatch');
    }
    await this.coordinator.submitResult(workerId, chunkId, dto);
    return { ok: true };
  }

  @Post(':workerId/chunks/:chunkId/fail')
  @HttpCode(HttpStatus.OK)
  async failChunk(
    @OcrWorker() worker: OcrWorkerContext,
    @Param('workerId', ParseUUIDPipe) workerId: string,
    @Param('chunkId', ParseUUIDPipe) chunkId: string,
    @Body() dto: WorkerChunkFail,
  ) {
    if (worker.workerId !== workerId) {
      throw new Error('Worker mismatch');
    }
    await this.coordinator.failChunk(workerId, chunkId, dto);
    return { ok: true };
  }
}
