import fs from 'node:fs/promises';
import path from 'node:path';
import { ReviewClipError } from './review-clip-service';

export async function assertReviewGameFiles(csgoFolder: string): Promise<void> {
  const folder = path.join(csgoFolder, 'game', 'csgo');
  for (const name of ['csdm', 'gameinfo.gi.backup']) {
    const exists = await fs
      .lstat(path.join(folder, name))
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
    if (exists) throw new ReviewClipError('game-files-conflict');
  }
  const content = await fs.readFile(path.join(folder, 'gameinfo.gi'), 'utf8');
  if (/csgo[\\/]csdm/i.test(content)) throw new ReviewClipError('game-files-conflict');
}
