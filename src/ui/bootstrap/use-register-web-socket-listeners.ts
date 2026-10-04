import { useRegisterAnalysesListeners } from './web-socket-listeners/use-register-analyses-listeners';
import type { WebSocketClient } from 'csdm/ui/web-socket-client';
import { useRegisterSettingsListeners } from './web-socket-listeners/use-register-settings-listeners';
import { useRegisterVideoQueueListeners } from './web-socket-listeners/use-register-video-queue-listeners';
import { useRegisterCounterStrikeListeners } from './web-socket-listeners/use-register-counter-strike-listeners';

export function useRegisterWebSocketListeners(client: WebSocketClient) {
  useRegisterAnalysesListeners(client);
  useRegisterSettingsListeners(client);
  useRegisterVideoQueueListeners(client);
  useRegisterCounterStrikeListeners(client);
}
