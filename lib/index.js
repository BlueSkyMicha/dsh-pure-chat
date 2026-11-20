/**
 * dsh-pure-chat — Host side of the "纯聊天" mode.
 *
 * Owns three things, all of them about the `chat` agent preset:
 *
 * 1. the persona prompt of a chat agent (one complete, agent-scoped prompt
 *    section registered on `agent/created`, so the right-sidebar panel can
 *    rewrite the text between turns),
 * 2. the sampling temperature of chat agents (an `agent/request` listener that
 *    only rewrites the request config of chat agents), and
 * 3. the small JSON API the sidebar panel uses to read/save those values.
 *
 * The persona is keyed by session, so every conversation can have its own
 * character; `persona` is the default used by sessions that have no entry of
 * their own. All three fields are `.volatile()`: the config editor persists
 * them into the profile and the values update in place without a restart.
 *
 * @module dsh-pure-chat
 */

import z from '@deepseek-ai/schemastery'
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

/** Agent preset id this bundle publishes (the Loader row is `preset-chat`). */
const PRESET_ID = 'chat'

/** Route prefix of the panel API; the client asks for the same constant. */
const ROUTE_PREFIX = '/dsh-pure-chat'

/** Upper bound on the request body the panel may send (persona text). */
const MAX_BODY_BYTES = 256 * 1024

/** Longest persona the panel accepts for one session. */
const MAX_PERSONA_CHARS = 20_000

/** Longest text a chat session may pull out of one attachment. */
const MAX_ATTACHMENT_CHARS = 20_000

/** Most attachments one `read_attachment` call returns. */
const MAX_ATTACHMENT_FILES = 5

/** Prompt used when neither the session nor the default has a persona. */
const DEFAULT_PERSONA_HINT = '（用户还没有设定人设：用自然、友好、稍微简洁的语气交流。）'

/**
 * The mode framing every chat session gets. The user's persona is spliced in
 * as its own paragraph, so it changes the voice without dropping the rules
 * that make this mode tool-less.
 */
const MODE_HEAD = [
  '你是一个纯聊天助手，运行在 DeepSeek Harness 的「纯聊天」模式里。',
  '',
  '这个模式默认不加载干活的工具：不能读写电脑上的文件、执行命令、编辑代码，也看不到工作区里的项目文件。'
    + '只有用户在这个会话里打开「读附件」或「联网」开关时，才会多出读对话里拖入/ @ 到的文件、联网搜索这几个工具。'
    + '其余要求（跑命令、改文件、操作工作区）请直接说明当前是「纯聊天」模式，并建议新建一个标准模式的会话来处理。',
  '',
  '不要编造你执行过的操作或结果，也不要输出工具调用格式的文本。用自然的语言交流：可以讨论、解释、答疑、写草稿、头脑风暴。',
].join('\n')

const MODE_TAIL = '以上是这个模式的基本规则；下面这段是用户为你设定的人设，在不违背基本规则的前提下按它来。'

/** Copy namespace / display name for logs. */
export const name = 'pure-chat'

/**
 * Row configuration. Every field is volatile: the panel saves them through the
 * config editor and this plugin keeps running with the live values.
 *
 * - `persona` is the default character of any chat session without its own,
 * - `personas` is a JSON object keyed by session id,
 * - `temperature` is shared by every chat session.
 */
export const Config = z.object({
  persona: z.string().default('').volatile(),
  personas: z.string().default('{}').volatile(),
  flags: z.string().default('{}').volatile(),
  temperature: z.number().min(0).max(2).step(0.05).default(1).volatile(),
})

/** Unwrap one schemastery volatile cell; plain values pass through. */
function cell(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return undefined
    }
  }
  return value
}

/** Coerce one cell to a string. */
function asString(value) {
  const raw = cell(value)
  return typeof raw === 'string' ? raw : ''
}

/** Coerce one cell to a finite number inside [min, max]. */
function asNumber(value, fallback, min, max) {
  const raw = cell(value)
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}

/**
 * Parse the session→persona map. Returns null when the cell holds nothing
 * usable, so the caller can fall back to its in-memory copy.
 */
function parsePersonas(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') return null
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const map = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.trim() !== '') map[key] = value
    }
    return map
  } catch {
    return null
  }
}

/**
 * Parse the session→feature-flag map. Returns null when the cell holds nothing
 * usable, so the caller can fall back to its in-memory copy.
 */
function parseFlags(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') return null
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const map = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = {}
      if (value.attachments === true) entry.attachments = true
      if (value.web === true) entry.web = true
      if (Object.keys(entry).length > 0) map[key] = entry
    }
    return map
  } catch {
    return null
  }
}

/** Look up one Host Service without letting a missing service throw. */
function safeGet(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

/** Read the JSON body of one request, refusing oversized payloads. */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(text)
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    request.on('error', reject)
  })
}

/** Write one JSON response. */
function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  response.end(body)
}

/**
 * Publish the mode: per-agent persona section, per-agent temperature override,
 * and the panel API.
 *
 * @param ctx - Host context of this bundle row.
 * @param config - Validated row config (volatile cells for every field).
 */
export function apply(ctx, config = {}) {
  /** Fallback memory state, used only when the profile cannot persist config. */
  const memory = {
    personas: parsePersonas(asString(config.personas)) ?? {},
    flags: parseFlags(asString(config.flags)) ?? {},
    temperature: asNumber(config.temperature, 1, 0, 2),
  }

  /**
   * Values the panel saved while the profile refused to persist them. They keep
   * the panel and the request override usable for this process instead of
   * silently dropping what the user typed.
   */
  const overrides = { personas: null, flags: null, temperature: null }

  /** Whether two persona maps hold the same text. */
  const samePersonas = (left, right) => {
    const a = Object.keys(left)
    const b = Object.keys(right)
    if (a.length !== b.length) return false
    return a.every((key) => left[key] === right[key])
  }

  /** Session→persona map in effect right now. */
  const personaMap = () => {
    if (overrides.personas !== null) {
      const live = parsePersonas(asString(config.personas))
      // Drop the optimistic copy once the config cell caught up with it.
      if (live !== null && samePersonas(live, overrides.personas)) overrides.personas = null
      else return overrides.personas
    }
    const parsed = parsePersonas(asString(config.personas))
    return parsed === null ? memory.personas : parsed
  }

  /** Whether two flag maps hold the same entries. */
  const sameFlags = (left, right) => {
    const a = Object.keys(left)
    const b = Object.keys(right)
    if (a.length !== b.length) return false
    return a.every((key) => {
      const one = left[key]
      const two = right[key]
      return (one?.attachments === true) === (two?.attachments === true)
        && (one?.web === true) === (two?.web === true)
    })
  }

  /** Session→feature-flag map in effect right now. */
  const flagMap = () => {
    if (overrides.flags !== null) {
      const live = parseFlags(asString(config.flags))
      if (live !== null && sameFlags(live, overrides.flags)) overrides.flags = null
      else return overrides.flags
    }
    const parsed = parseFlags(asString(config.flags))
    return parsed === null ? memory.flags : parsed
  }

  /** Feature switches of one session (`{}` means everything off). */
  const flagsOf = (sessionId) => {
    const entry = flagMap()[sessionId]
    return entry === undefined ? {} : entry
  }

  /** Default persona of chat sessions without an entry of their own. */
  const currentDefaultPersona = () => asString(config.persona).trim()

  const currentTemperature = () => {
    if (overrides.temperature !== null) return overrides.temperature
    const live = cell(config.temperature)
    if (typeof live === 'number' && Number.isFinite(live)) return asNumber(config.temperature, 1, 0, 2)
    return memory.temperature
  }

  /** The persona text actually in force for one session. */
  const effectivePersona = (sessionId) => {
    const own = personaMap()[sessionId]
    if (typeof own === 'string' && own.trim() !== '') return own.trim()
    return currentDefaultPersona()
  }

  /** The complete prompt text of one chat agent, re-evaluated on every assembly. */
  const personaPrompt = (sessionId) => {
    const custom = effectivePersona(sessionId)
    return [
      MODE_HEAD,
      custom === '' ? DEFAULT_PERSONA_HINT : custom,
      MODE_TAIL,
    ].join('\n\n')
  }

  /** Session id of one agent, or '' when it is not addressable yet. */
  const sessionIdOf = (agent) => {
    const session = agent === undefined ? undefined : agent.session
    const id = session === undefined ? undefined : session.id
    return typeof id === 'string' ? id : ''
  }

  /** Whether one live agent runs the chat preset. */
  const isChatAgent = (agent) => {
    const session = agent === undefined ? undefined : agent.session
    // A session created straight into the preset records it in its header,
    // before any projection or selection event exists.
    const header = session === undefined ? undefined : session.header
    if (header !== undefined && header !== null && typeof header.agentPreset === 'string') {
      if (header.agentPreset === PRESET_ID) return true
      // The picker binds its preset after creation, leaving a stale header, so
      // a non-chat header only means "look further".
    }
    const registry = safeGet(ctx, 'agentPresets')
    if (registry !== undefined && session !== undefined) {
      try {
        const preset = registry.presetForSession(session)
        if (typeof preset === 'string') return preset === PRESET_ID
      } catch {
        // A projection that is not ready yet falls through to the event scan.
      }
    }
    const events = session !== undefined && typeof session.snapshotEvents === 'function'
      ? session.snapshotEvents()
      : (session !== undefined && Array.isArray(session.events) ? session.events : undefined)
    if (Array.isArray(events)) {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        if (event !== null && typeof event === 'object' && event.type === 'agent-preset/selected') {
          const data = event.data
          return data !== undefined && data !== null && data.agentPreset === PRESET_ID
        }
      }
    }
    return false
  }

  /** Agents that already carry the persona section (installed once each). */
  const installed = new WeakSet()

  /**
   * Hide every host-registered tool from one chat agent. The preset itself
   * ships no tools, but Host-level plugins (context management, music insight,
   * workspace helpers) register theirs globally, and their schemas are the bulk
   * of the first request. `tools.restrict` is a per-scope mask, so other presets
   * keep their tools.
   */
  const restrictTools = (agent) => {
    try {
      agent.ctx.inject(['tools'], (scope) => {
        const tools = scope.tools
        if (tools === undefined || tools === null || typeof tools.restrict !== 'function') return
        let names = []
        try {
          const view = typeof tools.view === 'function' ? tools.view(undefined) : undefined
          if (view !== undefined && view !== null && view.restrictableNames instanceof Set) {
            names = [...view.restrictableNames]
          }
        } catch {
          return
        }
        const deny = names.filter((name) => name !== 'run_code')
        if (deny.length === 0) return
        try {
          tools.restrict({ deny })
        } catch (error) {
          ctx.logger.warn(`pure-chat: tool mask failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
    } catch (error) {
      ctx.logger.warn(`pure-chat: tool mask failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Scope-local tools currently registered on one agent. */
  const agentTools = new WeakMap()

  /** Drop every scope-local tool of one agent. */
  const disposeAgentTools = (agent) => {
    const record = agentTools.get(agent)
    if (record === undefined) return
    agentTools.delete(agent)
    for (const dispose of record.disposers) {
      try {
        dispose()
      } catch {
        // A disposed scope already dropped its tools.
      }
    }
  }

  /** One attachment as text, or a note explaining why it cannot be read. */
  const readAttachmentText = async (ref) => {
    const attachments = safeGet(ctx, 'attachments')
    if (attachments === undefined || typeof attachments.readFileStream !== 'function') {
      throw new Error('附件服务不可用，读不了这次上传的文件。')
    }
    const chunks = []
    let size = 0
    for await (const chunk of attachments.readFileStream(ref)) {
      chunks.push(Buffer.from(chunk))
      size += chunk.length
      if (size > 8 * 1024 * 1024) break
    }
    const bytes = Buffer.concat(chunks)
    if (bytes.includes(0)) return { binary: true, text: '' }
    return { binary: false, text: bytes.toString('utf8') }
  }

  /**
   * File attachment references of the newest prompt that carried any. The parts
   * are read out of the session log, so the tool never needs a receipt id from
   * the model.
   */
  const newestFileRefs = (agent) => {
    const session = agent === undefined ? undefined : agent.session
    const events = session !== undefined && typeof session.snapshotEvents === 'function'
      ? session.snapshotEvents()
      : []
    const found = []
    const collect = (value, depth) => {
      if (depth > 8 || value === null || typeof value !== 'object') return
      if (Array.isArray(value)) {
        for (const item of value) collect(item, depth + 1)
        return
      }
      if (typeof value.attachmentId === 'string' && typeof value.bytes === 'number'
        && typeof value.name === 'string' && value.mediaType === undefined) {
        if (!found.some((ref) => ref.attachmentId === value.attachmentId)) found.push(value)
        return
      }
      for (const item of Object.values(value)) collect(item, depth + 1)
    }
    for (let index = events.length - 1; index >= 0; index -= 1) {
      collect(events[index], 0)
      if (found.length > 0) return found
    }
    return found
  }

  /**
   * `@path` and `@"path with spaces"` mentions of the newest prompt. They are
   * plain text (the composer sends the token, the shipped file-reference plugin
   * only offers a `read`-tool guide), so the attachment reader has to parse
   * them itself to stay useful in a tool-less mode.
   */
  const mentionedPaths = (agent) => {
    const session = agent === undefined ? undefined : agent.session
    const events = session !== undefined && typeof session.snapshotEvents === 'function'
      ? session.snapshotEvents()
      : []
    const texts = []
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event === null || typeof event !== 'object' || event.type !== 'user/message') continue
      const content = event.data === undefined ? undefined : event.data.content
      if (!Array.isArray(content)) continue
      for (const part of content) {
        if (part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
          texts.push(part.text)
        }
      }
      // Look through the last few prompts, so "读一下刚才那个文件" still works
      // when the `@` token itself was sent one message earlier.
      if (texts.length >= 3) break
    }
    const quoted = /(?:^|\s)@"([^"]*)"/gu
    const plain = /(?:^|\s)@([^\s"]+)/gu
    const found = []
    for (const text of texts) {
      const rest = text.replace(quoted, ' ')
      quoted.lastIndex = 0
      let match = quoted.exec(text)
      while (match !== null) {
        found.push(match[1])
        match = quoted.exec(text)
      }
      let other = plain.exec(rest)
      while (other !== null) {
        found.push(other[1])
        other = plain.exec(rest)
      }
    }
    const unique = []
    for (const item of found) {
      const value = item.trim()
      if (value !== '' && !unique.includes(value)) unique.push(value)
    }
    return unique.slice(0, MAX_ATTACHMENT_FILES)
  }

  /** Read one `@`-mentioned path as text, relative to the session working directory. */
  const readMentionedFile = async (agent, mention) => {
    let base = ''
    const working = safeGet(ctx, 'workingDirectory')
    if (working !== undefined && typeof working.ensure === 'function') {
      try {
        base = await working.ensure(agent, new AbortController().signal)
      } catch {
        base = ''
      }
    }
    const target = isAbsolute(mention) ? mention : resolve(base === '' ? '.' : base, mention)
    const bytes = await readFile(target)
    if (bytes.includes(0)) return { binary: true, text: '', path: target }
    return { binary: false, text: bytes.toString('utf8'), path: target }
  }

  /** The web tools one chat session gets when the web switch is on. */  const webTools = () => [
    {
      name: 'web_search',
      description: '在互联网上搜索。返回结果摘要与来源链接；需要正文时再用 web_fetch 抓取。',
      parameters: {
        query: { type: 'string', required: true, description: '搜索查询串' },
        maxResults: { type: 'number', description: '最多返回多少条结果，默认 6' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(args, exec) {
        const web = safeGet(ctx, 'web')
        if (web === undefined || typeof web.search !== 'function') {
          throw new Error('这个 harness 没有可用的联网搜索服务。')
        }
        const query = typeof args?.query === 'string' ? args.query.trim() : ''
        if (query === '') throw new Error('query 不能为空。')
        const request = { query }
        const max = Number(args?.maxResults)
        if (Number.isFinite(max) && max > 0) request.maxResults = Math.min(20, Math.round(max))
        const result = await web.search(request, exec?.signal)
        const lines = []
        const summary = typeof result?.content === 'string' ? result.content.trim() : ''
        if (summary !== '') lines.push(summary)
        const sources = Array.isArray(result?.sources) ? result.sources : []
        sources.forEach((source, index) => {
          const title = typeof source?.title === 'string' && source.title !== '' ? source.title : '(无标题)'
          lines.push(`${index + 1}. ${title} — ${source?.url ?? ''}`)
          const text = typeof source?.snippet === 'string' && source.snippet !== ''
            ? source.snippet
            : (typeof source?.summary === 'string' ? source.summary : '')
          if (text !== '') lines.push(`   ${text.replace(/\s+/g, ' ').slice(0, 400)}`)
        })
        if (result?.truncated === true) lines.push('(结果已截断)')
        return lines.length === 0 ? '没有搜到结果。' : lines.join('\n')
      },
    },
    {
      name: 'web_fetch',
      description: '抓取一个 http(s) 地址的正文（网页或纯文本）。',
      parameters: {
        url: { type: 'string', required: true, description: '要抓取的完整地址，含 https://' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(args, exec) {
        const web = safeGet(ctx, 'web')
        if (web === undefined || typeof web.fetch !== 'function') {
          throw new Error('这个 harness 没有可用的网页抓取服务。')
        }
        const url = typeof args?.url === 'string' ? args.url.trim() : ''
        if (!/^https?:\/\//i.test(url)) throw new Error('url 必须以 http:// 或 https:// 开头。')
        const result = await web.fetch({ url }, exec?.signal)
        const body = typeof result?.body?.content === 'string' ? result.body.content : ''
        const text = result?.body?.kind === 'html'
          ? body
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ')
            .trim()
          : body.trim()
        const head = `HTTP ${result?.statusCode ?? 0} ${url}`
        const clipped = text.length > MAX_ATTACHMENT_CHARS ? `${text.slice(0, MAX_ATTACHMENT_CHARS)}\n(内容已截断)` : text
        return `${head}\n\n${clipped === '' ? '(空正文)' : clipped}`
      },
    },
  ]

  /** The attachment reader one chat session gets when its switch is on. */
  const attachmentTool = (agent) => ({
    name: 'read_attachment',
    description: '读取用户在对话里提到的文件：拖进来上传的附件，以及消息里用 @ 引用的文件（文本、代码、CSV 等）。'
      + '没有参数：读取最近一次消息里的那批文件。',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute() {
      const parts = []

      // Files the user pointed at with `@` in the newest prompt.
      for (const mention of mentionedPaths(agent)) {
        const label = `@${mention}`
        try {
          const read = await readMentionedFile(agent, mention)
          if (read.binary) {
            parts.push(`## ${label}\n(二进制内容，读不了文本；图片请直接发在对话里，我可以看。)`)
            continue
          }
          const clipped = read.text.length > MAX_ATTACHMENT_CHARS
            ? `${read.text.slice(0, MAX_ATTACHMENT_CHARS)}\n(内容已截断)`
            : read.text
          parts.push(`## ${label} (${read.path})\n${clipped}`)
        } catch (error) {
          parts.push(`## ${label}\n(读取失败：${error instanceof Error ? error.message : String(error)})`)
        }
      }

      // Files the user dropped into the composer, which arrive as attachments.
      for (const ref of newestFileRefs(agent).slice(0, MAX_ATTACHMENT_FILES)) {
        const label = `${ref.name} (${ref.bytes} 字节)`
        try {
          const read = await readAttachmentText(ref)
          if (read.binary) {
            parts.push(`## ${label}\n(二进制内容，读不了文本；图片请直接发在对话里，我可以看。)`)
            continue
          }
          const clipped = read.text.length > MAX_ATTACHMENT_CHARS
            ? `${read.text.slice(0, MAX_ATTACHMENT_CHARS)}\n(内容已截断)`
            : read.text
          parts.push(`## ${label}\n${clipped}`)
        } catch (error) {
          parts.push(`## ${label}\n(读取失败：${error instanceof Error ? error.message : String(error)})`)
        }
      }

      return parts.length === 0 ? '这个对话里没有找到上传或 @ 引用的文件。' : parts.join('\n\n')
    },
  })

  /**
   * Reconcile the scope-local tools of one agent with the switches of its
   * session. Registered on `agent.ctx`, so they exist only for that agent and
   * disappear with their disposers.
   */
  const syncTools = (agent) => {
    if (agent === null || typeof agent !== 'object') return
    const wanted = flagsOf(sessionIdOf(agent))
    const key = `${wanted.web === true}/${wanted.attachments === true}`
    const record = agentTools.get(agent)
    if (record !== undefined && record.key === key) return
    disposeAgentTools(agent)
    const definitions = []
    if (wanted.web === true) definitions.push(...webTools())
    if (wanted.attachments === true) definitions.push(attachmentTool(agent))
    if (definitions.length === 0) return
    try {
      agent.ctx.inject(['tools'], (scope) => {
        const disposers = []
        for (const definition of definitions) {
          try {
            disposers.push(scope.tools.register(definition))
          } catch (error) {
            ctx.logger.warn(`pure-chat: tool ${definition.name} failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        agentTools.set(agent, { key, disposers })
      })
    } catch (error) {
      ctx.logger.warn(`pure-chat: tool install failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Register the chat persona on one agent. The section is agent-scoped, so it
   * never reaches another preset, and it is the only `complete` section of a
   * chat agent (the preset itself carries no persona row).
   * @param agent live agent.
   * @param knownChat the caller already read a `chat` preset binding (the
   *   projection lags right after the selection event, so it cannot be asked).
   */
  const installPersona = (agent, knownChat = false) => {
    if (agent === null || typeof agent !== 'object') return
    if (installed.has(agent)) return
    if (!knownChat && !isChatAgent(agent)) return
    const sessionId = sessionIdOf(agent)
    installed.add(agent)
    restrictTools(agent)
    syncTools(agent)
    try {
      agent.ctx.inject(['systemPrompt'], (scope) => {
        let order = 0
        try {
          const resolved = typeof scope.systemPrompt.getSectionOrder === 'function'
            ? scope.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX')
            : undefined
          if (typeof resolved === 'number') order = resolved
        } catch {
          // An unknown order name is not worth failing the section for.
        }
        scope.systemPrompt.section({
          name: 'pure-chat:persona',
          order: typeof order === 'number' ? order : 0,
          complete: true,
          text: () => personaPrompt(sessionId),
        })
      })
    } catch (error) {
      installed.delete(agent)
      ctx.logger.warn(`pure-chat: persona section failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** One live agent holding a session, when the host still has it. */
  const agentOfSession = (session) => {
    const sessionId = session === undefined ? undefined : session.id
    if (typeof sessionId !== 'string') return undefined
    const live = safeGet(ctx, 'agents')
    if (live === undefined || typeof live.list !== 'function') return undefined
    try {
      for (const agent of live.list()) {
        if (sessionIdOf(agent) === sessionId) return agent
      }
    } catch {
      return undefined
    }
    return undefined
  }

  // Agents that already exist when the bundle activates (for example a plugin
  // reload in a running profile) get the same treatment as new ones.
  const agents = safeGet(ctx, 'agents')
  if (agents !== undefined && typeof agents.list === 'function') {
    for (const agent of agents.list()) installPersona(agent)
  }
  ctx.on('agent/created', ({ agent }) => { installPersona(agent) })

  // The session picker binds its preset *after* the Agent exists (it calls
  // `select`, which recomposes the tree and then appends this event). The
  // prompt of the first turn is assembled from the new composition, so the
  // section has to be in place before that turn enters — waiting for
  // `agent/pre-step` is too late, because assembly already happened there.
  ctx.on('session/event', (session, event) => {
    if (event === null || typeof event !== 'object') return
    if (event.type !== 'agent-preset/selected') return
    const data = event.data
    if (data === undefined || data === null || data.agentPreset !== PRESET_ID) return
    const agent = agentOfSession(session)
    if (agent !== undefined) installPersona(agent, true)
  })

  // Only the sampling temperature is rewritten: provider, model and reasoning
  // effort must stay exactly as the step prepared them.
  ctx.on('agent/request', async ({ agent }, next) => {
    // A preset projection that was not ready at creation gets a second chance
    // here; the section then applies from the next assembly on.
    installPersona(agent)
    const requestConfig = await next()
    if (!isChatAgent(agent)) return requestConfig
    const temperature = currentTemperature()
    if (requestConfig.temperature === temperature) return requestConfig
    return { ...requestConfig, temperature }
  })

  /** Which preset one session runs, by asking the live agents first. */
  const presetOfSession = (sessionId) => {
    if (sessionId === '') return null
    const live = safeGet(ctx, 'agents')
    if (live === undefined || typeof live.list !== 'function') return null
    try {
      for (const agent of live.list()) {
        if (sessionIdOf(agent) === sessionId) return isChatAgent(agent) ? PRESET_ID : 'other'
      }
    } catch {
      return null
    }
    return null
  }

  /**
   * Persist a partial config change. Returns whether the profile accepted it;
   * a false result keeps the in-memory value so the panel still works for this
   * process and can report the limitation.
   */
  const persist = async (patch) => {
    const entry = ctx.fiber === undefined ? undefined : ctx.fiber.entry
    const editor = safeGet(ctx, 'configEditor')
    if (entry === undefined || editor === undefined || typeof editor.edit !== 'function') {
      return { saved: false, reason: '这个 profile 无法保存插件配置（configEditor 不可用），本次只在当前进程内生效。' }
    }
    try {
      await editor.edit(entry, (current) => ({ ...current, ...patch }))
      return { saved: true }
    } catch (error) {
      return {
        saved: false,
        reason: `配置写入被拒绝：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /** Read the panel state for one session. */
  const stateOf = (sessionId, map = personaMap()) => {
    const own = typeof map[sessionId] === 'string' ? map[sessionId] : ''
    const effective = own.trim() !== '' ? own.trim() : currentDefaultPersona()
    return {
      sessionId,
      persona: own,
      defaultPersona: currentDefaultPersona(),
      effectivePersona: effective,
      temperature: currentTemperature(),
      preset: presetOfSession(sessionId),
      flags: flagsOf(sessionId),
      mode: PRESET_ID,
      maxPersonaChars: MAX_PERSONA_CHARS,
      defaultPersonaHint: DEFAULT_PERSONA_HINT,
    }
  }

  /** One request against the panel API. */
  const handle = async (request, response) => {
    const connection = safeGet(ctx, 'connection')
    if (connection !== undefined && typeof connection.admit === 'function') {
      try {
        const admission = connection.admit(request)
        if (admission !== undefined && admission !== null && 'rejection' in admission) {
          response.writeHead(admission.rejection)
          response.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
      } catch {
        response.writeHead(403)
        response.end('forbidden')
        return
      }
    }

    const url = new URL(request.url === undefined ? '/' : request.url, 'http://127.0.0.1')
    const path = url.pathname

    if (path === `${ROUTE_PREFIX}/state`) {
      if (request.method === 'GET' || request.method === 'HEAD') {
        const sessionId = url.searchParams.get('sessionId') ?? ''
        sendJson(response, 200, stateOf(sessionId))
        return
      }
      if (request.method === 'POST') {
        let body
        try {
          body = await readJsonBody(request)
        } catch (error) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : 'bad request' })
          return
        }
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        const patch = {}
        const notes = []
        const nextMap = { ...personaMap() }
        let mapChanged = false
        let nextFlags = null
        if (body.persona !== undefined) {
          if (sessionId === '') {
            sendJson(response, 400, { error: 'sessionId is required to save a persona' })
            return
          }
          if (typeof body.persona !== 'string') {
            sendJson(response, 400, { error: 'persona must be a string' })
            return
          }
          if (body.persona.length > MAX_PERSONA_CHARS) {
            sendJson(response, 400, { error: `persona is longer than ${MAX_PERSONA_CHARS} characters` })
            return
          }
          if (body.persona.trim() === '') delete nextMap[sessionId]
          else nextMap[sessionId] = body.persona
          patch.personas = JSON.stringify(nextMap)
          mapChanged = true
        }
        if (body.temperature !== undefined) {
          const value = typeof body.temperature === 'number' ? body.temperature : Number.NaN
          if (!Number.isFinite(value) || value < 0 || value > 2) {
            sendJson(response, 400, { error: 'temperature must be a number between 0 and 2' })
            return
          }
          patch.temperature = Math.round(value * 100) / 100
        }
        if (body.flags !== undefined) {
          if (sessionId === '') {
            sendJson(response, 400, { error: 'sessionId is required to save feature switches' })
            return
          }
          if (body.flags === null || typeof body.flags !== 'object' || Array.isArray(body.flags)) {
            sendJson(response, 400, { error: 'flags must be an object' })
            return
          }
          const entry = {}
          for (const [flag, value] of Object.entries(body.flags)) {
            if (flag !== 'attachments' && flag !== 'web') continue
            if (typeof value !== 'boolean') {
              sendJson(response, 400, { error: `flag ${flag} must be a boolean` })
              return
            }
            if (value) entry[flag] = true
          }
          const next = { ...flagMap() }
          if (Object.keys(entry).length === 0) delete next[sessionId]
          else next[sessionId] = entry
          nextFlags = next
          patch.flags = JSON.stringify(next)
        }
        if (Object.keys(patch).length === 0) {
          sendJson(response, 200, { ...stateOf(sessionId), saved: true, notes })
          return
        }
        if (patch.temperature !== undefined) memory.temperature = patch.temperature
        const result = await persist(patch)
        if (!result.saved) {
          // Keep the typed values usable for this process even when the profile
          // refuses to store them, and say so in the panel.
          if (mapChanged) overrides.personas = nextMap
          if (patch.temperature !== undefined) overrides.temperature = patch.temperature
        } else {
          if (mapChanged) {
            // Hold the saved map in memory until the config cell reports it, so
            // the next prompt never reads back the pre-save value.
            overrides.personas = nextMap
            memory.personas = nextMap
          }
          if (patch.temperature !== undefined) overrides.temperature = null
        }
        if (result.reason !== undefined) notes.push(result.reason)
        if (nextFlags !== null) {
          // Keep the switches usable right away, then re-sync the live agents so
          // the tools appear or disappear without waiting for a page reload.
          overrides.flags = nextFlags
          memory.flags = nextFlags
          const live = safeGet(ctx, 'agents')
          if (live !== undefined && typeof live.list === 'function') {
            try {
              for (const agent of live.list()) {
                if (isChatAgent(agent)) syncTools(agent)
              }
            } catch (error) {
              ctx.logger.warn(`pure-chat: tool resync failed: ${error instanceof Error ? error.message : String(error)}`)
            }
          }
        }
        sendJson(response, 200, { ...stateOf(sessionId, mapChanged ? nextMap : personaMap()), saved: result.saved, notes })
        return
      }
      sendJson(response, 405, { error: 'method not allowed' })
      return
    }

    sendJson(response, 404, { error: 'not found' })
  }

  ctx.inject(['webServer'], (web) => {
    web.effect(() => web.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: handle,
    }), 'pure-chat: panel API')
  })
}
