import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';

import { ocrWorkers } from '@catlium/database';
import type { Database } from '@catlium/database';
import { DATABASE_TOKEN } from '../../database/database.module.js';
import { hashToken, safeEqualHex } from '../ocr-workers.util.js';

export interface OcrWorkerContext {
  workerId: string;
  name: string;
  version: string | null;
}

// Worker-facing authentication: `x-worker-id` header + `Authorization: Bearer
// owr_...`. No institute context, no CSRF — bearer only. Verifies the stored
// SHA-256 token hash and the `enabled` flag; attaches the worker to the request.
@Injectable()
export class OcrWorkerAuthGuard implements CanActivate {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const workerId = request.headers['x-worker-id'] as string | undefined;
    const authHeader = request.headers['authorization'] as string | undefined;

    if (!workerId) {
      throw new UnauthorizedException('x-worker-id header required');
    }

    const token = authHeader?.match(/^Bearer (.+)$/)?.[1] as string | undefined;
    if (!token || !token.startsWith('owr_')) {
      throw new UnauthorizedException('Bearer owr_ token required');
    }

    const [worker] = await this.db
      .select()
      .from(ocrWorkers)
      .where(eq(ocrWorkers.id, workerId))
      .limit(1);

    if (!worker) {
      throw new UnauthorizedException('Unknown worker');
    }

    if (!safeEqualHex(hashToken(token), worker.tokenHash)) {
      throw new UnauthorizedException('Invalid worker token');
    }

    if (!worker.enabled) {
      throw new UnauthorizedException('Worker is disabled');
    }

    (request as unknown as Record<string, unknown>)['ocrWorker'] = {
      workerId: worker.id,
      name: worker.name,
      version: worker.version,
    } satisfies OcrWorkerContext;

    return true;
  }
}
