import type { FindHabitsIdentityPayload } from 'csdm/common/types/habits';
import { findHabitsIdentity } from 'csdm/node/database/habits/find-habits-identity';
import { handleError } from '../../handle-error';

export async function findHabitsIdentityHandler(payload: FindHabitsIdentityPayload) {
  try {
    return await findHabitsIdentity(payload.nickname);
  } catch (error) {
    handleError(error, 'Error while finding habits identity');
  }
}
