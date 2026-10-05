import { MainClientMessageName } from 'csdm/server/messages/main-client-message-name';
import { prepareForUpdateHandler } from './main-process/prepare-for-update-handler';
import type { Handler } from 'csdm/server/messages/handler';
import { startMinimizedModeHandler } from './main-process/start-minimized-mode-handler';
import type { Game } from 'csdm/common/types/counter-strike';
import { startCounterStrikeHandler } from './main-process/start-counter-strike-handler';
import type { CounterStrikeErrorPayload } from '../counter-strike';
import type { AiReportScope, PreparedAiContext } from 'csdm/common/types/ai';
import { prepareAiReportHandler } from './main-process/prepare-ai-report-handler';

export interface MainMessageHandlers {
  [MainClientMessageName.PrepareAiReport]: Handler<AiReportScope, PreparedAiContext>;
  [MainClientMessageName.PrepareForUpdate]: Handler<{ nonce: string }, boolean>;
  [MainClientMessageName.StartMinimizedMode]: Handler;
  [MainClientMessageName.StartCounterStrike]: Handler<Game, CounterStrikeErrorPayload | undefined>;
}

// Mapping between message names and server handlers sent from the Electron main process to the WebSocket server.
export const mainHandlers: MainMessageHandlers = {
  [MainClientMessageName.PrepareAiReport]: prepareAiReportHandler,
  [MainClientMessageName.PrepareForUpdate]: prepareForUpdateHandler,
  [MainClientMessageName.StartMinimizedMode]: startMinimizedModeHandler,
  [MainClientMessageName.StartCounterStrike]: startCounterStrikeHandler,
};
