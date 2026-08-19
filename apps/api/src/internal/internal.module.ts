import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller.js';
import { ContentModule } from '../content/content.module.js';

@Module({
  imports: [ContentModule],
  controllers: [InternalController],
})
export class InternalModule {}
