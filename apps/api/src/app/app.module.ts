import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { HealthModule } from '../health/health.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { InternalModule } from '../internal/internal.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { AcademicModule } from '../academic/academic.module.js';
import { ContentModule } from '../content/content.module.js';
import { MaterialsModule } from '../materials/materials.module.js';
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
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: parseInt(process.env['RATE_LIMIT_TTL_MS'] ?? '60000', 10),
          limit: parseInt(process.env['RATE_LIMIT_LIMIT'] ?? '100', 10),
        },
      ],
    }),
    DatabaseModule,
    HealthModule,
    IdentityModule,
    TenancyModule,
    JobsModule,
    InternalModule,
    AcademicModule,
    ContentModule,
    MaterialsModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    RabbitMQService,
  ],
  exports: [RabbitMQService],
})
export class AppModule {}
