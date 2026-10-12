import type { InspectDeathEvidence } from 'csdm/common/types/death-evidence';
import { deathEvidence } from 'csdm/node/death-review/death-evidence';
import { handleError } from '../../handle-error';

export async function inspectDeathEvidenceHandler(payload: InspectDeathEvidence) {
  try {
    return await deathEvidence.inspect(payload);
  } catch (error) {
    handleError(error, 'Error while inspecting death evidence');
  }
}
