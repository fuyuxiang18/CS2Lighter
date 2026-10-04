# CS2Lighter

用于个人 CS2 demo 复盘的 Windows 桌面软件。指定本地文件夹，自动解析对局，查看跨比赛习惯、位置热力图和回合证据，并对照高手的移动路线与朝向学习。

当前版本 **0.2.0**，支持 Windows 10/11 x64。基于 [CS Demo Manager](https://github.com/akiver/cs-demo-manager) 开发，保留 MIT 许可和上游署名。

## 下载与使用

从 [Releases](https://github.com/fuyuxiang18/CS2Lighter/releases/latest) 下载安装包。软件默认简体中文，也可切换 English。

1. 在设置中添加存放 demo 的文件夹，可以添加多个并递归扫描。
2. 在完美等平台下载并解压 demo 到这些文件夹。CS2Lighter 不下载对局，只读取完整的 CS2 `.dem` 文件。
3. 等待进度完成。解析和入库期间暂停数据浏览，设置仍可使用；失败或未下载完整的文件会单独提示。
4. 输入录制时使用的准确昵称。找到账号后按 SteamID 绑定，后续同账号更名仍可归集；同名多个账号需自行确认。
5. 在“我的习惯”查看地图、阵营和热区，在“向高手学习”对照回合并记录笔记。

统计来自 demo 已记录的数据。2D 朝向是记录的水平朝向，不等于第一人称真实画面或“最佳对枪角度”。原生 POV 播放需要本机 CS2 及兼容的 demo。

## 更新与数据

在“设置 → 关于 → 应用更新”检查、下载并重启更新。更新来自本项目的 GitHub Releases，无需登录 GitHub。

从 0.1.0 需要手动安装 0.2.0 一次，以获得应用内更新功能。**安装器应用标识、可执行文件名和数据路径保留兼容**；内部文件名仍是 `cs2-parser.exe`，Windows 数据仍在 `%LOCALAPPDATA%\CS2Parser`，不会因更名重新创建数据库。原始 demo 保留在你选择的目录，绑定和笔记保存在同一用户数据目录的 `ui` 子目录。

更新不会删除这些数据。手动备份时先退出软件并等后台解析结束，再备份完整数据目录；原始 demo 单独备份。请勿在更新时主动删除旧数据目录。

## 本地开发

安装 [Vite+](https://viteplus.dev/)，使用仓库固定的 Node 和依赖版本：

```sh
vp install
vp run dev
vp run test
vp check --no-fmt
vp run deadcode
vp run i18n:extract
vp run build
vp run package --win --publish never
```

Windows 构建需要 Visual Studio C++ Build Tools 与 Python（Electron 原生依赖）。安装脚本准备解析器和内嵌 PostgreSQL；发行版用户无需单独安装它们。

中英文翻译随源代码提交，离线构建不依赖 Crowdin。研发测试可设置绝对路径 `CS2_PARSER_DATA_DIR` 隔离测试资料；不应把个人 demo、数据库、账号绑定或密钥提交到仓库。

版本和发布流程见 [发布说明](docs/RELEASING.md)。架构及上游工具说明可参考 [CS Demo Manager 文档](https://cs-demo-manager.com/docs/development/architecture)。

## 许可

[MIT](LICENSE)。上游基础提交：`4d8f608443765e5830e43989fa69ca3ebd8b4a3e`。第三方组件声明见 [NOTICE.txt](NOTICE.txt) 和发行版中的 `resources/static/THIRD-PARTY-LICENSES.txt`，保留各组件自己的许可。
