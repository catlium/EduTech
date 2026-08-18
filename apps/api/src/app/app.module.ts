import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { HealthModule } from '../health/health.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { GlobalExceptionFilter } from '../common/filters/global-exception.filter.js';
import { DatabaseModule } from '../database/database.module.js';
import { RabbitMQService } from '../common/services/rabbitmq.service.js';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    DatabaseModule,
    HealthModule,
    IdentityModule,
    TenancyModule,
    JobsModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    RabbitMQService,
  ],
  exports: [RabbitMQService],
})
export class AppModule {}
