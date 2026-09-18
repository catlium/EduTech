import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractPaperPattern, type ExtractionBlock } from './pattern-extractor.ts';
import { validatePaperPatternStructure } from './paper-patterns.validation.ts';

/* ── pattern-extractor unit tests ────────────────────────────────────
 * Pure node:test. Covers every mandatory scenario from the design:
 *   - section extraction (basic)
 *   - multiple question types per section (type-change splitting)
 *   - attempt N of M attached to question-type rule level
 *   - marks/count + totalMarks header
 *   - missing totals → null + issues (not hard failure)
 *   - difficulty never derived (null)
 *   - provenance blockIds/pages present per rule
 *   - structure passes validatePaperPatternStructure (full fixture)
 *   - structure null when no sections/questions exist                */

function block(id: string, content: string, page = 1): ExtractionBlock {
  return { id, kind: 'paragraph', content, page };
}

describe('basic section extraction', () => {
  it('extracts named sections from section headings', () => {
    const result = extractPaperPattern([
      block(
        'b1',
        [
          'Maximum Marks: 100',
          'Time: 3 Hrs',
          '',
          'Section A',
          '1. What is photosynthesis? (2 marks)',
          '2. Define ecosystem. (2 marks)',
          '',
          'Section B',
          '3. Describe the water cycle. (5 marks)',
          '4. Explain the carbon cycle. (5 marks)',
        ].join('\n'),
      ),
    ]);

    assert.ok(result.structure !== null, 'should produce a structure');
    assert.equal(result.structure!.sections.length, 2);
    assert.equal(result.structure!.sections[0].name, 'Section A');
    assert.equal(result.structure!.sections[1].name, 'Section B');
    // Header says 100 but sections scorable-total 14 (conflict) → scorable
    // total is kept so the structure validates; mismatch surfaces as an issue.
    assert.equal(result.structure!.totalMarks, 14);
    assert.equal(result.structure!.durationMinutes, 180);
    assert.equal(result.structure!.sections[0].questionTypes.length, 1);
    assert.equal(result.structure!.sections[0].questionTypes[0].count, 2);
    assert.ok(result.issues.some((i) => i.code === 'INCONSISTENT_MARKS'));
  });
});

describe('type-change splitting', () => {
  it('splits a section into separate rules when type changes mid-section', () => {
    const result = extractPaperPattern([
      block(
        'b1',
        [
          'Section A',
          'Multiple Choice Questions (MCQ)',
          '1. Identify the correct option. (1 mark)',
          '2. Pick the odd one out. (1 mark)',
          'True or False',
          '3. The sun rises in the east. (1 mark)',
          '4. Photosynthesis requires sunlight. (1 mark)',
        ].join('\n'),
      ),
    ]);

    assert.ok(result.structure !== null);
    const rules = result.structure!.sections[0].questionTypes;
    assert.equal(rules.length, 2, 'should have 2 rules (MCQ + TF)');
    assert.equal(rules[0].questionType, 'MCQ');
    assert.equal(rules[0].count, 2);
    assert.equal(rules[1].questionType, 'TRUE_FALSE');
    assert.equal(rules[1].count, 2);
  });
});

describe('attempt N of M at rule level', () => {
  it('attaches attempt to the rule via section-level statement', () => {
    const result = extractPaperPattern([
      block(
        'b1',
        [
          'Section B — Short Answer',
          'Attempt any 3 of the following 5 questions:',
          '6. What is biodiversity? (3 marks)',
          '7. Define habitat. (3 marks)',
          '8. Explain conservation. (3 marks)',
          '9. What is endangered? (3 marks)',
          '10. Describe migration. (3 marks)',
        ].join('\n'),
      ),
    ]);

    assert.ok(result.structure !== null);
    const rule = result.structure!.sections[0].questionTypes[0];
    assert.equal(rule.compulsory, false);
    assert.equal(rule.attemptCount, 3);
    assert.equal(rule.count, 5);
    assert.equal(rule.totalMarks, 9, 'scorable total = 3 × 3');
  });

  it('converts attempt count ≥ count into compulsory', () => {
    const result = extractPaperPattern([
      block(
        'b1',
        [
          'Section C',
          'Attempt any 4 of the following 4 questions:',
          '11. Q? (4 marks)',
          '12. Q? (4 marks)',
          '13. Q? (4 marks)',
          '14. Q? (4 marks)',
        ].join('\n'),
      ),
    ]);

    assert.ok(result.structure !== null);
    const rule = result.structure!.sections[0].questionTypes[0];
    assert.equal(rule.compulsory, true);
    assert.equal(rule.attemptCount, null, 'attemptCount drops when ≥ count');
    assert.equal(rule.totalMarks, 16, '4 × 4 = 16');
  });
});

describe('marks extraction', () => {
  it('uses "each question carries N marks" as default marks', () => {
    const result = extractPaperPattern([
      block(
        'b1',
        [
          'Section A',
          'Each question carries 2 marks:',
          '1. Name the parts of a flower.',
          '2. Define pollination.',
        ].join('\n'),
      ),
    ]);

    assert.ok(result.structure !== null);
    const rule = result.structure!.sections[0].questionTypes[0];
    assert.equal(rule.marksPerQuestion, 2);
    assert.equal(rule.count, 2);
    assert.equal(rule.totalMarks, 4);
  });

  it('uses explicit "(N marks)" on each item line', () => {
    const result = extractPaperPattern([
      block('b1', ['Section A', '1. Q? (3 marks)', '2. Q? (3 marks)'].join('\n')),
    ]);

    assert.ok(result.structure !== null);
    assert.equal(result.structure!.sections[0].questionTypes[0].marksPerQuestion, 3);
    assert.equal(result.structure!.sections[0].questionTypes[0].totalMarks, 6);
  });

  it('sets null marks when items have inconsistent marks', () => {
    const result = extractPaperPattern([
      block('b1', ['Section A', '1. Q? (2 marks)', '2. Q? (5 marks)'].join('\n')),
    ]);

    assert.ok(result.structure !== null);
    assert.equal(result.structure!.sections[0].questionTypes[0].marksPerQuestion, null);
    const codes = result.issues.map((i) => i.code);
    assert.ok(codes.includes('INCONSISTENT_MARKS'));
  });
});

describe('null totals + issues (not hard failure)', () => {
  it('keeps duration null with DURATION_UNKNOWN when no time stated', () => {
    const result = extractPaperPattern([
      block('b1', ['Maximum Marks: 100', 'Section A', '1. Q? (1 mark)'].join('\n')),
    ]);

    assert.ok(result.structure !== null);
    assert.equal(result.structure!.durationMinutes, null);
    assert.equal(result.durationMinutesSource, 'UNKNOWN');
    assert.ok(result.issues.some((i) => i.code === 'DURATION_UNKNOWN'));
  });

  it('keeps totalMarks null with TOTAL_MARKS_UNKNOWN when neither header nor sum known', () => {
    const result = extractPaperPattern([
      block('b1', ['Time: 3 Hrs', 'Section A', '1. Q? (1 mark)', '2. Q?'].join('\n')),
    ]);

    assert.ok(result.structure !== null);
    assert.equal(result.structure!.totalMarks, null);
    assert.ok(result.issues.some((i) => i.code === 'TOTAL_MARKS_UNKNOWN'));
  });

  it('sums computable rule totals when no header is present', () => {
    const result = extractPaperPattern([
      block(
        'b1',
        ['Time: 2 Hrs 30 Minutes', 'Section A', '1. Q? (1 mark)', '2. Q? (1 mark)'].join('\n'),
      ),
    ]);

    assert.ok(result.structure !== null);
    assert.equal(result.structure!.totalMarks, 2, 'SECTION_SUM from 2 × 1');
    assert.equal(result.totalMarksSource, 'SECTION_SUM');
    assert.equal(result.structure!.durationMinutes, 150);
  });
});

describe('difficulty / topic never derived', () => {
  it('difficultyDistribution and topicDistribution are always null', () => {
    const result = extractPaperPattern([
      block(
        'b1',
        ['Section A', '1. Easy question. (1 mark)', '2. Hard question. (1 mark)'].join('\n'),
      ),
    ]);

    assert.ok(result.structure !== null);
    for (const rule of result.structure!.sections[0].questionTypes) {
      assert.equal(rule.difficultyDistribution, null);
      assert.equal(rule.topicDistribution, null);
    }
  });
});

describe('provenance', () => {
  it('each rule has blockIds and pages in provenance', () => {
    const result = extractPaperPattern([
      block('b1', ['Maximum Marks: 100', 'Section A', '1. Q? (2 marks)'].join('\n'), 3),
    ]);

    assert.ok(result.structure !== null);
    assert.equal(result.provenance.length, 1);
    const p = result.provenance[0];
    assert.ok(p.blockIds.length > 0);
    assert.ok(p.pages.includes(3));
    assert.equal(typeof p.sectionId, 'string');
    assert.equal(typeof p.ruleId, 'string');
  });
});

describe('full fixture validation', () => {
  it('produces a structure that passes validation (approve-safe)', () => {
    const mcqs = Array.from({ length: 20 }, (_, i) => `${i + 1}. MCQ? (1 mark)`).join('\n');
    const sas = Array.from({ length: 8 }, (_, i) => `${i + 21}. SA? (4 marks)`).join('\n');
    const result = extractPaperPattern([
      block(
        'b1',
        [
          'Maximum Marks: 40',
          'Time: 3 Hours',
          '',
          'Section A — MCQ',
          mcqs,
          '',
          'Section B — Short Answer',
          'Attempt any 5 of the following 8 questions:',
          sas,
        ].join('\n'),
      ),
    ]);

    assert.ok(result.structure !== null, 'should produce a structure');
    const errors = validatePaperPatternStructure(result.structure!);
    assert.equal(errors.length, 0, `validation errors: ${errors.join('; ')}`);
    assert.equal(result.structure!.totalMarks, 40);
    assert.equal(result.structure!.durationMinutes, 180);
    assert.equal(result.structure!.sections.length, 2);

    const mcq = result.structure!.sections[0].questionTypes[0];
    assert.equal(mcq.compulsory, true);
    assert.equal(mcq.count, 20);
    assert.equal(mcq.marksPerQuestion, 1);
    assert.equal(mcq.totalMarks, 20);

    const sa = result.structure!.sections[1].questionTypes[0];
    assert.equal(sa.compulsory, false);
    assert.equal(sa.attemptCount, 5);
    assert.equal(sa.count, 8);
    assert.equal(sa.marksPerQuestion, 4);
    assert.equal(sa.totalMarks, 20);
  });

  it('does not report ATTEMPT_POLICY_UNKNOWN for silent sections or one attempt phrase', () => {
    const result = extractPaperPattern([
      block(
        'b1',
        [
          'Maximum Marks: 40',
          'Section A',
          Array.from({ length: 20 }, (_, i) => `${i + 1}. Q? (1 mark)`).join('\n'),
          '',
          'Section B',
          'Attempt any 5 of the following 8 questions:',
          Array.from({ length: 8 }, (_, i) => `${i + 21}. Q? (4 marks)`).join('\n'),
        ].join('\n'),
      ),
    ]);

    assert.ok(result.structure !== null);
    assert.ok(!result.issues.some((i) => i.code === 'ATTEMPT_POLICY_UNKNOWN'));
  });

  it('flags ATTEMPT_POLICY_UNKNOWN when a section mixes conflicting attempt signals', () => {
    const result = extractPaperPattern([
      block(
        'b1',
        [
          'Section A',
          'Attempt any 2 of the following 5 questions:',
          '1. Q? (1 mark)',
          '2. Q? (1 mark)',
          '3. Q? (1 mark)',
          '4. Q? (1 mark)',
          '5. Q? (1 mark) (Attempt any 3 of the following 5 questions)',
        ].join('\n'),
      ),
    ]);

    assert.ok(result.structure !== null);
    assert.ok(result.issues.some((i) => i.code === 'ATTEMPT_POLICY_UNKNOWN'));
  });
});

describe('null structure for empty material', () => {
  it('returns null structure with NO_QUESTIONS_FOUND issue', () => {
    const result = extractPaperPattern([
      block('b1', 'This is just some random text about history.'),
    ]);
    assert.equal(result.structure, null);
    assert.ok(result.issues.some((i) => i.code === 'NO_QUESTIONS_FOUND'));
  });
});
