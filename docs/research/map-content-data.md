# Demo 地图版本与本机资源匹配（2026-10-22）

本轮没有发布新版本。新增的是可核验的资源匹配路径，不把地图名称相同、安装日期相近或协议号相同当作地图相同。

最终生产目录仅接受已闭合且核实完整的 **14190** 发行集合。14191 仍是开放协议版本，后续可能出现同协议的新资源；因此即使截至核验日的四份清单一致，生产也返回无可用认证依据。下面保留 14191 的历史研究过程和实测记录，不作为生产授权。

## Demo 中实际提供了什么

只读抽样了直接保存的 demo 和 ZIP 内的 demo 流；每份最多读前 48 个外层消息，实际读取约 0.4～0.65 MB，没有展开整批录像。

- 新 Mirage 样本报告 `patch=14191`；旧 Nuke / Inferno 样本报告 `patch=14190`。
- 这些样本的 demo header `buildNum` 都是 `10924`，不能区分这两代资源，更不是 Steam 的 build ID。
- 当前 [CSVCMsg_ServerInfo 定义](https://github.com/SteamTracking/GameTracking-CS2/blob/master/Protobufs/netmessages.proto) 没有地图 CRC / SHA 字段。抽样的 header / server-info 也没有额外未知 protobuf 字节。
- `game_session_manifest` 不能作为地图指纹：14190 Nuke、14190 Inferno、14191 Mirage 三份不同地图样本具有完全相同的 9,391 字节值，其 SHA256 为 `7e505dc8755d97022fddab1f7c7bb3dca8c624153f31467eb835243da945ed50`。
- 前 48 条消息未见可补充地图内容身份的 SpawnGroup_Load；这不等于断言整份 demo 都没有该消息。

## 采用的内容依据

[Steam ContentManifest protobuf](https://github.com/SteamDatabase/Protobufs/blob/master/steam/content_manifest.proto) 的 `FileMapping.sha_content` 是文件内容哈希。[SteamKit 的解析器](https://github.com/SteamRE/SteamKit/blob/master/SteamKit2/SteamKit2/Types/DepotManifest.cs) 将它作为文件 SHA1 使用。

当前本机安装为 ClientVersion `2000934`、PatchVersion `1.41.9.1`、Steam build `26087496`，共享 depot `2347770` 的 manifest 为 `6962766052972832680`。本机 depotcache 还保留了 2000933 的 `2520908610273941189`，没有 14190 的历史索引。旧、新本地 manifest 的共享包字节完全一致，只有三项非地图文件变化；这只能证明 933 / 934，不能外推整个协议版本。

因此按 demo patch 收集截至 2026-10-22 能核对的对应公开发行快照，逐个比较地图 VPK 的完整文件大小和 SHA1。已核对的固定快照如下：

| Demo patch | ClientVersion | Depot manifest      | 固定 GameTracking-CS2 commit                                                                                                              |
| ---------- | ------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 14190      | 2000930       | 4758919807587010422 | [f68ba6a](https://github.com/SteamTracking/GameTracking-CS2/blob/f68ba6aa2473367589e7cb249fc38814c9b90ff0/manifests/manifest_2347770.txt) |
| 14191      | 2000931       | 7851647903998529455 | [dad1537](https://github.com/SteamTracking/GameTracking-CS2/blob/dad153781103f47acc83d93f7097dc438b36f2fc/manifests/manifest_2347770.txt) |
| 14191      | 2000932       | 2312433566686574487 | [df666dc](https://github.com/SteamTracking/GameTracking-CS2/blob/df666dcbaa6f0d0cd713426537d9f71fddc442b3/manifests/manifest_2347770.txt) |
| 14191      | 2000933       | 2520908610273941189 | [34d3b47](https://github.com/SteamTracking/GameTracking-CS2/blob/34d3b4798accc0402d796f1f33159fcc3e196fe2/manifests/manifest_2347770.txt) |
| 14191      | 2000934       | 6962766052972832680 | [609b2ac](https://github.com/SteamTracking/GameTracking-CS2/blob/609b2aca32e129e094990e163771d6b86880f65f/manifests/manifest_2347770.txt) |

同时核对各 commit 的 `game/csgo/steam.inf`。`steam.inf` 路径 9 月 25 日～10 月 15 日的历史表明：10 月 2 日 2000924 是 14188，10 月 5 日 2000927 是 14189，直到 10 月 8 日 2000930 才进入 14190，10 月 14 日切到 14191。`manifest_2347770.txt` 路径 10 月 8 日～10 月 15 日的历史只有 f68ba6a / dad1537；14191 到 10 月 22 日的该路径也只有上述四份，没有发现未改 steam.inf 的额外 manifest。**不能把 10 月初的旧 demo 错算成 14190。**

上述五份 manifest 中，本轮加入目录的完整地图包一致：

| 地图       | 文件字节数 | SHA1                                       |
| ---------- | ---------: | ------------------------------------------ |
| de_ancient |  405482447 | `23345406e58342cea5140e6cfa15e96907d362cc` |
| de_dust2   |  262476433 | `7dc529cd65d843a2b8a98c297e79b9923dd70a5d` |
| de_inferno |  453401552 | `ffba75060715b1f315209c28df94646781fe3365` |
| de_mirage  |  176187297 | `0def8c7402b1ecf6d387f6e559d210b5a1856b32` |
| de_nuke    |  246935525 | `a188f671b2feb154a38bddab5df3e33a0b57a6a0` |

公开清单来自 SteamTracking 对 Steam depot 的固定快照，来源 URL 保存在此处；不是 demo 自带的哈希，也不宣称这些 GitHub 文本有 Valve 数字签名。生产使用已闭合集合的文件大小、SHA1 和候选 manifest ID，不访问网络，不自动下载历史资源。14191 的四份候选仅代表截至 2026-10-22 的已核验发行范围；仅增加一条截止日期提示不能阻止未来同协议录像误用这些清单，因此代码明确拒绝该开放集合。今后只有确认集合闭合并重新核实完整内容，才能加入生产目录；文件修改时间或录像日期不能替代此条件。

## 已落地的判定与边界

1. `visibility-content-catalog.ts` 按 demo patch 查询已核对且闭合的候选集合，目前只有 14190。开放的 14191、没有完整依据的旧 patch 和未知地图均返回无参考依据；此前研究运行的 14191 证书也不能通过生产几何来源校验。
2. `visibility-content-proof.ts` 对本机地图包实际字节计算 SHA1，和候选集合共同的文件哈希比对，同时计算本地缓存使用的 SHA256。安装版号仅记录来源，不再直接拒绝内容未变化的跨版本地图，也不因版号相同直接放行。
3. `visibility-resource-audit.ts` 递归检查所有地图 world / world-node / entity-lump 的模型依赖。只允许内容证书覆盖的目录项和载荷；共享包、分包载荷未获证书时拒绝导出完整地图。
4. 动态模型解析器对主模型、外部 mesh、磁盘缓存内的每项依赖和已解析内存结果都重新检查资源证明。地图的证书不会给同名的当前共享模型授权；CRC32 / 大小只用于绑定已认证目录中的条目，不能代替历史内容哈希。
5. 解析过程中地图文件变化会撤销证明；取消请求传播。哈希仅在当前进程中按路径、大小、mtime、ctime、inode 缓存，文件变化触发重新读取，不增添大体积持久副本。
6. 结果来源为 `content-manifest-matched`，记录候选 manifest 集合和地图 SHA1；`demoFingerprint` 仍为 null。旧保存证据继续由既有身份、比赛修订号和缓存校验处理，不能因为加了新匹配方式改写成新算的证据。
7. 自包含地图的派生网格按地图名称、内容 SHA256、证书及导出器标识复用。安装 build、未使用的共享 pak 变化不产生新的网格副本；返回结果仍记录本次实际看到的安装元数据。

本地逐资源读取检查了 Mirage 598、Inferno 787、Dust2 520 个几何依赖，全部载荷包含在各自完整地图 VPK 中。Nuke 709、Ancient 373 个依赖还包含共享包资源：尽管它们所在的部分 archive 文件在若干 manifest 中未变化，**历史 pak 目录的名称到偏移映射尚未认证**，所以本轮不放行其完整地图。共享目录 `pak01_dir.vpk` 在 14190→14191 以及 14191 自身 931→933 中都变化过。

动态地图内资源可以获证；缺少共享动态模型证明时，现有枪线逻辑保留 unknown，不将未解析物体当作不存在。地图准备成功不等于该死亡窗口每条枪线都可判定；烟雾、动态状态和未获证据的模型仍可能阻止结论。

### 材质语义的独立边界

资源版本正确不等于每个渲染面都能遮住视线。复核固定 Source 2 Viewer 20.0 发布 commit `a06886f7d06049052d32a7381ec05523064a2ca0` 后确认：[CLI 默认不导出材质](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/a06886f7d06049052d32a7381ec05523064a2ca0/CLI/Decompiler.cs#L153)，未开启时 [mesh exporter 不为 primitive 挂载材质](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/a06886f7d06049052d32a7381ec05523064a2ca0/ValveResourceFormat/IO/GltfModelExporter.Mesh.cs#L413)。当前地图调用正是此模式。因此不能按 glTF 缺少 alphaMode 时的默认 OPAQUE，把玻璃或裁切纹理几何判成确定掩体。

即使显式开启材质导出，[其转换](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/a06886f7d06049052d32a7381ec05523064a2ca0/ValveResourceFormat/IO/GltfModelExporter.Material.cs#L55) 主要依据 `F_TRANSLUCENT`、`F_ALPHA_TEST`、玻璃 shader 名称和背面开关；它本身不是对 CS2 所有 shader、贴图裁切与运行时材质状态的认证。本轮同步修复网格解释：渲染面相交但无原游戏遮挡证明时返回 unknown；几何依赖完整、射线未碰到任何渲染面时仍可返回 clear。位置网格可以复用，不能让旧的“命中三角形即 blocked”衍生报告绕过新语义。

## 无法凭本轮资料认证的旧录像

用户本人已缓存的 28 场对应 14165～14175，并不属于上述 14190 / 14191 样本。相关 10 个 patch 的 20 个 hotfix 版本已经枚举，但 GameTracking 的 depot manifest 历史从 2026-10-04 才开始；更早固定 commit 没有这些文件级 SHA1 清单。不能把这 28 场说成已匹配，也不能说成已证明地图变化：目前是缺少足够的历史内容依据。

尝试了 [DepotDownloader](https://github.com/SteamRE/DepotDownloader) 匿名获取固定历史 manifest，并以只含 `game/csgo/pak01_dir.vpk` 的 filelist 限定最多约 7.7 MB 索引。正确 app `730` / depot `2347770` 可取得 AppInfo 和 depot key，但历史 manifest `4758919807587010422` 的请求 code 为 0，CDN 返回 401。随后停止，没有使用用户登录、启动 Steam / 游戏或下载整个 depot。最初使用 ServerAppID 2347773 的尝试也被 depot 权限拒绝，不构成资源不存在的证据。

后续可增加经过独立验证的历史完整文件 / 资源内容哈希或历史目录证明。只要候选版本仍不确定，不能直接扩白名单、用 CRC32 替代完整文件证明或以当前地图覆盖旧版本。

## 验证

内容目录、实际字节校验、依赖审计、地图准备及模型缓存测试覆盖同大小内容篡改、共享目录误用、外部分包、错误资源条目、旧缓存绕过、内存结果失效、取消、缺失历史参考和无关安装热更新后复用网格。最终收口增加了开放集合及其旧证书的拒绝测试。真实数据和导出文件均留在忽略的 work 目录，不提交用户录像或标识。

已完成的真实负向样本：本人 Inferno 14165 的 449 帧死亡窗口完整读取，返回 `map-content-reference-unavailable`；另一个 Nuke 14190 的 449 帧窗口完整读取，但一个共享火警装置模型缺少历史目录证明，返回 `map-render-dependencies-missing:unverified-content:...`。两者都没有借用当前模型硬给枪线结论。Inferno 14190 的地图导出达到 QA 总大小限制后被取消，临时导出已由生产 finally 清理，未计作成功的枪线验证。

截至核验日的 Mirage 14191 研究构建曾用同一解析、地图准备、动态模型和枪线实现跑完真实死亡窗口。该研究运行发生在最终关闭开放集合认证之前，**当前生产不会为这个 14191 窗口生成地图证书**：

| 项目         | 实测结果                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Demo 窗口    | 449 / 449 帧，13 次射击                                                                                                 |
| 地图来源     | `content-manifest-matched`                                                                                              |
| 几何         | 1,291,734 个三角形；网格缓存 12,054,187 字节（约 12.05 MB）                                                             |
| 模型解析     | 65 个模型，38 个 ready，27 个因内容未认证而 unavailable                                                                 |
| 枪线         | 2,240 条，全部 unknown；clear = 0，blocked = 0                                                                          |
| unknown 原因 | 1,555 条 `active-smoke-bounds-unverified`；685 条 `unsupported-environment-classes`，唯一未支持类为 `CPlayerVisibility` |
| 材质检查     | GLB 的 3,488 个 primitive 均没有 material，材质数量为 0；临时 GLB 已清理                                                |

这记录了截至核验日的资源比较和调用链研究结果，**没有证明该死亡窗口的有效判定覆盖提升**，也没有产生暴露人数、确定掩体或相关死亡原因结论，更不授权以后任何 14191 录像使用这份地图证书。匿名结果保存在本轮忽略的 `work/qa-gunline-production-20261022/mirage-library-participant-summary.json`，没有提交完整私人帧或用户标识。
