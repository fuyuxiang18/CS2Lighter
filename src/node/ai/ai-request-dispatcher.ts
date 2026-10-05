import { Agent } from 'undici';
// Electron embeds a different Undici major: its global fetch cannot consume this package's dispatcher handlers.
export { fetch as fetchAiRequest } from 'undici';

/** A request-owned dispatcher avoids Undici's implicit five-minute header/body deadlines. */
export function createAiRequestDispatcher(timeoutMs: number) {
  const agent = new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
  const dispatcher = agent.compose(
    (dispatch) => (options, handler) =>
      dispatch({ ...options, headersTimeout: timeoutMs, bodyTimeout: timeoutMs }, handler),
  );
  return {
    dispatcher,
    // Destroy only this request's sockets, including unread error bodies; never change global networking defaults.
    dispose: () => agent.destroy().catch(() => {}),
  };
}
