# LangBot 初期调研

> 历史调研归档：以下选型、版本、权限与部署状态只代表当时的记录，不作为当前实施计划。当前决定见 [需求记录](../需求记录.md)，实际完成情况见 [实现进度](../实现进度.md)。

调研日期：2026-10-11。对象为第三方项目 [langbot-app/LangBot](https://github.com/langbot-app/LangBot)，与本项目 xiaolang 区分。

状态补充（2026-10-14）：本文保留早期调研结论；当前已选择 TypeScript＋Cordis 4 自行编写主链路，详见 [当前功能与执行流程](../主链路.md)。下文“先验证 AstrBot”是当时建议，不代表当前实施方向，尚未部署。

## 1. 结论

LangBot 是内置 Agent 能力的即时通信机器人开发平台，适合作为机器人基建候选。它覆盖平台接入、消息处理、模型与工具调用、知识库、插件和管理界面，不只是一个供代码导入的 Agent 库。[官方功能说明](https://langbot.app/docs/zh/insight/features/)

助手建议：将“直接基于 LangBot 编写功能模块”加入候选方案，与“选择性复用 AstrBot／MaiBot 后自建”比较；尚未确定采用，也不修改我们已经确认的九个模块。

后续已将直接使用 AstrBot／MaiBot 底座也纳入同等比较，详见 [底座评估与启动建议](底座评估与启动建议.md)。当前建议先验证 AstrBot，LangBot 保留为替代候选；不能凭工程组织或官方 Memory 插件就认定 LangBot 最适合本项目。

## 2. 是否规范、Agent 用什么实现

- 工程化证据：有架构文档、独立插件 SDK、数据库迁移、分层源码及单元／集成／端到端测试的 CI 配置。可以说工程组织较完整；本次未运行测试，不能据此断言质量优于 AstrBot 或 MaiBot。[架构说明](https://github.com/langbot-app/LangBot/blob/0b5b4cca59500f1cbc0f106e6dcbef2f682ed4a2/ARCHITECTURE.md)、[测试工作流](https://github.com/langbot-app/LangBot/blob/0b5b4cca59500f1cbc0f106e6dcbef2f682ed4a2/.github/workflows/run-tests.yml)
- 技术栈：Python 后端，Quart 提供 HTTP 服务；React 前端。Web 框架与 Agent 循环是不同职责。[项目依赖](https://github.com/langbot-app/LangBot/blob/0b5b4cca59500f1cbc0f106e6dcbef2f682ed4a2/pyproject.toml)、[前端及整体架构](https://github.com/langbot-app/LangBot/blob/0b5b4cca59500f1cbc0f106e6dcbef2f682ed4a2/ARCHITECTURE.md)
- 稳定版 v4.10.11 的 `LocalAgentRunner` 自行组织模型与工具循环；当前官方插件仓库中的 LocalAgent 也有自行实现的 `AgentLoop`。主仓库虽声明 LangChain 等依赖，不能因此认定 Agent 主循环由 LangChain／LangGraph 搭建。[稳定版实现](https://github.com/langbot-app/LangBot/blob/273b8839b91cb74dfd083644efea18849a3fcee1/src/langbot/pkg/provider/runners/localagent.py)、[当前 LocalAgent 实现](https://github.com/langbot-app/langbot-plugins/blob/a18c619e58c6b71ab584c6043603586184c3287b/Runner/LocalAgent/pkg/agent_core/loop.py)

## 3. 对照我们的九个模块

“已有”只表示找到相关实现，不代表已经满足我们的行为要求，也不代表不同版本可以直接组合。

| 我们的模块 | LangBot 已发现的能力 | 仍需评估 |
| --- | --- | --- |
| 触发与调度 | 群 @、前缀、正则、随机概率触发；群触发检查不限制普通私聊。[触发配置](https://github.com/langbot-app/LangBot/blob/0b5b4cca59500f1cbc0f106e6dcbef2f682ed4a2/src/langbot/templates/metadata/pipeline/trigger.yaml)、[检查逻辑](https://github.com/langbot-app/LangBot/blob/0b5b4cca59500f1cbc0f106e6dcbef2f682ed4a2/src/langbot/pkg/pipeline/resprule/resprule.py) | 随机触发不等于自然插话；定时自学习及主动消息的接入方式需继续核实。 |
| 人设与回复生成 | LocalAgent 支持系统提示词、上下文处理和回复生成。[LocalAgent](https://github.com/langbot-app/langbot-plugins/blob/a18c619e58c6b71ab584c6043603586184c3287b/Runner/LocalAgent/README.md) | 统一人设可以作为配置方向，具体聊天表现未测试。 |
| 规划与工具调用 | 有 Agent 工具循环、插件工具、MCP 和 Skills。[功能说明](https://langbot.app/docs/zh/insight/features/) | 首批工具、自动执行行为，以及脚本／Skill 所需运行环境。 |
| Memory | 有 RAG，并找到官方 LongTermMemory 插件，提供记忆写入、召回、资料更新和删除。[插件说明](https://github.com/langbot-app/langbot-plugins/blob/a18c619e58c6b71ab584c6043603586184c3287b/KnowledgeEngine/LongTermMemory/README.md) | 跨群共享、人物范围、记忆质量、存储后端与版本兼容。 |
| 图片处理 | LocalAgent 声明支持图片等结构化输入。[LocalAgent](https://github.com/langbot-app/langbot-plugins/blob/a18c619e58c6b71ab584c6043603586184c3287b/Runner/LocalAgent/README.md) | NapCat 图片取得与目标模型接口的端到端兼容，尚未实测。 |
| 自学习 | 本次未核实到满足我们要求的定时语言风格学习链路。 | 持续学习材料、评估和生效机制需要单独研究，不能以记忆插件替代此结论。 |
| 简单插件扩展 | 已有事件、命令、工具、知识引擎等扩展点。[插件说明](https://langbot.app/docs/zh/plugin/plugin-intro/) | 写自己的模块是否足够简单，以及平台本身带来的复杂度。 |
| 表情包收集与选用 | 平台具备图片输入及插件扩展能力。 | 本次未核实同类表情包链路；AstrBot 插件不能假定可直接安装到 LangBot。 |
| 基础管理界面 | 已有机器人、流水线、模型、扩展等管理入口。[功能说明](https://langbot.app/docs/zh/insight/features/) | 是否满足我们新增功能的管理需求。 |

## 4. Memory 插件值得研究的内容

LongTermMemory 将稳定资料与事件记忆分开：前者注入系统提示词，后者按需检索。它提供 `remember`、`recall_memory`、`update_profile`、`forget`，并有检查与管理入口。

其共享边界并不完全一致：稳定资料按会话／发言人保存，事件记忆可按会话或机器人范围检索；不能笼统理解成“打开共享就所有信息跨群共用”。事件记忆还依赖向量存储的元数据过滤能力，选定后端与版本后需验证。[插件设计与使用说明](https://github.com/langbot-app/langbot-plugins/blob/a18c619e58c6b71ab584c6043603586184c3287b/KnowledgeEngine/LongTermMemory/README.md)

这与我们的跨会话持久化记忆方向相关，但具体行为与效果未验证。

## 5. 部署、扩展与复用边界

- 有 Linux Docker Compose 部署路径；官方 v4.10.11 发布说明称提供 amd64／arm64 镜像。是否适配用户 NAS，仍需确认硬件与资源。[Docker 文档](https://langbot.app/docs/zh/deploy/langbot/docker/)、[发布说明](https://github.com/langbot-app/LangBot/releases/tag/v4.10.11)
- 当前 Compose 包含主服务、插件运行时和可选 Box 沙箱。关闭 Box 会影响 Skills、脚本执行及 stdio MCP 等相关能力，不能把“不做电脑操作”直接等同于“不需要代码执行环境”。[Compose 源码](https://github.com/langbot-app/LangBot/blob/0b5b4cca59500f1cbc0f106e6dcbef2f682ed4a2/docker/docker-compose.yaml)、[Skills 依赖说明](https://langbot.app/docs/zh/usage/skills/readme/)
- 核心、SDK、官方插件仓库根许可证均为 Apache-2.0；具体复用仍需核对文件、依赖与插件自己的声明。[核心许可证](https://github.com/langbot-app/LangBot/blob/0b5b4cca59500f1cbc0f106e6dcbef2f682ed4a2/LICENSE)、[SDK 许可证](https://github.com/langbot-app/langbot-plugin-sdk/blob/effc216f889c56bdc931cdaaf4b6758c501e877b/LICENSE)、[官方插件仓库许可证](https://github.com/langbot-app/langbot-plugins/blob/a18c619e58c6b71ab584c6043603586184c3287b/LICENSE)
- 拆出部分源码会遇到 SDK、运行时与存储接口依赖；作为完整底座扩展，与独立搬运源码是两种不同成本的方案。

## 6. 版本与验证范围

| 对象 | 本次核对基线 |
| --- | --- |
| GitHub latest 正式发布 | v4.10.11，2026-09-12；提交 `273b8839b91cb74dfd083644efea18849a3fcee1`。 |
| 主仓库 master | `0b5b4cca59500f1cbc0f106e6dcbef2f682ed4a2`；pyproject 标记 `4.11.0-rc.2`。 |
| 官方插件仓库 main | `a18c619e58c6b71ab584c6043603586184c3287b`；LongTermMemory manifest 为 `0.2.7`。 |
| 插件 SDK main | `effc216f889c56bdc931cdaaf4b6758c501e877b`。 |

当前源码已将 LocalAgent 组织为官方 Runner 插件；稳定版对应代码仍在主仓库。不得混用两套组织方式，也未验证以上各仓库快照彼此兼容。

本次仅阅读官方文档与源码，未部署、安装依赖、运行上游测试或连接 QQ。采用 LangBot 与选择版本尚未作决定。本项目名称已于 2026-10-12 确认为 xiaolang。
