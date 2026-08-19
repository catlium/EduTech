import { z } from 'zod';

export const RoleEnum = z.enum(['INSTITUTE_ADMIN', 'TEACHER', 'STUDENT']);
export type Role = z.infer<typeof RoleEnum>;

export const JobStatusEnum = z.enum(['queued', 'processing', 'completed', 'failed']);
export type JobStatus = z.infer<typeof JobStatusEnum>;

// ── Auth Contracts ──────────────────────────

export const RegisterRequestSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(255),
  password: z.string().min(8).max(128),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const UserResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  status: z.string(),
  createdAt: z.string().datetime(),
});
export type UserResponse = z.infer<typeof UserResponseSchema>;

export const AuthResponseSchema = z.object({
  user: UserResponseSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ── Job Contracts ───────────────────────────

export const CreateJobRequestSchema = z.object({
  type: z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;

export const JobResponseSchema = z.object({
  id: z.string().uuid(),
  instituteId: z.string().uuid(),
  type: z.string(),
  status: z.string(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});
export type JobResponse = z.infer<typeof JobResponseSchema>;

// ── Job Message Contract (RabbitMQ) ─────────

export const JobMessageSchema = z.object({
  jobId: z.string().uuid(),
  instituteId: z.string().uuid(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type JobMessage = z.infer<typeof JobMessageSchema>;

// ── Error Contracts ─────────────────────────

export const ErrorResponseSchema = z.object({
  statusCode: z.number(),
  message: z.string(),
  error: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ── Academic Contracts ──────────────────────

export const AcademicStatusEnum = z.enum(['active', 'archived']);
export type AcademicStatus = z.infer<typeof AcademicStatusEnum>;

export const CreateSubjectRequestSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case'),
  description: z.string().max(1000).optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateSubjectRequest = z.infer<typeof CreateSubjectRequestSchema>;

export const UpdateSubjectRequestSchema = CreateSubjectRequestSchema.partial().extend({
  status: AcademicStatusEnum.optional(),
});
export type UpdateSubjectRequest = z.infer<typeof UpdateSubjectRequestSchema>;

export const SubjectResponseSchema = z.object({
  id: z.string().uuid(),
  instituteId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number(),
  status: AcademicStatusEnum,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SubjectResponse = z.infer<typeof SubjectResponseSchema>;

export const CreateChapterRequestSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case'),
  description: z.string().max(1000).optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateChapterRequest = z.infer<typeof CreateChapterRequestSchema>;

export const UpdateChapterRequestSchema = CreateChapterRequestSchema.partial().extend({
  status: AcademicStatusEnum.optional(),
});
export type UpdateChapterRequest = z.infer<typeof UpdateChapterRequestSchema>;

export const ChapterResponseSchema = z.object({
  id: z.string().uuid(),
  subjectId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number(),
  status: AcademicStatusEnum,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ChapterResponse = z.infer<typeof ChapterResponseSchema>;

export const CreateTopicRequestSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case'),
  description: z.string().max(1000).optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateTopicRequest = z.infer<typeof CreateTopicRequestSchema>;

export const UpdateTopicRequestSchema = CreateTopicRequestSchema.partial().extend({
  status: AcademicStatusEnum.optional(),
});
export type UpdateTopicRequest = z.infer<typeof UpdateTopicRequestSchema>;

export const TopicResponseSchema = z.object({
  id: z.string().uuid(),
  chapterId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number(),
  status: AcademicStatusEnum,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TopicResponse = z.infer<typeof TopicResponseSchema>;

// ── Content Contracts ──────────────────────

export const ContentTypeEnum = z.enum(['NOTE', 'FLASHCARD_SET', 'CORNELL_NOTE']);
export type ContentType = z.infer<typeof ContentTypeEnum>;

export const ContentStatusEnum = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
export type ContentStatus = z.infer<typeof ContentStatusEnum>;

export const ContentSourceEnum = z.enum(['MANUAL', 'AI_GENERATED', 'OCR_EXTRACTED', 'IMPORTED']);
export type ContentSource = z.infer<typeof ContentSourceEnum>;

export const ContentChangeTypeEnum = z.enum(['CREATION', 'EDIT', 'REGENERATION', 'CORRECTION']);
export type ContentChangeType = z.infer<typeof ContentChangeTypeEnum>;

// ── Content Payload Contracts ──────────────

const PayloadId = z.string().min(1).max(128);

export const NoteBlockSchema = z.discriminatedUnion('type', [
  z.object({
    id: PayloadId,
    type: z.literal('heading'),
    content: z.string().min(1),
  }),
  z.object({
    id: PayloadId,
    type: z.literal('paragraph'),
    content: z.string().min(1),
  }),
  z.object({
    id: PayloadId,
    type: z.literal('list'),
    items: z.array(z.string()).min(1),
  }),
]);
export type NoteBlock = z.infer<typeof NoteBlockSchema>;

export const NotePayloadSchema = z.object({
  title: z.string().max(255).optional(),
  blocks: z.array(NoteBlockSchema).min(1),
});
export type NotePayload = z.infer<typeof NotePayloadSchema>;

export const FlashcardSchema = z.object({
  id: PayloadId,
  front: z.string().min(1).max(5000),
  back: z.string().min(1).max(5000),
});
export type Flashcard = z.infer<typeof FlashcardSchema>;

export const FlashcardSetPayloadSchema = z.object({
  title: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  cards: z.array(FlashcardSchema).min(1),
});
export type FlashcardSetPayload = z.infer<typeof FlashcardSetPayloadSchema>;

export const CornellSectionSchema = z.object({
  id: PayloadId,
  cue: z.string().max(5000),
  notes: z.string().max(20000),
});
export type CornellSection = z.infer<typeof CornellSectionSchema>;

export const CornellNotePayloadSchema = z.object({
  title: z.string().max(255).optional(),
  sections: z.array(CornellSectionSchema).min(1),
  summary: z.string().max(20000).optional(),
});
export type CornellNotePayload = z.infer<typeof CornellNotePayloadSchema>;

export const ContentPayloadSchemas = {
  NOTE: NotePayloadSchema,
  FLASHCARD_SET: FlashcardSetPayloadSchema,
  CORNELL_NOTE: CornellNotePayloadSchema,
} as const;
export type ContentPayload = NotePayload | FlashcardSetPayload | CornellNotePayload;

const AcademicScopeFields = {
  subjectId: z.string().uuid().optional(),
  chapterId: z.string().uuid().optional(),
  topicId: z.string().uuid().optional(),
} as const;

export const CreateContentRequestSchema = z
  .object({
    title: z.string().min(1).max(255),
    type: ContentTypeEnum,
    source: ContentSourceEnum,
    payload: z.record(z.string(), z.unknown()),
    renderedHtml: z.string().optional(),
    aiContext: z.record(z.string(), z.unknown()).optional(),
    sourceReference: z.record(z.string(), z.unknown()).optional(),
    changeReason: z.string().max(500).optional(),
    ...AcademicScopeFields,
  })
  .superRefine((value, ctx) => {
    const result = ContentPayloadSchemas[value.type].safeParse(value.payload);
    if (!result.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['payload'],
        message: `payload does not match ${value.type} schema: ${result.error.issues[0]?.message ?? 'invalid'}`,
      });
    }
  })
  .refine(
    (v) => [v.subjectId, v.chapterId, v.topicId].filter((x) => x !== undefined).length === 1,
    { message: 'Exactly one of subjectId, chapterId, topicId must be provided', path: ['scope'] },
  );
export type CreateContentRequest = z.infer<typeof CreateContentRequestSchema>;

export const UpdateContentRequestSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
  renderedHtml: z.string().optional(),
  aiContext: z.record(z.string(), z.unknown()).optional(),
  sourceReference: z.record(z.string(), z.unknown()).optional(),
  changeType: ContentChangeTypeEnum.optional(),
  changeReason: z.string().max(500).optional(),
});
export type UpdateContentRequest = z.infer<typeof UpdateContentRequestSchema>;

export const ContentVersionResponseSchema = z.object({
  id: z.string().uuid(),
  contentId: z.string().uuid(),
  version: z.number(),
  payload: z.record(z.string(), z.unknown()),
  renderedHtml: z.string().nullable(),
  aiContext: z.record(z.string(), z.unknown()).nullable(),
  sourceReference: z.record(z.string(), z.unknown()).nullable(),
  changeType: ContentChangeTypeEnum,
  changeReason: z.string().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type ContentVersionResponse = z.infer<typeof ContentVersionResponseSchema>;

export const ContentResponseSchema = z.object({
  id: z.string().uuid(),
  instituteId: z.string().uuid(),
  subjectId: z.string().uuid().nullable(),
  chapterId: z.string().uuid().nullable(),
  topicId: z.string().uuid().nullable(),
  type: ContentTypeEnum,
  title: z.string(),
  status: ContentStatusEnum,
  source: ContentSourceEnum,
  currentVersion: z.number(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  current: ContentVersionResponseSchema,
});
export type ContentResponse = z.infer<typeof ContentResponseSchema>;

export const ContentListItemSchema = ContentResponseSchema.omit({ current: true });
export type ContentListItem = z.infer<typeof ContentListItemSchema>;

export const ArchiveContentRequestSchema = z.object({
  status: ContentStatusEnum,
});
export type ArchiveContentRequest = z.infer<typeof ArchiveContentRequestSchema>;

// ── AI Contracts ─────────────────────────────

export const AIGenerateNotePayloadSchema = z.object({
  materialId: z.string().uuid(),
  title: z.string().optional(),
});
export type AIGenerateNotePayload = z.infer<typeof AIGenerateNotePayloadSchema>;

export const AIInternalPersistNoteRequestSchema = z.object({
  jobId: z.string().uuid(),
  materialId: z.string().uuid(),
  instituteId: z.string().uuid(),
  subjectId: z.string().uuid().optional(),
  chapterId: z.string().uuid().optional(),
  topicId: z.string().uuid().optional(),
  title: z.string().min(1).max(255),
  payload: NotePayloadSchema,
  aiContext: z.record(z.string(), z.unknown()),
});
export type AIInternalPersistNoteRequest = z.infer<typeof AIInternalPersistNoteRequestSchema>;

// ── Material Contracts ──────────────────────

export const MaterialTypeEnum = z.enum(['DOCUMENT', 'PDF', 'IMAGE', 'TEXT']);
export type MaterialType = z.infer<typeof MaterialTypeEnum>;

export const MaterialSourceTypeEnum = z.enum(['UPLOAD', 'TEXT', 'IMPORTED']);
export type MaterialSourceType = z.infer<typeof MaterialSourceTypeEnum>;

export const MaterialProcessingStatusEnum = z.enum([
  'UPLOADED',
  'QUEUED',
  'PROCESSING',
  'READY',
  'FAILED',
]);
export type MaterialProcessingStatus = z.infer<typeof MaterialProcessingStatusEnum>;

export const MaterialStatusEnum = z.enum(['ACTIVE', 'ARCHIVED']);
export type MaterialStatus = z.infer<typeof MaterialStatusEnum>;

export const CreateTextMaterialRequestSchema = z
  .object({
    title: z.string().min(1).max(255),
    description: z.string().max(1000).optional(),
    text: z.string().min(1).max(1_000_000),
    ...AcademicScopeFields,
  })
  .refine(
    (v) => [v.subjectId, v.chapterId, v.topicId].filter((x) => x !== undefined).length === 1,
    { message: 'Exactly one of subjectId, chapterId, topicId must be provided', path: ['scope'] },
  );
export type CreateTextMaterialRequest = z.infer<typeof CreateTextMaterialRequestSchema>;

export const UpdateMaterialRequestSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
});
export type UpdateMaterialRequest = z.infer<typeof UpdateMaterialRequestSchema>;

export const MaterialResponseSchema = z.object({
  id: z.string().uuid(),
  instituteId: z.string().uuid(),
  subjectId: z.string().uuid().nullable(),
  chapterId: z.string().uuid().nullable(),
  topicId: z.string().uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  materialType: MaterialTypeEnum,
  sourceType: MaterialSourceTypeEnum,
  fileName: z.string().nullable(),
  mimeType: z.string().nullable(),
  fileSize: z.number().nullable(),
  storageProvider: z.string(),
  storageKey: z.string().nullable(),
  processingStatus: MaterialProcessingStatusEnum,
  status: MaterialStatusEnum,
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MaterialResponse = z.infer<typeof MaterialResponseSchema>;

export const MaterialProcessResponseSchema = z.object({
  materialId: z.string().uuid(),
  jobId: z.string().uuid(),
  processingStatus: z.literal('QUEUED'),
});
export type MaterialProcessResponse = z.infer<typeof MaterialProcessResponseSchema>;
