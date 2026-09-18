-- Paper Pattern Extraction (Phase B): patterns derived deterministically from
-- an existing material keep their extraction metadata on the pattern row so
-- review issues, source provenance and the sourcing material/revision survive
-- with the pattern. status REVIEW + source_type PREVIOUS_YEAR_PAPER mark these
-- patterns; an empty/null extraction keeps builder workflows untouched.
--> statement-breakpoint
ALTER TABLE "paper_patterns" ADD COLUMN "extraction" jsonb;