# Local catalogs

This fork ships Simplified Chinese (`zh-CN`) and English (`en`). Chinese is the default for fresh installations. Settings migration 16 applies the Chinese default once to v0.1 installations, after which saved language changes are respected.

Both locales are maintained in the repository:

- Renderer: `src/ui/translations/{locale}/messages.po`
- Main process: `src/electron-main/translations/{locale}/messages.json`

Builds use these local files without downloading translations or requiring Crowdin credentials. The renderer imports both catalogs explicitly. Main-process catalogs are compiled during development and production builds, including ICU placeholders in notifications. The language selector contains only 简体中文 and English.

## Updating text

Use Lingui macros as documented in `skills/i18n/SKILL.md`. Coordinate parallel UI changes before running `vp run i18n:extract`, then translate new Chinese entries. Keep placeholder names and numbered component tags intact. Run `node scripts/validate-translations.mjs`; production builds perform the same validation and fail on missing Chinese entries, invalid ICU syntax, or broken placeholders/tags.

Both English and Chinese catalogs must be committed. Upstream instructions to leave non-English catalogs untracked or fetch them from Crowdin do not apply to this fork.

## Translation provenance

The initial Chinese translation base comes from CS Demo Manager v3.19.0's public catalogs:

- [Renderer catalog](https://github.com/akiver/cs-demo-manager/blob/v3.19.0/src/ui/translations/zh-CN/messages.po)
- [Main-process catalog](https://github.com/akiver/cs-demo-manager/blob/v3.19.0/src/electron-main/translations/zh-CN/messages.json)
- [Upstream MIT license](https://github.com/akiver/cs-demo-manager/blob/v3.19.0/LICENSE)

Copyright (c) 2014-present AkiVer. The upstream MIT notice is retained in the root `LICENSE` and distribution attribution files. Existing Crowdin translation contributors are credited through the source catalogs and upstream project. The fork adds translations for its own features and later upstream changes, and repairs invalid component markup where found. Game, platform and product names and technical abbreviations may intentionally remain unchanged.
