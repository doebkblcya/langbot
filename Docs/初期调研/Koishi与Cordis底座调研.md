# Koishi 与 Cordis 底座调研

> 历史调研归档：以下选型、版本、权限与部署状态只代表当时的记录，不作为当前实施计划。当前决定见 [需求记录](../需求记录.md)，实际完成情况见 [实现进度](../实现进度.md)。

日期：2026-10-13。范围：官方文档、上游源码与 npm 发布元数据。未安装依赖、构建或运行机器人，未在 NAS 部署；以下结论为静态评估。

状态更新（2026-10-14）：用户已选择 TypeScript＋Cordis 4，自行编写小狼主链路，现有项目作为参考。本文的 Koishi＋ChatLuna 组装建议及版本表保留为历史调查，不代表当前采用。最新功能设计、路线问题和待讨论事项见 [主链路功能与执行流程](../主链路.md)。

## 1. 当时的结论与决策状态（历史记录）

**助手建议：优先验证 TypeScript＋Koishi，以现成基础插件组装完整小狼；ChatLuna 作为默认聊天／Agent 链路的首个候选。**先验证实际组合，再决定需要编写多少自有代码。当前不建议自研插件内核，也不建议先将 Harness 整套嵌入机器人。

用户已经确认的目标是完整、轻量、可独立部署的小狼，以及包括主链路在内的插件化；已明确允许直接使用 Koishi 及其基础插件进行组装。TypeScript 是用户当前倾向和本轮优先研究方向，具体发布版本、ChatLuna 是否采用及最终实现组合仍未确认。

本轮重新打开底座选择。此前“基于 AstrBot 源码裁剪与重构”的路线属于历史阶段决定，暂不作为实施前提；九个功能模块、NapCat／OneBot 11、模型、触发规则和部署约束保持不变。

## 2. 三者的关系与版本边界

| 对象 | 提供什么 | 本次发现 |
| --- | --- | --- |
| Cordis | 插件上下文、服务与依赖、事件、生命周期及资源撤销。 | 通用运行机制，不自带完整 QQ 聊天、LLM 会话和工具循环。[S1] |
| Koishi | 基于 Cordis 的聊天机器人框架，以及适配器、数据库、管理界面等插件。 | npm `koishi` 为 4.18.11；核心依赖 `cordis: ^3.18.1`、`minato: ^3.7.0`。[S2] |
| DeepSeek Harness | 在 Cordis 上组合模型、会话、工具、Agent loop 等能力。 | 核对快照将 Cordis 4.0.0-rc.7 源码纳入 vendor，并以 `@deepseek-ai/cordis` 发布，记录本地修改。[S3] |

**共同使用 Cordis 不代表插件可直接互装。**Koishi 当前插件面向 Cordis 3／Koishi API，Harness 面向其 Cordis 4 定制运行时。不能直接给 Koishi 加 `cordis@latest` 或挂载 Harness 插件并假定兼容。

具体例子：`@koishijs/plugin-database-sqlite@4.7.0` 依赖驱动 4.7 系列与 Minato 3；驱动自身 npm latest 已是 5.0.3，要求 Minato 4／Cordis 4。因此应通过匹配的 Koishi 数据库插件组装并锁定依赖，避免逐项安装每个底层库的 latest。[S4]

## 3. 三条路线的实际成本

| 路线 | 直接复用的部分 | 仍需承担的工作 | 助手判断 |
| --- | --- | --- | --- |
| 直接 Cordis 4 | 插件运行机制。 | 接入层、消息／会话语义、持久化、管理界面和聊天执行链的装配；Koishi 插件还需要适配。 | 更适合明确需要 Cordis 4 特性的情况，当前复用成本偏高。 |
| Koishi＋基础插件 | 机器人运行与消息处理、OneBot、数据库、插件管理及配置界面。 | 选择聊天插件，验证触发、会话隔离、模型和工具调用；补齐小狼特有能力。 | **当前优先验证。** |
| Koishi＋Harness 运行时 | Koishi 接入与管理，Harness 的 Agent 能力。 | 两套上下文、配置、持久化和生命周期的桥接；通过 SDK／服务连接，而非直接混装插件。 | 暂不作为最小链路；以后有明确缺口再研究。 |

以上是依据职责和依赖图作出的工程判断，不是同硬件性能测试。Harness 的 SDK 路线也会启动其运行时，不能只按“导入一个轻量库”估算成本。[S3]

## 4. 可以用哪些基础插件组装

以下版本是本轮核对候选，不是已安装组合。依赖范围相容不等于运行验证通过。

| 职责 | 候选 | 本轮核对版本 | 说明 |
| --- | --- | --- | --- |
| 运行宿主与配置装配 | `koishi`／`@koishijs/loader` | 4.18.11／4.6.11 | 直接作为项目依赖使用，优先不修改核心。 |
| HTTP／WebSocket 服务 | `@koishijs/plugin-http`、`@koishijs/plugin-server` | 0.6.3／3.2.9 | 随 `koishi` 包提供相关基础能力，供适配器与控制台使用。 |
| NapCat／OneBot 11 | `koishi-plugin-adapter-onebot` | 6.9.5 | 支持正向 WS、反向 WS 和 HTTP；标准消息与 API 可先用现成适配器。[S5] |
| 数据持久化 | `@koishijs/plugin-database-sqlite` | 4.7.0 | 进程内文件存储候选；先服务基础配置与聊天数据，不等同于长期 Memory 方案。 |
| 管理界面 | `@koishijs/plugin-console`、`@koishijs/plugin-config` | 5.30.11／2.8.7 | 已有插件状态、启停和配置入口。[S6] |
| 管理登录与日志 | `@koishijs/plugin-auth`、`@koishijs/plugin-logger` | 4.1.7／2.6.9 | 按最小管理需求组合；具体控制台依赖和入口还需构建验证。 |
| LLM 聊天／Agent 链路 | `koishi-plugin-chatluna` | 1.4.2 | 提供预设、上下文、模型服务、聊天及工具循环，依赖数据库和 LangChain 组件。[S7] |
| DeepSeek 接入 | `koishi-plugin-chatluna-deepseek-adapter` | 1.4.1 | 配合共享适配器 1.0.51；实际 `deepseek-flash` 兼容待测。 |
| 普通工具扩展 | 自有工具插件，或筛选 ChatLuna 工具插件 | 尚未选择 | 核心已有工具循环；首轮不必先安装完整 Agent 扩展包。 |

建议首轮评估正向 WS：由小狼连接同一专用 Docker 网络中的 NapCat WS 地址。适配器发布源码的正向连接实现支持 Bearer token，并使用既有重连机制。容器间地址不能写成宿主机或另一容器的 `127.0.0.1`。[S5]

`koishi-plugin-chatluna-storage-service` 的 npm peer 与运行时注入均标为可选，文本聊天不因其存在就必须启用它。是否需要媒体持久化等能力，按后续插件的实际依赖决定。

## 5. ChatLuna 与小狼规则的对照

### 5.1 触发与消息观察：发现直接配置路径

以 npm 1.4.2 的 `gitHead` 源码核对，而不是仅看开发分支：[S8]

| 小狼要求 | 找到的实现 | 验证状态 |
| --- | --- | --- |
| 私聊普通消息默认回复 | `allowPrivate`＋`privateChatWithoutCommand`。 | 源码存在，未联调。 |
| 群 @ 触发 | `allowAtReply` 检查自身 @。 | 源码存在，未联调。 |
| 句中包含称呼／触发词即触发 | `isNickNameWithContent` 对 `botNames` 使用 `includes`。 | 无需先写前缀修补插件；仍需检查完整入口和其他命令路径。 |
| 普通群聊可观察而不回复 | `chatluna/message-observed` 在回复门控前发出。 | 对进入该链路且未被黑名单等提前排除的消息成立，不宣称所有原始事件无条件可见。 |
| 主动插话关闭时不插话 | 随机回复频率可设 0；其他主动触发入口需一并停用。 | 不把随机频率等同于已完成主动插话策略或统一 Toggle。 |

首轮配置候选是：打开私聊普通回复和 @ 回复，`isNickNameWithContent=true`，`botNames` 配置为小狼称呼／触发词，随机频率为 0，不启用额外主动消息模块。该表不是现有部署配置。

### 5.2 工具循环与主链路替换：已有扩展点，仍有内部耦合

ChatLuna 的默认工厂注册 `chat` 与 `plugin` 两种链路，后者进入 Agent／工具流程。插件 API 提供 `registerTool` 与 `registerChatChainProvider`，注册通过上下文 effect 管理，可由外部插件增加工具或聊天链提供者。[S9]

但 ChatLuna 核心同时创建模型服务、会话运行时、预设、上下文管理和消息入口，模型适配器也依赖 `chatluna` 服务。**不能把“聊天链提供者可替换”描述为“整个聊天宿主和模型服务已完全独立”。**[S10]

因此建议分开验收：

1. 整个默认聊天能力能作为 Koishi 插件启停；停用后 OneBot、管理和后续独立观察插件仍工作。
2. 能注册并切换一个聊天链提供者，工具和模型服务仍正常，不出现两次回复。
3. 若用户要求连完整会话编排都能独立替换，并保留同一套模型插件，则还需要评估 ChatLuna 的服务拆分或另一实现；当前没有验证这点。

ChatLuna 不是无依赖的薄循环：核心带 LangChain 等组件。Agent 扩展包还带 MCP、Skills、终端／执行环境和界面依赖，范围大于最小聊天链路。首轮建议先不启用 Agent 扩展、长期记忆、多模态辅助、角色主动聊天等整套扩展，逐个按需求评估。

### 5.3 模型标识与能力

DeepSeek 官方将 V4.1 Flash 的模型标识列为 `deepseek-flash`，OpenAI 兼容地址为 `https://api.deepseek.com`，声明支持视觉与工具调用。[S11]

已核对的 ChatLuna DeepSeek 适配器从服务端取得模型列表，并声明工具调用能力；共享适配器 1.0.51 的图像能力匹配表包含 `deepseek-flash`。这只证明存在代码路径，图片资源取得、请求内容格式、思考模式与工具调用衔接仍需端到端测试。适配器为 `deepseek-v4-*` 设置的特殊请求分支不能直接当作 `deepseek-flash` 别名也经过相同路径。[S12]

## 6. 如何形成完整小狼项目

建议把小狼交付为一套独立、可复现的组合：自己的依赖清单与锁文件、启动与组合配置、统一人设、自有插件、构建镜像和 NAS 部署材料。Koishi 作为基础依赖，ChatLuna 是可以选择和替换的默认聊天实现候选。

这满足“完整项目”的交付目标；不要求先维护一个 Koishi 源码 fork，也不缩成给用户现有机器人安装的单个插件。

官方模板可作为组合参考，但本次模板包含多平台适配器、桌面／移动端、浏览器渲染、遥测、统计、插件市场和其他管理模块。**建议按需选择依赖和启用项，不把模板全部安装后再猜哪些可以删除。**是否启用市场、沙箱聊天或渲染插件不属于当前已确认要求。[S13]

## 7. 部署、许可与待验收内容

- Koishi 有官方 Docker 路线；小狼应用与专用 NapCat 可分别为一个容器，数据库优先评估应用内 SQLite 文件，不先增加 Redis、向量库或独立数据库服务。[S14]
- 核心 Koishi／Cordis／OneBot 适配器的核对声明为 MIT；官方控制台／配置／认证等插件和 ChatLuna 相关包有 AGPL-3.0 声明。不能把整套组合概括成全 MIT，项目许可证尚未决定；本次不作具体组合的许可结论。
- 尚无同硬件资源、延迟和调用成本实测，不能仅凭 TypeScript 或插件数量声称更轻量。
- 插件生命周期应测试监听和任务清理、在途请求的取消／完成、依赖停用及恢复、重载后无重复回复；仅移动文件或存在 dispose API 不算通过验证。
- 插件停用与删除持久化资料分开，不能把卸载插件等同于删除用户记忆或聊天数据。
- NAS 已知为 x86_64，Compose v2.40.3；现有实例不复用。当前 SSH 身份无 Docker socket 权限且 sudo 需要密码。部署前需解决操作身份，并对新目录、容器、网络和端口的写操作取得用户审批。

首轮建议验收：普通群聊观察但不回复、私聊／@／句中称呼回复、统一预设、会话隔离、重启保留配置与上下文、断线重连、模型失败处理、一个自动工具调用，以及聊天插件启停／链路替换。Memory 的长期共享策略不阻塞文本闭环验证。

## 8. 核对基线与来源

npm 元数据直接从官方 registry 读取 `dist-tags`、依赖、`gitHead` 与许可证；未执行包安装。包版本表记录本轮查询时的发布信息，不是项目锁文件。

| 对象 | 源码基线 |
| --- | --- |
| Koishi npm 4.18.11 | `506be1ef16d9c0c0f04069fb4b2f0a403cc19833`；另核对 master `97d5c395750cec37b772e0b94dc63c427e3bb868`。 |
| OneBot npm 6.9.5 | `058d8488aeef069751b0a84e066d48d1e2298225`；另核对 main `4109eb95c34e53d5bdacfeb4970ce26a1e17b0de`。 |
| ChatLuna npm 1.4.2 | `4ebd593bdc76dbe1ff060dd734e8ed590d6d7cfb`；另核对 v1-dev `9ae242fd62efd39446e5da00aeb56cb8649a2f51`，所查差异仅核心版本号。 |
| DeepSeek 适配器 1.4.1／共享适配器 1.0.51 | `f61762d3d5ad17fdcdf7551bf611f8be0c41fad4`。 |
| Harness master | `d743267388641bc76f17c45ce8b4c231aed1d32c`。 |
| Cordis main | `fabd555a087ee51252518c4a424792809c20b76a`；npm latest 4.0.0-rc.10 的 gitHead 为 `f8ea3cd50f1a5724e8e715995bcde131c9c12b2c`。 |
| Koishi 模板 master | `12ad3fc66bd89c4562ff70607980810dfb1f4dbb`。 |

- [S1 Cordis 与可逆插件设计](https://koishi.chat/zh-CN/cookbook/design/disposable)
- [S2 Koishi 发布源码的核心依赖](https://github.com/koishijs/koishi/blob/506be1ef16d9c0c0f04069fb4b2f0a403cc19833/packages/core/package.json)
- [S3 Harness 架构](https://deepseek-harness.github.io/deepseek-harness/en/reference/)、[vendored 源码与修改记录](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/vendor/README.md)
- [S4 Koishi SQLite 插件发布元数据](https://registry.npmjs.org/@koishijs%2Fplugin-database-sqlite/4.7.0)、[驱动 4.7.0](https://registry.npmjs.org/@minatojs%2Fdriver-sqlite/4.7.0)、[驱动 5.0.3](https://registry.npmjs.org/@minatojs%2Fdriver-sqlite/5.0.3)
- [S5 OneBot 适配器](https://github.com/koishijs/koishi-plugin-adapter-onebot)、[发布版 WS 实现](https://github.com/koishijs/koishi-plugin-adapter-onebot/blob/058d8488aeef069751b0a84e066d48d1e2298225/src/ws.ts)
- [S6 Koishi 插件管理](https://koishi.chat/zh-CN/manual/usage/market)、[配置插件依赖](https://github.com/koishijs/webui/blob/a8d0e3184f8eba3ade1bedf6ec642fb1d0c94c32/plugins/config/package.json)
- [S7 ChatLuna 官方介绍](https://chatluna.chat/guide/introduction.html)、[核心发布元数据](https://registry.npmjs.org/koishi-plugin-chatluna/1.4.2)
- [S8 ChatLuna 发布版触发与观察](https://github.com/ChatLunaLab/chatluna/blob/4ebd593bdc76dbe1ff060dd734e8ed590d6d7cfb/packages/core/src/middlewares/chat/allow_reply.ts)、[配置定义](https://github.com/ChatLunaLab/chatluna/blob/4ebd593bdc76dbe1ff060dd734e8ed590d6d7cfb/packages/core/src/config.ts)
- [S9 默认聊天与 Agent 链路](https://github.com/ChatLunaLab/chatluna/blob/4ebd593bdc76dbe1ff060dd734e8ed590d6d7cfb/packages/core/src/llm-core/chat/default.ts)、[工具与链路注册](https://github.com/ChatLunaLab/chatluna/blob/4ebd593bdc76dbe1ff060dd734e8ed590d6d7cfb/packages/core/src/services/chat.ts)
- [S10 ChatLuna 入口与依赖](https://github.com/ChatLunaLab/chatluna/blob/4ebd593bdc76dbe1ff060dd734e8ed590d6d7cfb/packages/core/src/index.ts)
- [S11 DeepSeek 官方模型说明](https://api-docs.deepseek.com/quick_start/pricing/)
- [S12 DeepSeek 适配器](https://github.com/ChatLunaLab/chatluna/blob/f61762d3d5ad17fdcdf7551bf611f8be0c41fad4/packages/adapter-deepseek/src/client.ts)、[共享视觉能力匹配](https://github.com/ChatLunaLab/chatluna/blob/f61762d3d5ad17fdcdf7551bf611f8be0c41fad4/packages/shared-adapter/src/client.ts)
- [S13 官方模板配置](https://github.com/koishijs/boilerplate/blob/12ad3fc66bd89c4562ff70607980810dfb1f4dbb/koishi.yml)、[模板依赖](https://github.com/koishijs/boilerplate/blob/12ad3fc66bd89c4562ff70607980810dfb1f4dbb/package.json)
- [S14 Koishi Docker 文档](https://koishi.chat/zh-CN/manual/starter/docker)

本轮仅下载临时参考源码、读取资料和更新 Markdown；未引入项目依赖、搭建代码骨架、运行上游测试、连接 QQ 或进行 NAS 写操作。

## 补录：自写主链路路线评估（2026-10-14）

以下从原主链路文档移入，保留当时的可行性判断、版本与来源，不代表当前实现状态。

## 2. 路线调查：可行，但要保留这些边界

结论：没有发现阻止这条路线的架构性问题。Cordis 4 适合承载小型插件化原型；是否稳定、轻量以及具体开发时间，需要后续原型和 NAS 联调验证，当前没有运行证据。

| 核对结果 | 对小狼的影响 | 建议处理 |
| --- | --- | --- |
| npm `cordis` latest 为 `4.0.0-rc.10`，核心为 ESM；对应 Loader 源码为 `1.0.0-rc.7`，仍带 RC 标记。[S1] | 可以作为候选，但不能当作接口已永久稳定，也不能只凭“快速原型”推断完整交付成本。 | 后续锁定框架、Loader 和 Node 版本，先验证最小装配；本文不安装或锁定依赖。 |
| 本次核对的 Koishi 4.18.11 核心依赖 Cordis 3。[S2] | OneBot、数据库、控制台、ChatLuna 等 Koishi 插件不能假定直接装进 Cordis 4。 | 优先参考协议和职责；要复用某个库，单独检查其是否依赖 Koishi 服务。 |
| Harness 使用改名发布的 `@deepseek-ai/cordis`，基于 Cordis 4 RC 源码并有本地修改。[S3] | 使用同一架构思想不等于共享同一运行时或可直接互装插件。 | 默认研究上游 Cordis 4；不直接引入 Harness 全套，也不默认维护其框架补丁。 |
| Cordis 提供依赖和资源清理机制，Harness 将模型、会话、工具和循环分别组织为插件。[S3][S4] | 能减少框架建设，但排队、发送结果、工具副作用和数据一致性仍由小狼定义。 | 下面将这些行为列为主链路职责；插件化与热更新分别验收。 |
| OneBot 11 WS 使用 `echo` 关联请求与响应，发送 API 返回消息 ID。[S5][S6] | `echo` 是关联标识，标准没有在这里提供发送去重承诺。断线可能造成“已执行但没收到回执”。 | 明确发送的成功、失败、结果未知；结果未知时不盲目重发。 |
| DeepSeek 官方将 V4.1 Flash 标识为 `deepseek-flash`，声明支持视觉与工具调用；思考模式的工具续接还有额外字段要求。[S7] | “OpenAI 兼容”不等于只传文本即可。协议字段若丢失，工具续接可能失败。 | 由模型适配器保留续接信息；文字、工具、图片分别联调。思考模式默认值另定。 |
| 现有项目的大量实现依赖自身的消息、配置、数据库和生命周期对象。 | 参考实现能降低探索成本，但不是换一种语言逐行翻译后就天然兼容。 | 保留原理和必要算法，按小狼的接口实现；实际复制文件或代码时记录来源及许可证。 |

成本判断：文字原型的范围可控；完整基础链路的主要工作在会话并发、工具循环、持久化与发送一致性。管理界面、长期 Memory、自学习和表情包属于后续模块，不能把它们的成本计入“文字原型已跑通”后就视为完成。


## 10. 调研来源、基线与本轮操作

2026-10-14 读取官方文档、npm 元数据及参考源码。npm 查询候选：`cordis@4.0.0-rc.10`，gitHead `f8ea3cd50f1a5724e8e715995bcde131c9c12b2c`；`@koishijs/core@4.18.11`，gitHead `506be1ef16d9c0c0f04069fb4b2f0a403cc19833`。这不是小狼依赖锁定。

- [S1 Cordis npm 元数据](https://registry.npmjs.org/cordis/latest)、[核心源码 manifest](https://github.com/cordiverse/cordis/blob/main/packages/core/package.json)、[Loader manifest](https://github.com/cordiverse/cordis/blob/main/packages/loader/package.json)。
- [S2 Koishi 核心依赖基线](https://github.com/koishijs/koishi/blob/506be1ef16d9c0c0f04069fb4b2f0a403cc19833/packages/core/package.json)。
- [S3 Harness 架构](https://deepseek-harness.github.io/deepseek-harness/en/reference/)、[vendor 版本与本地修改](https://github.com/deepseek-ai/deepseek-harness/blob/master/vendor/README.md)。
- [S4 Cordis 生命周期实现](https://github.com/cordiverse/cordis/blob/main/packages/core/src/fiber.ts)、[Koishi 可逆插件设计（机制参考，非 Cordis 4 API 契约）](https://koishi.chat/zh-CN/cookbook/design/disposable)。
- [S5 OneBot 11 正向 WebSocket](https://github.com/botuniverse/onebot-11/blob/master/communication/ws.md)。
- [S6 OneBot 11 公开 API](https://github.com/botuniverse/onebot-11/blob/master/api/public.md)。
- [S7 DeepSeek 模型能力](https://api-docs.deepseek.com/quick_start/pricing/)、[工具调用](https://api-docs.deepseek.com/guides/tool_calls/)、[思考模式与工具续接](https://api-docs.deepseek.com/guides/thinking_mode/)。
- [S8 OneBot 数组消息格式](https://github.com/botuniverse/onebot-11/blob/master/message/array.md)。
- [S9 NapCat 信息接口概览及固定源码来源](NapCat信息接口概览.md)。
- 参考实现：[AstrBot v4.28.2 工具循环](https://github.com/AstrBotDevs/AstrBot/blob/v4.28.2/astrbot/core/agent/runners/tool_loop_agent_runner.py)、[OneBot 适配器参考基线](https://github.com/koishijs/koishi-plugin-adapter-onebot/blob/058d8488aeef069751b0a84e066d48d1e2298225/src/ws.ts)。只借鉴职责、请求关联和异常处理，不视为可脱离原宿主直接使用。

本节记录设计调研阶段：当时只做只读调查并修改本地 Markdown，未编写代码、安装依赖、运行机器人或操作 NAS。随后用户授权提交、推送并开始本地实现，具体状态见 [实现进度](../实现进度.md)。

当前 QQ 接入来源：[腾讯官方 Node.js SDK](https://github.com/tencent-connect/qqbot-nodejs)、[事件订阅文档](https://github.com/tencent-connect/bot-docs/blob/main/docs/develop/api-v2/dev-prepare/interface-framework/event-emit.md)。
