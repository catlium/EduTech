import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { InternalGuard } from '../common/guards/internal.guard.js';
import { ContentService } from '../content/content.service.js';
import { AIInternalPersistNoteRequestSchema } from '@catlium/contracts';

@Controller('internal/v1/content')
@UseGuards(InternalGuard)
export class InternalController {
  constructor(private readonly contentService: ContentService) {}

  @Post('ai-persist')
  async persistAiNote(@Body() body: unknown) {
    const data = AIInternalPersistNoteRequestSchema.parse(body);

    // Using a system ID or the job creator ID if available. 
    // For now, using a placeholder for the system user.
    const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'; 

    return this.contentService.createContent(data.instituteId, SYSTEM_USER_ID, {
      title: data.title,
      type: 'NOTE',
      source: 'AI_GENERATED',
      subjectId: data.subjectId,
      chapterId: data.chapterId,
      topicId: data.topicId,
      payload: data.payload,
      aiContext: data.aiContext,
    });
  }
}
