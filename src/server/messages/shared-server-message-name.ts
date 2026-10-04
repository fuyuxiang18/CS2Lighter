import type { ErrorCode } from 'csdm/common/error-code';

// Message names sent from the WebSocket server to several kinds of client: replies go to whichever client made the
// request (renderer, main, CLI or probe process).
export const SharedServerMessageName = {
  Reply: 'reply',
  ReplyError: 'reply-error',
} as const;

export type SharedServerMessageName = (typeof SharedServerMessageName)[keyof typeof SharedServerMessageName];

export interface SharedServerMessagePayload {
  [SharedServerMessageName.Reply]: unknown;
  [SharedServerMessageName.ReplyError]: ErrorCode;
}
