// Paper Pattern ↔ Subject association helper tests — deterministic, no AI, no
// NestJS, no database. Run:
//   node --test apps/api/src/paper-patterns/paper-pattern-subjects.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSubjectIds,
  dedupeSubjectIds,
  foreignSubjectIds,
} from './paper-pattern-subjects.ts';

test('General pattern: no subjects builds an empty set', () => {
  assert.deepEqual(buildSubjectIds(undefined, undefined), []);
  assert.deepEqual(buildSubjectIds([], undefined), []);
});

test('single-subject pattern maps to exactly one subject id', () => {
  assert.deepEqual(buildSubjectIds(['s1'], undefined), ['s1']);
});

test('multi-subject pattern keeps all subject ids', () => {
  assert.deepEqual(buildSubjectIds(['s1', 's2', 's3'], undefined), ['s1', 's2', 's3']);
});

test('duplicate associations are deduplicated (junction unique protection)', () => {
  assert.deepEqual(dedupeSubjectIds(['s1', 's1', 's2']), ['s1', 's2']);
  assert.deepEqual(buildSubjectIds(['s1', 's1'], undefined), ['s1']);
});

test('legacy single subjectId alias maps onto the subject set', () => {
  assert.deepEqual(buildSubjectIds(undefined, 'legacy'), ['legacy']);
  // Explicit subjectIds wins over the legacy alias.
  assert.deepEqual(buildSubjectIds(['s1'], 'legacy'), ['s1']);
});

test('cross-institute associations are surfaced by foreign-subject check', () => {
  const owned = new Set(['s1', 's2']);
  assert.deepEqual(foreignSubjectIds(['s1', 's9'], owned), ['s9']);
  assert.deepEqual(foreignSubjectIds(['s1', 's2'], owned), []);
  // A General pattern requests nothing, so nothing is foreign.
  assert.deepEqual(foreignSubjectIds([], owned), []);
});
