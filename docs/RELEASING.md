# 版本与发布

版本使用 `主版本.次版本.修订版本`：小 bug 修复增修订号（如 0.2.1），较大功能增次版本（如 0.3.0），重大阶段或正式上线增主版本（如 1.0.0）。发布过的版本不能覆盖；需要修复则发新版本。

每次完成用户授权的修改后，运行验证，将源代码提交并推送本仓库 main。远程 origin 是用户的 CS2Lighter 仓库；upstream 仅用于追踪 CS Demo Manager，不向 upstream 推送。

## 发布一个版本

1. 修改 package.json 版本，添加 `releases/版本号.md`，更新中英目录。
2. 通过 `vp check`、`vp run test`、`vp run deadcode` 和 `vp run i18n:extract`。Windows 对符号链接 CLAUDE.md 会使用文本占位，因此格式检查可对 src/scripts/linter/types 及根配置执行，再执行全仓 `vp check --no-fmt`。
3. 实际验证目录批量导入、中文和英文、960×720 窗口及旧数据升级，提交并推送 main。
4. 创建和推送与 package.json 一致的标签，例如 `git tag v0.3.0` 和 `git push origin v0.3.0`。
5. GitHub Actions 的 Release CS2Lighter 构建 Windows 安装包，先建草稿并上传 `.exe`、`.exe.blockmap`、`latest.yml`，全部成功后才公开，避免更新清单指向尚未上传的文件。

如本地构建发布，执行 `vp run build` 和 `vp run package --win --publish never`，同样先创建草稿、完整上传这三个文件再公开。只有已验证的版本才发布。不要把 GitHub token 打进安装包；发布任务使用 GitHub 提供的 GITHUB_TOKEN。

## 升级兼容性

- 保持 electron-builder 的 appId `local.cs2.parser` 和 Windows executableName `cs2-parser`。应用名称可以显示 CS2Lighter，旧安装记录和进程身份需要保持兼容。
- 保持 `%LOCALAPPDATA%\CS2Parser` 和 `ui` 用户数据子目录，保留现有 localStorage 身份与笔记 key。
- 安装目录 `demodata` 是用户缓存，不是程序资源；NSIS 的 `customRemoveFiles` 在升级和卸载时保留此目录。发布前须实际验证有缓存文件的覆盖安装，不能恢复默认递归删除安装目录的行为。
- 首次升级到 0.3.0 从已有数据库回填逐场缓存，不应重跑原始 demo 解析器。新解析、重分析、删除和地图元数据变化必须保持缓存一致性。
- 设置变动增加 schema migration；数据库变动使用现有数据库 migration，不重置用户库。
- PostgreSQL 主版本升级需额外设计数据迁移，不能直接替换不兼容主版本。
- 安装更新前须确认无解析/入库/视频任务及 CLI 工作，停止监听、关闭数据库并等待后台进程退出。
- 默认关闭“退出自动安装”，由用户按“重启并更新”完成替换。若网络失败保留当前程序和数据并允许重试。

## 本地更新验证

在独立 `CS2_PARSER_DATA_DIR` 中运行已安装程序，可同时设置 `CS2_PARSER_UPDATE_FEED_URL` 指向测试清单。正常用户发行版从打包的 GitHub feed 读取。测试清单和测试版本不发布到公开更新渠道。

测试安装器必须关闭桌面和开始菜单快捷方式创建，使用独立 appId、程序名、安装目录与用户资料。测试结束检查并清理测试快捷方式，不能把 QA 安装留作用户桌面的正式入口。

发行包当前未配置代码签名证书；如后续引入签名，需要同步验证旧版本更新到签名版本的行为。
