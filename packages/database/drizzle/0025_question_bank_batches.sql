DROP INDEX "jobs_active_generation_unique";
--> statement-breakpoint
-- Question-bank generation (Goal E): one AI_GENERATE_QUESTIONS job per
-- (source, questionType, difficulty) shares a batchId, so multiple children
-- of the same batch must coexist for the same source. The dedupKey column
-- (a per-child slot `qbank:<batchId>:<type>:<diff>:<sub>`) extends the active-
-- generation uniqueness so parallel per-type jobs for one source are allowed
-- while the same child slot can never be enqueued twice. Legacy jobs without
-- a dedupKey keep the historic (institute, operation, source) dedupe via the
-- COALESCE default.
CREATE UNIQUE INDEX "jobs_active_generation_unique" ON "jobs" USING btree ("institute_id",((payload -> 'operation')),((payload -> 'source' ->> 'type')),((payload -> 'source' ->> 'id')),(COALESCE((payload -> 'params' ->> 'dedupKey'), ''))) WHERE type IN ('AI_GENERATE_NOTE', 'AI_GENERATE_SUMMARY', 'AI_GENERATE_FLASHCARDS', 'AI_GENERATE_CONCEPTS', 'AI_GENERATE_CONTENT_PACKAGE', 'AI_GENERATE_QUESTIONS', 'AI_GENERATE_BLUEPRINT', 'AI_GENERATE_STARTER_MATERIAL', 'AI_ANALYZE_SYLLABUS') AND status IN ('queued', 'processing');