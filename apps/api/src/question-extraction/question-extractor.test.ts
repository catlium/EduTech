import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractQuestions, type ExtractionSourceBlock } from './question-extractor.ts';

/* ── question-extractor unit tests ────────────────────────────────────
 * Pure node:test. Covers the mandatory extraction semantics from the Phase 47
 * design:
 *   - numbered text questions + answers → TEXT candidates with modelAnswer
 *   - MCQ choice detection incl. "Ans: (b)" → correctChoiceId set
 *   - MCQ without a correct option → payload incomplete + ANSWER_MISSING
 *   - True/False detection
 *   - lettered sub-questions split into per-letter candidates
 *   - marks / difficulty extraction (never invented)
 *   - no markers → no candidates                                     */

function block(id: string, content: string, page = 1): ExtractionSourceBlock {
  return { id, kind: 'paragraph', content, page };
}

describe('text questions', () => {
  it('extracts numbered questions with answers as model answers', () => {
    const { questions } = extractQuestions([
      block(
        'b1',
        [
          'Section A - Short Questions',
          '1. Define photosynthesis. (2)',
          'Ans: The process by which plants make food using sunlight.',
          '2. State Newton\'s first law. (2)',
          'Answer: An object at rest stays at rest unless acted on by a force.',
        ].join('\n'),
      ),
    ]);

    assert.equal(questions.length, 2);
    assert.equal(questions[0].format, 'TEXT');
    assert.equal(questions[0].difficulty, null);
    assert.equal(questions[0].originalMarks, 2);
    assert.equal(questions[0].originalNumber, '1');
    assert.equal(questions[0].section, 'Section A - Short Questions');
    assert.deepEqual(questions[0].payload, {
      modelAnswer:
        'The process by which plants make food using sunlight.',
    });
    assert.ok(!questions[0].stem.includes('Ans:'));
    assert.equal(questions[1].payload.modelAnswer, 'An object at rest stays at rest unless acted on by a force.');
  });

  it('flags a missing answer as ANSWER_MISSING instead of inventing one', () => {
    const { questions } = extractQuestions([block('b1', '1. Explain the water cycle. (5)')]);
    assert.equal(questions.length, 1);
    assert.deepEqual(questions[0].payload, {});
    assert.ok(questions[0].issues.some((i) => i.code === 'ANSWER_MISSING'));
  });
});

describe('MCQ detection', () => {
  const mcqText = [
    '1. Which of the following is a renewable resource?',
    '(a) Coal',
    '(b) Solar energy',
    '(c) Petroleum',
    '(d) Natural gas',
    'Ans: (b)',
  ].join('\n');

  it('builds choices and sets correctChoiceId from Ans: (b)', () => {
    const { questions } = extractQuestions([block('b1', mcqText)]);
    assert.equal(questions.length, 1);
    assert.equal(questions[0].format, 'MCQ');
    const payload = questions[0].payload as {
      choices: Array<{ id: string; label: string; text: string }>;
      correctChoiceId: string;
    };
    assert.equal(payload.choices.length, 4);
    assert.equal(payload.choices[1].text, 'Solar energy');
    const correct = payload.choices.find((c) => c.id === payload.correctChoiceId);
    assert.equal(correct?.label, 'b');
  });

  it('leaves the payload incomplete + ANSWER_MISSING when no correct option is given', () => {
    const { questions } = extractQuestions([block('b1', mcqText.replace('Ans: (b)', ''))]);
    assert.equal(questions[0].format, 'MCQ');
    const payload = questions[0].payload as { choices: unknown[]; correctChoiceId?: string };
    assert.equal(payload.choices.length, 4);
    assert.equal(payload.correctChoiceId, undefined);
    assert.ok(questions[0].issues.some((i) => i.code === 'ANSWER_MISSING'));
  });

  it('keeps the full stem when it merely ends with "correct answer."', () => {
    const { questions } = extractQuestions([
      block(
        'b1',
        [
          '1. Choose the correct answer.',
          '(a) Water boils at 100 C',
          '(b) Water boils at 0 C',
          'Ans: (a)',
        ].join('\n'),
      ),
    ]);
    assert.equal(questions.length, 1);
    assert.equal(questions[0].stem, 'Choose the correct answer.');
    const payload = questions[0].payload as { correctChoiceId?: string };
    assert.ok(payload.correctChoiceId, 'mid-sentence marker must not swallow the answer line');
  });

  it('strips a bare "Ans:" from the stem and flags ANSWER_MISSING', () => {
    const { questions } = extractQuestions([block('b1', '1. Explain osmosis.\nAns:')]);
    assert.equal(questions.length, 1);
    assert.ok(!questions[0].stem.includes('Ans:'));
    assert.deepEqual(questions[0].payload, {});
    assert.ok(questions[0].issues.some((i) => i.code === 'ANSWER_MISSING'));
  });

  it('does not treat a mid-stem sentence as an answer line', () => {
    const { questions } = extractQuestions([
      block('b1', '1. The correct answer is written in the book.\nAnswer: It is in chapter 3.'),
    ]);
    assert.equal(questions[0].stem, 'The correct answer is written in the book.');
    assert.equal(questions[0].payload['modelAnswer'], 'It is in chapter 3.');
  });
});

describe('true/false', () => {
  it('detects TRUE_FALSE and the correct answer', () => {
    const { questions } = extractQuestions([
      block(
        'b1',
        ['1. State whether true or false: The sun rises in the east.', 'Answer: True'].join('\n'),
      ),
    ]);
    assert.equal(questions[0].format, 'TRUE_FALSE');
    assert.deepEqual(questions[0].payload, { correctAnswer: true });
  });
});

describe('sub-questions', () => {
  it('splits lettered sub-questions under a numbered parent', () => {
    const { questions } = extractQuestions([
      block(
        'b1',
        [
          '1. Attempt any two:',
          '(a) What is a force? (2)',
          '(b) Define momentum. (2)',
          '(c) State the law of conservation of momentum. (2)',
        ].join('\n'),
      ),
    ]);

    assert.equal(questions.length, 3);
    assert.equal(questions[0].originalNumber, '1(a)');
    assert.equal(questions[0].stem, 'What is a force? (2)');
    assert.equal(questions[1].originalNumber, '1(b)');
    assert.equal(questions[2].originalNumber, '1(c)');
    assert.equal(questions[0].originalMarks, 2);
  });

  it('emits a top-level lettered list as separate candidates', () => {
    const { questions } = extractQuestions([
      block(
        'b1',
        [
          '(a) What is photosynthesis? (2)',
          '(b) Define chlorophyll. (2)',
        ].join('\n'),
      ),
    ]);

    assert.equal(questions.length, 2);
    assert.equal(questions[0].originalNumber, 'a');
    assert.equal(questions[1].originalNumber, 'b');
  });
});

describe('difficulty', () => {
  it('extracts explicit difficulty and never derives one', () => {
    const hard = extractQuestions([block('b1', '1. Explain relativity. (Hard) (5)')]);
    assert.equal(hard.questions[0]!.difficulty, 'HARD');
    const clean = extractQuestions([block('b1', '1. Explain relativity. (5)')]);
    assert.equal(clean.questions[0]!.difficulty, null);
  });
});

describe('empty material', () => {
  it('produces no candidates for content without markers', () => {
    const { questions } = extractQuestions([block('b1', ['Preface', 'by the author'].join('\n'))]);
    assert.equal(questions.length, 0);
  });
});