import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canUse, canUseAny } from './permissions.ts';

const TEACHER_GRANTS = [
  'subjects.read',
  'subjects.create',
  'chapters.read',
  'questions.manage',
  'question-types.read',
  'attempts.read',
];

test('exact grant matches', () => {
  assert.equal(canUse(TEACHER_GRANTS, 'subjects.read'), true);
  assert.equal(canUse(TEACHER_GRANTS, 'chapters.read'), true);
});

test('absent key is denied without manage implication', () => {
  assert.equal(canUse(TEACHER_GRANTS, 'subjects.delete'), false);
  assert.equal(canUse(TEACHER_GRANTS, 'content.read'), false);
});

test('manage implies every other action of its resource', () => {
  assert.equal(canUse(TEACHER_GRANTS, 'questions.read'), true);
  assert.equal(canUse(TEACHER_GRANTS, 'questions.create'), true);
  assert.equal(canUse(TEACHER_GRANTS, 'questions.update'), true);
  assert.equal(canUse(TEACHER_GRANTS, 'questions.delete'), true);
  assert.equal(canUse(TEACHER_GRANTS, 'questions.manage'), true);
});

test('manage can never be implied by a narrower grant', () => {
  assert.equal(canUse(TEACHER_GRANTS, 'subjects.manage'), false);
});

test('unsupported / shapeless keys are default-deny', () => {
  assert.equal(canUse(TEACHER_GRANTS, 'not-a-key'), false);
  assert.equal(canUse(TEACHER_GRANTS, 'questions.own'), false);
  assert.equal(canUse(TEACHER_GRANTS, 'QUESTIONS.READ'), false);
  assert.equal(canUse(TEACHER_GRANTS, 'questions.cheatday'), false);
  assert.equal(canUse(TEACHER_GRANTS, ''), false);
});

test('canUseAny is true when any one key is usable', () => {
  assert.equal(canUseAny(TEACHER_GRANTS, ['content.read', 'questions.update']), true);
  assert.equal(canUseAny(TEACHER_GRANTS, ['content.read', 'attempts.create']), false);
});

test('hyphenated resource keys keep manage implication (question-types.manage → read)', () => {
  assert.equal(canUse(TEACHER_GRANTS, 'question-types.read'), true);
});