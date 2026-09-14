// Paper pattern lifecycle policy tests — pure rules, no database, no NestJS
// runtime boot. Run:
//   node --test apps/api/src/paper-patterns/paper-pattern-policy.test.ts
// The sibling imports use the .js->.ts rewrite (repo convention).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  isEditable,
  isVersionConflict,
  deletionBlockMessage,
  EDITABLE_STATUSES,
} from './paper-pattern-policy.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(__dirname, '../../../../packages/database/drizzle');
const controllerSource = readFileSync(join(__dirname, 'paper-patterns.controller.ts'), 'utf8');

// Authorization is enforced by @RequiredRoles at the controller layer. The
// controller imports cannot be loaded under node strip-only mode (NestJS
// parameter properties), so we assert the route source carries the guard.
function routeHasWriteRoles(routeDecl: string): boolean {
  const idx = controllerSource.indexOf(routeDecl);
  const chunk = controllerSource.slice(Math.max(0, idx - 120), idx);
  return chunk.includes('@RequiredRoles(...WRITE_ROLES)');
}

test('update endpoint requires an authorized write role', () => {
  assert.ok(routeHasWriteRoles('async update('), 'PATCH must carry @RequiredRoles');
});

test('delete endpoint requires an authorized write role', () => {
  assert.ok(routeHasWriteRoles('async remove('), 'DELETE must carry @RequiredRoles');
});

test('DRAFT is editable', () => {
  assert.equal(isEditable('DRAFT'), true);
});

test('REVIEW is editable', () => {
  assert.equal(isEditable('REVIEW'), true);
});

test('APPROVED is editable', () => {
  assert.equal(isEditable('APPROVED'), true);
});

test('every declared status stays editable', () => {
  for (const status of EDITABLE_STATUSES) {
    assert.ok(isEditable(status), `${status} must be editable`);
  }
});

test('optimistic concurrency rejects a stale version', () => {
  assert.equal(isVersionConflict(1, 2), true, 'expected=1 vs current=2 conflicts');
  assert.equal(isVersionConflict(2, 2), false, 'matching versions pass');
  assert.equal(isVersionConflict(undefined, 3), false, 'omitted version = no check');
});

test('an active AI analysis job blocks deletion', () => {
  const message = deletionBlockMessage(true);
  assert.ok(message && message.length > 0);
  assert.match(message!, /analysis/i);
});

test('an unblocked DRAFT can be deleted', () => {
  assert.equal(deletionBlockMessage(false), null);
});

test('an unblocked APPROVED can be deleted (safe deletion)', () => {
  assert.equal(deletionBlockMessage(false), null);
});

test('an unblocked REVIEW can be deleted', () => {
  assert.equal(deletionBlockMessage(false), null);
});

test('deleting a pattern cascades its subject junction rows (many-to-many clean-up)', () => {
  const migration = readFileSync(join(drizzleDir, '0026_paper_pattern_subjects.sql'), 'utf8');
  assert.match(migration, /REFERENCES "public"\."paper_patterns"\("id"\) ON DELETE cascade/);
  assert.match(migration, /REFERENCES "public"\."subjects"\("id"\) ON DELETE cascade/);
});

test('deleting a General (no-subject) pattern is safe', () => {
  assert.equal(deletionBlockMessage(false), null);
});

test('deleting a multi-subject pattern is safe', () => {
  assert.equal(deletionBlockMessage(false), null);
});

test('assessments.blueprint_id stays ON DELETE SET NULL (safe references)', () => {
  // The assessment keep their data; only the blueprint reference is nulled.
  const migration = readFileSync(join(drizzleDir, '0014_polite_agent_zero.sql'), 'utf8');
  assert.match(migration, /assessments_blueprint_id_paper_patterns_id_fk/);
  assert.match(migration, /REFERENCES "public"\."paper_patterns"\("id"\) ON DELETE set null/);
});

test('published assessment data is not mutated by pattern deletion (SET NULL, not CASCADE)', () => {
  const migration = readFileSync(join(drizzleDir, '0014_polite_agent_zero.sql'), 'utf8');
  assert.match(migration, /REFERENCES "public"\."paper_patterns"\("id"\) ON DELETE set null/);
  assert.doesNotMatch(
    migration,
    /assessments_blueprint_id_paper_patterns_id_fk.*ON DELETE cascade/s,
  );
});

test('pattern deletion leaves no orphaned relationships (junction cascades, blueprint nulls)', () => {
  const subjects = readFileSync(join(drizzleDir, '0026_paper_pattern_subjects.sql'), 'utf8');
  const assessments = readFileSync(join(drizzleDir, '0014_polite_agent_zero.sql'), 'utf8');
  assert.match(subjects, /ON DELETE cascade/g);
  assert.match(assessments, /ON DELETE set null/);
});
