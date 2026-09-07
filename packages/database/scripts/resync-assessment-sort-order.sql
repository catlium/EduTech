-- ============================================================================
-- resync-assessment-sort-order.sql
-- DATA REPAIR ONLY — no schema DDL (Phase 8 schema-gate: migrations forbidden
-- here; drizzle migration 0008 stays untouched).
--
-- Purpose: repair duplicate/invalid sort_order values on assessment_questions
-- for the two assessments identified in WR-04 (08-VERIFICATION.md gap 4).
-- Each row is renumbered deterministically per assessment to 1..n by
-- (sort_order, id). Re-running re-numbers identically (idempotent by
-- construction) — safe to apply repeatedly.
--
-- Source: .planning/phases/08-quiz-examination-management/08-VERIFICATION.md
--   gap 4 — assessments where append-time sortOrder = i + 1 (no max offset)
--   produced duplicate sort_order=1 rows:
--     1db88ee9-dded-497a-b434-94225679d1ad
--     c561fdf0-563e-44b1-a638-1a6327a76b91
--
-- Expected post-state: the global duplicate-group query
--   SELECT assessment_id, sort_order, count(*) FROM assessment_questions
--   WHERE assessment_id IN (the 2 ids)
--   GROUP BY assessment_id, sort_order HAVING count(*) > 1;
-- returns 0 rows, and each assessment is contiguous 1..n
-- (max(sort_order) = count(*) = count(DISTINCT sort_order)).
-- ============================================================================

BEGIN;

UPDATE assessment_questions AS aq
SET sort_order = rn
FROM (
  SELECT
    id,
    row_number() OVER (PARTITION BY assessment_id ORDER BY sort_order, id) AS rn
  FROM assessment_questions
  WHERE assessment_id IN (
    '1db88ee9-dded-497a-b434-94225679d1ad',
    'c561fdf0-563e-44b1-a638-1a6327a76b91'
  )
) AS r
WHERE aq.id = r.id;

COMMIT;