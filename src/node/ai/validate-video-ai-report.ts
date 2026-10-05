import type { PreparedVideoAiContext, VideoAiContent, VideoAiPoint } from 'csdm/common/types/ai';
import { AiServiceError } from './ai-error';

/** Verifies shape, references and perspective labels, not the factual truth of model prose. */
export function validateVideoAiReport(value: unknown, context: PreparedVideoAiContext): VideoAiContent {
  const fail = (): never => {
    throw new AiServiceError('invalid-response');
  };
  if (value && typeof value === 'object' && 'visualInput' in value && value.visualInput === 'unavailable')
    throw new AiServiceError('vision-unsupported');
  const object = (item: unknown, keys: string[]) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return fail();
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((key) => !keys.includes(key)) || keys.some((key) => !(key in record))) return fail();
    return record;
  };
  const text = (item: unknown): string => {
    if (typeof item !== 'string' || !item.trim() || item.length > 900) return fail();
    return item.trim();
  };
  const array = (item: unknown, max: number): unknown[] => {
    if (!Array.isArray(item) || item.length === 0 || item.length > max) return fail();
    return item;
  };
  const frames = new Map(context.frames.map((frame) => [frame.id, frame]));
  const ids = (item: unknown): string[] => {
    const entries = array(item, 6);
    if (entries.some((id) => typeof id !== 'string' || !frames.has(id))) return fail();
    return [...new Set(entries as string[])];
  };
  const statement = (item: unknown) => {
    const record = object(item, ['text', 'frameIds']);
    return { text: text(record.text), frameIds: ids(record.frameIds) };
  };
  const report = object(value, ['visualInput', 'summary', 'style', 'timeline', 'practice', 'limitations']);
  if (report.visualInput !== 'visible') return fail();
  const timeline = array(report.timeline, 5)
    .map((item): VideoAiPoint => {
      const record = object(item, [
        'frameIds',
        'observation',
        'inference',
        'information',
        'alternative',
        'uncertainty',
      ]);
      const frameIds = ids(record.frameIds);
      const information = record.information as VideoAiPoint['information'];
      if (!['player-visible', 'opponent-hindsight', 'uncertain'].includes(information)) return fail();
      const opponent = frameIds.some((id) => frames.get(id)?.perspective === 'opponent');
      if ((opponent && information !== 'opponent-hindsight') || (information === 'opponent-hindsight' && !opponent))
        return fail();
      return {
        frameIds,
        information,
        observation: text(record.observation),
        inference: text(record.inference),
        alternative: text(record.alternative),
        uncertainty: text(record.uncertainty),
      };
    })
    .sort(
      (a, b) =>
        Math.min(...a.frameIds.map((id) => frames.get(id)!.demoTick)) -
        Math.min(...b.frameIds.map((id) => frames.get(id)!.demoTick)),
    );
  return {
    visualInput: 'visible',
    summary: statement(report.summary),
    style: statement(report.style),
    timeline,
    practice: array(report.practice, 3).map((item) => {
      const record = object(item, ['action', 'check', 'frameIds']);
      return { action: text(record.action), check: text(record.check), frameIds: ids(record.frameIds) };
    }),
    limitations: array(report.limitations, 6).map(text),
  };
}
