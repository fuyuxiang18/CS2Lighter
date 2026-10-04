import React, { useEffect } from 'react';
import type { ReactNode } from 'react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { useLocale } from 'csdm/ui/settings/ui/use-locale';
import { messages as englishMessages } from 'csdm/ui/translations/en/messages.po';
import { messages as chineseMessages } from 'csdm/ui/translations/zh-CN/messages.po';

type Props = {
  children: ReactNode;
};

export function LocaleProvider({ children }: Props) {
  const locale = useLocale();

  useEffect(() => {
    // Both catalogs are bundled locally. Synchronous activation also avoids stale
    // asynchronous imports winning when the user switches languages quickly.
    i18n.loadAndActivate({ locale, messages: locale === 'en' ? englishMessages : chineseMessages });
    document.documentElement.lang = locale;
  }, [locale]);

  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
