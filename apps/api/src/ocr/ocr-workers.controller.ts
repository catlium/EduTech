import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { OcrWorkersService } from './ocr-workers.service.js';
import type { RegisterWorkerRequest, UpdateWorkerRequest } from '@catlium/contracts';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { PlatformGuard } from '../authorization/platform.guard.js';
import { RequiredPermission } from '../authorization/permissions.decorator.js';

// Platform-facing worker registry (Phase D / D3 §15): the OCR worker fleet is
// SHARED platform infrastructure, so the registry lives on the platform plane —
// Authentication → PlatformGuard (platform_user_roles → ocr-workers.*). No
// x-institute-id, no institute membership required; an ordinary INSTITUTE_ADMIN
// holds no platform keys and is denied. The worker-facing claim/heartbeat/
// source/result routes live in a separate worker-facing controller (bearer
// auth, no institute context).
@Controller('ocr/workers')
@UseGuards(AccessTokenGuard, PlatformGuard)
export class OcrWorkersController {
  constructor(private readonly ocrWorkersService: OcrWorkersService) {}

  @Get()
  @RequiredPermission('ocr-workers.read')
  async list() {
    return this.ocrWorkersService.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredPermission('ocr-workers.create')
  async register(@Body() dto: RegisterWorkerRequest) {
    return this.ocrWorkersService.register(dto);
  }

  @Patch(':workerId')
  @RequiredPermission('ocr-workers.update')
  async update(
    @Param('workerId', ParseUUIDPipe) workerId: string,
    @Body() dto: UpdateWorkerRequest,
  ) {
    return this.ocrWorkersService.update(workerId, dto);
  }
}
