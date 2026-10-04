import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatter } from '@lingui/format-po';
import { compileMessageOrThrow } from '@lingui/message-utils/compileMessage';

function getArguments(compiled) {
  const names = new Set();
  for (const token of compiled) {
    if (!Array.isArray(token)) {
      continue;
    }
    names.add(token[0]);
    const choices = token[2];
    if (choices && typeof choices === 'object') {
      for (const choice of Object.values(choices)) {
        if (Array.isArray(choice)) {
          for (const name of getArguments(choice)) {
            names.add(name);
          }
        }
      }
    }
  }
  return [...names].sort();
}

function getTags(message) {
  const tags = new Set();
  const stack = [];
  for (const match of message.matchAll(/<(\/)?(\d+)\s*(\/?)>/g)) {
    const [, closing, id, selfClosing] = match;
    tags.add(id);
    if (closing) {
      if (stack.pop() !== id) {
        throw new Error(`Unbalanced component tag ${match[0]}`);
      }
    } else if (!selfClosing) {
      stack.push(id);
    }
  }
  if (stack.length > 0) {
    throw new Error(`Unclosed component tag <${stack.at(-1)}>`);
  }
  return [...tags].sort();
}

function validateMessage(id, source, translation) {
  if (!translation?.trim()) {
    throw new Error(`${id}: Chinese translation is missing`);
  }
  try {
    const sourceArguments = getArguments(compileMessageOrThrow(source));
    const translatedArguments = getArguments(compileMessageOrThrow(translation));
    if (JSON.stringify(sourceArguments) !== JSON.stringify(translatedArguments)) {
      throw new Error(`Placeholder mismatch: ${sourceArguments.join(', ')} / ${translatedArguments.join(', ')}`);
    }
    if (JSON.stringify(getTags(source)) !== JSON.stringify(getTags(translation))) {
      throw new Error('Component tag mismatch');
    }
  } catch (error) {
    throw new Error(`${id}: ${error.message}\nSource: ${source}\nTranslation: ${translation}`);
  }
}

/** Fail the build instead of silently shipping missing or broken Chinese messages. */
export async function validateTranslations(projectPath = fileURLToPath(new URL('..', import.meta.url))) {
  const po = formatter();
  const readPo = async (locale) =>
    po.parse(await fs.readFile(path.join(projectPath, `src/ui/translations/${locale}/messages.po`), 'utf8'));
  const [english, chinese] = await Promise.all([readPo('en'), readPo('zh-CN')]);
  const errors = [];
  let rendererCount = 0;
  for (const [id, entry] of Object.entries(english)) {
    if (entry.obsolete) {
      continue;
    }
    rendererCount++;
    try {
      validateMessage(id, entry.message ?? entry.translation ?? id, chinese[id]?.translation);
    } catch (error) {
      errors.push(error.message);
    }
  }
  const readMain = async (locale) =>
    JSON.parse(
      await fs.readFile(path.join(projectPath, `src/electron-main/translations/${locale}/messages.json`), 'utf8'),
    );
  const [mainEnglish, mainChinese] = await Promise.all([readMain('en'), readMain('zh-CN')]);
  for (const [id, message] of Object.entries(mainEnglish)) {
    try {
      validateMessage(id, message, mainChinese[id]);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Translation validation failed (${errors.length}):\n${errors.join('\n\n')}`);
  }
  return { rendererCount, mainCount: Object.keys(mainEnglish).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const counts = await validateTranslations();
  console.log(
    `Validated Simplified Chinese: ${counts.rendererCount} renderer messages, ${counts.mainCount} main-process messages.`,
  );
}
