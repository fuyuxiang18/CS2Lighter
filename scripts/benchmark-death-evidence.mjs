// Read-only real-demo regression benchmark. No raw frames, player IDs or demo paths are saved.
// node scripts/benchmark-death-evidence.mjs --demo D:\demos\match.dem --work-dir D:\qa --windows 8000:8448,16000:16448 [--runs 3] [--output D:\qa\summary.json]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { build } from 'vite/rolldown';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
if (!args.get('--demo') || !args.get('--work-dir') || !args.get('--windows'))
  throw new Error('Required: --demo <file.dem> --work-dir <temporary-directory> --windows <start:end,start:end>');
const windows = args
  .get('--windows')
  .split(',')
  .map((pair) => {
    const [startTick, endTick] = pair.split(':').map(Number);
    if (
      !Number.isSafeInteger(startTick) ||
      !Number.isSafeInteger(endTick) ||
      startTick < 0 ||
      endTick < startTick ||
      endTick - startTick >= 4096
    )
      throw new Error('Invalid window');
    return { startTick, endTick };
  });
const runs = Number(args.get('--runs') ?? 1);
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 5) throw new Error('--runs must be between 1 and 5');
const work = path.resolve(args.get('--work-dir'));
await mkdir(work, { recursive: true });
const temporary = await mkdtemp(path.join(work, 'cs2lighter-evidence-'));
const entry = path.join(temporary, 'benchmark.ts');
const bundle = path.join(temporary, 'benchmark.cjs');
const imported = (name) => JSON.stringify(path.join(root, 'src', 'node', 'death-review', name).replaceAll('\\', '/'));
const source = `
import { createHash } from 'node:crypto';
import { writeFile, readdir } from 'node:fs/promises';
import { runDeathEvidenceProcess } from ${imported('death-evidence-process.ts')};
import { extractEvidenceWindows, planEvidenceScans } from ${imported('evidence-window-batch.ts')};
const [demoPath, directory, executable, windowJson, runText, output] = process.argv.slice(2);
const windows = JSON.parse(windowJson);
const runs = Number(runText);
function canonical(value: any): any {
  return value && typeof value === 'object'
    ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
}
function digest(value: any) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function summarize(data: any) {
  const world = new Map(), smokes = new Map(), frames = [];
  for (const frame of data.frames) {
    for (const [state, delta] of [[world, frame.world], [smokes, frame.smokes]]) {
      if (delta.complete) state.clear();
      for (const id of delta.removed) state.delete(id);
      for (const entity of delta.upserts) state.set(entity.id, entity);
    }
    const sorted = (map: any) => [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
    frames.push(digest({ ...frame, world: sorted(world), smokes: sorted(smokes) }));
  }
  return {
    window: data.window, frames: data.frames.length, shots: data.rawShots.length, bulletDamages: data.bulletDamages.length,
    frameHash: digest(frames), shotHash: digest(data.rawShots), bulletHash: digest(data.bulletDamages),
    missingTicks: data.end.missingTicks, duplicateTicks: data.end.duplicateTicks, classesHash: digest([data.end.supportedClasses, data.end.unsupportedClasses]),
    headerHash: digest([data.header.mapName, data.header.tickRate, data.header.patch, data.header.buildNum, data.header.sourceBytes]),
  };
}
async function main() {
  const observations = [];
  for (let iteration = 0; iteration < runs; iteration++) {
    const baseline = [], batch = [];
    let singleNativeMs = 0, singleComparisonMs = 0, batchComparisonMs = 0;
    const batchNativeMs = [];
    const first = performance.now();
    for (const window of windows) {
      const data: any = { window, frames: [], rawShots: [], bulletDamages: [] };
      const scanStarted = performance.now();
      data.end = await runDeathEvidenceProcess({ executable, request: { version: 1, demoPath, windows: [window] }, signal: new AbortController().signal,
        onMessage(message) {
          if (message.type === 'header') data.header = message;
          else if (message.type === 'frame') data.frames.push(message);
          else if (message.type === 'shot') data.rawShots.push(message);
          else if (message.type === 'bullet-damage') data.bulletDamages.push(message);
        },
      });
      singleNativeMs += performance.now() - scanStarted;
      const comparisonStarted = performance.now();
      baseline.push(summarize(data));
      singleComparisonMs += performance.now() - comparisonStarted;
    }
    const singleMs = Math.round(performance.now() - first);
    const second = performance.now();
    const groups = planEvidenceScans(windows);
    for (const group of groups) await extractEvidenceWindows({ executable, demoPath, windows: group, directory, signal: new AbortController().signal,
      onProgress() {}, onScanCompleted: milliseconds => { batchNativeMs.push(milliseconds); },
      consume: async data => { const comparisonStarted = performance.now(); batch.push(summarize(data)); batchComparisonMs += performance.now() - comparisonStarted; },
    });
    const batchMs = Math.round(performance.now() - second);
    const order = (a: any, b: any) => a.window.startTick - b.window.startTick || a.window.endTick - b.window.endTick;
    baseline.sort(order); batch.sort(order);
    observations.push({ singleMs, batchMs, singleExtractionMs: Math.round(singleMs - singleComparisonMs),
      batchExtractionMs: Math.round(batchMs - batchComparisonMs), singleNativeMs: Math.round(singleNativeMs),
      batchNativeMs: batchNativeMs.map(Math.round), singleComparisonMs: Math.round(singleComparisonMs), batchComparisonMs: Math.round(batchComparisonMs),
      individualScans: windows.length, batchedScans: batchNativeMs.length,
      equal: JSON.stringify(baseline) === JSON.stringify(batch), baseline, batch });
  }
  const percentile = (values: number[]) => values.toSorted((a, b) => a - b)[Math.ceil(values.length * 0.9) - 1];
  const summary = { kind: 'real-demo-evidence-equivalence', runs,
    singleP90Ms: percentile(observations.map(item => item.singleMs)), batchP90Ms: percentile(observations.map(item => item.batchMs)),
    equal: observations.every(item => item.equal), temporarySpools: (await readdir(directory)).filter(name => name.startsWith('.batch-')).length, observations };
  if (output) await writeFile(output, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.equal || summary.temporarySpools) process.exitCode = 1;
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
`;
try {
  await writeFile(entry, source);
  await build({ input: entry, platform: 'node', output: { file: bundle, format: 'cjs' } });
  const child = spawn(
    process.execPath,
    [
      bundle,
      path.resolve(args.get('--demo')),
      temporary,
      path.join(root, 'static', 'death-evidence', 'death-evidence.exe'),
      JSON.stringify(windows),
      String(runs),
      args.get('--output') ? path.resolve(args.get('--output')) : '',
    ],
    { shell: false, windowsHide: true, stdio: 'inherit' },
  );
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
