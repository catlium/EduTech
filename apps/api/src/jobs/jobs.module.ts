import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';
import { RabbitMQService } from '../common/services/rabbitmq.service.js';

@Module({
  controllers: [JobsController],
  providers: [JobsService, RabbitMQService],
  exports: [JobsService],
})
export class JobsModule {}
