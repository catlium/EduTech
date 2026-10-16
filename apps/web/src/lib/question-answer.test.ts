import test from 'node:test';
import assert from 'node:assert/strict';

import { hasValidQuestionAnswer } from './question-answer.ts';

test('question answer validity follows the candidate answer format', () => {
  const valid = [
    [
      'MCQ',
      {
        choices: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
        correctChoiceId: 'b',
      },
    ],
    ['TRUE_FALSE', { correctAnswer: false }],
    ['FILL_IN_BLANK', { acceptableAnswers: ['four'] }],
    ['TEXT', { modelAnswer: 'Four' }],
    [
      'MATCHING',
      {
        left: [
          { id: 'l1', text: 'A' },
          { id: 'l2', text: 'B' },
        ],
        right: [
          { id: 'r1', text: '1' },
          { id: 'r2', text: '2' },
        ],
        matches: { l1: 'r2', l2: 'r1' },
      },
    ],
    ['NUMERICAL', { modelAnswer: 0 }],
  ] as const;

  for (const [format, payload] of valid) {
    assert.equal(hasValidQuestionAnswer(format, payload), true, format);
  }

  assert.equal(hasValidQuestionAnswer('MCQ', { choices: [] }), false);
  assert.equal(
    hasValidQuestionAnswer('MCQ', {
      choices: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
      correctChoiceId: 'missing',
    }),
    false,
  );
  assert.equal(
    hasValidQuestionAnswer('MATCHING', {
      left: [
        { id: 'l1', text: 'A' },
        { id: 'l2', text: 'B' },
      ],
      right: [
        { id: 'r1', text: '1' },
        { id: 'r2', text: '2' },
      ],
      matches: { l1: 'r1' },
    }),
    false,
  );
  assert.equal(hasValidQuestionAnswer('FILL_IN_BLANK', { acceptableAnswers: [''] }), false);
  assert.equal(hasValidQuestionAnswer('TEXT', { modelAnswer: '' }), false);
  assert.equal(hasValidQuestionAnswer('NUMERICAL', { modelAnswer: '0' }), false);
  assert.equal(hasValidQuestionAnswer('UNKNOWN', { answer: 'x' }), false);
});
