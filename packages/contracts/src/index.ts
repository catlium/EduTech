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

// ── Error Contracts ─────────────────────────

export const ErrorResponseSchema = z.object({
  statusCode: z.number(),
  message: z.string(),
  error: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ── Job Message Contract (RabbitMQ) ─────────

export const JobMessageSchema = z.object({
  jobId: z.string().uuid(),
  instituteId: z.string().uuid(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type JobMessage = z.infer<typeof JobMessageSchema>;

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
