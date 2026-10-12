// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import unzipper from 'unzipper';

const root = fileURLToPath(new URL('..', import.meta.url));
const nativeDirectory = path.join(root, 'static', 'death-evidence');
const visibilityDirectory = path.join(root, 'static', 'visibility');
const vrfUrl = 'https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/20.0/cli-windows-x64.zip';
const vrfSha256 = 'd32ab327b8bbb42a2528866afb03bb582bdb779d0005488da32b90292afd3ff5';
const vrfFiles = new Set(['Source2Viewer-CLI.exe', 'libSkiaSharp.dll', 'spirv-cross.dll']);

/** @param {string[]} args */
async function go(args) {
  const child = spawn(process.env.CS2LIGHTER_GO || 'go', args, {
    cwd: path.join(root, 'tools', 'death-evidence'),
    windowsHide: true,
    shell: false,
    stdio: 'inherit',
    env: { ...process.env, CGO_ENABLED: '0' },
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`Go exited with ${code}`))));
  });
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Advanced death evidence packaging currently targets Windows x64.');
}
await mkdir(nativeDirectory, { recursive: true });
await go(['test', './...']);
await go(['build', '-trimpath', '-ldflags=-s -w', '-o', path.join(nativeDirectory, 'death-evidence.exe'), '.']);
await copyFile(
  path.join(root, 'tools', 'death-evidence', 'THIRD_PARTY_NOTICES.txt'),
  path.join(nativeDirectory, 'THIRD_PARTY_NOTICES.txt'),
);
const marker = path.join(visibilityDirectory, 'asset-sha256.txt');
const installedMarker = await readFile(marker, 'utf8').catch(() => '');
let installed = installedMarker.trim() === vrfSha256;
if (installed) {
  for (const file of vrfFiles) {
    try {
      await readFile(path.join(visibilityDirectory, file));
    } catch {
      installed = false;
      break;
    }
  }
}
if (!installed) {
  const archive = process.env.CS2LIGHTER_VRF_ARCHIVE
    ? await readFile(process.env.CS2LIGHTER_VRF_ARCHIVE)
    : await (async () => {
        const response = await fetch(vrfUrl);
        if (!response.ok) throw new Error(`Source 2 Viewer download failed: ${response.status}`);
        const length = Number(response.headers.get('content-length'));
        if (length > 60 * 1024 ** 2) throw new Error('Unexpected Source 2 Viewer archive size');
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength > 60 * 1024 ** 2) throw new Error('Source 2 Viewer archive exceeds its size limit');
        return bytes;
      })();
  if (createHash('sha256').update(archive).digest('hex') !== vrfSha256)
    throw new Error('Source 2 Viewer archive checksum mismatch');
  const zipped = await unzipper.Open.buffer(archive);
  await mkdir(visibilityDirectory, { recursive: true });
  for (const file of vrfFiles) {
    const entry = zipped.files.find((entry) => entry.path === file && entry.type === 'File');
    if (!entry || entry.uncompressedSize > 128 * 1024 ** 2) throw new Error(`Invalid Source 2 Viewer asset: ${file}`);
    await writeFile(path.join(visibilityDirectory, file), await entry.buffer());
  }
  await writeFile(marker, vrfSha256 + '\n');
}
