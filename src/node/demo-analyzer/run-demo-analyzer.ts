import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { Options as AnalyzeOptions } from '@akiver/cs-demo-analyzer';
import { getStaticFolderPath } from 'csdm/node/filesystem/get-static-folder-path';
import { isWindows } from 'csdm/node/os/is-windows';
import { CorruptedDemoError } from './corrupted-demo-error';

type RunDemoAnalyzerOptions = Omit<AnalyzeOptions, 'format' | 'executablePath'> & { signal?: AbortSignal };

export async function runDemoAnalyzer(
  options: Omit<RunDemoAnalyzerOptions, 'format' | 'executablePath'>,
): Promise<void> {
  options.signal?.throwIfAborted();
  const executablePath = path.join(getStaticFolderPath(), isWindows ? 'csda.exe' : 'csda');
  await fs.mkdir(options.outputFolderPath, { recursive: true });
  const args = [`-demo-path=${options.demoPath}`, `-output=${options.outputFolderPath}`, '-format=csdm'];
  if (options.source) args.push(`-source=${options.source}`);
  if (options.analyzePositions) args.push('-positions=true');
  if (options.minify) args.push('-minify');
  options.onStart?.([JSON.stringify(executablePath), ...args.map((arg) => JSON.stringify(arg))].join(' '));
  // Direct child ownership makes cancellation independent of other running user processes.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executablePath, args, { windowsHide: true, signal: options.signal });
    let failure: Error | undefined;
    child.on('error', (error) => {
      failure = error;
    });
    child.stdout.on('data', (data: Buffer) => options.onStdout?.(data.toString()));
    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      options.onStderr?.(text);
      if (text.includes('ErrUnexpectedEndOfDemo')) failure = new CorruptedDemoError();
    });
    child.on('close', (code) => {
      options.onEnd?.(code ?? -1);
      if (options.signal?.aborted) reject(options.signal.reason);
      else if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Demo analyzer exited with code ${code ?? 'unknown'}`));
      else resolve();
    });
  });
}
