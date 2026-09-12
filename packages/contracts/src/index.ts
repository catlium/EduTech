import { z } from 'zod';

export const RoleEnum = z.enum(['INSTITUTE_ADMIN', 'TEACHER', 'STUDENT']);
export type Role = z.infer<typeof RoleEnum>;

// A user's membership in an institute, used by the institute picker.
export const MembershipListItemSchema = z.object({
  instituteId: z.string().uuid(),
  instituteName: z.string(),
  slug: z.string(),
  status: z.string(),
  roles: z.array(RoleEnum),
});
export type MembershipListItem = z.infer<typeof MembershipListItemSchema>;

export const JobStatusEnum = z.enum(['queued', 'processing', 'completed', 'failed']);
export type JobStatus = z.infer<typeof JobStatusEnum>;

// ── Auth Contracts ──────────────────────────

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

// ── Institute User Management Contracts ─────

export const InstituteUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  roles: z.array(RoleEnum),
  status: z.enum(['active', 'deactivated']),
  createdAt: z.string().datetime(),
});
export type InstituteUser = z.infer<typeof InstituteUserSchema>;

export const CreateInstituteUserRequestSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(255),
  password: z.string().min(8).max(128),
  role: z.enum(['TEACHER', 'STUDENT']),
});
export type CreateInstituteUserRequest = z.infer<typeof CreateInstituteUserRequestSchema>;

export const UpdateUserStatusRequestSchema = z.object({
  status: z.enum(['active', 'deactivated']),
});
export type UpdateUserStatusRequest = z.infer<typeof UpdateUserStatusRequestSchema>;

export const InstituteUsersResponseSchema = z.object({
  users: z.array(InstituteUserSchema),
});
export type InstituteUsersResponse = z.infer<typeof InstituteUsersResponseSchema>;

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

export const ContentTypeEnum = z.enum([
  'NOTE',
  'FLASHCARD_SET',
  'CORNELL_NOTE',
  'SUMMARY',
  'IMPORTANT_CONCEPTS',
]);
export type ContentType = z.infer<typeof ContentTypeEnum>;

export const ContentStatusEnum = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
export type ContentStatus = z.infer<typeof ContentStatusEnum>;

export const ContentSourceEnum = z.enum(['MANUAL', 'AI_GENERATED', 'OCR_EXTRACTED', 'IMPORTED']);
export type ContentSource = z.infer<typeof ContentSourceEnum>;

export const ContentChangeTypeEnum = z.enum(['CREATION', 'EDIT', 'REGENERATION', 'CORRECTION']);
export type ContentChangeType = z.infer<typeof ContentChangeTypeEnum>;

// ── Content Payload Contracts ──────────────

const PayloadId = z.string().min(1).max(128);

export const NoteHeadingBlockSchema = z.object({
  id: PayloadId,
  type: z.literal('heading'),
  content: z.string().min(1),
});

export const NoteParagraphBlockSchema = z.object({
  id: PayloadId,
  type: z.literal('paragraph'),
  content: z.string().min(1),
});

export const NoteListBlockSchema = z.object({
  id: PayloadId,
  type: z.literal('list'),
  items: z.array(z.string()).min(1),
});

export const NoteStepsBlockSchema = z.object({
  id: PayloadId,
  type: z.literal('steps'),
  title: z.string().max(255).optional(),
  items: z.array(z.string()).min(1),
});

export const NoteTableBlockSchema = z.object({
  id: PayloadId,
  type: z.literal('table'),
  caption: z.string().max(255).optional(),
  headers: z.array(z.string().min(1).max(500)).max(12).optional(),
  rows: z.array(z.array(z.string().min(1).max(2000)).max(12)).min(1).max(100),
});

export const NoteFormulaBlockSchema = z.object({
  id: PayloadId,
  type: z.literal('formula'),
  content: z.string().min(1).max(2000),
});

export const NoteExampleBlockSchema = z.object({
  id: PayloadId,
  type: z.literal('example'),
  title: z.string().max(255).optional(),
  content: z.string().min(1).max(5000),
});

export const NoteCalloutBlockSchema = z.object({
  id: PayloadId,
  type: z.literal('callout'),
  variant: z.enum(['note', 'tip', 'warning', 'important']).default('note'),
  content: z.string().min(1).max(2000),
});

export const NoteTimelineEventSchema = z.object({
  period: z.string().min(1).max(255),
  title: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
});

export const NoteTimelineBlockSchema = z.object({
  id: PayloadId,
  type: z.literal('timeline'),
  caption: z.string().max(255).optional(),
  events: z.array(NoteTimelineEventSchema).min(1).max(50),
});

export const NoteDiagramNodeSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(500),
});

export const NoteDiagramEdgeSchema = z.object({
  from: z.string().min(1).max(64),
  to: z.string().min(1).max(64),
  label: z.string().max(255).optional(),
});

export const NoteDiagramBlockSchema = z.object({
  id: PayloadId,
  type: z.literal('diagram'),
  kind: z.enum(['flowchart', 'concept_map']),
  caption: z.string().max(255).optional(),
  nodes: z.array(NoteDiagramNodeSchema).min(1).max(30),
  edges: z.array(NoteDiagramEdgeSchema).max(60).default([]),
});

export const NoteChartDatumSchema = z.object({
  label: z.string().min(1).max(255),
  value: z.number().min(0),
});

export const NoteChartBlockSchema = z.object({
  id: PayloadId,
  type: z.literal('chart'),
  chartType: z.enum(['bar', 'line', 'pie']),
  caption: z.string().max(255).optional(),
  data: z.array(NoteChartDatumSchema).min(1).max(50),
});

export const NoteBlockSchema = z.discriminatedUnion('type', [
  NoteHeadingBlockSchema,
  NoteParagraphBlockSchema,
  NoteListBlockSchema,
  NoteStepsBlockSchema,
  NoteTableBlockSchema,
  NoteFormulaBlockSchema,
  NoteExampleBlockSchema,
  NoteCalloutBlockSchema,
  NoteTimelineBlockSchema,
  NoteDiagramBlockSchema,
  NoteChartBlockSchema,
]);
export type NoteBlock = z.infer<typeof NoteBlockSchema>;
export type NoteListBlock = z.infer<typeof NoteListBlockSchema>;
export type NoteStepsBlock = z.infer<typeof NoteStepsBlockSchema>;
export type NoteTableBlock = z.infer<typeof NoteTableBlockSchema>;
export type NoteDiagramBlock = z.infer<typeof NoteDiagramBlockSchema>;
export type NoteChartBlock = z.infer<typeof NoteChartBlockSchema>;

export const FurtherLearningResourceSchema = z.object({
  title: z.string().min(1).max(500),
  url: z.string().url().max(1000),
  kind: z.enum(['documentation', 'video', 'course', 'website', 'reference']).default('website'),
  note: z.string().max(500).optional(),
});
export type FurtherLearningResource = z.infer<typeof FurtherLearningResourceSchema>;

export const NotePayloadSchema = z.object({
  title: z.string().max(255).optional(),
  blocks: z.array(NoteBlockSchema).min(1),
  /* Authoritative external resources for deeper study. Never fabricated by the
   * generator — kept separate from the AI core content so a missing/incomplete
   * list never compromises the generated body. */
  furtherLearning: z.array(FurtherLearningResourceSchema).max(50).optional(),
});
export type NotePayload = z.infer<typeof NotePayloadSchema>;

// FLASHCARD_SET — a set of front/back cards.

export const FlashcardDifficultyEnum = z.enum(['EASY', 'MEDIUM', 'HARD']);
export type FlashcardDifficulty = z.infer<typeof FlashcardDifficultyEnum>;

export const FlashcardSchema = z.object({
  id: PayloadId,
  front: z.string().min(1).max(5000),
  back: z.string().min(1).max(5000),
  difficulty: FlashcardDifficultyEnum.optional(),
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

// SUMMARY — condensed summary with key concepts and important points.

export const SummaryPayloadSchema = z.object({
  title: z.string().max(255).optional(),
  summary: z.string().min(1).max(20000),
  keyConcepts: z.array(z.string().min(1).max(1000)).min(1),
  importantPoints: z.array(z.string().min(1).max(2000)).min(1),
  /* Concept → explanation → example → takeaway. Examples are generated only
   * where they genuinely aid understanding (never filler). */
  examples: z
    .array(
      z.object({
        topic: z.string().min(1).max(500).optional(),
        content: z.string().min(1).max(5000),
      }),
    )
    .max(20)
    .optional(),
  furtherLearning: z.array(FurtherLearningResourceSchema).max(50).optional(),
});
export type SummaryPayload = z.infer<typeof SummaryPayloadSchema>;

// IMPORTANT_CONCEPTS — a set of concept name/description pairs.

export const ConceptSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().min(1).max(5000),
});
export type Concept = z.infer<typeof ConceptSchema>;

export const ImportantConceptsPayloadSchema = z.object({
  title: z.string().max(255).optional(),
  concepts: z.array(ConceptSchema).min(1),
});
export type ImportantConceptsPayload = z.infer<typeof ImportantConceptsPayloadSchema>;

export const ContentPayloadSchemas = {
  NOTE: NotePayloadSchema,
  FLASHCARD_SET: FlashcardSetPayloadSchema,
  CORNELL_NOTE: CornellNotePayloadSchema,
  SUMMARY: SummaryPayloadSchema,
  IMPORTANT_CONCEPTS: ImportantConceptsPayloadSchema,
} as const;
export type ContentPayload =
  | NotePayload
  | FlashcardSetPayload
  | CornellNotePayload
  | SummaryPayload
  | ImportantConceptsPayload;

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
  processError: z.string().nullable().optional(),
  processStartedAt: z.string().datetime().nullable().optional(),
  processCompletedAt: z.string().datetime().nullable().optional(),
});
export type MaterialResponse = z.infer<typeof MaterialResponseSchema>;

export const MaterialProcessResponseSchema = z.object({
  materialId: z.string().uuid(),
  jobId: z.string().uuid(),
  processingStatus: z.literal('QUEUED'),
});
export type MaterialProcessResponse = z.infer<typeof MaterialProcessResponseSchema>;

// ── AI Generation Contracts ────────────────
//
// The worker receives a minimal job payload:
//   { "operation": "AI_GENERATE_NOTE"|..., "source": { "type": "MATERIAL"|"TOPIC", "id": "uuid" }, "requestedBy": "uuid" }
// and resolves the source text itself (no content embedded in the message).

export const GenerationSourceTypeEnum = z.enum(['MATERIAL', 'TOPIC', 'CHAPTER', 'SUBJECT']);
export type GenerationSourceType = z.infer<typeof GenerationSourceTypeEnum>;

export const GenerationOperationEnum = z.enum([
  'AI_GENERATE_NOTE',
  'AI_GENERATE_SUMMARY',
  'AI_GENERATE_FLASHCARDS',
  'AI_GENERATE_CONCEPTS',
]);
export type GenerationOperation = z.infer<typeof GenerationOperationEnum>;

export const GenerateContentRequestSchema = z.object({
  operation: GenerationOperationEnum,
  sourceType: GenerationSourceTypeEnum,
  sourceId: z.string().uuid(),
});
export type GenerateContentRequest = z.infer<typeof GenerateContentRequestSchema>;

export const GenerateContentResponseSchema = z.object({
  jobId: z.string().uuid(),
  operation: GenerationOperationEnum,
  sourceType: GenerationSourceTypeEnum,
  sourceId: z.string().uuid(),
  status: z.literal('QUEUED'),
});
export type GenerateContentResponse = z.infer<typeof GenerateContentResponseSchema>;

// Reusable content package: one generation request producing all requested
// content types for a source. The worker makes a single provider pass per
// chunk and persists one content item per type (generate once, reuse until the
// source changes or the teacher explicitly regenerates).

export const ContentPackageTypeEnum = z.enum([
  'NOTE',
  'SUMMARY',
  'FLASHCARD_SET',
  'IMPORTANT_CONCEPTS',
  'CORNELL_NOTE',
]);
export type ContentPackageType = z.infer<typeof ContentPackageTypeEnum>;

export const GenerateContentPackageRequestSchema = z.object({
  sourceType: z.enum(['MATERIAL', 'TOPIC']),
  sourceId: z.string().uuid(),
  includeTypes: z.array(ContentPackageTypeEnum).min(1).optional(),
});
export type GenerateContentPackageRequest = z.infer<typeof GenerateContentPackageRequestSchema>;

export const GenerateContentPackageResponseSchema = z.object({
  jobId: z.string().uuid(),
  operation: z.literal('AI_GENERATE_CONTENT_PACKAGE'),
  sourceType: z.enum(['MATERIAL', 'TOPIC']),
  sourceId: z.string().uuid(),
  status: z.literal('QUEUED'),
});
export type GenerateContentPackageResponse = z.infer<typeof GenerateContentPackageResponseSchema>;

// Generation status for a material's reusable content: per content type,
// whether an AI-generated item exists for this source, whether it is stale
// (source edited after generation), or currently generating (job active).

export const ContentGenerationStateEnum = z.enum([
  'not_generated',
  'generating',
  'generated',
  'stale',
  'failed',
]);
export type ContentGenerationState = z.infer<typeof ContentGenerationStateEnum>;

export const ContentGenerationStatusSchema = z.object({
  type: ContentPackageTypeEnum,
  state: ContentGenerationStateEnum,
  contentId: z.string().uuid().nullable(),
  version: z.number().nullable(),
  generatedAt: z.string().datetime().nullable(),
});
export type ContentGenerationStatus = z.infer<typeof ContentGenerationStatusSchema>;

export const ContentGenerationStatusResponseSchema = z.object({
  materialId: z.string().uuid(),
  items: z.array(ContentGenerationStatusSchema),
});
export type ContentGenerationStatusResponse = z.infer<typeof ContentGenerationStatusResponseSchema>;

// ── Question Contracts ─────────────────────

/** Open-ended reference to a question type (predefined template OR a custom
 * type created by the institute). Never a closed enum — the API validates the
 * code exists in the question_types table. */
export const QuestionTypeRefSchema = z.string().min(1).max(64);
export type QuestionTypeRef = z.infer<typeof QuestionTypeRefSchema>;

/** Predefined startter templates seeded globally. They are suggestions, not a
 * limit: institutes may create custom types with any code. */
export const PredefinedQuestionTypeEnum = z.enum([
  'MCQ',
  'TRUE_FALSE',
  'FILL_IN_BLANK',
  'DEFINITION',
  'VERY_SHORT_ANSWER',
  'SHORT_ANSWER',
  'BRIEF_ANSWER',
  'LONG_ANSWER',
  'MATCH_THE_FOLLOWING',
  'CASE_STUDY',
  'NUMERICAL',
]);
export type PredefinedQuestionType = z.infer<typeof PredefinedQuestionTypeEnum>;

/* Backwards-compatible alias kept for code that only deals with the original
 * self-grading objective trio. */
export const QuestionTypeEnum = z.enum(['MCQ', 'TRUE_FALSE', 'FILL_IN_BLANK']);
export type QuestionType = z.infer<typeof QuestionTypeEnum>;

/** The payload shape every question MUST follow, keyed by the type's answer
 * format (not by the type code). New formats later = one more entry here. */
export const AnswerFormatEnum = z.enum([
  'MCQ',
  'TRUE_FALSE',
  'FILL_IN_BLANK',
  'TEXT',
  'MATCHING',
  'NUMERICAL',
]);
export type AnswerFormat = z.infer<typeof AnswerFormatEnum>;

export const QuestionTypeKindEnum = z.enum(['OBJECTIVE', 'SUBJECTIVE']);
export type QuestionTypeKind = z.infer<typeof QuestionTypeKindEnum>;

export const McqFormatPayloadSchema = z.object({
  choices: z
    .array(z.object({ id: z.string().min(1).max(64), text: z.string().min(1) }))
    .min(2)
    .max(10),
  correctChoiceId: z.string().min(1).max(64),
});

export const TrueFalseFormatPayloadSchema = z.object({
  correctAnswer: z.boolean(),
});

export const FillInBlankFormatPayloadSchema = z.object({
  acceptableAnswers: z.array(z.string().min(1)).min(1).max(10),
});

export const TextFormatPayloadSchema = z.object({
  modelAnswer: z.string().min(1).max(4000),
});

export const MatchingFormatPayloadSchema = z.object({
  left: z
    .array(z.object({ id: z.string().min(1).max(64), text: z.string().min(1) }))
    .min(2)
    .max(10),
  right: z
    .array(z.object({ id: z.string().min(1).max(64), text: z.string().min(1) }))
    .min(2)
    .max(10),
  matches: z.record(z.string().min(1).max(64), z.string().min(1).max(64)),
});

export const NumericalFormatPayloadSchema = z.object({
  modelAnswer: z.number(),
  tolerance: z.number().min(0).max(10).optional(),
});

export const FormatPayloadSchemas = {
  MCQ: McqFormatPayloadSchema,
  TRUE_FALSE: TrueFalseFormatPayloadSchema,
  FILL_IN_BLANK: FillInBlankFormatPayloadSchema,
  TEXT: TextFormatPayloadSchema,
  MATCHING: MatchingFormatPayloadSchema,
  NUMERICAL: NumericalFormatPayloadSchema,
} as const;

export const QuestionTypeDefinitionSchema = z.object({
  id: z.string(),
  code: QuestionTypeRefSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  instructions: z.string().max(2000).nullable().optional(),
  answerFormat: AnswerFormatEnum,
  kind: QuestionTypeKindEnum,
  defaultMarks: z.number().int().min(1).max(1000).nullable().optional(),
  allowedDifficulties: z.array(z.enum(['EASY','MEDIUM','HARD'])).max(3).nullable().optional(),
  evaluationConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  isGlobal: z.boolean(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QuestionTypeDefinition = z.infer<typeof QuestionTypeDefinitionSchema>;

export const CreateQuestionTypeRequestSchema = z.object({
  name: z.string().min(1).max(100),
  code: QuestionTypeRefSchema.optional(),
  description: z.string().max(500).optional(),
  instructions: z.string().max(2000).optional(),
  answerFormat: AnswerFormatEnum,
  kind: QuestionTypeKindEnum,
  defaultMarks: z.number().int().min(1).max(1000).optional(),
  allowedDifficulties: z.array(z.enum(['EASY','MEDIUM','HARD'])).max(3).optional(),
  evaluationConfig: z.record(z.string(), z.unknown()).optional(),
});
export type CreateQuestionTypeRequest = z.infer<typeof CreateQuestionTypeRequestSchema>;

export const ListQuestionTypesResponseSchema = z.object({
  types: z.array(QuestionTypeDefinitionSchema),
});
export type ListQuestionTypesResponse = z.infer<typeof ListQuestionTypesResponseSchema>;

export const QuestionDifficultyEnum = z.enum(['EASY', 'MEDIUM', 'HARD']);
export type QuestionDifficulty = z.infer<typeof QuestionDifficultyEnum>;

export const QuestionSourceEnum = z.enum(['MANUAL', 'AI_GENERATED']);
export type QuestionSource = z.infer<typeof QuestionSourceEnum>;

export const QuestionApprovalStatusEnum = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type QuestionApprovalStatus = z.infer<typeof QuestionApprovalStatusEnum>;

// ── Question Payload Contracts ─────────────

export const McqChoiceSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1).max(1000),
});
export type McqChoice = z.infer<typeof McqChoiceSchema>;

export const McqPayloadSchema = z.object({
  choices: z.array(McqChoiceSchema).min(2),
  correctChoiceId: z.string().uuid(),
});
export type McqPayload = z.infer<typeof McqPayloadSchema>;

export const TrueFalsePayloadSchema = z.object({
  correctAnswer: z.boolean(),
});
export type TrueFalsePayload = z.infer<typeof TrueFalsePayloadSchema>;

export const FillInBlankPayloadSchema = z.object({
  acceptableAnswers: z.array(z.string().min(1).max(500)).min(1),
});
export type FillInBlankPayload = z.infer<typeof FillInBlankPayloadSchema>;

export const QuestionPayloadSchemas = {
  MCQ: McqPayloadSchema,
  TRUE_FALSE: TrueFalsePayloadSchema,
  FILL_IN_BLANK: FillInBlankPayloadSchema,
} as const;
export type QuestionPayload = McqPayload | TrueFalsePayload | FillInBlankPayload;

export const CreateQuestionRequestSchema = z
  .object({
    stem: z.string().min(1).max(20000),
    questionType: QuestionTypeRefSchema,
    difficulty: QuestionDifficultyEnum.optional(),
    explanation: z.string().max(20000).optional(),
    source: QuestionSourceEnum,
    payload: z.record(z.string(), z.unknown()),
    ...AcademicScopeFields,
  })
  .superRefine((value, ctx) => {
    // Built-in codes get client-side payload validation; custom codes
    // (any string) are validated server-side against the type's answer format.
    const schema = (QuestionPayloadSchemas as Record<string, import('zod').ZodTypeAny | undefined>)[value.questionType];
    if (!schema) return;
    const result = schema.safeParse(value.payload);
    if (!result.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['payload'],
        message: `payload does not match ${value.questionType} schema: ${result.error.issues[0]?.message ?? 'invalid'}`,
      });
    }
  })
  .refine(
    (v) => [v.subjectId, v.chapterId, v.topicId].filter((x) => x !== undefined).length === 1,
    { message: 'Exactly one of subjectId, chapterId, topicId must be provided', path: ['scope'] },
  );
export type CreateQuestionRequest = z.infer<typeof CreateQuestionRequestSchema>;

export const UpdateQuestionRequestSchema = z.object({
  stem: z.string().min(1).max(20000).optional(),
  difficulty: QuestionDifficultyEnum.optional(),
  explanation: z.string().max(20000).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateQuestionRequest = z.infer<typeof UpdateQuestionRequestSchema>;

export const QuestionResponseSchema = z.object({
  id: z.string().uuid(),
  instituteId: z.string().uuid(),
  subjectId: z.string().uuid().nullable(),
  chapterId: z.string().uuid().nullable(),
  topicId: z.string().uuid().nullable(),
  stem: z.string(),
  questionType: QuestionTypeRefSchema,
  difficulty: QuestionDifficultyEnum,
  explanation: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  source: QuestionSourceEnum,
  approvalStatus: QuestionApprovalStatusEnum,
  status: z.string(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type QuestionResponse = z.infer<typeof QuestionResponseSchema>;

export const QuestionListItemSchema = QuestionResponseSchema;
export type QuestionListItem = z.infer<typeof QuestionListItemSchema>;

export const GenerateQuestionsRequestSchema = z.object({
  topicId: z.string().uuid(),
  questionType: QuestionTypeRefSchema,
  count: z.number().int().min(1).max(50),
  difficulty: QuestionDifficultyEnum.optional(),
});
export type GenerateQuestionsRequest = z.infer<typeof GenerateQuestionsRequestSchema>;

export const GenerateQuestionsResponseSchema = z.object({
  jobId: z.string().uuid(),
  operation: z.literal('AI_GENERATE_QUESTIONS'),
  sourceType: z.literal('TOPIC'),
  sourceId: z.string().uuid(),
  status: z.literal('QUEUED'),
});
export type GenerateQuestionsResponse = z.infer<typeof GenerateQuestionsResponseSchema>;

export const BatchQuestionActionRequestSchema = z.object({
  questionIds: z.array(z.string().uuid()).min(1),
});
export type BatchQuestionActionRequest = z.infer<typeof BatchQuestionActionRequestSchema>;

// ── Question Bank Contracts ────────────────
//
// The bank is the `questions` table itself (scope + type + difficulty +
// source + approval metadata makes it queryable). Bank generation is the same
// AI_GENERATE_QUESTIONS operation, but parametrized with explicit
// (type, difficulty, count) buckets so a subject/chapter/topic scope can be
// filled once with a large enough pool instead of regenerating per assessment.

export const GenerateBankBucketSchema = z.object({
  questionType: QuestionTypeRefSchema,
  difficulty: QuestionDifficultyEnum,
  count: z.number().int().min(1).max(100),
});
export type GenerateBankBucket = z.infer<typeof GenerateBankBucketSchema>;

export const QuestionBankScopeSchema = z
  .object({
    subjectId: z.string().uuid().optional(),
    chapterId: z.string().uuid().optional(),
    topicId: z.string().uuid().optional(),
  })
  .refine(
    (v) => [v.subjectId, v.chapterId, v.topicId].filter((x) => x !== undefined).length === 1,
    {
      message: 'Exactly one of subjectId, chapterId, topicId must be provided',
      path: ['scope'],
    },
  );
export type QuestionBankScope = z.infer<typeof QuestionBankScopeSchema>;

export const DifficultyDistributionSchema = z
  .object({
    EASY: z.number().int().min(0).max(100),
    MEDIUM: z.number().int().min(0).max(100),
    HARD: z.number().int().min(0).max(100),
  })
  .refine((v) => v.EASY + v.MEDIUM + v.HARD === 100, {
    message: 'Difficulty distribution percentages must sum to 100',
  });
export type DifficultyDistribution = z.infer<typeof DifficultyDistributionSchema>;

export const GenerateBankRequestSchema = z
  .object({
    ...QuestionBankScopeSchema.shape,
    questionTypes: z.array(QuestionTypeRefSchema).min(1).max(32).optional(),
    count: z.number().int().min(1).max(100),
    difficultyDistribution: DifficultyDistributionSchema.optional(),
    blueprintId: z.string().uuid().optional(),
  });
export type GenerateBankRequest = z.infer<typeof GenerateBankRequestSchema>;

export const CountBucketSchema = z.object({
  questionType: QuestionTypeRefSchema,
  difficulty: QuestionDifficultyEnum,
  count: z.number().int().min(0),
});
export type CountBucket = z.infer<typeof CountBucketSchema>;

export const DeriveDistributionRequestSchema = z.object({
  ...QuestionBankScopeSchema.shape,
  count: z.number().int().min(1).max(500),
});
export type DeriveDistributionRequest = z.infer<typeof DeriveDistributionRequestSchema>;

export const DerivedDistributionBucketSchema = z.object({
  questionType: QuestionTypeRefSchema,
  difficulty: QuestionDifficultyEnum,
  percentage: z.number().int().min(0).max(100),
});
export type DerivedDistributionBucket = z.infer<typeof DerivedDistributionBucketSchema>;

export const DeriveDistributionResponseSchema = z.object({
  sources: z.array(z.string()),
  count: z.number().int(),
  distribution: z.array(DerivedDistributionBucketSchema),
  buckets: z.array(CountBucketSchema),
});
export type DeriveDistributionResponse = z.infer<typeof DeriveDistributionResponseSchema>;

export const GenerateBankResponseSchema = z.object({
  jobId: z.string().uuid(),
  operation: z.literal('AI_GENERATE_QUESTIONS'),
  sourceType: GenerationSourceTypeEnum,
  sourceId: z.string().uuid(),
  status: z.literal('QUEUED'),
  buckets: z.array(GenerateBankBucketSchema),
});
export type GenerateBankResponse = z.infer<typeof GenerateBankResponseSchema>;

export const GenerateBankFromBlueprintRequestSchema = z.object({
  blueprintId: z.string().uuid(),
  ...QuestionBankScopeSchema.shape,
});
export type GenerateBankFromBlueprintRequest = z.infer<
  typeof GenerateBankFromBlueprintRequestSchema
>;

export const QuestionBankStatsSchema = z.object({
  total: z.number(),
  usable: z.number(),
  byType: z.record(QuestionTypeRefSchema, z.number()),
  byDifficulty: z.object({
    EASY: z.number(),
    MEDIUM: z.number(),
    HARD: z.number(),
  }),
  byApproval: z.object({
    PENDING: z.number(),
    APPROVED: z.number(),
    REJECTED: z.number(),
  }),
});
export type QuestionBankStats = z.infer<typeof QuestionBankStatsSchema>;

export const GenerateMoreQuestionsRequestSchema = z.object({
  ...QuestionBankScopeSchema.shape,
  buckets: z.array(GenerateBankBucketSchema).min(1),
  dryRun: z.boolean().optional(),
});
export type GenerateMoreQuestionsRequest = z.infer<typeof GenerateMoreQuestionsRequestSchema>;

export const GenerateMoreBucketStatusSchema = z.object({
  questionType: QuestionTypeRefSchema,
  difficulty: QuestionDifficultyEnum,
  requested: z.number(),
  existing: z.number(),
  pending: z.number().optional().default(0),
  deficit: z.number(),
});
export type GenerateMoreBucketStatus = z.infer<typeof GenerateMoreBucketStatusSchema>;

export const GenerateMoreQuestionsResponseSchema = z.object({
  generated: z.boolean(),
  jobId: z.string().uuid().nullable(),
  status: z.enum(['QUEUED', 'NO_ACTION']),
  buckets: z.array(GenerateMoreBucketStatusSchema),
  totalExisting: z.number(),
  totalDeficit: z.number(),
});
export type GenerateMoreQuestionsResponse = z.infer<typeof GenerateMoreQuestionsResponseSchema>;

// ── Export Contracts ────────────────────────

export const ExportFormatEnum = z.enum(['pdf', 'docx']);
export type ExportFormat = z.infer<typeof ExportFormatEnum>;

// ── Assessment Contracts ────────────────────

export const AssessmentStatusEnum = z.enum(['DRAFT', 'PUBLISHED', 'ACTIVE', 'COMPLETED']);
export type AssessmentStatus = z.infer<typeof AssessmentStatusEnum>;

export const CreateAssessmentRequestSchema = z
  .object({
    title: z.string().min(1).max(255),
    description: z.string().max(5000).optional(),
    durationMinutes: z.number().int().min(1).max(600).optional(),
    maxMarks: z.number().int().min(1).max(10000).optional(),
    instructions: z.record(z.string(), z.unknown()).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
  })
  .refine(
    (v) =>
      v.startsAt === undefined ||
      v.endsAt === undefined ||
      new Date(v.startsAt) < new Date(v.endsAt),
    {
      message: 'Schedule start must be before end',
      path: ['schedule'],
    },
  );
export type CreateAssessmentRequest = z.infer<typeof CreateAssessmentRequestSchema>;

export const UpdateAssessmentRequestSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).nullable().optional(),
  durationMinutes: z.number().int().min(1).max(600).nullable().optional(),
  maxMarks: z.number().int().min(1).max(10000).nullable().optional(),
  instructions: z.record(z.string(), z.unknown()).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});
export type UpdateAssessmentRequest = z.infer<typeof UpdateAssessmentRequestSchema>;

export const AssessmentResponseSchema = z.object({
  id: z.string().uuid(),
  instituteId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  durationMinutes: z.number().int().nullable(),
  maxMarks: z.number().int().nullable(),
  instructions: z.record(z.string(), z.unknown()).nullable(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  status: AssessmentStatusEnum,
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AssessmentResponse = z.infer<typeof AssessmentResponseSchema>;

export const AssessmentListItemSchema = AssessmentResponseSchema.extend({
  questionCount: z.number(),
});
export type AssessmentListItem = z.infer<typeof AssessmentListItemSchema>;

// Add questions to an assessment (validated in-institute, Pitfall 3).
export const AddQuestionsRequestSchema = z.object({
  questionIds: z.array(z.string().uuid()).min(1),
});
export type AddQuestionsRequest = z.infer<typeof AddQuestionsRequestSchema>;

// A link row on the assessment_questions join table with the nested question.
export const AssessmentQuestionSchema = z.object({
  id: z.string().uuid(),
  assessmentId: z.string().uuid(),
  questionId: z.string().uuid(),
  sortOrder: z.number(),
  marks: z.number(),
  question: QuestionResponseSchema,
});
export type AssessmentQuestion = z.infer<typeof AssessmentQuestionSchema>;

// ── Syllabus Contracts ─────────────────────
//
// A syllabus proposal is the AI-generated (or teacher-edited) academic
// structure for a subject: ordered chapters, each with optional topics. It
// stays `PENDING_REVIEW` until a teacher/admin confirms it; confirmation
// transactionally creates the real chapters/topics via the academic module.
// AI (workers) only ever writes proposals — never chapters/topics directly.

export const SyllabusStatusEnum = z.enum(['PENDING_REVIEW', 'CONFIRMED']);
export type SyllabusStatus = z.infer<typeof SyllabusStatusEnum>;

export const SyllabusTopicSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).nullable().optional(),
});
export type SyllabusTopic = z.infer<typeof SyllabusTopicSchema>;

export const SyllabusChapterSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).nullable().optional(),
  topics: z.array(SyllabusTopicSchema).max(200),
});
export type SyllabusChapter = z.infer<typeof SyllabusChapterSchema>;

export const SyllabusStructureSchema = z.object({
  chapters: z.array(SyllabusChapterSchema).min(1).max(100),
});
export type SyllabusStructure = z.infer<typeof SyllabusStructureSchema>;

export const GenerateSyllabusRequestSchema = z.object({
  materialId: z.string().uuid().optional(),
});
export type GenerateSyllabusRequest = z.infer<typeof GenerateSyllabusRequestSchema>;

export const GenerateSyllabusResponseSchema = z.object({
  jobId: z.string().uuid(),
  operation: z.literal('AI_GENERATE_SYLLABUS'),
  sourceType: z.literal('MATERIAL'),
  sourceId: z.string().uuid(),
  subjectId: z.string().uuid(),
  status: z.literal('QUEUED'),
});
export type GenerateSyllabusResponse = z.infer<typeof GenerateSyllabusResponseSchema>;

export const UpdateSyllabusRequestSchema = z.object({
  structure: SyllabusStructureSchema,
});
export type UpdateSyllabusRequest = z.infer<typeof UpdateSyllabusRequestSchema>;

export const SyllabusResponseSchema = z.object({
  id: z.string().uuid(),
  instituteId: z.string().uuid(),
  subjectId: z.string().uuid(),
  status: SyllabusStatusEnum,
  structure: SyllabusStructureSchema,
  sourceMaterialId: z.string().uuid().nullable(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid().nullable(),
  confirmedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SyllabusResponse = z.infer<typeof SyllabusResponseSchema>;

// ── Student Attempt Contracts ────────────────
//
// The attempt snapshots the assessment question set at start; later edits to
// the assessment's question links or source questions never affect an in-flight
// attempt. Student-facing payloads are SANITIZED: the server retains answer
// fields (correctChoiceId / correctAnswer / acceptableAnswers) internally for
// Phase 10 evaluation, but every contract in this section omits them.

export const AttemptStatusEnum = z.enum(['IN_PROGRESS', 'SUBMITTED', 'EXPIRED']);
export type AttemptStatus = z.infer<typeof AttemptStatusEnum>;

// Student-safe question payload. Deliberately `record` (no typed answer field
// exists on purpose): shape depends on `questionType` and the answer-bearing
// field is dropped at serialization time. The single source of truth for
// sanitization is attempts.service's sanitizeQuestionPayload() — never add
// answer fields to this contract.
export const StudentQuestionPayloadSchema = z.record(z.string(), z.unknown());
export type StudentQuestionPayload = z.infer<typeof StudentQuestionPayloadSchema>;

export const StudentAttemptQuestionSchema = z.object({
  attemptQuestionId: z.string().uuid(),
  questionId: z.string().uuid(),
  questionType: QuestionTypeRefSchema,
  stem: z.string(),
  payload: StudentQuestionPayloadSchema,
  sortOrder: z.number(),
  marks: z.number(),
});
export type StudentAttemptQuestion = z.infer<typeof StudentAttemptQuestionSchema>;

// Student's saved answer value. Typed by questionType at the service boundary:
//   MCQ          { choiceId: uuid }
//   TRUE_FALSE   { value: boolean }
//   FILL_IN_BLANK{ value: string }
export const StudentAttemptAnswerSchema = z.object({
  attemptQuestionId: z.string().uuid(),
  answer: z.record(z.string(), z.unknown()),
});
export type StudentAttemptAnswer = z.infer<typeof StudentAttemptAnswerSchema>;

export const AttemptMetaSchema = z.object({
  id: z.string().uuid(),
  assessmentId: z.string().uuid(),
  status: AttemptStatusEnum,
  startedAt: z.string().datetime(),
  deadline: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
  score: z.number().int().nullable(),
  totalMarks: z.number().int().nullable(),
});
export type AttemptMeta = z.infer<typeof AttemptMetaSchema>;

export const AttemptDetailSchema = AttemptMetaSchema.extend({
  questions: z.array(
    StudentAttemptQuestionSchema.extend({
      answer: z.record(z.string(), z.unknown()).nullable(),
    }),
  ),
});
export type AttemptDetail = z.infer<typeof AttemptDetailSchema>;

// Phase 10 result review — only for the student's OWN terminal attempt
// (SUBMITTED / EXPIRED). Deliberately separate from AttemptDetailSchema: the
// detail endpoint stays answer-key-free (sanitized payload, no correctness),
// while this route reveals the correct answer for post-submission review.
export const AttemptResultQuestionSchema = StudentAttemptQuestionSchema.extend({
  answer: z.record(z.string(), z.unknown()).nullable(),
  isCorrect: z.boolean(),
  marksAwarded: z.number().int(),
  correctAnswer: z.record(z.string(), z.unknown()),
});
export type AttemptResultQuestion = z.infer<typeof AttemptResultQuestionSchema>;

export const AttemptResultSchema = AttemptMetaSchema.extend({
  questions: z.array(AttemptResultQuestionSchema),
});
export type AttemptResult = z.infer<typeof AttemptResultSchema>;

// Student-facing "available assessment" card — sanitized, answer-free.
export const AvailableAssessmentSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  durationMinutes: z.number().int().nullable(),
  maxMarks: z.number().int().nullable(),
  instructions: z.record(z.string(), z.unknown()).nullable(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  status: AssessmentStatusEnum,
  questionCount: z.number().int(),
  inProgressAttemptId: z.string().uuid().nullable(),
});
export type AvailableAssessment = z.infer<typeof AvailableAssessmentSchema>;

// Student's own attempt history row (for the student "My exams" hub).
// Deliberately answer-free — same sanitization promise as the other student
// attempt contracts in this section.
export const AttemptHistoryItemSchema = z.object({
  id: z.string().uuid(),
  assessmentId: z.string().uuid(),
  assessmentTitle: z.string(),
  status: AttemptStatusEnum,
  startedAt: z.string().datetime(),
  deadline: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
  score: z.number().int().nullable(),
  totalMarks: z.number().int().nullable(),
  questionCount: z.number().int(),
});
export type AttemptHistoryItem = z.infer<typeof AttemptHistoryItemSchema>;

export const StartAttemptRequestSchema = z.object({
  assessmentId: z.string().uuid(),
});
export type StartAttemptRequest = z.infer<typeof StartAttemptRequestSchema>;

export const SaveAttemptAnswerRequestSchema = z.object({
  answer: z.record(z.string(), z.unknown()),
});
export type SaveAttemptAnswerRequest = z.infer<typeof SaveAttemptAnswerRequestSchema>;

// Teacher/admin attempt listing per assessment (score populated once the
// attempt is evaluated — SUBMITTED/EXPIRED).
export const AttemptListItemSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  studentName: z.string().nullable(),
  studentEmail: z.string(),
  status: AttemptStatusEnum,
  startedAt: z.string().datetime(),
  deadline: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
  score: z.number().int().nullable(),
  totalMarks: z.number().int().nullable(),
});
export type AttemptListItem = z.infer<typeof AttemptListItemSchema>;

// Phase 12 — Examination analytics (teacher-facing, computed on demand from
// EVALUATED attempts only — SUBMITTED/EXPIRED with a non-null score).
// Accuracy is a 0..1 ratio, or null when there were no responses to base it on.
export const ScoreDistributionBucketSchema = z.object({
  score: z.number().int(),
  count: z.number().int(),
});
export type ScoreDistributionBucket = z.infer<typeof ScoreDistributionBucketSchema>;

export const AnalyticsSummarySchema = z.object({
  evaluatedAttempts: z.number().int(),
  averageScore: z.number().nullable(),
  highestScore: z.number().int().nullable(),
  lowestScore: z.number().int().nullable(),
  totalMarks: z.number().int().nullable(),
});
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>;

export const QuestionAccuracyMetricSchema = z.object({
  questionId: z.string().uuid(),
  stem: z.string(),
  sortOrder: z.number().int(),
  marks: z.number().int(),
  questionType: QuestionTypeRefSchema,
  difficulty: QuestionDifficultyEnum,
  responses: z.number().int(),
  correctCount: z.number().int(),
  incorrectCount: z.number().int(),
  unansweredCount: z.number().int(),
  accuracy: z.number().nullable(),
  marksAwarded: z.number().int(),
  marksAvailable: z.number().int(),
});
export type QuestionAccuracyMetric = z.infer<typeof QuestionAccuracyMetricSchema>;

export const TopicPerformanceMetricSchema = z.object({
  topicId: z.string().uuid(),
  topicName: z.string(),
  questionCount: z.number().int(),
  responses: z.number().int(),
  correctResponses: z.number().int(),
  accuracy: z.number().nullable(),
  marksEarned: z.number().int(),
  marksAvailable: z.number().int(),
});
export type TopicPerformanceMetric = z.infer<typeof TopicPerformanceMetricSchema>;

export const DifficultyPerformanceMetricSchema = z.object({
  difficulty: QuestionDifficultyEnum,
  questionCount: z.number().int(),
  responses: z.number().int(),
  correctResponses: z.number().int(),
  accuracy: z.number().nullable(),
  marksEarned: z.number().int(),
  marksAvailable: z.number().int(),
});
export type DifficultyPerformanceMetric = z.infer<typeof DifficultyPerformanceMetricSchema>;

export const AssessmentAnalyticsSchema = z.object({
  summary: AnalyticsSummarySchema,
  scoreDistribution: z.array(ScoreDistributionBucketSchema),
  questionAccuracy: z.array(QuestionAccuracyMetricSchema),
  topicPerformance: z.array(TopicPerformanceMetricSchema),
  difficultyPerformance: z.array(DifficultyPerformanceMetricSchema),
});
export type AssessmentAnalytics = z.infer<typeof AssessmentAnalyticsSchema>;

// ── Practice System (Phase 13) — ungraded practice, PRAC-03 ───────────────

export const PracticeModeSchema = z.enum(['FLASHCARD', 'QUESTION']);
export type PracticeMode = z.infer<typeof PracticeModeSchema>;

export const FlashcardRatingSchema = z.enum(['AGAIN', 'GOOD']);
export type FlashcardRating = z.infer<typeof FlashcardRatingSchema>;

export const PracticeSessionStatusSchema = z.enum(['IN_PROGRESS', 'COMPLETED']);

export const PracticeCreateRequestSchema = z.object({
  mode: PracticeModeSchema,
  contentId: z.string().uuid().optional(),
  topicId: z.string().uuid().optional(),
});
export type PracticeCreateRequest = z.infer<typeof PracticeCreateRequestSchema>;

export const PracticeSaveAnswerRequestSchema = z.object({
  answer: z.unknown().optional(),
  rating: FlashcardRatingSchema.optional(),
});
export type PracticeSaveAnswerRequest = z.infer<typeof PracticeSaveAnswerRequestSchema>;

export const PracticeSessionItemSchema = z.object({
  id: z.string().uuid(),
  sourceKey: z.string(),
  sortOrder: z.number().int(),
  prompt: z.string(),
  reveal: z.string().optional(),
  questionType: z.string().optional(),
  // Question explanation, only present after the item is answered.
  explanation: z.string().optional(),
  answer: z.unknown().optional(),
  rating: FlashcardRatingSchema.optional(),
  isCorrect: z.boolean().optional(),
});
export type PracticeSessionItem = z.infer<typeof PracticeSessionItemSchema>;

export const PracticeSessionDetailSchema = z.object({
  id: z.string().uuid(),
  mode: PracticeModeSchema,
  status: PracticeSessionStatusSchema,
  itemCount: z.number().int(),
  answeredCount: z.number().int(),
  correctCount: z.number().int(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  items: z.array(PracticeSessionItemSchema),
});
export type PracticeSessionDetail = z.infer<typeof PracticeSessionDetailSchema>;

export const PracticeSessionListItemSchema = z.object({
  id: z.string().uuid(),
  mode: PracticeModeSchema,
  status: PracticeSessionStatusSchema,
  itemCount: z.number().int(),
  answeredCount: z.number().int(),
  correctCount: z.number().int(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type PracticeSessionListItem = z.infer<typeof PracticeSessionListItemSchema>;

// ── Paper Pattern Contracts (Phase 18 — paper patterns / blueprint) ─────────
//
// A paper pattern is a reusable, tenant-scoped exam blueprint: total marks,
// duration, instructions and an ordered set of sections. Each section declares
// a question type (any code from question_types — predefined template OR a
// custom institute-created type; validated at runtime, never a closed enum),
// question count, marks per question, whether it is
// compulsory ("attempt all") or offers a choice ("attempt N of M"), and
// optional difficulty/topic *percentage* distributions. Nullable fields
// represent explicit uncertainty — e.g. an AI analysis that could not infer a
// difficulty split must leave it null rather than invent one.
//
// Lifecycle: DRAFT (manual) / REVIEW (AI draft awaiting teacher review) →
// APPROVED (after deterministic validation). Only APPROVED patterns may drive
// question generation or assessment creation. Edits to APPROVED patterns are
// rejected; drafts carry an optimistic `version` counter.

export const PaperPatternStatusEnum = z.enum(['DRAFT', 'REVIEW', 'APPROVED']);
export type PaperPatternStatus = z.infer<typeof PaperPatternStatusEnum>;

export const PaperPatternSourceTypeEnum = z.enum([
  'MANUAL',
  'TEXT',
  'MATERIAL',
  'PREVIOUS_YEAR_PAPER',
]);
export type PaperPatternSourceType = z.infer<typeof PaperPatternSourceTypeEnum>;

export const PaperPatternDifficultyDistributionSchema = z.object({
  EASY: z.number().int().min(0).max(100),
  MEDIUM: z.number().int().min(0).max(100),
  HARD: z.number().int().min(0).max(100),
});
export type PaperPatternDifficultyDistribution = z.infer<
  typeof PaperPatternDifficultyDistributionSchema
>;

export const PaperPatternTopicDistributionSchema = z.object({
  name: z.string().min(1).max(255),
  /* null percentage = explicit "unknown", never a fabricated value */
  percentage: z.number().min(0).max(100).nullable().optional(),
});
export type PaperPatternTopicDistribution = z.infer<typeof PaperPatternTopicDistributionSchema>;

export const PaperPatternSectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  /* absent/undefined = unspecified or mixed-type section (no descriptive type exists yet) */
  questionType: QuestionTypeRefSchema.optional(),
  /* null = unknown (teacher/AI could not state it) */
  count: z.number().int().min(1).nullable().optional(),
  marksPerQuestion: z.number().int().min(1).nullable().optional(),
  totalMarks: z.number().int().min(1).nullable().optional(),
  compulsory: z.boolean().default(true),
  /* "attempt N of M" — for non-compulsory sections */
  attemptCount: z.number().int().min(1).nullable().optional(),
  difficultyDistribution: PaperPatternDifficultyDistributionSchema.nullable().optional(),
  topicDistribution: z.array(PaperPatternTopicDistributionSchema).max(100).nullable().optional(),
});
export type PaperPatternSection = z.infer<typeof PaperPatternSectionSchema>;

export const PaperPatternStructureSchema = z.object({
  totalMarks: z.number().int().min(1),
  durationMinutes: z.number().int().min(1),
  instructions: z.array(z.string().max(2000)).max(50).default([]),
  sections: z.array(PaperPatternSectionSchema).min(1).max(50),
});
export type PaperPatternStructure = z.infer<typeof PaperPatternStructureSchema>;

export const PaperPatternSchema = z.object({
  id: z.string().uuid(),
  instituteId: z.string().uuid(),
  subjectId: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().max(1000).nullable(),
  status: PaperPatternStatusEnum,
  version: z.number().int().min(1),
  sourceType: PaperPatternSourceTypeEnum,
  sourceMaterialId: z.string().uuid().nullable(),
  structure: PaperPatternStructureSchema.nullable(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid().nullable(),
  validatedAt: z.string().datetime().nullable(),
  approvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PaperPattern = z.infer<typeof PaperPatternSchema>;

export const AnalyzePaperPatternSourceSchema = z.object({
  type: PaperPatternSourceTypeEnum,
  id: z.string().uuid().optional(),
  text: z.string().min(1).max(1_000_000).optional(),
});
export type AnalyzePaperPatternSource = z.infer<typeof AnalyzePaperPatternSourceSchema>;

export const GenerateQuestionsWithBlueprintSchema = z.object({
  blueprintId: z.string().uuid().optional(),
});
export type GenerateQuestionsWithBlueprint = z.infer<typeof GenerateQuestionsWithBlueprintSchema>;
