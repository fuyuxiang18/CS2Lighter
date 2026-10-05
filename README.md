# CS2Lighter

用于个人 CS2 demo 复盘的 Windows 桌面软件。指定本地文件夹，自动解析对局，查看个人数据、跨比赛习惯、位置热力图和回合证据。

当前版本 **0.5.0**，支持 Windows 10/11 x64。

## 下载与使用

从 [Releases](https://github.com/fuyuxiang18/CS2Lighter/releases/latest) 下载安装包。软件默认简体中文，也可切换 English。

1. 在设置中添加存放 demo 的文件夹，可以添加多个并递归扫描。
2. 在完美等平台下载并解压 demo 到这些文件夹。CS2Lighter 不下载对局，只读取完整的 CS2 `.dem` 文件。
3. 等待逐场进度完成。解析、入库和数据文件生成期间显示当前第几个 demo，并暂停数据浏览；设置仍可使用。失败或未下载完整的文件会单独提示。
4. 输入录制时使用的准确昵称。找到账号后按 SteamID 绑定，后续同账号更名仍可归集；同名多个账号需自行确认。
5. 在“复盘工作台”选择反复出现的场景，回看对应回合后标记“已复盘”或“战术安排”，并选择一个下一场要尝试的动作。
6. “我的风格”展示真实行为比例；“练习与进步”按相同地图、阵营、来源、模式及游戏版本比较自己。练习之后只统计发生时间晚于开始时间的比赛，导入旧录像不会被算作练习成果。
7. “地图习惯”中点击有数据的区域回看例子。“比赛记录”提供逐场入口，展开详细统计可查看完整战绩、道具、经济、武器和趋势。
8. “对枪与第一视角”可从首杀成功率进入完整首杀/首死列表，或查看所有击杀、对枪死亡和伤害遭遇。每条事件可打开 CS2 真实 POV，也可按需录制后在软件内播放；未造成伤害的交火暂不检测。
9. 在“设置 → AI 点评”配置云端 OpenAI 兼容 API 或本机 Ollama。个人风格和每场比赛均可生成点评，保存后直接读取。仅点击生成时调用模型，不自动批量调用或上传视频。

本版重点是从发现数据到核查画面，再选择下一场可尝试的动作。首死、未被补枪、友军致盲等只是候选事件，不会被自动判为失误；比例变化也不等于训练有效。使用流程与范围见 [0.5 产品说明](docs/PRODUCT-0.5.md)，早期产品取舍与竞品调研见 [0.4 产品说明](docs/PRODUCT-0.4.md)。

个人指标包含爆头率、K/D、ADR、KAST、Rating 1.0 历史公式、RWS 本地计算、首杀／首死、补枪、残局、多杀、闪光和道具伤害等。计算口径、覆盖范围及调研来源见 [指标说明](docs/METRICS.md)。不提供封禁查询、置顶玩家或高手学习工作区。

统计来自 demo 已记录的数据。2D 朝向是记录的水平朝向，不等于第一人称真实画面或“最佳对枪角度”。精准定位 POV 播放需要本机 CS2、Steam、HLAE 及兼容的 demo。

片段录制需要 Steam、CS2、HLAE 与 FFmpeg，会打开游戏窗口。影片存于用户数据目录 `review-clips`。AI 仅分析统计与抽样事件，不看这些影片，也不会根据爆头率虚构预瞄或反应评分。模型建议需要回看验证；云端服务可能收费，密钥由本机操作系统加密保存。详细说明见 [AI 统计复盘](docs/AI-REPORTS.md)。

## 更新与数据

在“设置 → 关于 → 应用更新”检查、下载并重启更新。更新来自本项目的 GitHub Releases，无需登录 GitHub。

从 0.1.0 需要手动安装新版一次，以获得应用内更新功能；0.2.0 及以后可在应用内升级。**安装器应用标识、可执行文件名和数据路径保留兼容**；内部文件名仍是 `cs2-parser.exe`，Windows 数据仍在 `%LOCALAPPDATA%\CS2Parser`。原始 demo 保留在你选择的目录，绑定和旧笔记保存在同一用户数据目录的 `ui` 子目录。

每个 demo 对应一个 `demodata/<checksum>.json` 数据文件，优先放在安装目录内，例如 `cs2-parser\demodata`。目录不可写时使用用户数据目录下的 `demodata`，界面显示实际位置。升级后已入库的 demo 只需生成一次数据文件，不会重新解析原始 demo；之后进入复盘页面或筛选时直接读取缓存。重新解析、地图数据修正或缓存格式升级后会重建相关文件。

更新不会删除数据库、绑定或缓存。手动备份时先退出软件并等后台任务结束，再备份完整用户数据目录和实际 `demodata` 目录；原始 demo 单独备份。

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

版本和发布流程见 [发布说明](docs/RELEASING.md)。

## 鸣谢与许可

感谢 [CS Demo Manager](https://github.com/akiver/cs-demo-manager) 和其贡献者提供开源基础。遵循 [MIT](LICENSE)，基础提交：`4d8f608443765e5830e43989fa69ca3ebd8b4a3e`。第三方组件声明见 [NOTICE.txt](NOTICE.txt) 和发行版中的 `resources/static/THIRD-PARTY-LICENSES.txt`。
