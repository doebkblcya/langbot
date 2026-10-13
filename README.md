# 小狼 xiaolang

个人定制、轻量克制、拟人化的 QQ 聊天机器人。使用 **TypeScript＋Cordis 4** 自行编写，NapCat／OneBot 11 作为黑盒接入。

目前是文字主链路的第一版实现，尚未在 NAS 接通 QQ 或真实模型，不是九个模块已全部完成。完整设计见 [主链路功能与执行流程](Docs/主链路功能与执行流程.md)，当前边界见 [实现进度](Docs/实现进度.md)。

## 已实现

- Cordis 4 服务组合，聊天编排可停用、替换；接入与消息观察保持独立。
- 私聊默认回复；群 @ 或任意位置的称呼／触发词回复；一条消息只产生一次默认回复。
- OneBot 正向 WS、账号核对、连接保活、重连、API 回执关联；机器人自身消息不触发。
- SQLite 保存入站消息、轮次、工具和逐段发送状态；会话隔离、去重、串行排队及有限并发。
- DeepSeek 文字调用、工具循环、参数校验、取消和预算；提供查询时间的示例工具。
- 超时后保留发送／操作的未知状态，不自动重放；失败草稿不作为已交付回复进入上下文。

主动插话、图片理解、长期 Memory、自学习、表情包、MCP／Skills 和管理界面尚未实现。群临时私聊、CQ 字符串消息及引用原文获取也暂未支持。

## 开发验证

Node.js 22.23.2，依赖使用锁文件。当前持久化使用 Node 内置 `node:sqlite`，在此 Node 版本仍显示实验性提示。

```sh
npm ci --ignore-scripts
npm run check
npm test
```

测试使用模拟模型、内存传输和临时数据库，不启动机器人、不连接 QQ 或调用真实模型。Mac 仅用于编译及这种离线验证；正式入口在非 Linux 系统会拒绝运行。

配置格式可单独检查，不打开数据库或网络连接：

```sh
XIAOLANG_CONFIG=config.example.json node dist/src/main.js --check-config
```

## NAS 运行准备

**NAS 写操作仍需用户审批。**本仓库的 Dockerfile 和 Compose 文件是准备材料，尚未构建验收或部署到 NAS。

1. 后续获批后，在独立目录准备小狼及专用 NapCat；不复用已有 AstrBot／NapCat。
2. 将 `config.example.json` 复制为 `config.local.json`，填写专用 QQ 账号及 NapCat 地址；NapCat 必须按数组格式上报消息。`groupIds: []` 表示接收所有群，填写群号可限定范围。
3. 将 `.env.example` 复制为 `.env`，在 NAS 本地填入模型 Key 和 NapCat Token；不要提交这两个本地文件。
4. `compose.example.yml` 只包含小狼，不创建 NapCat。需先为专用 NapCat 确定版本、登录与 WS 配置，再将它接入小狼的专用网络。示例地址 `xiaolang-napcat:3001` 是待配置占位。
5. 审批部署方案后，才执行镜像构建与启动；SQLite 数据挂载在 `/app/data`，同一数据库只运行一个应用实例。

临时人设、FIFO 排队、上下文字符预算、模型非思考模式、重试次数和超时等是第一版的可改默认值，不视为用户逐项确认。没有开启主动插话策略。

## 扩展

`src/contracts.ts` 定义能力接口；`src/app.ts` 组合提供者；`src/chat.ts` 负责默认聊天流程。新增工具通过 `ctx.tools.register()` 注册并把返回的清理函数交给插件生命周期。工具默认按有副作用处理，只读工具需显式声明 `effect: 'read'`。

框架固定为上游 `cordis@4.0.0-rc.10`，不是 Harness 定制版本。Koishi／ChatLuna／Harness 插件不能直接互装；现有项目用于机制参考，没有复制其业务源码。项目自身许可证尚未选择，不以底层库的 MIT 许可证代替项目许可决定。
