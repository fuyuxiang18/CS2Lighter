import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';

/** One authenticated, ordered acknowledgement per native HLAE segment. No arbitrary game commands from clients. */
export async function createReviewSessionBridge(options: {
  completed: (segment: number) => Promise<string>;
  failed: (error: unknown) => void;
}) {
  const token = randomBytes(24).toString('hex');
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 256 });
  await once(server, 'listening');
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('Recording bridge failed to bind');
  const url = `ws://127.0.0.1:${address.port}/${token}`;
  const seen = new Set<number>();
  let handling = false;
  let closing = false;
  let inFlight: Promise<void> = Promise.resolve();
  server.on('connection', (socket, request) => {
    if (closing || request.url !== `/${token}`) {
      socket.close(1008);
      return;
    }
    socket.once('message', (data) => {
      let segment: number;
      try {
        const bytes = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
        const parsed: unknown = JSON.parse(bytes.toString('utf8'));
        if (
          typeof parsed !== 'number' ||
          !Number.isSafeInteger(parsed) ||
          parsed < 1 ||
          seen.has(parsed) ||
          handling ||
          closing
        )
          throw new Error('Invalid recording acknowledgement');
        segment = parsed;
      } catch {
        socket.close(1008);
        return;
      }
      seen.add(segment);
      handling = true;
      inFlight = options
        .completed(segment)
        .then((command) => {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ command }));
        })
        .catch((error) => {
          options.failed(error);
          socket.close(1011);
        })
        .finally(() => {
          handling = false;
        });
    });
    socket.on('error', () => {});
  });
  return {
    url,
    close: async () => {
      closing = true;
      for (const client of server.clients) client.terminate();
      await inFlight;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Supported by HLAE mirv.connect_async / mirv.exec since 2.162.0; no CSDM plugin or gameinfo edit. */
export function buildReviewBoundaryScript(url: string, segment: number): string {
  return `(async function () {
    let connection;
    try {
      connection = await mirv.connect_async(${JSON.stringify(url)});
      await connection.out.send(${JSON.stringify(JSON.stringify(segment))});
      const text = await connection.in.next();
      if (typeof text !== 'string') throw new Error('Closed recording bridge');
      const response = JSON.parse(text);
      if (typeof response.command !== 'string') throw new Error('Invalid recording response');
      mirv.exec(response.command);
      await connection.out.close();
      while (await connection.in.next() !== null) {}
    } catch (_) { mirv.warning('CS2Lighter recording session interrupted'); mirv.exec('quit'); }
    finally { if (connection) { try { connection.in.drop(); } catch (_) {} try { connection.out.drop(); } catch (_) {} } }
  })();`;
}
