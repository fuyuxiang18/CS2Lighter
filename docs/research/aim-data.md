# R4：从 demo 动画数据到射击时刻的身体范围

验证日期：2026-10-22。本次没有启动游戏或数据库，也没有导出整场的逐帧动画。

## 结论

**“demo 没有动画数据”不准确。** 真实录像包含 AG2 姿态指令、任务类型表、动画资源索引和骨骼名称表；本次已经把这些数据的提取、上下文解码和任务依赖图解码加入软件。它们还不是最终骨骼矩阵。R4 要比较“每发射击中心是否持续偏离对手身体”，仍需要执行完整姿态指令，并与该发射击的目标时钟对齐。

同样，**“游戏模型没有命中盒”不准确。** 本机模型 `agents/models/ctm_fbi/ctm_fbi.vmdl_c` 的 MDAT 包含 `cstrike` 命中盒集，实查为 19 个绑定骨骼的胶囊。能读到静态胶囊定义，不等于已经知道每发射击时胶囊在世界中的位置。

## 已经实际取得的数据

### 1. Demo 内的动画上下文

在 patch 14190 的 Nuke 录像中，初始 `AnimTaskTypes` 表有 16 项，`AnimAssetData` 表有 21 项。到第 8000 tick，后续增量把资产表补到 28 项。本次实现同时处理建表和增量更新，不能只读取开场快照。

实际解码结果包括：

- worldmodel 图的有序资源列表：975 项。
- 人物骨架的有序骨骼列表：75 项。
- 人物骨架的骨骼遮罩名称：12 项。
- 多个武器骨架的独立骨骼列表。

这些列表携带的是原录像的索引顺序。排序、去重或用当前游戏的资源遍历顺序替换，会导致同一个二进制索引指向错误资源。

`AnimAssetData` 当前实测格式为小端版本号 1，后接计数和以 NUL 结束的 UTF-8 字符串。图记录包含资源列表；骨架记录包含骨骼列表和遮罩列表。实现检查版本、UTF-8、长度、计数、尾部剩余字节，并拒绝未知格式。

### 2. 每个玩家的当前姿态指令

玩家 pawn（不是 controller）包含以下可读数据：

- 当前 AG2 recipe 版本、激活的 topology slot、动态图指令字节。
- 服务器图实例迭代号、序列化上下文迭代号。
- 主图、外部图、外部 clip 的资源 ID。
- 次级骨架与对应 slot。
- 模型 ID、旋转、缩放、命中盒集和 root bone offset。

实测 recipe 版本为 3，动态数组常见长度为 128 字节。数组字节不能按“出现 0 就结束”截断；尾部也有合法的 0。当前 parser 对越界的索引路径还可能返回 `present=true, value=nil`，因此实现读取根数组的声明长度，校验其中每个字节，而不是用逐项 `present` 猜长度。64 位资源 ID 保留为十进制字符串，不能经过 JavaScript 浮点数转换。

### 3. 已经解开的任务依赖图

参考公开的 [Esoterica 任务序列化定义](https://github.com/BobbyAnguelov/Esoterica/blob/main/Code/Engine/Animation/TaskSystem/Animation_TaskSerializer.h) 后，对真实二进制进行核对：一个玩家的 32 个 topology 缓存槽全部能解成依赖合法的 DAG，剩余仅 0～7 位字节填充。16 项任务表使用 5 位索引，错误地使用 4 位会产生大量向前引用。

当前已核对并识别 Sample、Blend、AdditiveBlend、ModelSpaceBlend、CachedPoseWrite、AimCS、SnapWeapon 七类任务的拓扑。生产解码仅启用实测 patch 14190、recipe 3，未知任务、错误依赖、未知版本、非零填充和截断输入均拒绝。测试包含匿名化的真实 5、7、13、30 项任务图；其中没有账号、位置、比赛 ID 或完整 demo。

必须区分两步：拓扑说明“先执行谁、后执行谁”；动态数据说明任务参数。后者还要结合 clip、骨骼遮罩和姿态缓存执行，才能得到骨骼位置。开源代码展示了这种执行关系，但并不证明 CS2 所有私有任务都与其相同。[任务执行实现](https://github.com/BobbyAnguelov/Esoterica/blob/main/Code/Engine/Animation/TaskSystem/Animation_TaskSystem.cpp)

### 4. 游戏资源的命中盒定义

用项目已有的 Source2Viewer CLI 只读取了一个人物模型的 MDAT/PHYS 和 worldmodel 图的 DATA。MDAT 中的 19 个胶囊有骨骼名称、局部端点和半径。例如该本机模型头部胶囊半径为 4.3，颈部为 3.5。PHYS 内的 ragdoll 形状和 bind pose 不能当作开枪时的活体命中盒。

ValveResourceFormat 从模型的 MDAT 暴露命中盒集，并提供模型、骨架与动画资源读取能力。[Model 实现](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/ValveResourceFormat/Resource/ResourceTypes/Model.cs)

**本机资源版本是 patch 14191 / ClientVersion 2000934 / Steam build 26087496，样本录像有 14190 和 14165。** 本次读取说明数据可获得，不能用它认证旧录像的身体范围。资源路径 ID 识别路径，不能替代资源内容校验；未来需要保留匹配版本的模型、骨架、clip 与图资源，或证实有关资源在两版之间逐字节相同。

## 真实录像抽查

前期每份只顺序读到约第 12000 tick，并保存计数和一份无身份信息的动画结构快照：

| 样本      | patch | FireBullets | Full UserCmd | history 条目 | ShootInfo / FireBullets.extra |
| --------- | ----: | ----------: | -----------: | -----------: | ----------------------------: |
| Ancient A | 14190 |         316 |            0 |            0 |                         0 / 0 |
| Nuke B    | 14190 |         276 |            0 |            0 |                         0 / 0 |
| Dust2 C   | 14165 |          78 |       132011 |       513222 |                         0 / 0 |

Dust2 C 的 history 包含 view angles、render/player tick 与 fraction；target entity、target head position、target absolute position/angle 均未出现。Nuke B、Dust2 C 的 `CDemoAnimationHeader/Data` 消息也未出现，实际动画数据来自实体字段和上述字符串表。不能因 protobuf 定义存在就认为这份录像发送了对应数据。

新提取器又分别验证了 8000～8002 三个 tick：

| 样本      | 帧数 | 当前玩家 recipe 数 | 非空 dynamic 数 | 上下文资产数 | 总流大小（含原有世界数据） |
| --------- | ---: | -----------------: | --------------: | -----------: | -------------------------: |
| Ancient A |    3 |                 30 |              30 |           24 |                 约 0.83 MB |
| Nuke B    |    3 |                 30 |              30 |           28 |                 约 1.19 MB |
| Dust2 C   |    3 |                 33 |              33 |           25 |                 约 0.67 MB |

三份均正常结束、上下文解码无错误。旧版 C 的原始动画仍予以保留，但不会套用 14190 的已核对拓扑规则。

## R4 还要补齐什么

1. **CS 专用姿态任务的动态参数和执行。** 每个已观察到的常见活体图末端都有 `CNmAimCSTask`、`CNmSnapWeaponTask`。当前只识别了它们的输入依赖，还没有验证其数值计算。不能凭名称断言只影响手臂、不会改变身体范围。
2. **完整 clip 采样、混合、遮罩、缓存与次级骨架。** 只读取基础站姿、只执行前面的 Sample，或跳过未知末端任务，都会得到一个看起来像人的错误姿态。必须从已匹配的原版资源执行整条链，覆盖姿态缓存生命周期、插值和 root offset。
3. **射击与目标的时钟对齐。** FireBullets 是射击事件；窗口帧是网络状态。目标在射手画面中的 render clock、服务器判伤使用的回溯 clock 和 frame-end 状态不能混用。部分录像有更完整 UserCmd，但仍需唯一关联到实际射击、排除历史缺口，并核对最终射击方向。直接用最近一帧不是证明。
4. **完整命中盒覆盖与遮挡。** 胶囊要随经过验证的最终骨骼变换，计入全部命中部位，再与地图动态实体及烟雾状态共同求证。地图移动 hull、视图 AABB、模型静态 mesh bounds 都不能替代动画后的全身范围。

公开的 [CS2 UserCmd 协议](https://github.com/SteamTracking/GameTracking-CS2/blob/master/Protobufs/cs_usercmd.proto)、[射击事件协议](https://github.com/SteamTracking/GameTracking-CS2/blob/master/Protobufs/cs_gameevents.proto) 和 [ShootInfo 协议](https://github.com/SteamTracking/GameTracking-CS2/blob/master/Protobufs/cstrike15_usermessages.proto) 提供了可继续研究的时钟/变换入口。ShootInfo 的 hitbox transforms 在本次样本未发送，不能成为通用前提。

## 本次代码与存储边界

- `tools/death-evidence/animation.go` 只缓存两个动画表，并处理后续增量；其他表只记 ID 与必要格式，不保存用户信息。
- `animation-context` 在请求窗口内首次使用或上下文改变时发出；消息携带自己的 ID。不会每一帧重发 975 项列表。
- 每帧玩家只带激活 slot 的 topology 和当前 dynamic，不复制全部 32 个缓存 slot，也不保存整场骨骼轨迹。
- 单份解压 payload、总动画上下文均限 1 MiB；数组最多 4096 字节，任务表最多 255 项。原有 2 MiB 单行、128 MiB 总输出上限继续生效。
- `animation-evidence.ts` 解出有序资产列表和任务 DAG；`buildAnimationEvidence` 展示提取到的内容以及阻塞任务。它按 SteamID 唯一匹配玩家，拒绝同帧身份歧义、未来上下文和重复上下文 ID。
- 结果没有任何可被误用为“全身姿态已经验证”的布尔值。R4 的正式判定入口仍要求真正的射击中心、目标关联、全身和时钟证明。

下一阶段应先对受控测试录像收集同版本引擎输出的最终骨骼/命中盒基准，逐任务验证离线执行结果，再开放 R4 结论。当前成果已将缺口从笼统的“没有骨骼数据”，收窄到可复现的任务执行与时钟验证工作。
