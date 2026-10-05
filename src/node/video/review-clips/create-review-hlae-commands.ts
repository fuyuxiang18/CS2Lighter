import fs from 'node:fs/promises';

type Action = { tick: number; cmd: string };

/** HLAE owns the tick scheduler, avoiding version-sensitive CSDM server interfaces. */
export function buildReviewHlaeCommands(actions: Action[]): string {
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const commands = [
    { tick: 1, cmd: 'demo_ui_mode 0' },
    { tick: 1, cmd: 'mirv_script_load "mirv_script_spec_lock.js"' },
    ...actions.flatMap((action) =>
      /^spec_player \d+$/.test(action.cmd)
        ? [action, { ...action, cmd: action.cmd.replace('spec_player ', 'mirv_script_spec_lock ') }]
        : [action],
    ),
  ]
    // This is a CSDM-only blocking pause, not a game console command.
    .filter((action) => action.cmd !== 'pause_playback')
    .map((action) => `<c tick="${action.tick}">${escape(action.cmd)}</c>`);
  return `<?xml version="1.0" encoding="utf-8"?><commandSystem><commands>${commands.join('')}</commands></commandSystem>`;
}

export async function createReviewHlaeCommands(demoPath: string): Promise<string> {
  const sequences: { actions: Action[] }[] = JSON.parse(await fs.readFile(`${demoPath}.json`, 'utf8'));
  if (sequences.length === 0) throw new Error('A review must have at least one sequence');
  const filePath = `${demoPath}.xml`;
  for (const [index, sequence] of sequences.entries()) {
    const nextPath = `${demoPath}.${index + 1}.xml`.replaceAll('\\', '/');
    const actions = sequence.actions.map((action) =>
      action.cmd === 'go_to_next_sequence'
        ? { ...action, cmd: `mirv_cmd load "${nextPath}"; demo_gototick 0` }
        : action,
    );
    await fs.writeFile(index === 0 ? filePath : `${demoPath}.${index}.xml`, buildReviewHlaeCommands(actions), 'utf8');
  }
  return filePath;
}
