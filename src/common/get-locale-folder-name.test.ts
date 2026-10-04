import { describe, expect, it } from 'vite-plus/test';
import { getLocaleFolderName } from './get-locale-folder-name';

describe('getLocaleFolderName', () => {
  it('uses the two bundled catalogs for supported and legacy locales', () => {
    expect(getLocaleFolderName('zh-CN')).toBe('zh-CN');
    expect(getLocaleFolderName('en')).toBe('en');
    expect(getLocaleFolderName('en-US')).toBe('en');
    expect(getLocaleFolderName('EN-gb')).toBe('en');
  });

  it('uses the Chinese default for unsupported or invalid settings', () => {
    for (const locale of ['fr', 'zh-TW', 'zh-Hans', '', 'invalid_locale']) {
      expect(getLocaleFolderName(locale)).toBe('zh-CN');
    }
  });
});
