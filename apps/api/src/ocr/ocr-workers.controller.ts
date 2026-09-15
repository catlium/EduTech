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
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';

const ADMIN_ROLES = ['INSTITUTE_ADMIN'] as const;

// Browser/monitoring-facing worker registry: INSTITUTE_ADMIN may list,
// register, disable, or rotate workers. The worker-facing claim/heartbeat/
// source/result routes live in a separate worker-facing controller (bearer
// auth, no institute context).
@Controller('ocr/workers')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
@RequiredRoles(...ADMIN_ROLES)
export class OcrWorkersController {
  constructor(private readonly ocrWorkersService: OcrWorkersService) {}

  @Get()
  async list() {
    return this.ocrWorkersService.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterWorkerRequest) {
    return this.ocrWorkersService.register(dto);
  }

  @Patch(':workerId')
  async update(
    @Param('workerId', ParseUUIDPipe) workerId: string,
    @Body() dto: UpdateWorkerRequest,
  ) {
    return this.ocrWorkersService.update(workerId, dto);
  }
}
