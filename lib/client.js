/**
 * dsh-subagent-profile — browser half: a read-only `dispatch` tool-call card
 * plus a settings page that manages the profile registry.
 *
 * Hand-written `__ModuleLoader__` factory (no build step), modeled on
 * @dsh-external/dsh-persona-ref: React comes from the shared module host, every
 * data operation goes through the loopback /subagent-profiles/* HTTP routes
 * served by the host half (index.mjs), and slots register through the shared
 * `slots` service. The card lives on the keyed `tool.call.toolview` seat (key
 * `dispatch`); the settings page lives on the `settings.section` list.
 *
 * The settings page visual language follows the shipped "模型" settings section
 * (dsh-client-ui-settings-models): same design tokens, a title + intro, one
 * bordered card per row with a layered name / description / meta layout, and a
 * dashed "+ 新增" button that expands an inline form card instead of a
 * permanently-visible input row. Dropdown options (preset / provider / model /
 * reasoning effort) are served by the host `/options` route from the live
 * presets roster and llm directory.
 */
window.__ModuleLoader__.load({
  id: 'dsh-subagent-profile',
  factory: (require) => {
    const React = require('react')
    const { useEffect, useState, useCallback } = React
    const el = React.createElement

    /** Required cordis services: the slot registry only. */
    const inject = ['slots']

    // ── api (loopback HTTP, host half serves /subagent-profiles/*) ──────────

    async function api(path, payload) {
      const init = payload === undefined
        ? undefined
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
      const res = await fetch(`/subagent-profiles${path}`, init)
      let data
      try {
        data = await res.json()
      } catch {
        throw new Error(`宿主返回了非 JSON 响应（HTTP ${res.status}）`)
      }
      if (!data.ok) throw new Error(data.error || '请求失败')
      return data
    }

    // ── styles (tokens mirror the shipped "模型" settings section) ──────────

    const CSS = [
      '.sap-section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}',
      '.sap-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}',
      '.sap-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}',
      '.sap-notice{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}',
      '.sap-savedNotice{color:var(--dsw-alias-state-success-primary);margin:0;font-size:12px;line-height:18px}',
      '.sap-rows{flex-direction:column;gap:8px;margin:12px 0 0;padding:0;list-style:none;display:flex}',
      '.sap-rowCard{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;gap:10px;padding:12px 14px;display:flex}',
      '.sap-rowHead{align-items:center;gap:10px;display:flex}',
      '.sap-rowIdentity{align-items:center;gap:6px;min-width:0;display:inline-flex}',
      '.sap-rowName{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}',
      '.sap-rowId{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;font-family:monospace}',
      '.sap-rowTag{border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:4px;flex:none;padding:1px 6px;font-size:11px;line-height:16px}',
      '.sap-rowActions{align-items:center;gap:4px;margin-left:auto;display:inline-flex}',
      '.sap-desc{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:18px}',
      '.sap-warn{color:var(--dsw-alias-state-warn-label);margin:0;font-size:12px;line-height:18px}',
      '.sap-chips{flex-wrap:wrap;gap:6px;display:flex}',
      '.sap-chip{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;flex:none;align-items:center;gap:5px;padding:2px 8px;font-size:12px;line-height:18px;display:inline-flex}',
      '.sap-chipLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      '.sap-chipValue{color:var(--dsw-alias-label-primary)}',
      '.sap-chipValueDim{color:var(--dsw-alias-label-tertiary)}',
      '.sap-chipWarn{background:var(--dsw-alias-state-warn-tertiary);border-color:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);font-weight:500}',
      '.sap-chipSuccess{color:var(--dsw-alias-state-success-primary);font-weight:500}',
      '.sap-chipDisabled{color:var(--dsw-alias-state-warn-label);font-weight:500}',
      '.sap-metaValueDefault{color:var(--dsw-alias-label-tertiary)}',
      '.sap-addBlock{margin-top:4px}',
      '.sap-addActions{flex-wrap:wrap;gap:10px;display:flex}',
      '.sap-addButton{box-sizing:border-box;border:1px dashed var(--dsw-alias-border-l3);border-radius:12px;flex:1 1 0;gap:6px;min-width:180px;height:44px;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;background:0 0;cursor:pointer;justify-content:center;align-items:center;display:inline-flex}',
      '.sap-addButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.sap-addCard{background:var(--dsw-alias-bg-module-platform);border-radius:12px;flex-direction:column;gap:14px;padding:14px 16px;display:flex}',
      '.sap-editorHeader{align-items:baseline;gap:8px;display:flex}',
      '.sap-editorTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}',
      '.sap-field{flex-direction:column;gap:6px;display:flex}',
      '.sap-fieldLabel{color:var(--dsw-alias-label-secondary);align-items:center;gap:10px;font-size:12px;font-weight:500;line-height:18px;display:inline-flex}',
      '.sap-input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);width:100%;height:32px;font:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font-size:14px;line-height:22px}',
      '.sap-input:focus{border-color:var(--dsw-alias-brand-primary);outline:none}',
      '.sap-input::placeholder{color:var(--dsw-alias-label-dimmed)}',
      '.sap-select{appearance:auto}',
      '.sap-customized{border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px}',
      '.sap-customizedSummary{cursor:pointer;width:fit-content;color:var(--dsw-alias-label-secondary);border-radius:6px;align-items:center;gap:6px;margin-left:-4px;padding:2px 4px;font-size:12px;font-weight:500;line-height:18px;list-style:none;display:flex}',
      '.sap-customizedSummary::-webkit-details-marker{display:none}',
      '.sap-customizedSummary:before{content:"";border-bottom:1.5px solid;border-right:1.5px solid;width:5px;height:5px;transition:transform .12s;transform:rotate(-45deg)translate(-1px,-1px)}',
      '.sap-customized[open]>.sap-customizedSummary:before{transform:rotate(45deg)translate(-1px,-1px)}',
      '.sap-customizedSummary:hover{color:var(--dsw-alias-label-primary)}',
      '.sap-customizedBody{flex-direction:column;gap:12px;padding-top:12px;display:flex}',
      '.sap-editorActions{justify-content:flex-end;gap:8px;display:flex}',
      '.sap-primaryButton,.sap-secondaryButton{box-sizing:border-box;height:36px;font:inherit;cursor:pointer;border:none;border-radius:18px;justify-content:center;align-items:center;gap:4px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}',
      '.sap-primaryButton{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.sap-primaryButton:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
      '.sap-secondaryButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:0 0}',
      '.sap-secondaryButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.sap-dangerButton{box-sizing:border-box;height:28px;color:var(--dsw-alias-state-error-primary);font:inherit;cursor:pointer;background:0 0;border:none;border-radius:14px;justify-content:center;align-items:center;padding:0 10px;font-size:12px;line-height:18px;display:inline-flex}',
      '.sap-dangerButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}',
      '.sap-primaryButton:disabled,.sap-secondaryButton:disabled,.sap-dangerButton:disabled,.sap-addButton:disabled{opacity:.4;cursor:default}',
      '.sap-titleRow{display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.sap-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);user-select:none}',
      '.sap-switch input{appearance:none;width:36px;height:20px;border-radius:10px;background:var(--dsw-alias-border-l2);position:relative;cursor:pointer;margin:0;transition:background .2s;flex:none}',
      '.sap-switch input::before{content:"";position:absolute;width:16px;height:16px;border-radius:50%;background:#fff;top:2px;left:2px;transition:left .2s;box-shadow:0 1px 2px rgba(0,0,0,.2)}',
      '.sap-switch input:checked{background:var(--dsw-alias-brand-primary)}',
      '.sap-switch input:checked::before{left:18px}',
      '.sap-toolview{flex-direction:column;align-items:flex-start;gap:6px;padding:4px 8px;display:flex}',
      '.sap-toolText{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}',
      '.sap-toolModes{flex-wrap:wrap;gap:4px 16px;display:flex}',
      '.sap-toolGroups{flex-direction:column;gap:8px;display:flex}',
      '.sap-toolLayerCard{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px}',
      '.sap-toolLayerBody{flex-direction:column;gap:6px;padding-top:6px;display:flex}',
      '.sap-toolGroup{flex-direction:column;gap:4px;display:flex}',
      '.sap-toolGroupTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:4px}',
      '.sap-toolActions{flex-wrap:wrap;gap:6px;display:flex}',
      '.sap-toolList{flex-wrap:wrap;gap:2px 16px;display:flex}',
      '.sap-toolItem{align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;line-height:20px;user-select:none;display:inline-flex}',
      '.sap-toolItem input{margin:0;accent-color:var(--dsw-alias-brand-primary)}',
    ].join('\n')

    function ensureStyles() {
      const tagId = 'dsh-subagent-profile/ProfilesSection.css'
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') !== null) return
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-subagent-profile'
      style.dataset.pluginCss = tagId
      style.textContent = CSS
      document.head.appendChild(style)
    }

    // ── dispatch tool-call card ─────────────────────────────────────────────

    // 面向用户的固定文案（G1）。注意：此表仅集中 dispatch 卡片文案；设置页文案
    // 仍为 v0.1.0 散落硬编码，属 G1 待迁移债（V2.0 中期一次性迁入）。
    const ZH = {
      inlineProfile: '内联',
      inherit: '继承父',
      effortDefault: '默认（继承父）',
      chipProfile: '方案',
      chipPreset: '预设',
      chipProvider: '提供方',
      chipModel: '模型',
      chipEffort: '推理强度',
      chipTier: '档位',
      chipEnabled: '已启用',
      chipDisabled: '已禁用',
      ignoredMark: '已忽略',
      toolLabel: '派发子 Agent',
      cont: 'continuable 子 Agent',
      canContinue: '可续跑',
      toolBackground: '后台任务',
      toolForeground: '前台',
      toolRunning: '运行中',
      tierZh: { cheap: '省 token（cheap）', balanced: '均衡（balanced）', premium: '高成本（premium）' },
      persistFail: '已保存但未持久化',
      persistFailHint: '（磁盘写入未成功，重启 dsh web 后该改动可能丢失）'
    }

    const effortZh = (id) => {
      if (id === undefined || id === null || id === '') return ZH.inherit
      if (id === '(default)') return ZH.effortDefault
      if (id === '(parent)' || id === 'undefined') return ZH.inherit
      return EFFORT_ZH[id] ? `${EFFORT_ZH[id]}（${id}）` : id
    }
    const presetZh = (v) => (v === 'inherit' ? ZH.inherit : (typeof v === 'string' && v !== '' ? v : ZH.inherit))
    const profileZh = (v) => (v === undefined || v === '' || v === '(inline)' ? ZH.inlineProfile : v)
    const rawOrInherit = (v) => (v === '(parent)' ? ZH.inherit : (typeof v === 'string' && v !== '' ? v : ZH.inherit))

    /** 统一 chip 元素：label + value，dim=继承/默认值弱显。 */
    const chip = (key, label, value, opts) => {
      const valueCls = opts && opts.dim ? 'sap-chipValueDim' : 'sap-chipValue'
      return el('span', {
        key,
        className: 'sap-chip',
        ...(opts && typeof opts.title === 'string' && opts.title !== '' ? { title: opts.title } : {})
      },
        el('span', { className: 'sap-chipLabel' }, label),
        el('span', { className: valueCls }, value)
      )
    }

    // 请求值：argsRaw（运行中 / 已结算两种 block 形态都有）。
    function readDispatchRequest(block) {
      const out = { profile: '', preset: '', provider: '', model: '', reasoningEffort: '', continuable: false, runInBackground: false }
      if (!block || typeof block !== 'object') return out
      const done = 'kind' in block
      const argsRaw = (done ? (block.call && block.call.argsRaw) : block.argsRaw) ?? ''
      if (typeof argsRaw !== 'string' || argsRaw === '') return out
      try {
        const parsed = JSON.parse(argsRaw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const key of ['profile', 'preset', 'provider', 'model', 'reasoningEffort']) {
            if (typeof parsed[key] === 'string' && parsed[key] !== '') out[key] = parsed[key]
          }
          out.continuable = parsed.continuable === true
          out.runInBackground = parsed.run_in_background === true
        }
      } catch {
        // unparsable argsRaw：保持默认（继承/内联口径）。
      }
      return out
    }

    // 结果 meta（生效值）：宿主 render 行（"[dispatch] …"）是持久回放的唯一
    // 生效值来源——结构化 value 只存在于执行局部（dsh-tools 约定），且宿主未
    // 定义 output.presentationMeta（block.meta 为空）。解析成功返回
    // {kind, id, fields, ignored}；任何一步不符预期返回 null，调用方回退请求值。
    const DISPATCH_RESULT_KEYS = ['profile', 'preset', 'provider', 'model', 'reasoningEffort', 'tokenTier']
    function parseDispatchText(text) {
      if (typeof text !== 'string') return null
      const firstLine = text.split('\n')[0] ?? ''
      if (!firstLine.startsWith('[dispatch] ')) return null
      let rest = firstLine.slice('[dispatch] '.length)
      let kind = 'foreground'
      let id = ''
      if (rest.startsWith('background job ')) {
        kind = 'background'
        rest = rest.slice('background job '.length)
      } else if (rest.startsWith('started subagent ')) {
        kind = 'continuable'
        rest = rest.slice('started subagent '.length)
      }
      if (kind !== 'foreground') {
        const sep = rest.indexOf(' · ')
        id = sep >= 0 ? rest.slice(0, sep) : rest
        rest = sep >= 0 ? rest.slice(sep + 3) : ''
      }
      const fields = {}
      let ignored = []
      let known = 0
      for (const seg of rest.split(' · ')) {
        const eq = seg.indexOf('=')
        if (eq <= 0) continue
        const key = seg.slice(0, eq)
        if (!DISPATCH_RESULT_KEYS.includes(key)) continue
        let value = seg.slice(eq + 1)
        const m = /^(.+)\(ignored:\s*([^)]*)\)$/.exec(value)
        if (m !== null) {
          value = m[1]
          ignored = m[2].split(',').map((s) => s.trim()).filter((s) => s !== '')
        }
        if (value === 'undefined') value = ''   // v0.1.0 渲染该字段为字面 undefined
        fields[key] = value
        known += 1
      }
      if (known <= 0) return null
      return { kind, id, fields, ignored }
    }

    function readDispatchResult(block) {
      if (!block || typeof block !== 'object' || !('kind' in block)) return null
      const content = block.content
      if (!Array.isArray(content)) return null
      for (const item of content) {
        if (item && typeof item === 'object' && typeof item.text === 'string') {
          const parsed = parseDispatchText(item.text)
          if (parsed !== null) return parsed
        }
      }
      return null
    }

    function DispatchToolview(props) {
      const block = props && props.block
      const request = readDispatchRequest(block)
      const result = readDispatchResult(block)
      const settled = !!(block && typeof block === 'object' && 'kind' in block)
      // 生效值：结果解析成功用结果（优先），字段缺失回退请求值。
      const eff = {
        profile: result ? (result.fields.profile || request.profile) : request.profile,
        preset: result ? (result.fields.preset || request.preset) : request.preset,
        provider: result ? (result.fields.provider || request.provider) : request.provider,
        model: result ? (result.fields.model || request.model) : request.model,
        reasoningEffort: result ? (result.fields.reasoningEffort || request.reasoningEffort) : request.reasoningEffort
      }
      // ignored 列表：已结算读结果；运行中（无结果）按已知降级规则预判——
      // continuable 恒忽略 preset 换用与 reasoningEffort（与结果同口径）。
      const ignored = result ? result.ignored.slice() : []
      if (!settled && request.continuable) {
        if (request.preset !== '' && request.preset !== 'inherit' && !ignored.includes('preset')) ignored.push('preset')
        if (request.reasoningEffort !== '' && !ignored.includes('reasoningEffort')) ignored.push('reasoningEffort')
      }
      // P2（请求≠生效）：被忽略字段的生效值 = 确定性降级值。
      if (ignored.includes('preset')) eff.preset = 'inherit'
      if (ignored.includes('reasoningEffort')) eff.reasoningEffort = '(default)'

      let kindLabel
      const kindPrefix = request.continuable ? ZH.cont : (request.runInBackground ? ZH.toolBackground : ZH.toolForeground)
      // 运行/结算标签判据 = settled（`'kind' in block`）：已结算块即使 render 为
      // 旧格式不可解析（result===null）也绝不落入「运行中」分支。
      if (settled) {
        if (result) {
          if (result.kind === 'background') kindLabel = `${ZH.toolBackground} #${result.id}`
          else if (result.kind === 'continuable') kindLabel = `${ZH.cont} #${result.id}（${ZH.canContinue}）`
          else kindLabel = ZH.toolForeground
        } else {
          // 已结算但结果不可解析：kind 由请求值推导，不带「运行中」。
          kindLabel = kindPrefix
        }
      } else {
        kindLabel = `${kindPrefix}（${ZH.toolRunning}）`
      }

      const chips = []
      chips.push(chip('profile', ZH.chipProfile, profileZh(eff.profile)))
      // preset 继承值（'inherit' 或未请求即空串，均渲染为「继承父」）与
      // provider·model / effort 一样弱显。
      chips.push(chip('preset', ZH.chipPreset, presetZh(eff.preset), { dim: eff.preset === 'inherit' || eff.preset === '' }))
      const p = rawOrInherit(eff.provider)
      const m = rawOrInherit(eff.model)
      chips.push(chip('providerModel', `${ZH.chipProvider}·${ZH.chipModel}`, p === ZH.inherit && m === ZH.inherit ? ZH.inherit : `${p} / ${m}`, { dim: p === ZH.inherit && m === ZH.inherit }))
      chips.push(chip('effort', ZH.chipEffort, effortZh(eff.reasoningEffort), { dim: eff.reasoningEffort === '' || eff.reasoningEffort === '(default)' }))
      // tokenTier：宿主当前结果里未产出（§8.3 属中期切片）；字段出现即渲染（向前兼容）。
      let tier = ''
      if (result && result.fields && typeof result.fields.tokenTier === 'string' && result.fields.tokenTier !== '') {
        tier = result.fields.tokenTier
      } else if (block && block.meta && typeof block.meta === 'object' && typeof block.meta.tokenTier === 'string' && block.meta.tokenTier !== '') {
        tier = block.meta.tokenTier
      }
      if (tier !== '') chips.push(chip('tier', ZH.chipTier, ZH.tierZh[tier] || tier))
      // ignored 项：警示色、置于 chip 行末尾（BP-03 根治：非静默）。
      for (const key of ignored) {
        const reqVal = request[key] || ''
        chips.push(el('span', {
          key: `ignored-${key}`,
          className: 'sap-chip sap-chipWarn',
          title: reqVal !== '' ? `请求值 "${reqVal}" 已忽略` : '请求值已忽略'
        }, `⬆${key}(${ZH.ignoredMark})`))
      }

      const text = `${ZH.toolLabel}：${kindLabel} · 方案=${profileZh(eff.profile)} · 预设=${presetZh(eff.preset)} · 提供方=${p} · 模型=${m} · 推理强度=${effortZh(eff.reasoningEffort)}`
      return el('div', { className: 'sap-toolview' },
        el('div', { className: 'sap-chips' }, chips),
        el('div', { className: 'sap-toolText' }, text)
      )
    }

    // ── settings page ───────────────────────────────────────────────────────

    const EMPTY_FORM = { id: '', description: '', preset: '', provider: '', model: '', reasoningEffort: '', toolMode: 'none', toolList: [] }
    const EFFORT_ZH = { off: '关闭', high: '高', max: '最大' }
    const effortLabel = (effort) => {
      const id = effort && effort.id
      return EFFORT_ZH[id] ? `${EFFORT_ZH[id]}（${id}）` : (effort && effort.name) || id
    }

    function ProfilesSection() {
      const [profiles, setProfiles] = useState([])
      const [options, setOptions] = useState({ models: [], efforts: {}, presets: [] })
      const [enabled, setEnabled] = useState(true)
      const [adding, setAdding] = useState(false)
      const [editingId, setEditingId] = useState(null)
      const [error, setError] = useState('')
      const [savedNotice, setSavedNotice] = useState('')
      const [persistWarning, setPersistWarning] = useState('')
      const [form, setForm] = useState(EMPTY_FORM)
      const [tools, setTools] = useState([])

      const refresh = useCallback(() => {
        api('/list')
          .then((data) => setProfiles(Array.isArray(data.profiles) ? data.profiles : []))
          .catch((err) => setError(String((err && err.message) || err)))
      }, [])

      const loadOptions = useCallback(() => {
        api('/options')
          .then((data) => {
            setEnabled(data.enabled !== false)
            setOptions({
              models: Array.isArray(data.models) ? data.models : [],
              efforts: data.efforts && typeof data.efforts === 'object' ? data.efforts : {},
              presets: Array.isArray(data.presets) ? data.presets : []
            })
            setTools(Array.isArray(data.tools) ? data.tools : [])
          })
          .catch(() => {})
      }, [])

      useEffect(() => {
        refresh()
        loadOptions()
      }, [refresh, loadOptions])

      const toggleEnabled = () => {
        const next = !enabled
        setEnabled(next)
        setError('')
        api('/set-enabled', { enabled: next })
          .catch((err) => {
            setEnabled(!next)
            setError(String((err && err.message) || err))
          })
      }

      const setField = (key) => (event) => {
        const value = event && event.target ? event.target.value : ''
        setForm((prev) => {
          const next = { ...prev, [key]: value }
          if (key === 'model') next.reasoningEffort = '' // 换模型时重置推理强度
          return next
        })
      }

      const setToolMode = (mode) => () => setForm((prev) => ({ ...prev, toolMode: mode }))
      const toggleTool = (name) => () => {
        setForm((prev) => {
          const cur = Array.isArray(prev.toolList) ? prev.toolList : []
          const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]
          return { ...prev, toolList: next }
        })
      }
      const selectLayer = (layer) => () => setForm((prev) => {
        const layerNames = tools.filter((t) => t.layer === layer).map((t) => t.name)
        return { ...prev, toolList: [...new Set([...(Array.isArray(prev.toolList) ? prev.toolList : []), ...layerNames])] }
      })
      const clearLayer = (layer) => () => setForm((prev) => {
        const layerSet = new Set(tools.filter((t) => t.layer === layer).map((t) => t.name))
        return { ...prev, toolList: (Array.isArray(prev.toolList) ? prev.toolList : []).filter((n) => !layerSet.has(n)) }
      })
      const invertLayer = (layer) => () => setForm((prev) => {
        const layerNames = tools.filter((t) => t.layer === layer).map((t) => t.name)
        const cur = Array.isArray(prev.toolList) ? prev.toolList : []
        const toAdd = layerNames.filter((n) => !cur.includes(n))
        const toRemove = new Set(layerNames.filter((n) => cur.includes(n)))
        return { ...prev, toolList: [...cur.filter((n) => !toRemove.has(n)), ...toAdd] }
      })

      // D5/B1 写路径契约：HTTP 200 但 persisted:false 时 host 附
      // persistWarning「已保存但未持久化」——这里改为 amber 警示（非绿色成功态）。
      const applyWrite = (data, successNotice) => {
        if (data && data.persisted === false) {
          setSavedNotice('')
          setPersistWarning(typeof data.persistWarning === 'string' && data.persistWarning !== '' ? data.persistWarning : ZH.persistFail)
          return
        }
        setPersistWarning('')
        if (typeof successNotice === 'string' && successNotice !== '') setSavedNotice(successNotice)
        else setSavedNotice('')
      }

      const openAdd = () => {
        setError('')
        setSavedNotice('')
        setPersistWarning('')
        setForm(EMPTY_FORM)
        setEditingId(null)
        setAdding(true)
      }

      const openEdit = (profile) => () => {
        setError(''); setSavedNotice(''); setPersistWarning('')
        const tf = profile.toolFilter && typeof profile.toolFilter === 'object' ? profile.toolFilter : {}
        const allowArr = Array.isArray(tf.allow) ? tf.allow.slice() : []
        const denyArr = Array.isArray(tf.deny) ? tf.deny.slice() : []
        const toolMode = allowArr.length > 0 ? 'allow' : (denyArr.length > 0 ? 'deny' : 'none')
        setForm({
          id: profile.id,
          description: typeof profile.description === 'string' ? profile.description : '',
          preset: typeof profile.preset === 'string' ? profile.preset : '',
          provider: typeof profile.provider === 'string' ? profile.provider : '',
          model: typeof profile.model === 'string' ? profile.model : '',
          reasoningEffort: typeof profile.reasoningEffort === 'string' ? profile.reasoningEffort : '',
          toolMode,
          toolList: toolMode === 'allow' ? allowArr : denyArr
        })
        setEditingId(profile.id)
        setAdding(true)
      }

      const closeAdd = () => {
        setAdding(false)
        setEditingId(null)
        setError('')
        setPersistWarning('')
        setForm(EMPTY_FORM)
      }

      const submit = () => {
        const payload = { id: typeof form.id === 'string' ? form.id.trim() : '' }
        // 字符串字段总是发送（含空串）：后端 merge 语义里空串 = 清除该字段，
        // 否则把字段清回“继承父/默认”会被静默忽略（保留旧值）。
        const add = (key, value) => { if (typeof value === 'string') payload[key] = value.trim() }
        add('description', form.description)
        add('preset', form.preset)
        add('provider', form.provider)
        add('model', form.model)
        add('reasoningEffort', form.reasoningEffort)
        const list = Array.isArray(form.toolList) ? form.toolList : []
        if (form.toolMode === 'allow' && list.length > 0) payload.toolFilter = { allow: list }
        else if (form.toolMode === 'deny' && list.length > 0) payload.toolFilter = { deny: list }
        else payload.toolFilter = {}   // 不限制：空对象 = 清除（后端会 delete）
        if (typeof payload.id !== 'string' || payload.id === '') { setError('profile id 不能为空'); return }
        // 编辑：保留原 name 和 enabled 状态
        const existing = profiles.find((p) => p.id === form.id)
        if (existing) {
          if (typeof existing.name === 'string' && existing.name !== '') payload.name = existing.name
          if (existing.enabled === false) payload.enabled = false
        }
        api('/add', payload)
          .then((data) => {
            setForm(EMPTY_FORM); setAdding(false); setEditingId(null); setError('')
            applyWrite(data, `已保存 ${payload.id}`)
            refresh()
          })
          .catch((err) => setError(String((err && err.message) || err)))
      }

      const setProfileEnabled = (profile, next) => () => {
        setError('')
        api('/set-profile-enabled', { id: profile.id, enabled: next })
          .then((data) => { applyWrite(data, ''); refresh() })
          .catch((err) => setError(String((err && err.message) || err)))
      }

      const resetAll = () => {
        if (!window.confirm('将所有内置方案重置为默认配置？已删除的内置也会恢复。')) return
        setError('')
        api('/reset-all')
          .then((data) => { applyWrite(data, '已重置所有内置方案'); refresh() })
          .catch((err) => setError(String((err && err.message) || err)))
      }

      const remove = (profile) => () => {
        if (!window.confirm(`删除方案「${profile.name || profile.id}」？${profile.builtin === true ? '内置方案删除后可在上方「重置内置方案」恢复' : ''}`)) return
        api('/remove', { id: profile.id })
          .then((data) => {
            setError('')
            applyWrite(data, `已删除 ${profile.id}`)
            refresh()
          })
          .catch((err) => setError(String((err && err.message) || err)))
      }

      // Distinct providers, derived from the model list.
      const providers = []
      const seenProvider = new Set()
      for (const model of options.models) {
        if (seenProvider.has(model.provider)) continue
        seenProvider.add(model.provider)
        providers.push({ id: model.provider, name: model.providerName || model.provider })
      }

      const effortsForModel = form.model ? (options.efforts[form.model] ?? []) : []

      const rows = profiles.map((profile) => {
        const builtin = profile.builtin === true
        const isDisabled = profile.enabled === false
        const hasName = typeof profile.name === 'string' && profile.name !== '' && profile.name !== String(profile.id)
        const hasPreset = typeof profile.preset === 'string' && profile.preset !== ''
        const hasModel = typeof profile.model === 'string' && profile.model !== ''
        const hasEffort = typeof profile.reasoningEffort === 'string' && profile.reasoningEffort !== ''
        const chipItems = [
          chip('preset', ZH.chipPreset, presetZh(profile.preset), { dim: !hasPreset }),
          chip('model', ZH.chipModel, rawOrInherit(profile.model), { dim: !hasModel }),
          chip('effort', ZH.chipEffort, effortZh(profile.reasoningEffort), { dim: !hasEffort }),
          isDisabled
            ? el('span', { key: 'state', className: 'sap-chip sap-chipDisabled' }, ZH.chipDisabled)
            : el('span', { key: 'state', className: 'sap-chip sap-chipSuccess' }, ZH.chipEnabled)
        ]
        return el('li', { key: String(profile.id), className: 'sap-rowCard' },
          el('div', { className: 'sap-rowHead' },
            el('span', { className: 'sap-rowIdentity' },
              el('span', { className: 'sap-rowName' }, hasName ? profile.name : String(profile.id)),
              hasName ? el('span', { className: 'sap-rowId' }, String(profile.id)) : null,
              builtin ? el('span', { className: 'sap-rowTag' }, '内置') : null
            ),
            el('span', { className: 'sap-rowActions' },
              el('label', { className: 'sap-switch', title: '启用/禁用' },
                el('input', { type: 'checkbox', checked: !isDisabled, onChange: setProfileEnabled(profile, isDisabled) }),
                el('span', null, isDisabled ? '已禁用' : '已启用')
              ),
              el('button', { className: 'sap-secondaryButton', style: { height: '28px', padding: '0 10px', fontSize: '12px', borderRadius: '14px' }, onClick: openEdit(profile) }, '编辑'),
              el('button', { className: 'sap-dangerButton', onClick: remove(profile) }, '删除')
            )
          ),
          el('div', { className: 'sap-chips' }, chipItems),
          typeof profile.description === 'string' && profile.description !== ''
            ? el('p', { className: 'sap-desc' }, profile.description)
            : null
        )
      })

      const selectField = (label, key, optionsList, renderOption) => el('div', { className: 'sap-field' },
        el('span', { className: 'sap-fieldLabel' }, label),
        el('select', { className: 'sap-input sap-select', value: form[key], onChange: setField(key) },
          el('option', { value: '' }, '继承父（不指定）'),
          optionsList.map(renderOption)
        )
      )

      const renderEffortOption = (effort) => el('option', { key: effort.id, value: effort.id }, effortLabel(effort))

      const smallBtn = { height: '24px', padding: '0 8px', fontSize: '12px', borderRadius: '12px' }
      const TOOL_MODES = [
        ['none', '不限制（继承父的全部工具，自动剔除 run_code）'],
        ['allow', '白名单（只允许勾选的工具）'],
        ['deny', '黑名单（排除勾选的工具）'],
      ]
      const CORE_ORDER = ['文件', '终端', '网络', '任务', '子 Agent', '工作流', '交互', '图片', 'Cordis', '计划']
      const LAYER_TITLES = { core: '核心预设', plugin: '第三方插件', custom: '自建预设' }
      const buildLayerGroups = (layer) => {
        const layerTools = tools.filter((t) => t.layer === layer)
        const groups = new Map()
        for (const t of layerTools) {
          const g = typeof t.group === 'string' && t.group !== '' ? t.group : '其他'
          if (!groups.has(g)) groups.set(g, [])
          groups.get(g).push(t)
        }
        const keys = layer === 'core'
          ? [...CORE_ORDER.filter((c) => groups.has(c)), ...new Set([...groups.keys()].filter((k) => !CORE_ORDER.includes(k)))]
          : [...groups.keys()]
        return keys.map((k) => [k, groups.get(k)])
      }
      const renderTool = (t) => {
        const checked = Array.isArray(form.toolList) && form.toolList.includes(t.name)
        return el('label', { key: t.name, className: 'sap-toolItem' },
          el('input', { type: 'checkbox', checked, onChange: toggleTool(t.name) }),
          el('span', null, t.zh ? `${t.zh} ${t.name}` : t.name)
        )
      }
      const toolSection = el('div', { className: 'sap-field' },
        el('span', { className: 'sap-fieldLabel' }, '工具限制'),
        el('div', { className: 'sap-toolModes' },
          TOOL_MODES.map(([mode, label]) => el('label', { key: mode, className: 'sap-toolItem' },
            el('input', { type: 'radio', name: 'sap-toolMode', checked: form.toolMode === mode, onChange: setToolMode(mode) }),
            el('span', null, label)
          ))
        ),
        form.toolMode === 'none'
          ? null
          : (tools.length === 0
              ? el('span', { className: 'sap-metaValueDefault' }, '（无可用工具列表）')
              : el('div', { className: 'sap-toolGroups' },
                  ['core', 'plugin', 'custom']
                    .filter((layer) => tools.some((t) => t.layer === layer))
                    .map((layer) => {
                      const groups = buildLayerGroups(layer)
                      const layerTools = tools.filter((t) => t.layer === layer)
                      const count = layerTools.length
                      const selectedCount = layerTools.filter((t) => Array.isArray(form.toolList) && form.toolList.includes(t.name)).length
                      const summaryText = selectedCount > 0
                        ? `${LAYER_TITLES[layer]}（${count}）· 已选 ${selectedCount}`
                        : `${LAYER_TITLES[layer]}（${count}）`
                      return el('details', { key: layer, className: 'sap-toolLayerCard' },
                        el('summary', { className: 'sap-customizedSummary' }, summaryText),
                        el('div', { className: 'sap-toolLayerBody' },
                          el('div', { className: 'sap-toolActions', style: { marginTop: '2px' } },
                            el('button', { type: 'button', className: 'sap-secondaryButton', style: smallBtn, onClick: selectLayer(layer) }, '全选'),
                            el('button', { type: 'button', className: 'sap-secondaryButton', style: smallBtn, onClick: clearLayer(layer) }, '清空'),
                            el('button', { type: 'button', className: 'sap-secondaryButton', style: smallBtn, onClick: invertLayer(layer) }, '反选')
                          ),
                          groups.map(([g, list]) => el('div', { key: g, className: 'sap-toolGroup' },
                            el('div', { className: 'sap-toolGroupTitle' }, `${g}（${list.length}）`),
                            el('div', { className: 'sap-toolList' }, list.map(renderTool))
                          ))
                        )
                      )
                    })
                )
            )
      )

      return el('div', { className: 'sap-section' },
        el('div', { className: 'sap-titleRow' },
          el('h2', { className: 'sap-title' }, '子 Agent 方案'),
          el('label', { className: 'sap-switch' },
            el('input', { type: 'checkbox', checked: enabled, onChange: toggleEnabled }),
            el('span', null, enabled ? '已启用' : '已禁用')
          )
        ),
        el('p', { className: 'sap-intro' }, '在此管理「派发子 Agent」工具可用的 profile。内置方案可编辑、可删除、可点下方按钮批量重置回默认；每个方案可单独启用/禁用。'),
        el('div', { className: 'sap-addActions', style: { margin: '4px 0' } },
          el('button', { type: 'button', className: 'sap-secondaryButton', style: { height: '28px', padding: '0 12px', fontSize: '12px', borderRadius: '14px' }, onClick: resetAll }, '重置所有内置方案')
        ),
        !enabled ? el('p', { className: 'sap-notice' }, '插件已禁用：「派发子 Agent」工具已从模型工具列表中移除，打开开关即可恢复。') : null,
        error !== '' ? el('p', { className: 'sap-notice' }, error) : null,
        savedNotice !== '' ? el('p', { className: 'sap-savedNotice', role: 'status' }, savedNotice) : null,
        persistWarning !== '' ? el('p', { className: 'sap-warn', role: 'alert' }, `${persistWarning}${ZH.persistFailHint}`) : null,
        el('ul', { className: 'sap-rows' }, rows),
        el('div', { className: 'sap-addBlock' },
          adding
            ? el('div', { className: 'sap-addCard' },
                el('div', { className: 'sap-editorHeader' },
                  el('span', { className: 'sap-editorTitle' }, editingId !== null ? '编辑 profile' : '新增 profile')
                ),
                el('div', { className: 'sap-field' },
                  el('span', { className: 'sap-fieldLabel' }, 'profile id（唯一标识，必填）'),
                  el('input', { className: 'sap-input', value: form.id, placeholder: '小写字母/数字/连字符，如 my-focus', disabled: editingId !== null, onChange: setField('id') })
                ),
                el('div', { className: 'sap-field' },
                  el('span', { className: 'sap-fieldLabel' }, '描述（一句话定位）'),
                  el('input', { className: 'sap-input', value: form.description, placeholder: '说明这个 profile 适合什么场景，帮助模型选择', onChange: setField('description') })
                ),
                selectField('模型（子 agent 使用的模型）', 'model', options.models,
                  (m) => el('option', { key: m.id, value: m.id }, m.name && m.name !== m.id ? `${m.name}（${m.providerName || m.provider}）` : m.id)),
                el('details', { className: 'sap-customized' },
                  el('summary', { className: 'sap-customizedSummary' }, '高级选项'),
                  el('div', { className: 'sap-customizedBody' },
                    selectField('目标预设（切换子 agent 使用的 Agent 预设）', 'preset', options.presets,
                      (p) => el('option', { key: p.id, value: p.id }, p.name && p.name !== p.id ? `${p.name}（${p.id}）` : p.id)),
                    selectField('提供方（模型服务商）', 'provider', providers,
                      (p) => el('option', { key: p.id, value: p.id }, p.name && p.name !== p.id ? `${p.name}（${p.id}）` : p.id)),
                    form.model === ''
                      ? el('div', { className: 'sap-field' },
                          el('span', { className: 'sap-fieldLabel' }, '推理强度（思考深度）'),
                          el('select', { className: 'sap-input sap-select', value: '', disabled: true },
                            el('option', { value: '' }, '先选择模型')
                          )
                        )
                      : selectField('推理强度（思考深度）', 'reasoningEffort', effortsForModel, renderEffortOption),
                    toolSection
                  )
                ),
                el('div', { className: 'sap-editorActions' },
                  el('button', { className: 'sap-secondaryButton', onClick: closeAdd }, '取消'),
                  el('button', { className: 'sap-primaryButton', onClick: submit }, '保存')
                )
              )
            : el('div', { className: 'sap-addActions' },
                el('button', { className: 'sap-addButton', onClick: openAdd }, '+ 新增 profile')
              )
        )
      )
    }

    // ── plugin ──────────────────────────────────────────────────────────────

    function apply(ctx) {
      ensureStyles()
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'dispatch'
      }, DispatchToolview))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'subagent-profiles',
        order: 100,
        label: '子 Agent 方案'
      }, ProfilesSection))
    }

    return { apply, inject }
  },
})
