import type { AiReportContent, AiScoreDimension, PreparedAiContext } from 'csdm/common/types/ai';
import { AiServiceError } from './ai-error';

const dimensions: AiScoreDimension[] = ['aim', 'opening', 'trading', 'utility', 'clutch'];

/** Validates structure, bounded output, cited round IDs and score eligibility; not factual truth of prose. */
export function validateAiReport(value: unknown, context: PreparedAiContext): AiReportContent {
  const fail = (
    code:
      | 'response-schema-invalid'
      | 'response-evidence-invalid'
      | 'response-score-invalid' = 'response-schema-invalid',
  ): never => {
    throw new AiServiceError(code);
  };
  const object = (item: unknown, keys: string[]): Record<string, unknown> => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return fail();
    const record = item as Record<string, unknown>;
    // Ignore harmless extra model fields; reconstruct only the supported report fields below.
    if (keys.some((key) => !(key in record))) return fail();
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
    if (!Array.isArray(item) || item.length > 8) return fail('response-evidence-invalid');
    const entries = item;
    if ((required && entries.length === 0) || entries.some((id) => typeof id !== 'string' || !validIds.has(id)))
      return fail('response-evidence-invalid');
    return [...new Set(entries as string[])];
  };
  const statement = (item: unknown) => {
    const record = object(item, ['text', 'evidenceIds']);
    return { text: text(record.text), evidenceIds: ids(record.evidenceIds) };
  };
  const styleRecord = object((value as Record<string, unknown> | null)?.style, ['label', 'text', 'evidenceIds']);
  const label = styleRecord.label;
  if (
    typeof label !== 'string' ||
    (context.payload.locale === 'zh-CN'
      ? !/^\p{Script=Han}{2,5}$/u.test(label)
      : label.length > 80 || !/^[A-Za-z]+(?:['-][A-Za-z]+)*(?: [A-Za-z]+(?:['-][A-Za-z]+)*){1,4}$/.test(label))
  )
    return fail();
  const report = object(value, ['summary', 'style', 'observations', 'recommendations', 'scores', 'limitations']);
  if (!Array.isArray(report.scores) || report.scores.length !== dimensions.length)
    return fail('response-score-invalid');
  const scores = report.scores.map((item) => {
    const record = object(item, ['dimension', 'score', 'rationale', 'evidenceIds']);
    const dimension = record.dimension as AiScoreDimension;
    if (!dimensions.includes(dimension)) return fail('response-score-invalid');
    const score = record.score;
    const available = context.payload.allowedScoreDimensions.includes(dimension);
    if (available ? !Number.isInteger(score) || typeof score !== 'number' || score < 0 || score > 100 : score !== null)
      return fail('response-score-invalid');
    return {
      dimension,
      score: score as number | null,
      rationale: text(record.rationale),
      evidenceIds: ids(record.evidenceIds, score !== null),
    };
  });
  if (new Set(scores.map((item) => item.dimension)).size !== scores.length || scores.length !== dimensions.length)
    return fail('response-score-invalid');
  const limitations = array(report.limitations, 8).map((item) => text(item, 600));
  return {
    summary: statement(report.summary),
    style: { label, ...statement(styleRecord) },
    observations: array(report.observations, 5).map(statement),
    recommendations: array(report.recommendations, 4).map((item) => {
      const record = object(item, ['title', 'action', 'uncertainty', 'evidenceIds']);
      return {
        title: text(record.title, 120),
        action: text(record.action, 900),
        uncertainty: record.uncertainty === '' ? '' : text(record.uncertainty, 600),
        evidenceIds: ids(record.evidenceIds),
      };
    }),
    scores: scores.sort((a, b) => dimensions.indexOf(a.dimension) - dimensions.indexOf(b.dimension)),
    limitations,
  };
}
