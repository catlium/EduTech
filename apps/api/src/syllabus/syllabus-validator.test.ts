// SyllabusValidator unit tests — deterministic fixtures, no NestJS bootstrap,
// no database. The validator is the exact gate confirm/update run against a
// syllabus structure, so rejecting chapter-only structures here is the API's
// 400 contract for F4.
// Run: node --test apps/api/src/syllabus/syllabus-validator.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BadRequestException } from '@nestjs/common';
import { SyllabusStructureSchema } from '@catlium/contracts';
import { SyllabusValidator } from './syllabus.validation.ts';

const VALID_STRUCTURE = {
  chapters: [
    {
      name: 'Introduction',
      description: 'First chapter',
      topics: [{ name: 'Fundamentals' }],
    },
  ],
};

test('valid Chapter -> Topic structure parses through the validator', () => {
  const parsed = SyllabusValidator.parseStructure(VALID_STRUCTURE);
  assert.equal(parsed.chapters.length, 1);
  assert.deepEqual(
    parsed.chapters[0]!.topics.map((t) => t.name),
    ['Fundamentals'],
  );
});

test('chapter with topics: [] is rejected with a 400-style BadRequestException', () => {
  assert.throws(
    () =>
      SyllabusValidator.parseStructure({
        chapters: [{ name: 'Introduction', topics: [] }],
      }),
    (err: unknown) =>
      err instanceof BadRequestException && err.message === 'Invalid syllabus structure',
  );
});

test('contract schema rejects a chapter with topics: []', () => {
  const result = SyllabusStructureSchema.safeParse({
    chapters: [{ name: 'Introduction', topics: [] }],
  });
  assert.equal(result.success, false);
});

test('contract schema accepts a chapter with at least one topic', () => {
  assert.equal(SyllabusStructureSchema.safeParse(VALID_STRUCTURE).success, true);
});