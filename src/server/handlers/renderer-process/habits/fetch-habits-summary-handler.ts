import type { FetchHabitsPayload } from 'csdm/common/types/habits';
import { fetchHabitsSummary } from 'csdm/node/database/habits/fetch-habits-summary';
import { handleError } from '../../handle-error';

export async function fetchHabitsSummaryHandler(payload: FetchHabitsPayload) {
  try {
    return await fetchHabitsSummary(payload);
  } catch (error) {
    handleError(error, 'Error while fetching habits summary');
  }
}
