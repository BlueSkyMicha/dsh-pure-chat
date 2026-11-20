# dsh-pure-chat

A **pure chat mode** for [DeepSeek Harness](https://github.com/deepseek-ai): a session preset with no work tools at all, a right-sidebar panel for the persona, temperature and a few on-demand capabilities, and a one-click hand-off that copies the conversation into a new standard-mode session.

中文说明见 [README.zh.md](./README.zh.md)。

## Why

Standard DSH sessions carry a full toolbelt (files, shell, web, subagents…) and its system prompt. For plain conversation — thinking out loud, drafting, asking questions — that is noise, and every turn pays for it. Pure chat strips the session down to a single persona prompt and no tools, while keeping what makes the conversation live: messages, compaction, and a place to steer the voice.

## Features

- **Preset `chat`** — appears as 纯聊天 in the new-session picker. No file, shell, web, or delegation tools: Host-level tools (context management, music insight, workspace helpers…) are masked per agent, so the request carries no `tools` array at all.
- **Right-sidebar panel** (also reachable from the composer chip):
  - **Persona** — free text, **stored per session**; empty inherits the default.
  - **Temperature** — 0–2, shared by every pure-chat session, applied on the next request.
  - **Top P** — shown as unavailable: the Harness model interface has no `top_p` parameter.
  - **Capabilities** (off by default, per session):
    - **Read chat attachments** — a `read_attachment` tool that reads the files you mention in the conversation: dropped-in attachments and `@path` references (`@"path with spaces"` for paths with spaces). Relative paths resolve against the session working directory.
    - **Web** — `web_search` and `web_fetch`.
- **One-click hand-off** — puts the whole conversation into a **new standard-mode session** as an editable draft, using the shipped `/api/session.markdown` export route.
- **Bilingual UI** — English and Chinese strings ship with the panel.

## Install

Requires DeepSeek Harness with the Web GUI. Pick whichever path you like.

### 1. Plugin manager UI

Open **插件 (Plugins)** → install, and enter:

```
github:BlueSkyMicha/dsh-pure-chat
```

### 2. From an agent session

Ask the agent to install the bundle, or call the tool directly:

```
plugin_manager install_bundle target="github:BlueSkyMicha/dsh-pure-chat"
```

### 3. From a local checkout

```bash
git clone https://github.com/BlueSkyMicha/dsh-pure-chat.git
```

then point the bundle install at that directory:

```
plugin_manager install_bundle target="C:\\path\\to\\dsh-pure-chat"
```

After installing, reload the page (client bundle) and create a new session — pick **纯聊天** in the mode picker. Presets bind at session creation; existing sessions cannot switch into it.

### Requirements

- The shipped **`@deepseek-ai/dsh-session-log-export`** bundle (row `session-log-download`) for the hand-off feature. Without it the import button reports that export is unavailable; everything else works.
- No extra dependencies. `@deepseek-ai/schemastery` is the only peer and ships with DSH.

## Usage

1. New session → mode **纯聊天**.
2. Open the right sidebar → **聊天设置 (Chat settings)** (or click the chat-settings chip under the composer).
3. Write a persona, save. It applies from the next reply.
4. Flip **读附件** or **联网** if this conversation needs to read a file or reach the web; each switch adds only those tools, and turning it off removes them immediately.

Hand-off: **导入并新建会话** converts the current conversation into a standard-mode session draft — review, then send.

## How it works

- The Host plugin registers an agent-scoped `complete` prompt section **before the first assembly** (a session created straight into the preset reads `session.header.agentPreset`; the picker's late binding is caught on the `agent-preset/selected` session event), so the persona can change between turns without recomposing the preset.
- `agent/request` rewrites only `temperature` for chat agents; provider, model and reasoning effort stay as the step prepared them.
- Host-level tools are masked per chat agent with `ctx.tools.restrict({ deny })`. Capability switches register at most three tools **on `agent.ctx`**, so they exist only for that agent and disappear with their disposers.
- Persona, per-session personas, capability flags and temperature are volatile config fields, persisted through the config editor, so the panel works without a restart.
- The panel talks to `GET|POST /dsh-pure-chat/state?sessionId=…` behind the same browser-cookie authentication as the rest of the GUI.

## Privacy

Pure chat sessions have no tools unless you enable a switch. With **读附件** on, the tool reads only files that appear in the conversation (attachments you dropped in, or paths you explicitly `@`-mentioned) — it never walks the file system on its own. With **联网** on, searches and fetches go through the Host's configured web provider.

## Development

```
dsh-pure-chat/
├── cordis.patch.yml   # bundle rows: host plugin + `chat` preset
├── lib/index.js       # Host: persona section, temperature, tools, panel API
├── lib/client.js      # Client: sidebar tab, composer chip, panel UI
├── locale/{en,zh}.json# plugin card metadata
├── icon.svg
└── README.md / README.zh.md
```

- The Host module may import only Node builtins and `@deepseek-ai/schemastery`.
- After editing `lib/client.js`, restart the plugin entry (the Host caches client bundle bytes) and reload the page.
- Check the bundle rows with `cordis_inspect_query` (`Config.listConfigs`, name `dsh-pure-chat`) rather than inferring from the plugin list.

## License

MIT — see [LICENSE](./LICENSE).
