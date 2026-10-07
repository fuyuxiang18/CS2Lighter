export const SettingsCategory = {
  Ai: 'ai',
  Folders: 'folders',
  Database: 'database',
  UI: 'ui',
  Analyze: 'analyze',
  Playback: 'playback',
  Video: 'video',
  Maps: 'maps',
  About: 'about',
} as const;

export type SettingsCategory = (typeof SettingsCategory)[keyof typeof SettingsCategory];
