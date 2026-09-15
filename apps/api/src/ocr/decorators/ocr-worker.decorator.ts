import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { OcrWorkerContext } from '../guards/ocr-worker-auth.guard.js';

export const OcrWorker = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OcrWorkerContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return (request as unknown as Record<string, unknown>)['ocrWorker'] as OcrWorkerContext;
  },
);
