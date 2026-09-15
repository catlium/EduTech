-- Paper-pattern section a linked question belongs to. Rows added before the
-- pattern workflow landed default to 'General'; pattern-driven assessments
-- store the section name so the paper preview/export can group by section.
ALTER TABLE "assessment_questions" ADD COLUMN "section" varchar(100) DEFAULT 'General' NOT NULL;