import { FormatPayloadSchemas } from '@catlium/contracts';

export function isSupportedQuestionAnswerFormat(
  answerFormat: string | null | undefined,
): boolean {
  return typeof answerFormat === 'string' && Object.hasOwn(FormatPayloadSchemas, answerFormat);
}

export function hasValidQuestionAnswer(
  answerFormat: string | null | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!isSupportedQuestionAnswerFormat(answerFormat)) return false;
  const schema = FormatPayloadSchemas[answerFormat as keyof typeof FormatPayloadSchemas];
  return schema.safeParse(payload).success;
}
