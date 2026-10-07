/** New recordings use the persistent recording queue; retain legacy media access only. */
export function resumeVideoQueueHandler(): Promise<void> {
  return Promise.reject(new Error('Start recordings from the recording queue'));
}
