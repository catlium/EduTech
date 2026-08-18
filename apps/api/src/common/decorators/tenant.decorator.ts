import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface TenantContext {
  instituteId: string;
  membershipId: string;
  roles: string[];
}

export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.tenant;
  },
);
