import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scopeCoversRow } from './scope-resolver.ts';

const row = (subjectId: string | null, chapterId: string | null, topicId: string | null) => ({
  subjectId,
  chapterId,
  topicId,
});

test('most specific scope level wins: topic', () => {
  const scope = { subjectId: 's1', chapterId: 'c1', topicId: 't1' };
  assert.equal(scopeCoversRow(scope, row('s1', 'c1', 't1')), true);
  assert.equal(scopeCoversRow(scope, row('s1', 'c1', 't2')), false);
  assert.equal(scopeCoversRow(scope, row('s1', 'c2', null)), false);
});

test('chapter scope also covers its topic-level questions', () => {
  const scope = { subjectId: 's1', chapterId: 'c1' };
  assert.equal(scopeCoversRow(scope, row('s1', 'c1', 't1')), true);
  assert.equal(scopeCoversRow(scope, row('s1', 'c1', null)), true);
  assert.equal(scopeCoversRow(scope, row('s1', 'c2', 't9')), false);
});

test('subject scope covers every chapter/topic question within it', () => {
  const scope = { subjectId: 's1' };
  assert.equal(scopeCoversRow(scope, row('s1', null, null)), true);
  assert.equal(scopeCoversRow(scope, row('s1', 'c1', 't1')), true);
  assert.equal(scopeCoversRow(scope, row('s2', 'c1', 't1')), false);
  assert.equal(scopeCoversRow(scope, row(null, null, null)), false);
});

test('null scope never matches, and a null-subject scope matches nothing', () => {
  assert.equal(scopeCoversRow({ subjectId: null }, row('s1', null, null)), false);
  assert.equal(scopeCoversRow({}, row(null, null, null)), false);
});
