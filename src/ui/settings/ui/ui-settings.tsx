import React from 'react';
import { SettingsView } from 'csdm/ui/settings/settings-view';
import { ThemeSelect } from 'csdm/ui/settings/ui/theme-select';
import { LanguageSelect } from 'csdm/ui/settings/ui/language-select';
import { SystemStartupBehavior } from './system-startup-behavior';
import { ResetTablesState } from './reset-tables-state';
import { EnableHardwareAcceleration } from './enable-hardware-acceleration';
import { DateFormatInput } from './date-format-input';
import { DateTimezoneInput } from './date-timezone-input';

export function UiSettings() {
  return (
    <SettingsView>
      <ThemeSelect />
      <LanguageSelect />
      <DateFormatInput />
      <DateTimezoneInput />
      <SystemStartupBehavior />
      <EnableHardwareAcceleration />
      <ResetTablesState />
    </SettingsView>
  );
}
