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
 * never throws; dispatch is by answer format, so a custom question type that
 * reuses a known format (or an unknown future format) grades without a 400.
 * Subjective/text answers are not auto-graded → isCorrect=false, marks 0.
 *
 * `answerFormat` is the persisted answer format on the question row (set from
 * the question-type definition at write time). Legacy rows predating that
 * column fall back to questionType.toUpperCase() — the predefined types'
 * codes match their formats 1:1.
 */
export function gradeAnswer(
  questionType: string,
  payload: unknown,
  answer: unknown,
  answerFormat?: string | null,
): GradedAnswer {
  const a = (answer ?? {}) as Record<string, unknown>;
  const fmt = (answerFormat ?? questionType).toUpperCase();
  if (fmt === 'MCQ') {
    const correctChoiceId = (payload as { correctChoiceId?: string })['correctChoiceId'];
    const choiceId = a['choiceId'];
    return { isCorrect: isUuid(choiceId) && choiceId === correctChoiceId, correctAnswer: { choiceId: correctChoiceId } };
  }
  if (fmt === 'TRUE_FALSE') {
    const correctValue = (payload as { correctAnswer?: boolean })['correctAnswer'];
    return {
      isCorrect: typeof a['value'] === 'boolean' && a['value'] === correctValue,
      correctAnswer: { value: correctValue },
    };
  }
  if (fmt === 'FILL_IN_BLANK') {
    const acceptable = ((payload as { acceptableAnswers?: unknown })['acceptableAnswers'] ?? []) as unknown[];
    const correctValue = acceptable.length > 0 ? acceptable[0] : '';
    return {
      isCorrect: normalizeBlank(a['value']) !== '' && acceptable.some((x) => normalizeBlank(x) === normalizeBlank(a['value'])),
      correctAnswer: { value: correctValue },
    };
  }
  if (fmt === 'NUMERICAL') {
    const model = (payload as { modelAnswer?: number })['modelAnswer'];
    const tolerance = (payload as { tolerance?: number })['tolerance'] ?? 0;
    const attempted = typeof a['value'] === 'number' ? a['value'] : parseFloat(String(a['value']));
    const correctValue = typeof model === 'number' ? model : NaN;
    const isCorrect =
      typeof correctValue === 'number' &&
      Number.isFinite(correctValue) &&
      typeof attempted === 'number' &&
      Number.isFinite(attempted) &&
      Math.abs(attempted - correctValue) <= tolerance;
    return { isCorrect, correctAnswer: { value: correctValue, tolerance } };
  }
  if (fmt === 'MATCHING') {
    const correct = (payload as { matches?: Record<string, string> })['matches'] ?? {};
    const attempted = (a['matches'] ?? {}) as Record<string, string>;
    const correctKeys = Object.keys(correct);
    const attemptedKeys = Object.keys(attempted);
    const isCorrect =
      correctKeys.every((k) => attempted[k] !== undefined && attempted[k] === correct[k]) &&
      attemptedKeys.every((k) => correct[k] !== undefined);
    return { isCorrect, correctAnswer: { matches: correct } };
  }
  // TEXT and any unknown/custom format: not auto-graded.
  const modelAnswer = (payload as { modelAnswer?: string })['modelAnswer'] ?? '';
  return { isCorrect: false, correctAnswer: { modelAnswer: String(modelAnswer) } };
}