import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { HealthModule } from '../health/health.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { AcademicModule } from '../academic/academic.module.js';
import { AcademicStructureModule } from '../academic-structure/academic-structure.module.js';
import { ContentModule } from '../content/content.module.js';
import { MaterialsModule } from '../materials/materials.module.js';
import { OcrModule } from '../ocr/ocr.module.js';
import { MaterialEnhancementModule } from '../material-enhancement/material-enhancement.module.js';
import { QuestionsModule } from '../questions/questions.module.js';
import { ExaminationsModule } from '../examinations/examinations.module.js';
import { SyllabusModule } from '../syllabus/syllabus.module.js';
import { PaperPatternsModule } from '../paper-patterns/paper-patterns.module.js';
import { QuestionExtractionModule } from '../question-extraction/question-extraction.module.js';
import { QuestionPapersModule } from '../question-papers/question-papers.module.js';
import { AttemptsModule } from '../attempts/attempts.module.js';
import { ExportModule } from '../export/export.module.js';
import { PracticeModule } from '../practice/practice.module.js';
import { UsersModule } from '../users/users.module.js';
import { PlatformModule } from '../platform/platform.module.js';
import { GlobalExceptionFilter } from '../common/filters/global-exception.filter.js';
import { DatabaseModule } from '../database/database.module.js';
import { RabbitMQService } from '../common/services/rabbitmq.service.js';
import { CsrfGuard } from '../common/guards/csrf.guard.js';

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
    AuthorizationModule,
    JobsModule,
    AcademicModule,
    AcademicStructureModule,
    ContentModule,
    MaterialsModule,
    OcrModule,
    MaterialEnhancementModule,
    QuestionsModule,
    ExaminationsModule,
    SyllabusModule,
    PaperPatternsModule,
    QuestionExtractionModule,
    QuestionPapersModule,
    AttemptsModule,
    PracticeModule,
    UsersModule,
    ExportModule,
    PlatformModule,
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
    // F4 — double-submit CSRF on every cookie-authenticated state-changing
    // request; GET/HEAD/OPTIONS exempt and non-cookie requests bypass (login
    // is Origin-checked, the worker bearer protocol carries no cookies).
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
    RabbitMQService,
  ],
  exports: [RabbitMQService],
})
export class AppModule {}
