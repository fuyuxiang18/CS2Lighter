export function getLocaleFolderName(locale: string): 'zh-CN' | 'en' {
  // The fork ships exactly these two catalogs. Legacy or invalid values use its default.
  return /^en(?:-|$)/i.test(locale) ? 'en' : 'zh-CN';
}
