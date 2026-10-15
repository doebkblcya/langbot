# 小狼 xiaolang

个人定制、轻量克制、拟人化的 QQ 聊天机器人。使用 **TypeScript＋Cordis 4** 自行编写，通过独立接入插件连接 **QQ 官方机器人**。OneBot／NapCat 接入实现已移除。

目前是文字主链路的第一版实现。已在美国 VPS 的 Docker 中连接 QQ 官方 WebSocket 沙箱，并验证私聊入站、DeepSeek 生成与 QQ 发送回执；群聊等验收继续进行，九个模块尚未全部完成。完整设计见 [主链路功能与执行流程](Docs/主链路功能与执行流程.md)，当前边界见 [实现进度](Docs/实现进度.md)。

## 已实现

- Cordis 4 服务组合与官方 Loader，支持挂载目录中的外部插件及 npm 包；聊天编排可停用、替换。
- 私聊默认回复；群 @ 或任意位置的称呼／触发词回复；一条消息只产生一次默认回复。
- 通用接入服务和标准消息；接入插件可通过配置替换。QQ 官方插件复用腾讯 SDK，处理鉴权、WebSocket 连接、重连和被动回复。
- SQLite 保存入站消息、轮次、工具和逐段发送状态；会话隔离、去重、串行排队及有限并发。
- DeepSeek 文字调用、工具循环、参数校验、取消和预算；提供查询时间的示例工具。
- 超时后保留发送／操作的未知状态，不自动重放；失败草稿不作为已交付回复进入上下文。

主动插话、图片理解、长期 Memory、自学习、表情包、MCP／Skills 尚未实现。管理界面当前为只读面板，支持运行状态、最近聊天、实时过程日志、失败详情及插件状态；插件启停与配置编辑后续加入。当前 QQ 插件只处理官方 C2C 单聊与群聊；频道、媒体解析和引用原文获取暂未支持。非 @ 群消息只有平台实际推送时才能观察或按关键词触发。

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

## Docker 运行

用户已批准独立的小狼 Docker 部署和联调。因 NAS 故障，当前改在美国 VPS 验证；NAS 操作暂停。Linux 镜像、无网络容器验证及 VPS 的 QQ 连接／真实模型调用已通过。

1. 当前 VPS 目录为 `/home/doebk/xiaolang`，Compose 配置为 `compose.yml`，项目及容器名为 `xiaolang`。NAS 此前仅创建 `/vol1/1000/sys/docker/xiaolang` 目录并上传镜像，导入未确认、未启动容器；现有 AstrBot／NapCat 不改动。
2. 将 `config.example.json` 复制为 `config.local.json`，填写 `adapter.config.appId`。`environment: "sandbox"` 使用官方沙箱地址，按后台配置测试成员和群；实际生产接入另设 `"production"`。两种环境的历史命名空间隔离。
3. 将 `.env.example` 复制为 `.env`，填入 `DEEPSEEK_API_KEY` 和 `QQBOT_APP_SECRET`；真实密钥不进入 Git、镜像或普通日志。
4. `groupIds` 填 QQ 官方事件中的群 OpenID，不是普通 QQ 群号；空列表表示所有平台允许接收的群。`groupMessages: "mentions"` 是保守的能力声明；确认平台已开放非 @ 群消息后才改为 `"all"`，此配置不会替平台授予权限。
5. 当前插件使用 WebSocket，由容器向 QQ 官方网关发起连接，不需要 NapCat 或公网回调端口。当前应用已在 VPS 成功鉴权并进入沙箱就绪状态；生产环境和实际消息权限仍须分别验收。没有实现 Webhook 服务。
6. `main` 每次推送通过全部检查后，Actions 导出 `linux/amd64` 镜像和 SHA-256 校验文件，保存为保留 7 天的 Artifact，不创建 Release 或发布到镜像仓库。镜像标签为 `xiaolang:<完整提交 SHA>`；导入目标 Docker 后在 `.env` 的 `XIAOLANG_IMAGE` 填写该标签。将 `compose.example.yml` 作为项目的 Compose 配置使用，无需在目标服务器重新构建。
7. 宿主机 `data/` 挂载在 `/app/data`，`plugins/` 挂载在 `/app/plugins`，配置只读挂载；目录须允许容器用户 UID/GID 1000 读写，同一数据库只运行一个应用实例。容器内存上限 512 MiB，日志最多 3 个 10 MiB 文件。只读面板映射为 `127.0.0.1:18080:18080`，QQ 接入没有入站端口。若自行在 Linux 构建镜像，可使用 `docker build -t xiaolang:local .`。

当前 VPS 运行镜像对应提交 `c579868`，已启用外挂中文日志和只读后台插件，已按用户要求切换为 QQ 正式环境并重新连接，原有两个沙箱完成轮次保留并可在后台查看。后台仅映射到 VPS 的 `127.0.0.1:18080`，通过 SSH 转发访问。用户私聊“日志测试”已在 Docker 日志中完整显示接收、触发、排队、模型生成、发送回执与完成。此前已验证真实 `deepseek-flash` 回复、容器重启后重新就绪及数据库挂载；客户端可见性、群消息、非 @ 群事件和真实会话恢复继续人工联调。NAS 尚未完成部署。

临时人设、FIFO 排队、上下文字符预算、模型非思考模式、重试次数和超时等是第一版的可改默认值，不视为用户逐项确认。没有开启主动插话策略。

## 私有后台面板

页面和 Node.js 内置 HTTP 服务位于外挂的 `examples/plugins/panel/`。复制整个目录到运行目录的 `plugins/panel/`，在 `plugins.entries` 添加：

```json
{ "id": "panel", "module": "./panel/index.mjs", "config": { "host": "0.0.0.0", "port": 18080 } }
```

这里的 `0.0.0.0` 是容器内部监听地址；Compose 的宿主端口必须保持 `127.0.0.1:18080:18080`。Mac 打开 SSH 转发后访问 http://127.0.0.1:18080：

```sh
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:18080:127.0.0.1:18080 RacknerdUS
```

后台目前只读，通过 SSH 登录控制访问；HTTP 同时限制本机 Host、同源请求和 GET 方法。页面全部使用本地静态资源，无前端框架或第三方 CDN。每 2 秒刷新运行状态与日志；聊天按轮次分页，支持异常筛选、分段回执和关联过程日志。未触发的普通消息可以在过程日志中查看，不进入聊天轮次列表。面板不接收模型密钥、不提供任意 SQL、命令执行或配置写入接口。

面板依赖主链路的 `inspection` 只读服务；不直接操作 SQLite。聊天来自持久化记录，日志仅缓存本次启动的最近 500 条。重启后页面会自动重连，日志缓存重新开始。改变页面或 HTTP 展示逻辑后更新外挂文件并重启即可；改变主链路查询能力才需要更新镜像。Mac 的离线测试不会启动 HTTP 监听；实际 HTTP 验证在 Linux 容器与 VPS 执行。

## 过程日志

在 Mac 终端通过已有 SSH 配置登录 VPS，然后查看实时日志：

```sh
ssh RacknerdUS
sudo docker logs --tail 100 -f xiaolang
```

`Ctrl+C` 只结束查看，不停止机器人。过程事件包括收到消息、忽略原因、触发、排队与等待时间、模型调用与耗时、工具名称与状态、回复短预览、逐段发送回执和整轮结果。日志中的时间为 UTC；`turn` 关联同一轮次，`message` 关联入站、忽略和触发事件。平台回执表示 QQ 接受发送，不代替客户端可见性确认；结果未知不会记录为成功，也不会自动重发。

本体在处理边界发出结构化事件，由独立的日志处理插件筛选字段、脱敏、限制预览长度，再发布 `xiaolang/logged` 事件。默认预览 200 个 Unicode 字符；`logging.content: false` 可关闭所有正文预览。提示词、历史、思考内容、工具参数和工具结果不作为日志字段输出。已知环境密钥及常见凭证形式会脱敏，这不等于对任意个人信息自动匿名化。

终端中文格式由外挂的 `examples/plugins/console-logger/index.mjs` 提供。复制到运行目录的 `plugins/console-logger/index.mjs`，并将下面条目加入 `plugins.entries`：

```json
{ "id": "console-logger", "module": "./console-logger/index.mjs", "config": { "format": "text" } }
```

插件提供 `logOutput.write(entry)` 服务，接收脱敏后的事件；`format: "json"` 可改为结构化输出。未启用展示插件时，正式入口回退到 JSON 输出。修改外挂展示文件或它的配置后重启即可；增加本体观测点或修改脱敏边界仍需更新镜像。日志输出异常不会改变消息处理结果。后续后台可订阅同一套脱敏事件并读取已有数据库，不需要解析终端文字。

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
