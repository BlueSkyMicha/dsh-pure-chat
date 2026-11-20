# dsh-pure-chat

给 [DeepSeek Harness](https://github.com/deepseek-ai) 的**纯聊天模式**：一个不带任何干活工具的会话模式（preset），右侧栏提供人设、温度与按需能力开关，并能把当前对话一键导进新的标准模式会话。

English: [README.md](./README.md)

## 为什么

DSH 的标准会话带全套工具（文件、命令、联网、子代理……）和对应的系统提示词。纯聊天时这些只是噪音，而且每一轮都在为它们付费。纯聊天把会话压缩成一段人设提示词、零工具，同时保留对话本身需要的东西：消息、压缩，以及一个随时改语气的入口。

## 功能

- **`chat` preset** —— 新建会话时选「纯聊天」即可。不挂文件、命令、联网、子代理工具；主机层注册的工具（上下文管理、音乐分析、工作区助手等）会被 per-agent 遮罩挡掉，请求里因此完全没有 `tools` 数组。
- **右侧栏「聊天设置」**（输入框下方的「聊天设置」按钮也能打开）：
  - **人设**：自由输入，**按会话保存**；留空继承默认人设。
  - **温度**：0–2，所有纯聊天会话共用，下一步请求生效。
  - **Top P**：宿主模型接口没有 `top_p` 参数，固定显示「宿主不支持」。
  - **能力开关**（默认全关、按会话）：
    - **读附件**：`read_attachment` 读取对话里提到的文件——拖进对话框的附件，以及消息里 `@路径` 引用的文件（含空格用 `@"路径"`）。相对路径按会话工作目录解析。
    - **联网**：`web_search` 与 `web_fetch`。
- **一键导入**：把整段对话作为草稿放进一个**新的标准模式会话**，复用内置的 `/api/session.markdown` 导出路由。
- **中英双语界面**。

## 安装

需要带 Web GUI 的 DeepSeek Harness。任选一种。

### 1. 插件页安装

打开 **插件** → 安装，填：

```
github:BlueSkyMicha/dsh-pure-chat
```

### 2. 让 agent 安装

直接让对话里的 agent 装，或调用工具：

```
plugin_manager install_bundle target="github:BlueSkyMicha/dsh-pure-chat"
```

### 3. 本地目录安装

```bash
git clone https://github.com/BlueSkyMicha/dsh-pure-chat.git
```

然后把目录交给安装器：

```
plugin_manager install_bundle target="C:\\path\\to\\dsh-pure-chat"
```

装完刷新页面（客户端 bundle 在条目就绪时缓存），新建会话时在模式选择器里选「纯聊天」。preset 在会话创建时绑定，已有会话不能中途切换。

### 依赖

- 一键导入依赖内置的 **`@deepseek-ai/dsh-session-log-export`**（行 `session-log-download`）；没有它时导入按钮会提示导出不可用，其它功能不受影响。
- 无额外依赖；`@deepseek-ai/schemastery` 是唯一 peer，随 DSH 提供。

## 用法

1. 新建会话 → 模式选 **纯聊天**。
2. 打开右侧栏 → **聊天设置**（或点输入框下方的「聊天设置」）。
3. 写人设、保存，下一步回复即生效。
4. 这个会话要读文件或联网时，再打开 **读附件** / **联网**；每个开关只加对应的工具，关掉立刻消失。

导入：点 **导入并新建会话**，当前对话会变成标准模式会话里的一条草稿，先改再发。

## 工作方式

- 宿主插件在**第一次组装之前**注册一个 agent 作用域的 `complete` prompt section：直接以 `chat` 创建的会话读 `session.header.agentPreset`，在新建页选模式的则通过 `agent-preset/selected` 会话事件捕捉（早于第一轮组装）。所以人设可以逐轮变化，不用重新组装 preset。
- `agent/request` 只改写 chat 会话的 `temperature`；provider、model、reasoning effort 保持步骤准备时的值。
- 主机层工具用 `ctx.tools.restrict({ deny })` 按 agent 遮掉；能力开关把最多三个工具注册在 **`agent.ctx`** 上，只在这一个会话存在，注销 disposer 即消失。
- 人设、按会话人设表、能力开关、温度都是 volatile 配置字段，经 config editor 持久化，面板改完无需重启。
- 面板走 `GET|POST /dsh-pure-chat/state?sessionId=…`，与 GUI 其余部分同一套 cookie 认证。
- 读附件只有两条来源：上传附件走 `ctx.attachments.readFileStream`，`@` 引用按会话工作目录解析后用 `fs` 读文本；不会自己去翻工作区。

## 隐私

纯聊天会话默认没有任何工具。打开**读附件**后，工具只读对话里出现过的文件（你拖进来的附件，或你明确 `@` 到的路径），不会自行遍历文件系统；打开**联网**后，搜索与抓取走宿主配置的 web provider。

## 开发

```
dsh-pure-chat/
├── cordis.patch.yml   # bundle 两行：宿主插件 + `chat` preset
├── lib/index.js       # 宿主：人设 section、温度、工具、面板 API
├── lib/client.js      # 客户端：右侧栏 tab、输入框药丸、面板
├── locale/{en,zh}.json# 插件卡片元数据
├── icon.svg
└── README.md / README.zh.md
```

- 宿主模块只能 import Node 内置模块与 `@deepseek-ai/schemastery`。
- 改 `lib/client.js` 后要重启插件条目（主机缓存了客户端 bundle 字节）再刷新页面。
- 用 `cordis_inspect_query`（`Config.listConfigs`，name `dsh-pure-chat`）确认行状态，不要靠插件列表推断。

## 许可

MIT，见 [LICENSE](./LICENSE)。
