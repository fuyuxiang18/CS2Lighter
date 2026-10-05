export const SettingsCategory = {
  Ai: 'ai',
  Folders: 'folders',
  Database: 'database',
  UI: 'ui',
  Analyze: 'analyze',
  Playback: 'playback',
  Video: 'video',
  Maps: 'maps',
  Tags: 'tags',
  Integrations: 'integrations',
  About: 'about',
  Cameras: 'cameras',
} as const;

export type SettingsCategory = (typeof SettingsCategory)[keyof typeof SettingsCategory];
