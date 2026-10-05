import type { AiReportContent, AiScoreDimension, PreparedAiContext } from 'csdm/common/types/ai';
import { AiServiceError } from './ai-error';

const dimensions: AiScoreDimension[] = ['opening', 'trading', 'utility', 'survival', 'aim'];

/** Validates structure, bounded output, cited round IDs and score eligibility; not factual truth of prose. */
export function validateAiReport(value: unknown, context: PreparedAiContext): AiReportContent {
  const fail = (): never => {
    throw new AiServiceError('invalid-response');
  };
  const object = (item: unknown, keys: string[]): Record<string, unknown> => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return fail();
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((key) => !keys.includes(key)) || keys.some((key) => !(key in record))) return fail();
    return record;
  };
  const text = (item: unknown, max = 1000): string => {
    if (typeof item !== 'string' || !item.trim() || item.length > max) return fail();
    return item.trim();
  };
  const array = (item: unknown, max: number): unknown[] => {
    if (!Array.isArray(item) || item.length > max) return fail();
    return item;
  };
  const validIds = new Set(context.evidence.map((item) => item.id));
  const ids = (item: unknown, required = true): string[] => {
    const entries = array(item, 8);
    if ((required && entries.length === 0) || entries.some((id) => typeof id !== 'string' || !validIds.has(id)))
      return fail();
    return [...new Set(entries as string[])];
  };
  const statement = (item: unknown) => {
    const record = object(item, ['text', 'evidenceIds']);
    return { text: text(record.text), evidenceIds: ids(record.evidenceIds) };
  };
  const report = object(value, ['summary', 'style', 'observations', 'recommendations', 'scores', 'limitations']);
  const scores = array(report.scores, 5).map((item) => {
    const record = object(item, ['dimension', 'score', 'rationale', 'evidenceIds']);
    const dimension = record.dimension as AiScoreDimension;
    if (!dimensions.includes(dimension)) return fail();
    const score = record.score;
    if (
      score !== null &&
      (!Number.isInteger(score) ||
        typeof score !== 'number' ||
        score < 0 ||
        score > 100 ||
        !context.payload.allowedScoreDimensions.includes(dimension))
    )
      return fail();
    return {
      dimension,
      score: score as number | null,
      rationale: text(record.rationale),
      evidenceIds: ids(record.evidenceIds, score !== null),
    };
  });
  if (new Set(scores.map((item) => item.dimension)).size !== scores.length || scores.length !== dimensions.length)
    return fail();
  const limitations = array(report.limitations, 8).map((item) => text(item, 600));
  if (limitations.length === 0) return fail();
  return {
    summary: statement(report.summary),
    style: statement(report.style),
    observations: array(report.observations, 5).map(statement),
    recommendations: array(report.recommendations, 4).map((item) => {
      const record = object(item, ['title', 'action', 'uncertainty', 'evidenceIds']);
      return {
        title: text(record.title, 120),
        action: text(record.action, 900),
        uncertainty: text(record.uncertainty, 600),
        evidenceIds: ids(record.evidenceIds),
      };
    }),
    scores,
    limitations,
  };
}
