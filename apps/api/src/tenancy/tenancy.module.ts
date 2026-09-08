import { Module, Global } from '@nestjs/common';
import { TenancyService } from './tenancy.service.js';
import { MembershipsController } from './memberships.controller.js';

@Global()
@Module({
  controllers: [MembershipsController],
  providers: [TenancyService],
  exports: [TenancyService],
})
export class TenancyModule {}
