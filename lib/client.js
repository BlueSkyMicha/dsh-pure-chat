/**
 * dsh-pure-chat — Web client side.
 *
 * Adds two surfaces:
 *
 * 1. a right-sidebar tab ("聊天设置") that edits the persona and sampling
 *    temperature of the 纯聊天 preset and can hand the current conversation to a
 *    fresh standard-mode session as one editable draft, and
 * 2. a small button in the composer dock that opens that tab.
 *
 * The tab is registered without `patterns`, so it is reachable from the
 * right-sidebar guide list instead of opening itself automatically.
 */
window.__ModuleLoader__.load({
  id: 'dsh-pure-chat',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-pure-chat'
    const TAB_ID = 'dsh-pure-chat'
    const TAB_KIND = 'dsh-pure-chat'
    const MAX_PERSONA = 20000

    /**
     * Host routes are absolute paths; the browser form drops the leading slash
     * so the app keeps working when it is not mounted at the origin root.
     */
    const apiPath = (path) => {
      const relative = String(path).replace(/^\/+/, '')
      if (typeof document === 'undefined') return `/${relative}`
      return new URL(relative, document.baseURI).pathname
    }

    const STATE_PATH = apiPath('/dsh-pure-chat/state')
    const MARKDOWN_PATH = apiPath('/api/session.markdown')

    const zh = {
      'tab.title': '聊天设置',
      'guide.title': '聊天设置',
      'guide.description': '写「纯聊天」模式的人设、调温度，或把当前会话导入新的标准会话',
      'dock.label': '聊天设置',
      'dock.failed': '侧边栏暂时打不开，请从右侧栏的引导页进入',
      'panel.title': '纯聊天设置',
      'panel.subtitle': '人设只属于当前这个会话；温度对所有「纯聊天」会话生效。改完立刻对下一步回复生效。',
      'panel.loading': '正在读取设置…',
      'panel.persona.label': '人设（只作用于本会话）',
      'panel.persona.placeholder': '例如：你是耐心的写作教练，先提问再给建议，语气轻松，不要堆术语。',
      'panel.persona.inherit': '留空就继承默认人设：{text}',
      'panel.persona.hint': '留空就是默认的纯聊天风格。你的文字会接在「纯聊天」模式提示词后面，只影响当前会话。',
      'panel.persona.counter': '已用 {n} / 20000 字',
      'panel.temperature.label': '温度',
      'panel.temperature.hint': '0 到 2，越高越发散，越低越稳定。',
      'panel.temperature.invalid': '温度需要是 0 到 2 之间的数字。',
      'panel.topp.label': 'Top P',
      'panel.topp.value': '宿主不支持',
      'panel.topp.hint': '当前 DeepSeek Harness 的模型接口只接受 temperature，没有 top_p 参数，所以这一项暂时只能留空。',
      'panel.flags.title': '能力开关（只作用于本会话）',
      'panel.flags.desc': '默认全关：纯聊天什么都不带。打开后只给这个会话多挂对应的几个工具。',
      'panel.flags.attachments': '读对话框附件：能读你拖进来的文本、代码、CSV 等文件内容（图片本身就能看，不需要开关）',
      'panel.flags.web': '联网：能搜索网页并抓取链接正文',
      'panel.flags.cost': '打开会增加一点 token（工具说明会随请求发送）；关掉立刻消失。',
      'panel.flags.saved': '能力开关已更新',
      'panel.save': '保存',
      'panel.saving': '保存中…',
      'panel.saved': '已保存',
      'panel.dirty': '有未保存的修改',
      'panel.failed': '保存失败：',
      'panel.reload': '重新读取',
      'panel.reload.confirm': '重新读取会覆盖你还没有保存的修改，继续？',
      'panel.import.title': '导入到新的标准会话',
      'panel.import.desc': '把当前会话的完整记录作为一条草稿放进新的标准模式会话，你可以先改再发送。',
      'panel.import.action': '导入并新建会话',
      'panel.import.confirm': '再点一次确认：新建一个标准模式的会话，并把整段记录放进它的草稿',
      'panel.import.cancel': '取消',
      'panel.import.working': '正在整理会话…',
      'panel.import.done': '已把记录交给新会话的草稿；如果界面没有切过去，去会话列表里看最新的那条。',
      'panel.import.failed': '导入失败：',
      'panel.import.empty': '这个会话还没有可导出的内容。',
      'panel.import.unsupported': '这个版本没有开启会话导出（session-log-export），无法导入。',
      'panel.preset.note': '新建会话时选择「纯聊天」即可进入这个模式。',
      'panel.mode.other': '当前会话不是纯聊天模式：preset 在创建时绑定、事后不能切换，所以这段人设在这里不会被使用。',
      'panel.mode.new': '新建一个纯聊天会话',
      'panel.mode.unknown': '还没确认这个会话的模式。如果它是在「纯聊天」下创建的，人设会在下一步回复生效。',
    }

    const en = {
      'tab.title': 'Chat settings',
      'guide.title': 'Chat settings',
      'guide.description': 'Write the persona of Pure chat mode, tune its temperature, or hand this conversation to a new standard session',
      'dock.label': 'Chat settings',
      'dock.failed': 'The side panel is unavailable; open it from the right sidebar guide',
      'panel.title': 'Pure chat settings',
      'panel.subtitle': 'The persona belongs to this conversation only; temperature applies to every Pure chat session. Both take effect on the next reply.',
      'panel.loading': 'Reading settings…',
      'panel.persona.label': 'Persona (this conversation only)',
      'panel.persona.placeholder': 'For example: you are a patient writing coach who asks a question before giving advice, in a light tone.',
      'panel.persona.inherit': 'Empty inherits the default: {text}',
      'panel.persona.hint': 'Leave it empty for the default Pure chat voice. Your text follows the mode prompt and affects this conversation only.',
      'panel.persona.counter': '{n} / 20000 characters',
      'panel.temperature.label': 'Temperature',
      'panel.temperature.hint': 'Between 0 and 2: higher is more varied, lower is steadier.',
      'panel.temperature.invalid': 'Temperature must be a number between 0 and 2.',
      'panel.topp.label': 'Top P',
      'panel.topp.value': 'Not available',
      'panel.topp.hint': 'The DeepSeek Harness model interface only accepts temperature, so top_p cannot be set here yet.',
      'panel.flags.title': 'Capabilities (this conversation only)',
      'panel.flags.desc': 'Off by default: Pure chat carries no tools. Turning one on adds only those few tools to this conversation.',
      'panel.flags.attachments': 'Read chat attachments: text, code and CSV files you drop into the chat (images are already visible)',
      'panel.flags.web': 'Web: search the web and fetch the text of a link',
      'panel.flags.cost': 'Turning a switch on adds some tokens (tool descriptions ship with each request); turning it off removes them at once.',
      'panel.flags.saved': 'Capabilities updated',
      'panel.save': 'Save',
      'panel.saving': 'Saving…',
      'panel.saved': 'Saved',
      'panel.dirty': 'Unsaved changes',
      'panel.failed': 'Save failed: ',
      'panel.reload': 'Reload',
      'panel.reload.confirm': 'Reloading discards the changes you have not saved. Continue?',
      'panel.import.title': 'Copy into a new standard session',
      'panel.import.desc': 'Places this conversation into a new standard-mode session as one draft you can edit before sending.',
      'panel.import.action': 'Copy to new session',
      'panel.import.confirm': 'Click again to confirm: a new standard session opens with this conversation as its draft',
      'panel.import.cancel': 'Cancel',
      'panel.import.working': 'Preparing…',
      'panel.import.done': 'The conversation was handed to a new session draft. If the view did not switch, look for the newest session in the list.',
      'panel.import.failed': 'Copy failed: ',
      'panel.import.empty': 'This conversation has nothing to export yet.',
      'panel.import.unsupported': 'This build does not enable session export (session-log-export), so the copy cannot run.',
      'panel.preset.note': 'Choose Pure chat when you create a session to use this mode.',
      'panel.mode.other': 'This conversation does not run Pure chat: a preset is bound when the session is created and cannot be switched afterwards, so this persona is unused here.',
      'panel.mode.new': 'Open a new Pure chat session',
      'panel.mode.unknown': 'The mode of this conversation is not confirmed yet. If it was created in Pure chat, the persona applies to the next reply.',
    }

    // Component-local styles: one style element inside the panel root disappears
    // with the panel, and only our own class names are touched.
    const css = `
      .dshpc-root { box-sizing: border-box; display: flex; flex-direction: column; gap: 18px; padding: 16px 18px 28px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; }
      .dshpc-title { font-size: 15px; font-weight: 600; margin: 0; }
      .dshpc-subtitle, .dshpc-hint { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 11px; }
      .dshpc-section { display: flex; flex-direction: column; gap: 8px; padding: 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
      .dshpc-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
      .dshpc-label { font-weight: 600; font-size: 12px; }
      .dshpc-textarea, .dshpc-input { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 13px; line-height: 1.5; }
      .dshpc-textarea { min-height: 120px; resize: vertical; }
      .dshpc-input { width: 72px; padding: 5px 8px; }
      .dshpc-textarea:focus-visible, .dshpc-input:focus-visible, .dshpc-btn:focus-visible, .dshpc-range:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .dshpc-btn { appearance: none; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); padding: 6px 12px; font-family: inherit; font-size: 12px; cursor: pointer; min-height: 28px; }
      .dshpc-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-overlay); }
      .dshpc-btn:disabled { cursor: default; opacity: 0.5; }
      .dshpc-btn-primary { border-color: transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); font-weight: 600; }
      .dshpc-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
      .dshpc-btn-ghost { border-color: var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); }
      .dshpc-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .dshpc-range { width: 100%; accent-color: var(--dsw-alias-brand-primary); }
      .dshpc-check { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; cursor: pointer; }
      .dshpc-check input { margin: 2px 0 0; accent-color: var(--dsw-alias-brand-primary); }
      .dshpc-check:has(input:disabled) { cursor: default; opacity: 0.6; }
      .dshpc-ok { margin: 0; font-size: 11px; color: var(--dsw-alias-state-success-primary); }
      .dshpc-error { margin: 0; font-size: 11px; color: var(--dsw-alias-state-error-primary); }
      .dshpc-note { margin: 0; font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .dshpc-banner { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
      .dshpc-banner-text { margin: 0; font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-primary); }
      .dshpc-dock { appearance: none; border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); border-radius: 999px; padding: 4px 12px; min-height: 26px; font-family: inherit; font-size: 11px; cursor: pointer; }
      .dshpc-dock:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
      .dshpc-dock:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
    `

    /** Read the panel state of one session from the Host plugin. */
    async function fetchState(sessionId) {
      const query = typeof sessionId === 'string' && sessionId !== ''
        ? `?sessionId=${encodeURIComponent(sessionId)}`
        : ''
      const response = await fetch(`${STATE_PATH}${query}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

    /** Save a partial state of one session; resolves to the Host answer. */
    async function saveState(sessionId, patch) {
      const response = await fetch(STATE_PATH, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sessionId, ...patch }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
      return payload
    }

    /** Fetch the current conversation as Markdown through the shipped export route. */
    async function readConversationMarkdown(sessionId) {
      const response = await fetch(`${MARKDOWN_PATH}?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { accept: 'text/markdown' },
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(detail.trim() === '' ? `HTTP ${response.status}` : `${detail.trim()} (HTTP ${response.status})`)
      }
      return response.text()
    }

    /** Clamp one temperature, keeping two decimals. */
    const clampTemperature = (value) => Math.round(Math.min(2, Math.max(0, value)) * 100) / 100

    const pureChatPanel = (props) => {
      const { sessionId, uiWorkspace, t } = props

      const [loading, setLoading] = React.useState(true)
      const [persona, setPersona] = React.useState('')
      const [defaultPersona, setDefaultPersona] = React.useState('')
      const [preset, setPreset] = React.useState(null)
      const [temperature, setTemperature] = React.useState(1)
      const [temperatureText, setTemperatureText] = React.useState('1.00')
      const [flags, setFlags] = React.useState({})
      const [baseline, setBaseline] = React.useState({ persona: '', temperature: 1 })
      const [saving, setSaving] = React.useState(false)
      const [saveNote, setSaveNote] = React.useState(null)
      const [importing, setImporting] = React.useState(false)
      const [importArmed, setImportArmed] = React.useState(false)
      const [importNote, setImportNote] = React.useState(null)

      const aliveRef = React.useRef(true)
      React.useEffect(() => () => { aliveRef.current = false }, [])

      const applyState = (state) => {
        const nextPersona = typeof state.persona === 'string' ? state.persona : ''
        const nextDefault = typeof state.defaultPersona === 'string' ? state.defaultPersona : ''
        const nextTemperature = typeof state.temperature === 'number' ? clampTemperature(state.temperature) : 1
        setPersona(nextPersona)
        setDefaultPersona(nextDefault)
        setPreset(typeof state.preset === 'string' ? state.preset : null)
        setFlags(state.flags !== null && typeof state.flags === 'object' ? state.flags : {})
        setTemperature(nextTemperature)
        setTemperatureText(nextTemperature.toFixed(2))
        setBaseline({ persona: nextPersona, temperature: nextTemperature })
      }

      const load = () => {
        setLoading(true)
        fetchState(sessionId).then((state) => {
          if (!aliveRef.current) return
          applyState(state)
          setSaveNote(null)
        }).catch((error) => {
          if (!aliveRef.current) return
          setSaveNote({ kind: 'error', text: `${t('panel.failed')}${error instanceof Error ? error.message : String(error)}` })
        }).finally(() => {
          if (aliveRef.current) setLoading(false)
        })
      }

      React.useEffect(load, [])

      const dirty = persona !== baseline.persona || temperature !== baseline.temperature

      /** Commit whatever the temperature field currently holds. */
      const commitTemperature = () => {
        const parsed = Number(temperatureText)
        if (!Number.isFinite(parsed)) {
          setTemperatureText(temperature.toFixed(2))
          return temperature
        }
        const next = clampTemperature(parsed)
        setTemperature(next)
        setTemperatureText(next.toFixed(2))
        return next
      }

      const onSave = () => {
        const nextTemperature = commitTemperature()
        setSaving(true)
        setSaveNote(null)
        saveState(sessionId, { persona, temperature: nextTemperature }).then((state) => {
          if (!aliveRef.current) return
          const savedPersona = typeof state.persona === 'string' ? state.persona : persona
          const savedTemperature = typeof state.temperature === 'number' ? clampTemperature(state.temperature) : nextTemperature
          setPersona(savedPersona)
          if (typeof state.defaultPersona === 'string') setDefaultPersona(state.defaultPersona)
          if (typeof state.preset === 'string') setPreset(state.preset)
          setTemperature(savedTemperature)
          setTemperatureText(savedTemperature.toFixed(2))
          setBaseline({ persona: savedPersona, temperature: savedTemperature })
          if (Array.isArray(state.notes) && state.notes.length > 0) {
            setSaveNote({ kind: 'error', text: state.notes.join(' ') })
          } else {
            setSaveNote({ kind: 'ok', text: t('panel.saved') })
          }
        }).catch((error) => {
          if (!aliveRef.current) return
          setSaveNote({ kind: 'error', text: `${t('panel.failed')}${error instanceof Error ? error.message : String(error)}` })
        }).finally(() => {
          if (aliveRef.current) setSaving(false)
        })
      }

      /** Flip one capability switch and save it right away. */
      const onToggleFlag = (name) => {
        const previous = flags
        const next = { ...flags, [name]: flags[name] !== true }
        setFlags(next)
        setSaving(true)
        setSaveNote(null)
        saveState(sessionId, { flags: next }).then((state) => {
          if (!aliveRef.current) return
          setFlags(state.flags !== null && typeof state.flags === 'object' ? state.flags : next)
          setSaveNote({ kind: 'ok', text: t('panel.flags.saved') })
        }).catch((error) => {
          if (!aliveRef.current) return
          setFlags(previous)
          setSaveNote({ kind: 'error', text: `${t('panel.failed')}${error instanceof Error ? error.message : String(error)}` })
        }).finally(() => {
          if (aliveRef.current) setSaving(false)
        })
      }

      /** Open a fresh session in this very mode, for conversations that are not. */
      const onOpenChatSession = () => {
        try {
          uiWorkspace.startSession(undefined, { agentPreset: 'chat' })
        } catch (error) {
          setSaveNote({ kind: 'error', text: `${t('panel.failed')}${error instanceof Error ? error.message : String(error)}` })
        }
      }

      const onReload = () => {
        if (dirty && !window.confirm(t('panel.reload.confirm'))) return
        load()
      }

      const onImport = () => {
        if (typeof sessionId !== 'string' || sessionId === '') return
        if (!importArmed) {
          setImportArmed(true)
          setImportNote({ kind: 'note', text: t('panel.import.confirm') })
          return
        }
        setImportArmed(false)
        setImporting(true)
        setImportNote(null)
        readConversationMarkdown(sessionId).then((markdown) => {
          if (!aliveRef.current) return
          if (markdown.trim() === '') throw new Error(t('panel.import.empty'))
          uiWorkspace.startSession(undefined, {
            agentPreset: 'standard',
            prompt: markdown,
            whenDraftExists: 'replace',
          })
          setImportNote({ kind: 'ok', text: t('panel.import.done') })
        }).catch((error) => {
          if (!aliveRef.current) return
          const message = error instanceof Error ? error.message : String(error)
          const text = /^\s*HTTP 404\b/.test(message)
            ? t('panel.import.unsupported')
            : `${t('panel.import.failed')}${message}`
          setImportNote({ kind: 'error', text })
        }).finally(() => {
          if (aliveRef.current) setImporting(false)
        })
      }

      const canImport = typeof sessionId === 'string' && sessionId !== ''
      const noteStyle = (note) => (note.kind === 'ok' ? 'dshpc-ok' : note.kind === 'error' ? 'dshpc-error' : 'dshpc-note')
      const liveRole = (note) => (note.kind === 'error' ? 'alert' : 'status')

      return h('div', { className: 'dshpc-root' },
        h('style', null, css),

        h('div', null,
          h('h2', { className: 'dshpc-title' }, t('panel.title')),
          h('p', { className: 'dshpc-subtitle' }, t('panel.subtitle')),
        ),

        loading || preset === 'chat'
          ? null
          : h('div', { className: 'dshpc-banner', role: 'status' },
            h('p', { className: 'dshpc-banner-text' }, preset === 'other' ? t('panel.mode.other') : t('panel.mode.unknown')),
            preset === 'other'
              ? h('button', {
                className: 'dshpc-btn',
                type: 'button',
                onClick: onOpenChatSession,
              }, t('panel.mode.new'))
              : null,
          ),

        h('div', { className: 'dshpc-section' },
          h('div', { className: 'dshpc-head' },
            h('label', { className: 'dshpc-label', htmlFor: 'dshpc-persona' }, t('panel.persona.label')),
            h('span', { className: 'dshpc-hint' }, t('panel.persona.counter').replace('{n}', String(persona.length))),
          ),
          h('textarea', {
            id: 'dshpc-persona',
            className: 'dshpc-textarea',
            value: persona,
            placeholder: defaultPersona.trim() === ''
              ? t('panel.persona.placeholder')
              : t('panel.persona.inherit').replace('{text}', defaultPersona),
            maxLength: MAX_PERSONA,
            spellCheck: false,
            disabled: loading,
            onChange: (event) => setPersona(event.target.value),
          }),
          h('p', { className: 'dshpc-hint' }, t('panel.persona.hint')),
        ),

        h('div', { className: 'dshpc-section' },
          h('div', { className: 'dshpc-head' },
            h('label', { className: 'dshpc-label', htmlFor: 'dshpc-temperature-range' }, t('panel.temperature.label')),
            h('span', { className: 'dshpc-hint' }, temperature.toFixed(2)),
          ),
          h('input', {
            id: 'dshpc-temperature-range',
            className: 'dshpc-range',
            type: 'range',
            min: 0,
            max: 2,
            step: 0.05,
            value: temperature,
            disabled: loading,
            'aria-valuetext': temperature.toFixed(2),
            onChange: (event) => {
              const next = clampTemperature(Number(event.target.value))
              setTemperature(next)
              setTemperatureText(next.toFixed(2))
            },
          }),
          h('div', { className: 'dshpc-row' },
            h('input', {
              id: 'dshpc-temperature-value',
              className: 'dshpc-input',
              type: 'text',
              inputMode: 'decimal',
              value: temperatureText,
              disabled: loading,
              'aria-label': t('panel.temperature.label'),
              onChange: (event) => setTemperatureText(event.target.value),
              onBlur: commitTemperature,
              onKeyDown: (event) => {
                if (event.key === 'Enter') commitTemperature()
              },
            }),
            h('span', { className: 'dshpc-hint' }, t('panel.temperature.hint')),
          ),
          Number.isFinite(Number(temperatureText)) && temperatureText.trim() !== ''
            ? null
            : h('p', { className: 'dshpc-error', role: 'alert' }, t('panel.temperature.invalid')),
        ),

        h('div', { className: 'dshpc-section' },
          h('div', { className: 'dshpc-head' },
            h('span', { className: 'dshpc-label' }, t('panel.flags.title')),
          ),
          h('p', { className: 'dshpc-hint' }, t('panel.flags.desc')),
          h('label', { className: 'dshpc-check', htmlFor: 'dshpc-flag-attachments' },
            h('input', {
              id: 'dshpc-flag-attachments',
              type: 'checkbox',
              checked: flags.attachments === true,
              disabled: loading || saving || preset !== 'chat',
              onChange: () => onToggleFlag('attachments'),
            }),
            h('span', null, t('panel.flags.attachments')),
          ),
          h('label', { className: 'dshpc-check', htmlFor: 'dshpc-flag-web' },
            h('input', {
              id: 'dshpc-flag-web',
              type: 'checkbox',
              checked: flags.web === true,
              disabled: loading || saving || preset !== 'chat',
              onChange: () => onToggleFlag('web'),
            }),
            h('span', null, t('panel.flags.web')),
          ),
          h('p', { className: 'dshpc-hint' }, t('panel.flags.cost')),
        ),

        h('div', { className: 'dshpc-section' },
          h('div', { className: 'dshpc-head' },
            h('label', { className: 'dshpc-label', htmlFor: 'dshpc-topp' }, t('panel.topp.label')),
            h('span', { className: 'dshpc-hint' }, t('panel.topp.value')),
          ),
          h('input', {
            id: 'dshpc-topp',
            className: 'dshpc-input',
            type: 'text',
            value: '',
            disabled: true,
            readOnly: true,
            'aria-disabled': true,
            'aria-describedby': 'dshpc-topp-hint',
          }),
          h('p', { className: 'dshpc-hint', id: 'dshpc-topp-hint' }, t('panel.topp.hint')),
        ),

        h('div', { className: 'dshpc-row' },
          h('button', {
            className: 'dshpc-btn dshpc-btn-primary',
            type: 'button',
            disabled: loading || saving || !dirty,
            onClick: onSave,
          }, saving ? t('panel.saving') : t('panel.save')),
          h('button', {
            className: 'dshpc-btn',
            type: 'button',
            disabled: loading || saving,
            onClick: onReload,
          }, t('panel.reload')),
          dirty ? h('span', { className: 'dshpc-note', role: 'status' }, t('panel.dirty')) : null,
        ),
        saveNote === null ? null : h('p', { className: noteStyle(saveNote), role: liveRole(saveNote) }, saveNote.text),

        h('div', { className: 'dshpc-section' },
          h('span', { className: 'dshpc-label' }, t('panel.import.title')),
          h('p', { className: 'dshpc-hint' }, t('panel.import.desc')),
          h('div', { className: 'dshpc-row' },
            h('button', {
              className: 'dshpc-btn dshpc-btn-primary',
              type: 'button',
              disabled: importing || !canImport,
              onClick: onImport,
            }, importing ? t('panel.import.working') : importArmed ? t('panel.import.confirm') : t('panel.import.action')),
            importArmed && !importing
              ? h('button', {
                className: 'dshpc-btn',
                type: 'button',
                onClick: () => { setImportArmed(false); setImportNote(null) },
              }, t('panel.import.cancel'))
              : null,
          ),
          importNote === null ? null : h('p', { className: noteStyle(importNote), role: liveRole(importNote) }, importNote.text),
          canImport ? null : h('p', { className: 'dshpc-hint' }, t('panel.preset.note')),
        ),
      )
    }

    const pureChatTitle = (props) => h('span', null, props.t('tab.title'))

    const composerDock = (props) => {
      const { sessionId, t, sidebarRight } = props
      const [failed, setFailed] = React.useState(false)

      // Only a Pure chat session is governed by these settings, so the pill
      // appears there and nowhere else.
      const sessionPreset = typeof props.useSessions === 'function'
        ? props.useSessions((state) => {
          const value = state.byId[sessionId]?.projectionValues?.agentPreset
          return typeof value === 'string' ? value : undefined
        })
        : undefined

      const open = () => {
        try {
          sidebarRight.openTab(TAB_KIND, { revealIfOpened: true })
          setFailed(false)
        } catch {
          setFailed(true)
        }
      }
      if (sessionPreset !== 'chat') return null
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: '8px' } },
        h('button', {
          className: 'dshpc-dock',
          type: 'button',
          onClick: open,
          title: failed ? t('dock.failed') : t('guide.description'),
        }, t('dock.label')),
        failed ? h('span', { className: 'dshpc-error', role: 'status' }, t('dock.failed')) : null,
      )
    }

    const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'uiWorkspace']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'pure-chat: locale dictionary')
      const bound = ctx.locale.bind(NS)
      /**
       * Translate one key. The locale service answers with the key itself when
       * a namespace or locale is not registered yet, so a miss falls back to
       * our own dictionary instead of printing the key into the UI.
       */
      const t = (key) => {
        let active = 'en'
        try {
          const snapshot = ctx.locale.getSnapshot()
          active = typeof snapshot?.active === 'string' ? snapshot.active : 'en'
        } catch { /* the service is not ready: fall back to English */ }
        const dict = active.toLowerCase().startsWith('zh') ? zh : en
        try {
          const value = bound(key)
          if (typeof value === 'string' && value !== key) return value
        } catch { /* fall through to the local dictionary */ }
        return dict[key] ?? en[key] ?? zh[key] ?? key
      }

      ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        priority: 'extension',
        multiple: false,
        // Remounting on every open re-reads the Host state instead of showing a
        // stale snapshot left over from an earlier visit.
        keepMounted: false,
        title: () => t('tab.title'),
        guide: [
          {
            id: TAB_ID,
            order: 60,
            title: () => t('guide.title'),
            description: () => t('guide.description'),
          },
        ],
      })

      const Panel = (props) => h(pureChatPanel, { ...props, uiWorkspace: ctx.uiWorkspace, t })
      const PanelTitle = (props) => h(pureChatTitle, { ...props, t })
      const Dock = (props) => h(composerDock, { ...props, sidebarRight: ctx.sidebarRight, t })

      ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: TAB_ID,
        locale: NS,
      }, Panel))

      ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: TAB_ID,
        locale: NS,
      }, PanelTitle))

      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: TAB_ID,
        order: 20,
        locale: NS,
      }, Dock))
    }

    return { inject, apply }
  },
})
