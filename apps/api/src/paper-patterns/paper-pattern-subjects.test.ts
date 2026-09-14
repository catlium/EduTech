// Paper Pattern ↔ Subject association helper tests — deterministic, no AI, no
// NestJS, no database. Run:
//   node --test apps/api/src/paper-patterns/paper-pattern-subjects.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSubjectIds,
  dedupeSubjectIds,
  foreignSubjectIds,
  patternMatchesSubject,
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

test('a pattern can be shared across multiple subjects', () => {
  const ids = ['s1', 's2'];
  assert.ok(patternMatchesSubject(ids, 's1'));
  assert.ok(patternMatchesSubject(ids, 's2'));
});

test('one subject can belong to multiple patterns (no constraint blocks it)', () => {
  const patternA = buildSubjectIds(['s1'], undefined);
  const patternB = buildSubjectIds(['s1', 's2'], undefined);
  assert.ok(patternMatchesSubject(patternA, 's1'));
  assert.ok(patternMatchesSubject(patternB, 's1'));
});

test('removing all subjects converts the pattern to General', () => {
  const fromMulti = dedupeSubjectIds([]);
  assert.deepEqual(fromMulti, []);
  assert.ok(patternMatchesSubject(fromMulti, 'any-subject'));
});

test('General patterns match any scope subject; scoped patterns only their own', () => {
  // General (zero subjects): fully reusable.
  assert.ok(patternMatchesSubject([], 'anything'));
  // Scoped: only associated subjects match.
  assert.ok(patternMatchesSubject(['s1'], 's1'));
  assert.ok(!patternMatchesSubject(['s1'], 's2'));
  assert.ok(!patternMatchesSubject(['s1', 's2'], 's3'));
});

test('cross-institute associations are surfaced by foreign-subject check', () => {
  const owned = new Set(['s1', 's2']);
  assert.deepEqual(foreignSubjectIds(['s1', 's9'], owned), ['s9']);
  assert.deepEqual(foreignSubjectIds(['s1', 's2'], owned), []);
  // A General pattern requests nothing, so nothing is foreign.
  assert.deepEqual(foreignSubjectIds([], owned), []);
});
