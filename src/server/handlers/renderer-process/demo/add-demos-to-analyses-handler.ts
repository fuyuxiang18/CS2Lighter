import { analysesListener } from 'csdm/server/analyses-listener';
import type { Demo } from 'csdm/common/types/demo';

export type AddDemosToAnalysesPayload = Demo[] | { demos: Demo[]; force?: boolean };
export async function addDemosToAnalysesHandler(payload: AddDemosToAnalysesPayload) {
  await analysesListener.addDemosToAnalyses(Array.isArray(payload) ? payload : payload.demos, {
    force: !Array.isArray(payload) && payload.force === true,
  });
}
