import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';

import { GenerationService } from './generation.service.js';
import { GenerateNoteDto } from './dto/generate-note.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('content/generate')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class GenerationController {
  constructor(private readonly generationService: GenerationService) {}

  @Post('note')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiredRoles(...WRITE_ROLES)
  async generateNote(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateNoteDto,
  ) {
    const generation = await this.generationService.requestNoteGeneration(
      tenant.instituteId,
      user.userId,
      dto.sourceType,
      dto.sourceId,
    );
    return { generation };
  }
}
