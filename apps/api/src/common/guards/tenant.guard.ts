import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../decorators/current-user.decorator.js';
import { TenancyService } from '../../tenancy/tenancy.service.js';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly tenancyService: TenancyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as unknown as Record<string, unknown>)['user'] as
      AuthenticatedUser | undefined;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const instituteId = request.headers['x-institute-id'] as string | undefined;

    if (!instituteId) {
      throw new ForbiddenException('Institute context required');
    }

    const membership = await this.tenancyService.getMembership(user.userId, instituteId);

    if (!membership) {
      throw new ForbiddenException('You do not belong to this institute');
    }

    if (membership.status !== 'active') {
      throw new ForbiddenException('Membership is not active');
    }

    (request as unknown as Record<string, unknown>)['tenant'] = {
      instituteId: membership.instituteId,
      membershipId: membership.id,
      roles: membership.roles,
    };

    return true;
  }
}
