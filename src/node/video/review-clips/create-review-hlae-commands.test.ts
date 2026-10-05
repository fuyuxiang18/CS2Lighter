import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vite-plus/test';
import { createReviewHlaeCommands } from './create-review-hlae-commands';

it('chains native schedules with a rewind, keeps every perspective locked, and quits only after the final capture', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-schedule-'));
  try {
    const demo = path.join(folder, 'source.dem');
    await fs.writeFile(
      `${demo}.json`,
      JSON.stringify([
        {
          actions: [
            { tick: 96, cmd: 'demo_gototick 999' },
            { tick: 1000, cmd: 'spec_player 4' },
            { tick: 1100, cmd: 'mirv_streams record start' },
            { tick: 1400, cmd: 'mirv_streams record end' },
            { tick: 1464, cmd: 'go_to_next_sequence' },
          ],
        },
        {
          actions: [
            { tick: 96, cmd: 'demo_gototick 999' },
            { tick: 1000, cmd: 'spec_player 7' },
            { tick: 1100, cmd: 'mirv_streams record start' },
            { tick: 1350, cmd: 'mirv_streams record end' },
            { tick: 1414, cmd: 'quit' },
          ],
        },
      ]),
    );
    const first = await fs.readFile(await createReviewHlaeCommands(demo), 'utf8');
    const second = await fs.readFile(`${demo}.1.xml`, 'utf8');
    expect(first).toContain(`mirv_cmd load "${demo.replaceAll('\\', '/')}.1.xml"; demo_gototick 0`);
    expect(first).toContain('mirv_script_load "mirv_script_spec_lock.js"');
    expect(first).toContain('<c tick="1000">mirv_script_spec_lock 4</c>');
    expect(first).not.toContain('quit');
    expect(first).not.toContain('go_to_next_sequence');
    expect(second).toContain('<c tick="1000">mirv_script_spec_lock 7</c>');
    expect(second).toContain('<c tick="1414">quit</c>');
    expect(second).not.toContain('mirv_cmd load');
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
