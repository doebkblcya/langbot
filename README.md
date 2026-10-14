# 小狼 xiaolang

个人定制、轻量克制、拟人化的 QQ 聊天机器人。使用 **TypeScript＋Cordis 4** 自行编写，通过独立接入插件连接 **QQ 官方机器人**。OneBot／NapCat 接入实现已移除。

目前是文字主链路的第一版实现，尚未在 NAS 接通 QQ 或真实模型，不是九个模块已全部完成。完整设计见 [主链路功能与执行流程](Docs/主链路功能与执行流程.md)，当前边界见 [实现进度](Docs/实现进度.md)。

## 已实现

- Cordis 4 服务组合与官方 Loader，支持挂载目录中的外部插件及 npm 包；聊天编排可停用、替换。
- 私聊默认回复；群 @ 或任意位置的称呼／触发词回复；一条消息只产生一次默认回复。
- 通用接入服务和标准消息；接入插件可通过配置替换。QQ 官方插件复用腾讯 SDK，处理鉴权、WebSocket 连接、重连和被动回复。
- SQLite 保存入站消息、轮次、工具和逐段发送状态；会话隔离、去重、串行排队及有限并发。
- DeepSeek 文字调用、工具循环、参数校验、取消和预算；提供查询时间的示例工具。
- 超时后保留发送／操作的未知状态，不自动重放；失败草稿不作为已交付回复进入上下文。

主动插话、图片理解、长期 Memory、自学习、表情包、MCP／Skills 和管理界面尚未实现。当前 QQ 插件只处理官方 C2C 单聊与群聊；频道、媒体解析和引用原文获取暂未支持。非 @ 群消息只有平台实际推送时才能观察或按关键词触发。

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

1. 后续获批后，在固态存储空间的独立目录准备小狼容器；现有 AstrBot／NapCat 不改动。
2. 将 `config.example.json` 复制为 `config.local.json`，填写 `adapter.config.appId`。`environment: "sandbox"` 使用官方沙箱地址，按后台配置测试成员和群；实际生产接入另设 `"production"`。两种环境的历史命名空间隔离。
3. 将 `.env.example` 复制为 `.env`，在 NAS 本地填入 `DEEPSEEK_API_KEY` 和 `QQBOT_APP_SECRET`；不要提交或在聊天里发送密钥。
4. `groupIds` 填 QQ 官方事件中的群 OpenID，不是普通 QQ 群号；空列表表示所有平台允许接收的群。`groupMessages: "mentions"` 是保守的能力声明；确认平台已开放非 @ 群消息后才改为 `"all"`，此配置不会替平台授予权限。
5. 当前插件使用 WebSocket，由容器向 QQ 官方网关发起连接，不需要 NapCat 或公网回调端口。腾讯旧文档曾提示 WebSocket 下线，新 SDK 仍支持双传输；新机器人是否可用须以后台权限和实际 NAS 联调为准。本轮没有实现 Webhook 服务。
6. 审批具体部署方案后才构建、启动。SQLite 数据挂载在 `/app/data`，插件目录挂载在 `/app/plugins`，同一数据库只运行一个应用实例。

已实现本地文字闭环和模拟适配器验证；Linux 镜像构建和无网络容器验证由 CI 执行；尚未连接真实 QQ／DeepSeek 或部署 NAS。

临时人设、FIFO 排队、上下文字符预算、模型非思考模式、重试次数和超时等是第一版的可改默认值，不视为用户逐项确认。没有开启主动插话策略。

## 扩展

外部插件通过官方 `@cordisjs/plugin-loader@1.0.0-rc.7` 加载，不需要重新构建小狼镜像。当前通过**重启小狼进程／容器**读取更新，不做热更新、自动安装或插件市场。

例如，将 `examples/plugins/hello` 复制到持久化的 `plugins/hello`，在 `config.local.json` 中配置：

```json
"plugins": {
  "directory": "plugins",
  "entries": [
    { "id": "hello", "module": "./hello/index.mjs", "enabled": true, "config": { "greeting": "你好" } }
  ]
}
```

然后重启小狼；模型会获得此插件注册的 `greet` 工具。更新插件文件或配置后再次重启即可。`enabled: false` 的插件不导入、不执行；没有 `plugins` 配置的旧配置仍可使用。

插件导出标准 Cordis 的函数、对象或模块形式，声明 `inject` 服务依赖，用 `ctx.effect()` 管理清理函数。文件入口使用 `.mjs`、`.cjs` 或可运行的 `.js`；TypeScript 插件先编译为 JavaScript。可选导出 `xiaolangApiVersion = 1`，声明其他版本会被拒绝。启用插件缺文件、缺依赖或加载失败时，应用报告插件 ID 并停止启动，不连接 QQ。

`module` 也支持已安装的 npm 包名：将其 `package.json`、锁文件与 `node_modules` 保存在插件工作目录，先安装，再配置包名加载。依赖在 Linux 运行环境准备，插件的 `cordis` 使用 peer dependency 复用宿主版本。官方 Loader 可能在该工作区写入 `.cordis` 解析缓存，因此 npm 工作区需可写。这里只支持加载，不自动下载或升级依赖。

要替换主链路，在 `plugins.chat` 填入某个已启用的插件 ID；它必须提供包含 `idle()` 和 `stop()` 的 `chat` 服务。默认主链路不会同时加载；`chatEnabled: false` 也会停用所选外部主链路。

`adapter.module` 指定唯一接入插件，内置值为 `builtin:qq-official`。也支持插件目录中的相对入口或已安装 npm 包，与其他外部插件共用官方 Loader。接入插件必须提供 `adapter` 服务：平台／账号身份、接收能力、文字上限、`start(receive)`、`stop()` 和 `reply(message, text, part, signal)`。它只向 `receive` 交付小狼标准消息；鉴权、OpenID、平台事件和发送格式都留在插件内。替换接入插件不修改聊天编排，也不要求 QQ 凭证。接入插件卸载时应通过 `ctx.effect()` 停止连接。当前通过重启替换，不支持在线热切换。

`reply` 返回平台回执 ID；明确拒绝与结果未知要分开报告。主链路保存分段发送意图和回执，不自动重发未知结果。QQ 插件默认只发关联入站消息的被动回复，采用 5 分钟回复窗口及最多 5 段的保守默认限制；过期不降级为主动推送。

`src/contracts.ts` 定义能力接口；`src/app.ts` 组合提供者；`src/chat.ts` 负责默认聊天流程；`src/plugins.ts` 对接官方 Loader 并检查启动状态。新增工具通过 `ctx.tools.register()` 注册并把返回的清理函数交给插件生命周期。工具默认按有副作用处理，只读工具需显式声明 `effect: 'read'`。更改小狼本体或系统依赖时仍需要更新镜像。

实现参考：[腾讯 QQ 官方 Node.js SDK](https://github.com/tencent-connect/qqbot-nodejs)、[Cordis 官方 Loader](https://github.com/cordiverse/cordis/tree/main/packages/loader)、[Koishi 插件配置](https://koishi.chat/zh-CN/manual/usage/market)。直接依赖上游 Loader，没有复制或另建插件内核。

框架固定为上游 `cordis@4.0.0-rc.10`，不是 Harness 定制版本。Koishi／ChatLuna／Harness 插件不能直接互装；现有项目用于机制参考，没有复制其业务源码。项目自身许可证尚未选择，不以底层库的 MIT 许可证代替项目许可决定。
