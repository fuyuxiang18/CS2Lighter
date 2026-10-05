// Message names sent from the main Electron process to the WebSocket server.
export const MainClientMessageName = {
  PrepareAiReport: 'prepare-ai-report',
  PrepareForUpdate: 'prepare-for-update',
  StartMinimizedMode: 'start-minimized-mode',
  StartCounterStrike: 'start-counter-strike',
} as const;

export type MainClientMessageName = (typeof MainClientMessageName)[keyof typeof MainClientMessageName];
