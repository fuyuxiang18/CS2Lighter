# R4 射击时钟实测（2026-10-22）

## 产品结论

本轮不发布版本。已停止输出 R4「压枪失误」风险结论，继续保留 demo 直接记录的逐发射击中心、连射片段、上扬／下压／横摆现象和回放定位。现有证据不能把这些现象进一步解释成「连续射击偏离了当时的对手身体」，也不能据此评分或归因死亡。

原因不是所有录像都没有细粒度时钟：部分录像有完整 UserCmd 和 input_history，甚至可以找到首发对应的攻击历史项。但采样发现，按住连射的大多数后续子弹没有独立攻击索引；命令、玩家预测、渲染、射击广播的时钟也不相同。再加上目标回溯姿态尚未验证，当前无法连续、准确地完成每一发的 shot → target clock 对齐。研究计数留在这里，不增加面向用户的技术缺口面板。

## 读取范围与可用性基线

只读检查了本机 demo 目录的 105 个文件：47 个 `.dem`、58 个 `.zip`，均成功读取小型 header，覆盖 patch 14165～14191。**文件数不是比赛数**：目录里存在同一录像的压缩和未压缩副本。

ZIP 使用 Go `archive/zip` 打开唯一 `.dem` entry 的流直接解析，不解压到磁盘、不修改用户文件。代表样本每次只收集 4001 个 demo tick 的窗口，解析器从文件开头顺序读取以恢复基线，在窗口末尾停止；没有整场位置、骨骼或命令导出，也没有启动数据库、游戏或 Steam。

匿名样本：A 为旧版 Dust2 录制（14165）；B 为较新 Inferno 录制（14190）；C 为最新 Ancient 录制（14191）；D 为最新 Mirage 录制（14191）；E 为 Nuke 录制（14190）。这里按实际消息覆盖区分样本，不从文件名或 header 推断平台类别。

### 窗口 8000～12000

| 样本 | FireBullets | 原始 UserCmd | 成功恢复完整命令 | 广播包执行 tick 下有唯一攻击历史候选 | 候选 player tick 与 FireBullets tick 相同 |
| ---- | ----------: | -----------: | ---------------: | -----------------------------------: | ----------------------------------------: |
| A    |           2 |        44011 |            44011 |                                    2 |                                         1 |
| B    |           5 |        40010 |            25361 |                                    3 |                                         2 |
| C    |          50 |        44011 |            13444 |                                    7 |                                         2 |
| D    |         146 |            0 |                0 |                                    0 |                                         0 |
| E    |         167 |            0 |                0 |                                    0 |                                         0 |

### 窗口 20000～24000

| 样本 | FireBullets | 原始 UserCmd | 成功恢复完整命令 | 广播包执行 tick 下有唯一攻击历史候选 | 候选 player tick 与 FireBullets tick 相同 |
| ---- | ----------: | -----------: | ---------------: | -----------------------------------: | ----------------------------------------: |
| A    |          84 |        44011 |            44011 |                                   32 |                                         6 |
| B    |         111 |        40010 |            28007 |                                   13 |                                         5 |
| C    |         123 |        44011 |            20005 |                                   17 |                                         6 |
| D    |          85 |            0 |                0 |                                    0 |                                         0 |

上述所有窗口的 `FireBullets.extra`、`bullet_damage`、`ShootInfo` 均为 0。候选数量只是研究用关联结果，**不代表已经认证了对应射击时刻或目标姿态**。若同一输入时段有预测、延迟执行、武器冷却等因素，数值接近也不能证明关联。

## 时钟分别代表什么

| 数据                                         | 保留内容                 | 不能替代的内容                        |
| -------------------------------------------- | ------------------------ | ------------------------------------- |
| demo tick / parser frame                     | 消息在录像流中的位置     | 不是射手客户端预测 tick               |
| `CNETMsg_Tick.tick`                          | 当前网络包的服务器 tick  | 不保证等于子弹原始 tick               |
| `FireBullets.tick`                           | 子弹广播显式携带的 tick  | 没有 fraction 时不能制造精确 sub-tick |
| `CMsgServerUserCmd.server_tick_executed`     | 录制的命令执行 tick      | 不等于所有 history 项的 player tick   |
| command/client tick                          | 命令客户端时钟及预测偏移 | 不能直接作为对手回溯时钟              |
| history player tick + fraction               | 相应输入历史项的玩家时钟 | 需要先确认这就是该发射击使用的项      |
| history render tick + fraction               | 相应输入历史项的渲染时钟 | 不自动证明服务器判伤采用了同一时刻    |
| `sv_interp0/1`、`player_interp`、`cl_interp` | 显式记录的插值端点和比例 | 不能只选一个字段当作最终全身姿态      |

字段存在性逐项检查；不使用 protobuf getter 的零值补缺失。完整 pawn handle 必须与当前 controller 所属 pawn 的 index 和 serial 一致。命令包装层的 `server_tick_executed`、`client_tick` 也要检查原始字段是否存在，不能只依赖事件接口中已经变为数字的 getter 结果。

## 为什么不能固定加一个 tick

样本 A 的一发首枪可以观察到：FireBullets 原始 tick 为 66411、广播包 tick 为 66412；包内执行命令的攻击历史项为 player `66411 + 0.88596314`、render `66410 + 0.066802986`。该历史视角与子弹射击中心完全相同，且攻击索引指向唯一项。

但紧接着另一发，FireBullets 原始 tick 为 66426，候选历史项的 player tick 却为 66427；其 pitch 与子弹中心还相差约 0.127°。样本 B 另一次对应候选的 player tick 比 FireBullets tick 大 2。实际命令中的攻击索引也分布在射击原始 tick 的前后，不只出现在 `+1`。

因此：

- 只按 `command.server_tick_executed === FireBullets.tick` 会经常选到按下攻击前的命令。样本 C 早期窗口虽然有 38 发能这样找到唯一命令，选中的命令却全部没有攻击索引。
- 改成固定 `+1` 或广播包 tick，只会得到部分候选，不会自动解决预测、输入历史、子弹中心及目标时钟之间的关系。
- 视角接近不是关联凭据。后坐力本来就可能使输入视角与 FireBullets 中心不同；反过来，静止视角在多个 history 项中相同，也不等于唯一命中时刻。
- 上表中使用 0.001° 比较的辅助探针只用于统计数值差异，没有进入生产阈值或作为正确性的证明。

## 按下攻击与持续射击

`attack1_start_history_index` 是攻击开始对应的历史索引，不是每发子弹的通用索引。样本 C 后期窗口有 123 发子弹，但在广播包执行 tick 下仅 17 发存在唯一攻击历史候选；其余不能通过复制上一发的 index、选择最后一个 history 或选择最近视角补齐。

首发关联成功也不能认证整段压枪。要恢复按住射击的后续子弹，还需证明武器实际开火调度、sub-tick 冷却及命令执行关系，并将每一发与最终射击中心交叉核对；随后仍要解决目标选择、服务器回溯时刻与完整骨骼姿态。目前这些环节没有同版本引擎基准完成验证。

## Delta 缺口不是“没有开启完整解析”

探针明确启用 `UserCmdParsingFull`，并从录像开头读取。A 从 tick 1 就有各 slot 的 full 命令，恢复完整；B、C 开头主要是 delta，部分 slot 在观察结束前始终没有 full baseline。

- B 的不同 slot 首个 full baseline 出现在 tick 5、9、1029、9321、9325 等位置；到 24000 仍有 3 个 slot 没有 full baseline。
- C 的首个 full baseline 分布在 tick 3、11、1024、10560、15374；到 24000 仍有 6 个 slot 没有 full baseline。
- 每个已恢复 slot 的首个完整命令与首个 full payload 出现在相同 tick。缺口对应 pinned parser 的 `WarnTypeUserCommandBaselineMissing`。

不能用后来的快照或另一个 slot 的默认值补造更早的输入基线。以后若做字段级恢复，也需要独立证明该字段的完整赋值、后续 delta 连续性与生命周期，不能将部分恢复标为整个命令已验证。

注意 pinned parser 在这个分支把 UserCmd 警告送入 message dispatcher；本次同时注册 `RegisterNetMessageHandler(func(events.ParserWarn))` 才看到了这些警告。只监听普通事件警告会漏掉这项诊断。

## 复现与产物

本地研究工具位于工作目录 `work/qa-r4-clock-20261022/clock-probe.go`，不参与应用构建。产物只含计数、小型 header 和少量匿名时钟例子；私人文件名留在未提交的本地报告中，本文不记录账号或私人文件名。

从项目根目录，在已有 Go 工具链环境下运行：

```powershell
$clockQa = Join-Path (Split-Path (Get-Location) -Parent) 'work/qa-r4-clock-20261022'
Push-Location tools/death-evidence
go build -trimpath -ldflags='-s -w' -o "$clockQa/clock-probe.exe" "$clockQa/clock-probe.go"
Pop-Location

# 输入目录和代表样本路径由本地操作者指定；不会解压 ZIP 到磁盘。
& "$clockQa/clock-probe.exe" -headers $demoDirectory
& "$clockQa/clock-probe.exe" -start 8000 -end 12000 @samplePaths
& "$clockQa/clock-probe.exe" -start 20000 -end 24000 @samplePaths
```

窗口上限为 4096 tick，命令缓存上限为 100000 条。`headers.json`、`representative-windows.json`、`association-windows.json`、`packet-association-windows.json`、`later-windows.json` 是本次本地结果；不同探针阶段的诊断字段有所增加，最终统计以上文的两个窗口为准。

## 原始协议与实现依据

- [Valve UserCmd / input_history 协议](https://github.com/SteamTracking/GameTracking-CS2/blob/master/Protobufs/cs_usercmd.proto)：各类时钟、插值参数与攻击历史索引的独立字段。
- [Valve 网络消息协议](https://github.com/SteamTracking/GameTracking-CS2/blob/master/Protobufs/netmessages.proto)：命令包装层的完整 payload、delta、执行 tick 和客户端 tick。
- [Valve FireBullets 协议](https://github.com/SteamTracking/GameTracking-CS2/blob/master/Protobufs/cs_gameevents.proto)：射击原始 tick、中心角、可选 Extra 的攻击／渲染 sub-tick。
- [Valve ShootInfo 协议](https://github.com/SteamTracking/GameTracking-CS2/blob/master/Protobufs/cstrike15_usermessages.proto)：frame number、射击方向与命中盒 transforms；定义存在不表示样本录制了这些字段。
- [本项目锁定的 demoinfocs 命令重建实现](https://github.com/markus-wa/demoinfocs-golang/blob/8e1342e6585c/pkg/demoinfocs/s2_commands.go)：full baseline、delta、ring slot 和失败时的处理。

协议字段解释与本次实际观察分开使用。本文的具体覆盖率、tick 差异和 baseline 到达时刻来自真实录像有限窗口，不是根据字段名称推算。
