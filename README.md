# codex-im

> 本项目改自 [vduggg/codex-im](https://github.com/vduggg/codex-im)（作者 Dawn Lee，MIT 协议），主要适配企业微信并在 Windows 上运行。感谢原作者的开源！
>
> Adapted from [vduggg/codex-im](https://github.com/vduggg/codex-im) by Dawn Lee (MIT), mainly for WeCom (企业微信) on Windows. Thanks to the original author!

`codex-im` 是一个本地运行的企业微信机器人桥接层：

`企业微信消息 -> 本机 codex app-server -> 企业微信回复`

Codex 运行在本地，企业微信只负责消息收发。

## 特性

- 企业微信长连接机器人
- 群聊和单聊命令识别
- `/codex bind` 绑定项目
- `/codex where` 查看当前项目/线程
- `/codex workspace` 查看当前会话已记录项目和线程
- `/codex remove /绝对路径` 移除会话绑定项目
- `/codex send <相对文件路径>` 发送当前绑定项目内文件
- `/codex switch <threadId>` 切换线程
- `/codex message` 查看最近几轮消息
- `/codex new` 新建线程
- `/codex stop` 停止当前运行
- `/codex model` / `/codex model update` / `/codex model <modelId>` 查看和设置模型
- `/codex quota` / `/codex status` 查看当前模型和额度
- `/codex effort` / `/codex effort <low|medium|high|xhigh>` 设置推理强度
- `/codex approve` / `/codex reject` 处理授权请求

## 安装

全局安装：

```sh
npm install -g @vdug/codex-im
codex-im wecom-bot
```

> 注意：npm 上的 `@vdug/codex-im` 是原作者发布的版本。要用本仓库的企业微信适配版，请 clone 本仓库后按下面的「开发态运行」启动；Windows 上也可以直接双击 `start-wecom-bot.cmd` / `stop-wecom-bot.cmd` 后台启动和停止。

开发态运行：

```sh
npm install
npm run wecom-bot
```

## 配置

程序会按这个顺序加载配置：

1. 当前目录下的 `.env`
2. `~/.codex-im/.env`
3. 当前 shell 环境变量

默认 session 文件：

```text
~/.codex-im/sessions.json
```

必填环境变量：

- `WECOM_BOT_ID`
- `WECOM_BOT_SECRET`
- `CODEX_IM_DEFAULT_CODEX_MODEL`
- `CODEX_IM_DEFAULT_CODEX_EFFORT`
- `CODEX_IM_DEFAULT_CODEX_ACCESS_MODE`：`default` / `full-access`

可选环境变量：

- `WECOM_WS_ENDPOINT`：默认 `wss://openws.work.weixin.qq.com`
- `CODEX_IM_DEFAULT_WORKSPACE_ID`
- `CODEX_IM_WECOM_STREAMING_OUTPUT`
- `CODEX_IM_WECOM_MAX_FILE_SIZE_MB`
- `CODEX_IM_WORKSPACE_ALLOWLIST`
- `CODEX_IM_CODEX_ENDPOINT`
- `CODEX_IM_SESSIONS_FILE`

示例配置见 [.env.example](.env.example)。

## 使用

```sh
npm run wecom-bot
```

常用命令：

- `/codex bind /绝对路径`
- `/codex where`
- `/codex workspace`
- `/codex remove /绝对路径`
- `/codex send <相对文件路径>`
- `/codex switch <threadId>`
- `/codex message`
- `/codex new`
- `/codex stop`
- `/codex model`
- `/codex model update`
- `/codex effort`
- `/codex approve`
- `/codex approve workspace`
- `/codex reject`
- `/codex help`

## 项目与线程模型

- 一个企业微信会话可以记住多个项目
- 每个项目对应一个当前选中的 Codex 线程
- 历史线程列表以 Codex `thread/list` 为准
- 切换项目或线程后，后续普通消息继续发到当前线程

## 开发

- [src/index.js](src/index.js)：启动入口
- [src/app/wecom-bot-runtime.js](src/app/wecom-bot-runtime.js)：企业微信运行时
- [src/infra/codex/rpc-client.js](src/infra/codex/rpc-client.js)：Codex JSON-RPC 传输层
- [src/infra/storage/session-store.js](src/infra/storage/session-store.js)：会话绑定持久化
- [src/infra/config/config.js](src/infra/config/config.js)：环境变量配置
