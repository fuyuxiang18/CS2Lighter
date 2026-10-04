import type { LinguiConfig } from '@lingui/conf';
import { formatter } from '@lingui/format-json';

const config: LinguiConfig = {
  locales: ['en', 'zh-CN'],
  sourceLocale: 'en',
  rootDir: '.',
  format: formatter({ style: 'minimal', lineNumbers: false }),
  orderBy: 'origin',
  catalogs: [
    {
      path: 'src/electron-main/translations/{locale}/messages',
      include: ['src/electron-main'],
    },
  ],
};

export default config;
