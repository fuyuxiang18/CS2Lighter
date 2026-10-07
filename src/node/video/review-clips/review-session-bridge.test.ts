import { once } from 'node:events';
import { runInNewContext } from 'node:vm';
import WebSocket from 'ws';
import { expect, it, vi } from 'vite-plus/test';
import { buildReviewBoundaryScript, createReviewSessionBridge } from './review-session-bridge';

it('accepts only authenticated boundaries and delivers trusted commands over a real loopback connection', async () => {
  const completed = vi.fn(() => Promise.resolve('quit'));
  const failed = vi.fn();
  const bridge = await createReviewSessionBridge({ completed, failed });
  try {
    const wrong = new WebSocket(bridge.url.replace(/[^/]+$/, 'wrong-token'));
    await once(wrong, 'close');
    expect(completed).not.toHaveBeenCalled();
    const client = new WebSocket(bridge.url);
    await once(client, 'open');
    const reply = once(client, 'message');
    client.send('7');
    expect(JSON.parse(String((await reply)[0]))).toEqual({ command: 'quit' });
    client.close();
    await once(client, 'close');
    expect(completed).toHaveBeenCalledWith(7);
    const duplicate = new WebSocket(bridge.url);
    await once(duplicate, 'open');
    const closed = once(duplicate, 'close');
    duplicate.send('7');
    await closed;
    expect(completed).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  } finally {
    await bridge.close();
  }
});

it('generated HLAE boundary script awaits the daemon response before loading another demo and releases streams', async () => {
  const calls: string[] = [];
  const input = {
    next: vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ command: 'playdemo "next.dem"' }))
      .mockResolvedValue(null),
    drop: vi.fn(),
  };
  const output = {
    send: vi.fn((value: string) => {
      calls.push(value);
      return Promise.resolve();
    }),
    close: vi.fn(async () => {}),
    drop: vi.fn(),
  };
  await runInNewContext(buildReviewBoundaryScript('ws://127.0.0.1:1234/token', 4), {
    mirv: {
      connect_async: () => Promise.resolve({ in: input, out: output }),
      exec: (command: string) => calls.push(command),
      warning: vi.fn(),
    },
  });
  expect(calls).toEqual(['4', 'playdemo "next.dem"']);
  expect(input.drop).toHaveBeenCalled();
  expect(output.drop).toHaveBeenCalled();
});

it('closing drains an already accepted boundary before callers may remove its staging files', async () => {
  let finish!: (command: string) => void;
  const completed = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const bridge = await createReviewSessionBridge({ completed, failed: vi.fn() });
  const client = new WebSocket(bridge.url);
  await once(client, 'open');
  client.send('1');
  await vi.waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
  let settled = false;
  const closing = bridge.close().then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  finish('quit');
  await closing;
  expect(settled).toBe(true);
});
