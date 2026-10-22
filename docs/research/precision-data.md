# R1–R3 精度数据复核（2026-10-22）

## 缺的具体是什么

FireBullets 已经记录这一发的总不准度、随机散布半径、射击中心方向和后坐力序号。这可以回答“这一发精度是多少”，但总量本身不能回答损失来自移动、落地、上一轮连射、转向还是开镜状态。游戏资源提供武器模式的静态参数，不能补回录制服务器未发送的动态状态。

| 规则            | 可以读到的数据                                            | 还需要的证据                                                                   |
| --------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| R1 首枪未急停   | 实际总不准度、逐帧速度、首发后坐力序号、武器参数          | 射击时直接移动分量；或排除其他分量后的严格残差，不以接收帧速度代替开枪瞬间速度 |
| R2 落地开枪过早 | 地面标志、垂直速度、完整跳落过程、实际精度与 penalty 轨迹 | 孤立的跳落区间与射击时刻；排除转向、姿态、前次射击、装填等同时变化             |
| R3 续枪过早     | 前次射击、实际射击节奏、后坐力序号、penalty 的衰减轨迹    | 重启射击前残余损失的归因；不能把未知转向或隐含移动算成连射恢复损失             |

## 本次补上的生产路径

1. 增加独立 `bullet_damage` 原始事件通道。Valve 的事件定义包含总不准度、移动/空中分量、攻击与渲染的 tick/frac、实际目标与距离等字段。
2. 事件不会只按“同 tick”关联。要求射手完整实体身份、武器生命周期、唯一伤害目标、服务器时钟、攻击时钟、总量和后坐力序号全部一致；重复记录、多目标、缺字段、相互矛盾都不采用。事件计数必须与提取结果一致。
3. 如果 `FireBullets.extra` 或独立伤害事件明确传送移动分量、空中分量和射击时是否在空中，R1 可以使用这一发的直接分量。该路径不再要求一个实际上不需要的静止历史起点，也不再被未传输的 `m_flTurningInaccuracy` 阻挡。
4. 对直接分量，用“这一发总不准度减去这一发移动分量”展示保持其他条件不变时的精度范围。不计算命中概率，不把它冒充静止站姿的武器基线。
5. 显式录制的 `sv_turning_inaccuracy_enabled=0/false` 可排除转向开关；缺失时不采用游戏默认值。与已读到的非零转向值冲突时仍拒绝归因。
6. 测量结果保存 `measurementSource`、`movementInaccuracy`、`airborneInaccuracy`，区分 `fire-bullets-extra` 和 `bullet-damage`。原始总量保留。

直接路径目前仍使用已验证的 patch 14190 武器资料，保持单弹、武器模式等限定。直接分量的因果比较本身不需要静态站立参数，但不能把未验证的其他版本资料标成已验证；本次没有借此绕过版本检查。

## 实际 demo 复查

只读扫描了四份现有 demo 的完整事件流，没有启动游戏或访问数据库，也没有导出整场位置。

| 样本           | FireBullets | FireBullets.extra | bullet_damage | 精度相关 ConVars |
| -------------- | ----------: | ----------------: | ------------: | ---------------: |
| Ancient 样本   |        2308 |                 0 |             0 |                0 |
| Nuke 样本      |        2480 |                 0 |             0 |                0 |
| 第三种录制样本 |        3343 |                 0 |             0 |                0 |
| 第四种录制样本 |        2079 |                 0 |             0 |                0 |
| 合计           |       10210 |                 0 |             0 |                0 |

因此新通道能处理包含这类记录的 demo，但不能宣称已给这四份录像补出直接分量。对 Ancient 原有 1501 tick / 98 发窗口回归，新代码仍未输出精度归因：4 发没有超出对应静态基线，89 发无法分离分量，5 发射击状态不完整。没有通过调宽阈值制造命中数量。

还直接检查了该 Ancient demo 的 flattened serializer：`m_fAccuracyPenalty` 和 `m_flDuckAmount` 是 32 位 float；`m_flTurningInaccuracy` 不在 serializer 中。后者是这份录像里没有传输，并非请求字段漏写。速度相关字段存在量化编码，且快照不是完整的 sub-tick 输入过程。

## 进一步解析与资源读取的边界

- 可以继续读取已有的 `FireBullets.extra`、`bullet_damage`、实际 ConVars、UserCmd/input_history，以及对应版本武器资源。必须以实际记录是否出现为准，不能把协议里“定义了字段”当成“该 demo 含有字段”。
- 完整 UserCmd 有望排除某些区间的输入变化，但还需要准确的玩家与攻击/渲染时钟关联。两个 tick 的视角恰好相同不能证明中间没有转向。
- 用旧 CS:GO 公式、统一速度阈值、当前客户端默认 cvar 或经验拟合补齐缺失成分，都不能证明这一场服务器实际采用了同样状态。本次没有采用这些捷径。
- 单独读取 `weapons.vdata` 能提供静态参数，不能还原未录制的动态 `m_flTurningInaccuracy` 或射击瞬间的实际状态。R2/R3 在现有样本中的这一缺口仍存在；需要含更完整动态记录的录像，或得到经过同版本对照验证的完整机制重建，才能继续扩大准确归因范围。

## 复核来源

- [Valve FireBullets 协议](https://github.com/SteamTracking/GameTracking-CS2/blob/master/Protobufs/cs_gameevents.proto)：`Extra` 中的精度分量与 sub-tick 字段，以及显式 `player_inair`。
- [Valve 游戏事件定义](https://github.com/SteamTracking/GameTracking-CS2/blob/master/game/csgo/pak01_dir/resource/mod.gameevents)：独立 `bullet_damage` 字段。
- [demoinfocs 的事件接口](https://github.com/markus-wa/demoinfocs-golang/blob/8e1342e6585c/pkg/demoinfocs/events/events.go)：录制类型影响细粒度弹道记录是否存在。
- [维护者关于缺失 bullet_damage 的说明](https://github.com/markus-wa/demoinfocs-golang/issues/618)：事件描述存在不等于事件本身在录像中出现。
- 本地同版本 `scripts/weapons.vdata_c` 与 demo send-table schema：本次原始资源与编码验证。
