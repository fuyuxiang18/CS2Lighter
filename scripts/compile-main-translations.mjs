import fs from 'node:fs/promises';
import path from 'node:path';
import { compileMessageOrThrow } from '@lingui/message-utils/compileMessage';

/** Compile both local catalogs so ICU placeholders work in production without a runtime compiler. */
export async function compileMainTranslations(projectPath, outputPath) {
  for (const locale of ['en', 'zh-CN']) {
    const inputFile = path.join(projectPath, 'src', 'electron-main', 'translations', locale, 'messages.json');
    const messages = JSON.parse(await fs.readFile(inputFile, 'utf8'));
    const compiled = Object.fromEntries(
      Object.entries(messages).map(([id, message]) => [id, compileMessageOrThrow(message)]),
    );
    const outputFolder = path.join(outputPath, 'translations', locale);
    await fs.mkdir(outputFolder, { recursive: true });
    await fs.writeFile(path.join(outputFolder, 'messages.json'), JSON.stringify(compiled), 'utf8');
  }
}
