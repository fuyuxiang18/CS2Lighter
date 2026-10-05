import fs from 'node:fs/promises';

type Action = { tick: number; cmd: string };

/** HLAE owns the tick scheduler, avoiding version-sensitive CSDM server interfaces. */
export function buildReviewHlaeCommands(actions: Action[]): string {
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const commands = [{ tick: 1, cmd: 'demo_ui_mode 0' }, ...actions]
    // This is a CSDM-only blocking pause, not a game console command.
    .filter((action) => action.cmd !== 'pause_playback')
    .map((action) => `<c tick="${action.tick}">${escape(action.cmd)}</c>`);
  return `<?xml version="1.0" encoding="utf-8"?><commandSystem><commands>${commands.join('')}</commands></commandSystem>`;
}

export async function createReviewHlaeCommands(demoPath: string): Promise<string> {
  const sequences: { actions: Action[] }[] = JSON.parse(await fs.readFile(`${demoPath}.json`, 'utf8'));
  if (sequences.length !== 1) throw new Error('A review clip must have exactly one sequence');
  const filePath = `${demoPath}.xml`;
  await fs.writeFile(filePath, buildReviewHlaeCommands(sequences[0].actions), 'utf8');
  return filePath;
}
