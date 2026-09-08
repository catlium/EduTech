import { BadRequestException } from '@nestjs/common';

interface GradedAnswer {
  isCorrect: boolean;
  correctAnswer: Record<string, unknown>;
}

function isUuid(v: unknown): boolean {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
}

function normalizeBlank(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Deterministic, server-side grading of one snapshotted question. Pure —
 * never throws for well-formed stored data; the snapshot payload and the
 * saved answer were already validated at write time.
 */
export function gradeAnswer(questionType: string, payload: unknown, answer: unknown): GradedAnswer {
  const a = (answer ?? {}) as Record<string, unknown>;
  if (questionType === 'MCQ') {
    const correctChoiceId = (payload as { correctChoiceId?: string })['correctChoiceId'];
    const choiceId = a['choiceId'];
    return { isCorrect: isUuid(choiceId) && choiceId === correctChoiceId, correctAnswer: { choiceId: correctChoiceId } };
  }
  if (questionType === 'TRUE_FALSE') {
    const correctValue = (payload as { correctAnswer?: boolean })['correctAnswer'];
    return {
      isCorrect: typeof a['value'] === 'boolean' && a['value'] === correctValue,
      correctAnswer: { value: correctValue },
    };
  }
  if (questionType === 'FILL_IN_BLANK') {
    const acceptable = ((payload as { acceptableAnswers?: unknown })['acceptableAnswers'] ?? []) as unknown[];
    const correctValue = acceptable.length > 0 ? acceptable[0] : '';
    return {
      isCorrect: normalizeBlank(a['value']) !== '' && acceptable.some((x) => normalizeBlank(x) === normalizeBlank(a['value'])),
      correctAnswer: { value: correctValue },
    };
  }
  throw new BadRequestException(`Unsupported question type: ${questionType}`);
}