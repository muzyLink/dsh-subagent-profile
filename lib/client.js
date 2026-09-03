/**
 * dsh-subagent-profile — 浏览器侧：只读 `dispatch` 工具调用卡片 +
 * 管理方案注册表的设置页。
 *
 * 手写 `__ModuleLoader__` 工厂（无构建步骤），参照 @dsh-external/dsh-persona-ref：
 * React 来自共享模块宿主，所有数据操作走宿主侧（index.mjs）提供的 loopback
 * `/subagent-profiles/*` HTTP 路由，slot 经共享 `slots` 服务注册。卡片挂在
 * keyed `tool.call.toolview` 座（key `dispatch`）；设置页挂在 `settings.section` 列表。
 *
 * 设置页视觉语言对齐官方「模型」设置节（dsh-client-ui-settings-models）：同一套
 * 设计 token，标题 + 引言，每行一张带边框卡片（名称/描述/元信息分层布局），
 * 虚线「+ 新增」按钮展开就地表单卡片。下拉选项（preset / provider / model /
 * reasoning effort）由宿主 `/options/summary`（模型 + 预设，设置页打开时）、
 * `/options/efforts`（按模型，选择模型后懒加载）与 `/options/tools`（工具目录，
 * 限制面板打开时懒加载）路由提供，数据来自实时 presets roster 与 llm 目录。
 *
 * 结构：纯数据（CSS/ZH 文案表）与纯函数（api/解析/文案映射等）驻留模块作用域
 * （load 调用之前的顶层声明）；依赖 React 的组件经参数注入的 maker 函数装配
 * （makeChip / makeDispatchToolview / makeProfilesSection），factory 只做组装。
 */

// ── 纯数据：样式（tokens 对齐 shipped「模型」设置节）────────────────────────

const CSS = [
  '.sap-section{width:100%;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}',
  '.sap-zoneStack{flex-direction:column;gap:12px;display:flex}',
  '.sap-statusBar{position:sticky;top:0;z-index:1;background:transparent;border:0;border-bottom:1px solid var(--dsw-alias-border-l2);flex-wrap:wrap;gap:4px 14px;padding:4px 0 8px;display:flex;font-size:12px;line-height:18px}',
  '.sap-statusDim{color:var(--dsw-alias-label-tertiary)}',
  '.sap-rowHighlight{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}',
  '.sap-subagentBanner{flex:none;display:flex;align-items:flex-end;padding:0 2px;max-width:42%;min-width:0}',
  '.sap-subagentBannerTag{box-sizing:border-box;max-width:260px;border:1px dashed var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:2px 8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:help;display:inline-block}',
  '.sap-dispatchPhase{flex-wrap:wrap;gap:2px 6px;display:flex;font-size:11px;line-height:16px}',
  '.sap-phaseStep{color:var(--dsw-alias-label-tertiary)}',
  '.sap-phaseStep-done{color:var(--dsw-alias-state-success-primary);font-weight:500}',
  '.sap-phaseStep-fail{color:var(--dsw-alias-state-error-primary);font-weight:500}',
  '.sap-phaseStep-running{color:var(--dsw-alias-state-warn-label);font-weight:500}',
  '.sap-reminderP0{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-secondary);font-weight:600}',
  '.sap-reminderP1{color:var(--dsw-alias-state-warn-label);font-weight:600}',
  '.sap-reminderUnread{border-color:var(--dsw-alias-label-primary)}',
  '.sap-reminderHead{display:flex;align-items:center;gap:6px;min-width:0}',
  '.sap-reminderTitle{font-size:14px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}',
  '.sap-reminderMeta{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;font-family:monospace;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.sap-reminderActions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;margin-top:6px}',
  '.sap-reminderActions .sap-detailToggle,.sap-reminderActions .sap-dangerButton{border-radius:5px}',
  '.sap-reminderFields{flex-direction:column;gap:4px;display:flex}',
  '.sap-reminderField{display:flex;gap:6px;margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);min-width:0;align-items:baseline}',
  '.sap-reminderFieldLabel{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
  '.sap-reminderFieldValue{min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}',
  '.sap-reminderJump{box-sizing:border-box;width:100%;border:none;background:0 0;font:inherit;text-align:left;cursor:pointer;padding:0;margin:0;display:flex;gap:6px;min-width:0;align-items:baseline;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
  '.sap-reminderJump:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
  '.sap-reminderJump:disabled{opacity:.4;cursor:default}',
  '.sap-reminderJumpText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.sap-overlayBadge{position:fixed;top:12px;right:12px;z-index:9000;pointer-events:auto;flex-direction:column;gap:6px;align-items:flex-end;display:flex}',
  '.sap-overlayBadgeBtn{box-sizing:border-box;border:none;border-radius:14px;background:var(--dsw-alias-state-error-primary);color:#fff;font:inherit;font-size:12px;line-height:18px;height:28px;padding:0 12px;cursor:pointer;font-weight:600}',
  '.sap-overlayPanel{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:10px;flex-direction:column;gap:6px;padding:8px 10px;display:flex;max-width:360px}',
  '.sap-overlayRow{align-items:center;gap:8px;display:flex;font-size:12px;line-height:18px}',
  '.sap-statusBad{color:var(--dsw-alias-state-success-primary)}',
  '.sap-statusBadFail{color:var(--dsw-alias-state-error-primary)}',
  '.sap-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
  '.sap-card + .sap-card{margin-top:16px}',
  '.sap-cardHead{box-sizing:border-box;width:100%;border:0;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;padding:12px 16px;display:flex;align-items:center;gap:8px}',
  '.sap-cardTitleBox{flex:1;min-width:0}',
  '.sap-cardTitle{font-size:14px;font-weight:550;line-height:20px}',
  '.sap-cardDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
  '.sap-cardToggle{cursor:pointer;transition:background .15s ease}',
  '.sap-cardToggle:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.sap-cardChevron{width:14px;height:14px;flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .2s ease}',
  '.sap-cardOpen .sap-cardChevron{transform:rotate(180deg)}',
  '.sap-cardBody{display:none;border-top:1px solid var(--dsw-alias-border-l2);padding:4px 16px 14px}',
  '.sap-cardOpen .sap-cardBody{display:block}',
  '.sap-cardStatic .sap-cardHead{cursor:default}',
  '.sap-cardStatic .sap-cardHead:hover{background:0 0}',
  '.sap-cardStatic .sap-cardBody{display:block}',
  '.sap-costLine{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:18px}',
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
  '.sap-adviceManageCard{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 12px;flex-direction:column;gap:6px;display:flex}',
  '.sap-adviceCardHead{flex-direction:column;align-items:stretch;gap:2px}',
  '.sap-adviceHeadTitleRow{display:flex;align-items:center;gap:8px}',
  '.sap-adviceGlobalLine{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}',
  '.sap-adviceSection{flex-direction:column;display:flex}',
  '.sap-adviceSection + .sap-adviceSection{margin-top:10px}',
  '.sap-adviceSectionTitle{color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-weight:700;margin:0 0 2px}',
  '.sap-adviceSectionBody{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;margin:0}',
  '.sap-candidateHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:16px}',
  '.sap-candidateBody{border-top:1px dashed var(--dsw-alias-border-l2);margin-top:4px;padding-top:8px;padding-left:16px;flex-direction:column;gap:6px;display:flex}',
  '.sap-candidateChanges{flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;display:flex}',
  '.sap-candidateChange{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
  '.sap-adviceDetailBlock{flex-direction:column;gap:4px;display:flex}',
  '.sap-adviceDetailToggle{border:0;background:0 0;padding:0;margin:0;font:inherit;cursor:pointer;color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;font-size:12px;line-height:18px;display:inline-flex;align-self:flex-start}',
  '.sap-adviceDetailToggle:hover{color:var(--dsw-alias-label-primary)}',
  '.sap-adviceDetailArrow{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1;transition:transform .15s}',
  '.sap-adviceDetailToggle[aria-expanded="true"] .sap-adviceDetailArrow{transform:rotate(90deg)}',
  '.sap-adviceDetailTable{width:100%;border-collapse:collapse;font-size:12px;line-height:18px}',
  '.sap-adviceDetailTable th{text-align:left;font-weight:500;color:var(--dsw-alias-label-tertiary);padding:3px 8px 3px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}',
  '.sap-adviceDetailTable td{text-align:left;padding:4px 8px 4px 0;border-bottom:1px dotted var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);vertical-align:top}',
  '.sap-adviceDetailTime{color:var(--dsw-alias-label-primary);font-weight:500;white-space:nowrap}',
  '.sap-adviceDetailSession{color:var(--dsw-alias-label-primary)}',
  '.sap-adviceDetailSessionId{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-left:4px}',
  '.sap-adviceDetailChild{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
  '.sap-warn-x{color:var(--dsw-alias-state-error-primary)}',
  '.sap-candidates{flex-direction:column;gap:6px;margin-top:14px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2);display:flex}',
  '.sap-candidatesTitle{color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-weight:700;margin:0}',
  '.sap-candidatesTitle .sap-candidatesNotApplied{color:var(--dsw-alias-label-tertiary);font-weight:400}',
  '.sap-candidatesCount{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:2px 0 0}',
  '.sap-candidate{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1)}',
  '.sap-candidateSelected{border-color:var(--dsw-alias-label-primary)}',
  '.sap-candidateRow{box-sizing:border-box;width:100%;border:0;background:0 0;padding:8px 10px;margin:0;font:inherit;text-align:left;cursor:pointer;align-items:center;gap:8px;display:flex}',
  '.sap-candidateRadio{box-sizing:border-box;width:14px;height:14px;border:1.5px solid var(--dsw-alias-border-l2);border-radius:7px;flex:none}',
  '.sap-candidateSelected .sap-candidateRadio{border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 3px var(--dsw-alias-bg-layer-1)}',
  '.sap-candidateName{font-weight:600;flex:1;min-width:0;padding-right:8px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;overflow-wrap:anywhere}',
  '.sap-candidateValidity{margin-left:auto;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);border-radius:3px;padding:1px 6px;white-space:nowrap;flex:none}',
  '.sap-candidateArrow{margin-left:6px;color:var(--dsw-alias-label-tertiary);font-size:9px;line-height:1;flex:none;transition:transform .15s}',
  '.sap-candidateOpen .sap-candidateArrow{transform:rotate(90deg)}',
  '.sap-candidateGroup{flex-direction:column;gap:4px;display:flex}',
  '.sap-candidateGroup + .sap-candidateGroup{margin-top:6px}',
  '.sap-candidateGroupTitle{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;font-weight:700;margin:0}',
  '.sap-candidateSafetyList{margin:0 0 0 16px;padding:0;list-style:none;flex-direction:column;gap:2px;display:flex}',
  '.sap-candidateSafetyItem{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
  '.sap-candidateSafetyToggle{border:0;background:0 0;padding:0;margin:0;font:inherit;cursor:pointer;color:var(--dsw-alias-label-secondary);align-items:center;gap:4px;font-size:12px;line-height:18px;display:inline-flex;align-self:flex-start;font-weight:600}',
  '.sap-candidateSafetyToggle:hover{color:var(--dsw-alias-label-primary)}',
  '.sap-candidateSafetyArrow{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1;transition:transform .15s}',
  '.sap-candidateSafetyToggleOpen .sap-candidateSafetyArrow{transform:rotate(90deg)}',
  '.sap-adviceFoot{align-items:center;gap:10px;flex-wrap:wrap;display:flex;border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px;margin-top:2px}',
  '.sap-adviceFootNotes{flex-direction:column;gap:2px;display:flex;min-width:0}',
  '.sap-adviceFootNote{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin:0}',
  '.sap-adviceStatusLine{align-items:center;gap:8px;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary);margin:10px 0 0;display:flex}',
  '.sap-adviceStatusLineWarn{color:var(--dsw-alias-state-error-primary);font-weight:600}',
  '.sap-adviceStatusDim{color:var(--dsw-alias-label-tertiary)}',
  '.sap-candidateState{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);border-radius:3px;padding:1px 6px;white-space:nowrap;flex:none}',
  '.sap-adviceTimelineLine{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}',
  '.sap-adviceTimelineStep{color:var(--dsw-alias-label-secondary)}',
  '.sap-adviceTimelineStepDim{color:var(--dsw-alias-label-dimmed)}',
  '.sap-rollbackBox{border:1px solid var(--dsw-alias-state-error-secondary);background:var(--dsw-alias-interactive-bg-hover-danger);border-radius:6px;padding:10px 12px;flex-direction:column;gap:4px;display:flex;margin-top:12px}',
  '.sap-rollbackBoxLine{color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:18px;margin:0}',
  '.sap-rollbackBoxKeep{color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:18px;margin:0}',
  '.sap-rollbackBoxActions{display:flex;gap:8px;margin-top:6px}',
  '.sap-rollbackDanger{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:0 0}',
  '.sap-applyModal{background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;gap:10px;padding:12px 14px;margin-top:12px;display:flex}',
  '.sap-applyModalHead{align-items:baseline;gap:8px;display:flex}',
  '.sap-applyModalTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}',
  '.sap-applyModalLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px;margin:0}',
  '.sap-applyModalLine{color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:18px;margin:0}',
  '.sap-applyModalLineDim{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}',
  '.sap-applyModalActions{justify-content:flex-end;gap:8px;display:flex}',
  '.sap-candidateSettingsRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
  '.sap-candidateSettingsRow b{font-weight:600;color:var(--dsw-alias-label-primary)}',
  '.sap-candidateSettingsEdit{border:0;background:0 0;padding:0;margin:0;font:inherit;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;text-decoration:underline;text-underline-offset:3px}',
  '.sap-candidateSettingsEdit:hover{color:var(--dsw-alias-label-primary)}',
  '.sap-candidateSettingsPanel{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:12px 14px;margin-top:8px;flex-direction:column;gap:10px;display:flex;background:var(--dsw-alias-bg-layer-1)}',
  '.sap-candidateSettingsField{flex-direction:column;gap:6px;display:flex}',
  '.sap-candidateSettingsOption{align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);display:inline-flex;cursor:pointer}',
  '.sap-candidateSettingsOptions{flex-wrap:wrap;gap:4px 14px;display:flex}',
  '.sap-candidateSettingsCustom{align-items:center;gap:8px;display:flex}',
  '.sap-candidateSettingsCustom .sap-input{max-width:120px}',
  '.sap-candidateSettingsActions{align-items:center;gap:10px;display:flex}',
  '.sap-desc{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:18px}',
  '.sap-descMinor{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:16px}',
  '.sap-maintenanceSwitchDesc{flex-direction:column;gap:2px;display:flex}',
  '.sap-warn{color:var(--dsw-alias-state-warn-label);margin:0;font-size:12px;line-height:18px}',
  '.sap-versionWarn{background:var(--dsw-alias-state-warn-tertiary);border:1px solid var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);border-radius:8px;flex-direction:column;gap:4px;padding:10px 12px;font-size:12px;line-height:18px;margin:0;display:flex}',
  '.sap-chips{flex-wrap:wrap;gap:6px;display:flex}',
  '.sap-chip{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;flex:none;align-items:center;gap:5px;padding:2px 8px;font-size:12px;line-height:18px;display:inline-flex}',
  '.sap-chipLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
  '.sap-chipValue{color:var(--dsw-alias-label-primary)}',
  '.sap-chipValueDim{color:var(--dsw-alias-label-tertiary)}',
  '.sap-chipDot{color:var(--dsw-alias-label-tertiary)}',
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
  '.sap-customizedArrowEnd .sap-customizedSummary:before{display:none}',
  '.sap-customizedEndArrow{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1;transition:transform .15s}',
  '.sap-customizedArrowEnd[open] .sap-customizedEndArrow{transform:rotate(90deg)}',
  '.sap-reminderHandled{border-top:none;padding-top:8px}',
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
  '.sap-toolMeta{flex-wrap:wrap;gap:4px 14px;display:flex}',
  '.sap-draftCard{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;flex-direction:column;gap:8px;padding:10px 12px;display:flex}',
  '.sap-drafts{flex-direction:column;gap:8px;display:flex}',
  '.sap-costSection{flex-direction:column;gap:8px;display:flex}',
  '.sap-infoLine{justify-content:space-between;gap:12px;display:flex}',
  '.sap-infoLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;flex:none}',
  '.sap-infoValue{color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;text-align:right}',
  '.sap-draftTitle{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}',
  '.sap-toolMetaItem{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
  '.sap-toolText{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}',
  '.sap-toolSummary{align-items:center;gap:6px;flex-wrap:wrap;display:flex}',
  '.sap-detailToggle{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);background:0 0;border-radius:10px;font:inherit;font-size:11px;line-height:16px;height:20px;padding:0 8px;cursor:pointer;flex:none;align-items:center;display:inline-flex}',
  '.sap-detailToggle:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
  '.sap-toolDetail{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);display:flex}',
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
  '.sap-ledger{flex-direction:column;gap:12px;display:flex}',
  '.sap-ledgerSummary{position:sticky;top:0;z-index:1;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:12px;flex-direction:column;gap:6px;padding:12px 14px;display:flex}',
  '.sap-ledgerSummaryTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;font-weight:500;line-height:22px}',
  '.sap-ledgerSummaryLine{flex-wrap:wrap;gap:2px 12px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;display:flex}',
  '.sap-ledgerStatSeg{color:var(--dsw-alias-label-secondary)}',
  '.sap-ledgerStat{color:var(--dsw-alias-label-primary);font-weight:600}',
  '.sap-ledgerSep{color:var(--dsw-alias-label-tertiary)}',
  '.sap-ledgerRows{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}',
  '.sap-ledgerRowFail{border-left:3px solid var(--dsw-alias-state-error-secondary)}',
  '.sap-ledgerStatus{font-size:12px;line-height:18px;font-weight:600;flex:none}',
  '.sap-ledgerStatusOk{color:var(--dsw-alias-state-success-primary)}',
  '.sap-ledgerStatusFail{color:var(--dsw-alias-state-error-primary)}',
  '.sap-ledgerStatusRun{color:var(--dsw-alias-state-warn-label)}',
  '.sap-ledgerCostText{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;flex:none}',
  '.sap-ledgerToolsText{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;flex:none}',
  '@keyframes sap-ledgerPulse{0%,100%{opacity:1}50%{opacity:.35}}',
  '.sap-ledgerProgress{align-items:center;gap:6px;display:flex;flex-wrap:wrap}',
  '.sap-ledgerProgressStep{align-items:center;gap:6px;display:inline-flex;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
  '.sap-ledgerProgressDot{width:8px;height:8px;border-radius:50%;flex:none}',
  '.sap-ledgerProgressDot-done{background:var(--dsw-alias-state-success-primary)}',
  '.sap-ledgerProgressDot-run{background:var(--dsw-alias-state-warn-label);animation:sap-ledgerPulse 1.4s infinite}',
  '.sap-ledgerProgressDot-todo{background:var(--dsw-alias-border-l3)}',
  '.sap-ledgerProgressDot-warn{background:var(--dsw-alias-state-warn-label)}',
  '.sap-ledgerProgressSep{width:14px;height:1px;background:var(--dsw-alias-border-l2);flex:none}',
  '.sap-ledgerSafety{flex-wrap:wrap;gap:6px;display:flex}',
  '.sap-ledgerBadge{font-size:12px;line-height:18px;padding:2px 10px;border-radius:6px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
  '.sap-ledgerBadgeOk{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
  '.sap-ledgerBadgeFail{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-secondary);background:var(--dsw-alias-interactive-bg-hover-danger)}',
  '.sap-ledgerBadgeWarn{color:var(--dsw-alias-state-warn-label);border-color:var(--dsw-alias-state-warn-label)}',
  '.sap-ledgerCostCard{flex-wrap:wrap;gap:8px 24px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px 14px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);display:flex}',
  '.sap-ledgerCostCard b{color:var(--dsw-alias-label-primary);font-weight:600}',
  '.sap-ledgerCostSave b{color:var(--dsw-alias-state-success-primary)}',
  '.sap-ledgerRejectBlock{border:1px solid var(--dsw-alias-state-error-secondary);background:var(--dsw-alias-interactive-bg-hover-danger);border-radius:8px;flex-direction:column;gap:4px;padding:10px 14px;font-size:12px;line-height:18px;display:flex}',
  '.sap-ledgerIntervention{color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:18px}',
  '.sap-ledgerEvidenceToggle{box-sizing:border-box;border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;padding:2px 0;align-self:flex-start}',
  '.sap-ledgerEvidenceToggle:hover{color:var(--dsw-alias-brand-primary)}',
  '.sap-ledgerVsHead{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin:2px 0 4px}',
  '.sap-ledgerVsTable{border-collapse:collapse;width:100%;font-size:12px;line-height:18px}',
  '.sap-ledgerVsTable th{text-align:left;color:var(--dsw-alias-label-tertiary);font-weight:500;font-size:11px;line-height:16px;padding:4px 10px 4px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}',
  '.sap-ledgerVsTable td{padding:6px 10px 6px 0;border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);vertical-align:top}',
  '.sap-ledgerVsTable td:first-child{color:var(--dsw-alias-label-tertiary);width:60px}',
  '.sap-ledgerVsTable tr.sap-ledgerVsDiff td{background:var(--dsw-alias-state-warn-tertiary)}',
  '.sap-ledgerVsTable tr.sap-ledgerVsDiff .sap-ledgerVsEff{color:var(--dsw-alias-state-warn-label);font-weight:600}',
  '.sap-ledgerVsNote{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
  '.sap-ledgerToolScroll{max-height:220px;overflow-y:auto}',
  '.sap-ledgerToolTable{border-collapse:collapse;width:100%;font-size:12px;line-height:18px}',
  '.sap-ledgerToolTable th{text-align:left;color:var(--dsw-alias-label-tertiary);font-weight:500;font-size:11px;line-height:16px;padding:4px 10px 4px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}',
  '.sap-ledgerToolTable td{padding:6px 10px 6px 0;border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
  '.sap-ledgerToolName{font-family:monospace;font-size:11px}',
  '.sap-ledgerEventLine{position:relative;padding-left:18px;margin-top:2px}',
  '.sap-ledgerEventLine:before{content:"";position:absolute;left:5px;top:4px;bottom:4px;width:1px;background:var(--dsw-alias-border-l2)}',
  '.sap-ledgerEvent{position:relative;padding:3px 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
  '.sap-ledgerEvent:before{content:"";position:absolute;left:-17px;top:9px;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-border-l3)}',
  '.sap-ledgerEvent-done:before{background:var(--dsw-alias-state-success-primary)}',
  '.sap-ledgerEvent-warn{color:var(--dsw-alias-state-warn-label)}',
  '.sap-ledgerEvent-warn:before{background:var(--dsw-alias-state-warn-label)}',
  '.sap-ledgerEvent-int{color:var(--dsw-alias-brand-primary)}',
  '.sap-ledgerEvent-int:before{background:var(--dsw-alias-brand-primary)}',
  '.sap-ledgerEventTime{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;margin-right:8px}',
  '.sap-ledgerEventAct{color:var(--dsw-alias-label-primary)}',
  '.sap-ledgerRow{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;display:flex}',
  '.sap-ledgerRowHead{box-sizing:border-box;width:100%;border:0;background:0 0;color:var(--dsw-alias-label-primary);cursor:pointer;align-items:center;gap:10px;padding:10px 14px;font:inherit;text-align:left;flex-wrap:wrap;display:flex}',
  '.sap-ledgerRowHead:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.sap-ledgerTime{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;font-family:monospace;flex:none}',
  '.sap-ledgerMeta{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;min-width:0;word-break:break-word}',
  '.sap-ledgerImageText{color:var(--dsw-alias-label-tertiary);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none}',
  '.sap-ledgerToggle{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;transition:transform .12s;margin-left:auto;flex:none;display:inline-flex}',
  '.sap-ledgerRowOpen .sap-ledgerToggle{transform:rotate(90deg)}',
  '.sap-ledgerExpand{flex-direction:column;gap:10px;border-top:1px solid var(--dsw-alias-border-l2);padding:10px 14px 12px;display:flex}',
  '.sap-ledgerSection{flex-direction:column;gap:6px;display:flex}',
  '.sap-ledgerSectionTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}',
  '.sap-ledgerTimeline{flex-direction:column;gap:8px;display:flex}',
  '.sap-ledgerStep{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;flex-direction:column;gap:6px;padding:8px 10px;display:flex}',
  '.sap-ledgerStepHead{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}',
  '.sap-ledgerStepBody{flex-direction:column;gap:4px;display:flex}',
  '.sap-ledgerGate{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;flex-direction:column;gap:6px;padding:8px 10px;display:flex}',
  '.sap-ledgerGateFail{background:var(--dsw-alias-interactive-bg-hover-danger);border-color:var(--dsw-alias-state-error-secondary)}',
  '.sap-ledgerGateHead{justify-content:space-between;align-items:center;gap:8px;display:flex}',
  '.sap-ledgerGateName{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}',
  '.sap-ledgerGateVerdict{font-size:12px;font-weight:500;line-height:18px;flex:none}',
  '.sap-ledgerGateVerdictPass{color:var(--dsw-alias-state-success-primary)}',
  '.sap-ledgerGateVerdictFail{color:var(--dsw-alias-state-error-primary)}',
  '.sap-ledgerGateBody{flex-direction:column;gap:4px;display:flex}',
  '.sap-ledgerSubBlock{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:8px;flex-direction:column;gap:6px;padding:8px 10px;display:flex}',
  '.sap-ledgerSubBlockTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px;align-items:center;gap:6px;display:flex}',
  '.sap-ledgerSubBlockBody{flex-direction:column;gap:4px;display:flex}',
  '.sap-ledgerGateNested{flex-direction:column;gap:2px;border-left:2px solid var(--dsw-alias-border-l2);padding-left:10px;margin-left:2px;display:flex}',
  '.sap-ledgerGateKV{flex-wrap:wrap;align-items:baseline;gap:2px 8px;display:flex}',
  '.sap-ledgerGateKey{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;flex:none}',
  '.sap-ledgerGateValue{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-family:monospace;word-break:break-all}',
  '.sap-ledgerReject{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}',
  '.sap-ledgerRejectFix{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}',
  '.sap-ledgerUsage{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
  '.sap-ledgerManual{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;align-items:baseline;gap:6px;display:flex}',
  '.sap-ledgerSource{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
  '.sap-ledgerSourceDim{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;font-style:italic}',
  // 次级说明小字：供安全检查卡片说明沿用（原跳变线右下角注记样式）
  '.sap-cogJumpDim{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
  '.sap-cogParentText{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word}',
  '.sap-ledgerChildRow{align-items:center;gap:8px;display:flex}',
  '.sap-ledgerChildCount{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
  '.sap-ledgerManualId{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-family:monospace;word-break:break-all}',
  '.sap-ledgerEmpty{flex-direction:column;gap:4px;padding:8px 2px;display:flex}',
  '.sap-ledgerEmptyTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;font-weight:500;line-height:22px}',
  '.sap-ledgerLoadOlder{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);background:0 0;border-radius:10px;font:inherit;font-size:12px;line-height:18px;height:28px;padding:0 12px;cursor:pointer;align-self:flex-start;align-items:center;display:inline-flex}',
  '.sap-ledgerLoadOlder:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
  '.sap-ledgerLoadOlder:disabled{opacity:.4;cursor:default}',
  '.sap-ledgerLegacy{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
  '.sap-ledgerCallsTable{border-collapse:collapse;width:100%;font-size:11px;line-height:16px}',
  '.sap-ledgerCallsTable th{color:var(--dsw-alias-label-secondary);font-weight:500;text-align:right;padding:2px 8px;border-bottom:1px solid var(--dsw-alias-border-l2)}',
  '.sap-ledgerCallsTable td{color:var(--dsw-alias-label-primary);font-family:monospace;text-align:right;padding:2px 8px;border-bottom:1px solid var(--dsw-alias-border-l2)}',
  '.sap-ledgerCallsIndex{color:var(--dsw-alias-label-tertiary);text-align:left!important;font-family:inherit!important}',
  '.sap-ledgerCallsTotal{font-weight:600;border-bottom:none}',
  '.sap-ledgerCallsNote{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
  '.sap-ledgerGateGroup{flex-direction:column;gap:2px;display:flex}',
  '.sap-ledgerRawJson{box-sizing:border-box;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:4px;cursor:pointer;font:inherit;font-size:11px;line-height:16px;padding:0 4px;margin-left:auto;flex:none}',
  '.sap-ledgerRawJson:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
  '.sap-ledgerJsonBody{flex-direction:column;gap:6px;display:flex}',
  '.sap-ledgerJsonBlock{flex-direction:column;gap:2px;display:flex}',
  '.sap-ledgerScope{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0}',
  '.sap-ledgerWindowNote{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
  '.sap-escapeAdd{align-items:center;gap:8px;display:flex}',
  '.sap-chipRemove{box-sizing:border-box;color:var(--dsw-alias-state-error-primary);font:inherit;cursor:pointer;background:0 0;border:none;border-radius:4px;padding:0 4px;font-size:11px;line-height:16px}',
  '.sap-chipRemove:hover{background:var(--dsw-alias-interactive-bg-hover-danger)}',
  // 六页签：横向 tab（下划线激活+加粗）+ 内容区（非激活隐藏，全部挂载保状态）
  '.sap-tabs{display:flex;flex-wrap:wrap;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}',
  '.sap-tab{box-sizing:border-box;border:0;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;padding:9px 14px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;user-select:none}',
  '.sap-tab:hover{color:var(--dsw-alias-label-primary)}',
  '.sap-tabActive{color:var(--dsw-alias-label-primary);font-weight:700;border-bottom-color:var(--dsw-alias-label-primary)}',
  '.sap-zone{display:none}',
  '.sap-zoneActive{display:block}',
  // 建议摘要行 + 展开区（v8：卡片边界 .advice-item，无二级标题）
  '.sap-adviceItem{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;flex-direction:column;display:flex}',
  '.sap-adviceSummary{box-sizing:border-box;width:100%;border:0;background:0 0;padding:10px 14px;margin:0;font:inherit;text-align:left;cursor:pointer;flex-direction:column;align-items:stretch;gap:2px;display:flex}',
  '.sap-adviceObjLine{align-items:center;gap:6px;flex-wrap:wrap;min-width:0;display:flex}',
  '.sap-adviceSummaryLine{align-items:center;gap:8px;flex-wrap:wrap;min-width:0;display:flex}',
  '.sap-adviceSummary:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.sap-adviceObj{color:var(--dsw-alias-label-primary);font-weight:600;font-size:13px;line-height:20px}',
  '.sap-adviceSummaryText{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
  '.sap-adviceConf{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap}',
  '.sap-adviceSummaryArrow{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1;transition:transform .15s}',
  '.sap-adviceItemOpen .sap-adviceSummaryArrow{transform:rotate(90deg)}',
  '.sap-adviceNoProfileTag{font-size:11px;line-height:16px;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:3px;padding:0 5px;flex:none}',
  '.sap-adviceDetail{border-top:1px dashed var(--dsw-alias-border-l2);padding:10px 14px 12px;flex-direction:column;gap:8px;display:flex}',
  // 审计明细折叠表（只读展示）
  '.sap-auditCollapse{border:0;background:0 0;padding:0;margin:0;font:inherit;cursor:pointer;color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;font-size:12px;line-height:18px;display:inline-flex;align-self:flex-start}',
  '.sap-auditCollapse:hover{color:var(--dsw-alias-label-primary)}',
  '.sap-auditArrow{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1;transition:transform .15s}',
  '.sap-auditCollapse[aria-expanded="true"] .sap-auditArrow{transform:rotate(90deg)}',
  '.sap-auditTable{width:100%;border-collapse:collapse;font-size:12px;line-height:18px;margin-top:4px}',
  '.sap-auditTable th{text-align:left;font-weight:500;color:var(--dsw-alias-label-tertiary);padding:3px 8px 3px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}',
  '.sap-auditTable td{text-align:left;padding:4px 8px 4px 0;border-bottom:1px dotted var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);vertical-align:top}',
  '.sap-auditTime{color:var(--dsw-alias-label-primary);font-weight:500;white-space:nowrap}',
  '.sap-auditEvent{color:var(--dsw-alias-label-secondary);white-space:nowrap}',
  '.sap-auditObject{color:var(--dsw-alias-label-primary)}',
].join('\n')

// ── 纯数据：dispatch 卡片面向用户固定文案 ──────────────────────────────────

// 面向用户的固定文案。注意：此表仅集中 dispatch 卡片文案；设置页文案仍为
// 散落硬编码，属待迁移债（迁移时一次性并入此表）。
const ZH = {
  inlineProfile: '未存方案',
  inherit: '继承父会话',
  effortDefault: '默认（继承父会话）',
  chipProfile: '方案',
  chipPreset: '预设',
  chipProvider: '提供方',
  chipModel: '模型',
  chipEffort: '推理强度',
  chipTier: '档位（估算口径）',
  chipEnabled: '已启用',
  chipDisabled: '已禁用',
  ignoredMark: '已忽略',
  toolLabel: '派发子 Agent',
  detailOpen: '详情',
  detailClose: '收起',
  cont: 'continuable 子 Agent',
  canContinue: '可续跑',
  toolBackground: '后台任务',
  toolForeground: '前台',
  chipMode: '模式',
  modeForeground: '前台',
  modeBackground: '后台',
  modeContinuable: 'continuable',
  bannerInheritValue: '继承父会话',
  bannerModePersistent: '持久',
  bannerOriginTitle: '来源：由父会话派发',
  // 派发链路状态机 phase 徽标
  phaseInitiate: '发起',
  phaseGuards: '检查通过',
  phaseCreate: '创建',
  phaseRun: '执行中',
  phaseDone: '完成',
  phaseFailed: '失败',
  phaseLegacy: '已结算（旧版）',
  // 提醒系统
  reminderCenterTitle: '提醒中心',
  reminderCenterDesc: '需要你关注的事件汇总，所有动作均有审计记录；处理过的条目折叠保存',
  reminderEmpty: '暂无提醒（历史操作与事件会在这里留痕）',
  reminderAck: '标记已读',
  reminderAdopt: '采纳',
  reminderIgnore: '忽略',
  reminderReject: '拒绝',
  reminderDismiss: '关闭',
  reminderGlobal: '全局',
  reminderSessionLabel: '会话 ',
  reminderP0Badge: '⚠ 紧急 {n}',
  reminderActed: '已处理：{action}',
  reminderActionZh: { adopt: '采纳', ignore: '忽略', reject: '拒绝', dismiss: '关闭' },
  reminderViewChild: '查看子会话',
  reminderParentLabel: '主会话',
  reminderChildLabel: '子会话',
  reminderTaskLabel: '任务',
  reminderResultLabel: '结果',
  reminderNoteLabel: '说明',
  reminderNoSettlement: '未结算',
  reminderNoExcerpt: '（未记录）',
  reminderArchivedEmpty: '暂无已归档条目（数据维护区执行归档后在此分页查看）',
  reminderArchivedMore: '加载更早',
  // 数据维护（设置页 → 方案管理尾部）
  maintenanceCardTitle: '数据维护',
  maintenanceCardDesc: '候选、快照、提醒与统计数据的清理入口；每次清理都会留下记录',
  snapshotSwitchDesc: '派发时在本机自动保存完整配置（含自定义人格），供「保存为方案」与对比使用。\n数据仅存您本机（~/.dsh/subagent-evolution/snapshots/），插件更新不影响，可随时清理。\n关闭开关即停止新快照（已存保留）。',
  snapshotCount: '已存快照：{n} / {cap} 条',
  snapshotCapHint: '快照已达护栏上限，停止新快照（可清理后继续）',
  snapshotNone: '暂无快照（开启开关后每次派发保存一条）',
  snapshotView: '查看',
  snapshotViewClose: '收起',
  snapshotMeta: '快照 {id} · 于 {ts}',
  snapshotPersonaFold: '人格（{n} 字符，点击展开）',
  snapshotEmptyConfig: '（无配置字段）',
  cleanCandidates: '清理候选/建议',
  cleanSnapshots: '清理快照',
  cleanReminders: '归档已处理提醒',
  cleanStats: '重置统计',
  maintenanceConfirm: '确认要执行「{zone}」吗？清理操作会留下记录。',
  maintenanceDone: '已执行 {zone}：{count} 条',
  maintenanceCleanErr: '清理失败：',
  toolRunning: '运行中',
  tierZh: { cheap: '省 token（cheap）', balanced: '均衡（balanced）', premium: '高成本（premium）' },
  stopReasonZh: { completed: '完成', 'max-tokens': '超出预算', aborted: '已中止', refusal: '已拒绝', error: '出错' },
  cacheHit: '缓存命中',
  usageInput: '输入',
  usageOutput: '输出',
  usageCacheRead: '缓存命中',
  usageCacheWrite: '缓存写',
  usageReasoning: '推理',
  persistFail: '已保存但未持久化',
  persistFailHint: '（磁盘写入未成功，重启 dsh web 后该改动可能丢失）',
  // 审计分级（设置页红字 + 丢失计数）
  auditDegraded: '审计记录写入异常（已降级）：请检查磁盘',
  auditLost: '审计丢失计数',
  // 派发决策台账（conversation.view 会话标签页）文案
  ledgerTab: '派发决策台账',
  ledgerSummary: '本会话派发',
  ledgerDispatch: '派发',
  ledgerTimes: '次',
  ledgerSuccess: '成功',
  ledgerReject: '拒绝',
  ledgerPass: '通过',
  ledgerTotalTokens: '总 token',
  ledgerTotalElapsed: '总耗时',
  ledgerElapsed: '耗时',
  ledgerStopReason: '结束原因',
  ledgerGateRejectDist: '安全检查拒绝分布',
  ledgerByProfile: '按方案',
  ledgerByModel: '按模型',
  ledgerByTier: '按档位（估算口径）',
  ledgerEmpty: '本会话暂无派发记录',
  ledgerEmptyHint: '在此会话中派发一次子 Agent 后，即可查看完整的决策轨迹。',
  ledgerLoadOlder: '加载更早',
  ledgerLoadingOlder: '加载中…',
  ledgerLegacy: '该记录产生于决策轨迹上线前，仅有结果摘要',
  ledgerGateInput: '输入',
  ledgerGateOutput: '输出',
  ledgerRejectFix: '修复方向',
  ledgerJumpChild: '打开子会话',
  ledgerChildManual: '子会话 ID',
  ledgerJobManual: '后台任务 ID',
  ledgerStarted: '发起',
  ledgerParentContext: '父会话上下文',
  ledgerRequested: '请求值',
  ledgerEffectiveStep: '生效值',
  ledgerDecisionTimeline: '决策时间线',
  ledgerSettledStep: '结算',
  ledgerRawJson: '原始 JSON',
  ledgerFieldView: '字段视图',
  ledgerCallDetail: '逐次调用明细',
  ledgerCallsTotal: '合计',
  ledgerCallsTruncated: '仅显示前 {shown} 条，共 {total} 次调用',
  ledgerCallsIndex: '序号',
  ledgerExecutionStep: '执行信息',
  cogTimelineTitle: '派发决策时间线',
  cogPerceiveDecide: '① 发起',
  cogDecide: '② 决策 · 生效值',
  cogExecute: '③ 执行',
  cogNewPerceive: '④ 结算',
  // ── 三层信息架构（折叠态 / 结论层 / 证据层）文案 ──
  ledgerStatusSuccess: '✅ 成功',
  ledgerStatusReject: '❌ 拒绝',
  ledgerStatusRunning: '🔄 执行中',
  ledgerStatusAbnormal: '⚠ 异常',
  ledgerCostRunning: '进行中…',
  ledgerToolsPending: '未派发',
  ledgerInterventionBadge: '⚠ 干预 {n} 次',
  ledgerSafetyAllPass: '安全检查 ✅ 5/5 通过',
  ledgerSafetyFail: '安全检查 ❌ 未通过（{gate}）',
  ledgerSafetyBadge: '安全检查',
  ledgerGateBadgeZh: { whitelist: '白名单', cost: '成本', intersection: '交集非空', approval: '审批不豁免', budget: '预算' },
  ledgerProgressZh: { start: '发起', decide: '决策', run: '执行', settle: '结算', stop: '终止' },
  ledgerProgressStepZh: { start: '① 发起', decide: '② 决策', run: '③ 执行', settle: '④ 结算' },
  ledgerCostCardScope: '本会话口径',
  ledgerCostCardCounter: '若继承父会话',
  ledgerCostCardSave: '省',
  ledgerEvidenceToggle: '查看完整因果链 ▸',
  ledgerEvidenceClose: '收起因果链 ▴',
  ledgerVsTitle: '请求 vs 生效',
  ledgerVsDiff: '{n} 项与请求不同（琥珀底行）',
  ledgerVsAllMatch: '请求全部生效 ✓',
  ledgerVsItem: '项',
  ledgerVsRequest: '请求',
  ledgerVsEffective: '生效',
  ledgerVsNote: '说明',
  ledgerVsUnset: '未指定',
  ledgerVsDefault: '方案默认',
  ledgerVsInherit: '继承父会话（{model}）',
  ledgerVsIgnored: '请求了 {v}，未生效（被忽略）',
  ledgerToolsetTitle: '工具集',
  ledgerToolsetFormula: '白名单 {x} ∩ 父会话 {y} → 实得 {z}',
  ledgerToolsetGranted: '由系统授予',
  ledgerToolsetRemoved: '移除 {n} 个',
  ledgerToolsetHostNarrow: '工具由系统最终授予（插件侧未收录移除明细）',
  ledgerToolsetTruncated: '（清单已截断，前 {n} 项）',
  ledgerToolRemoveRunCode: '安全策略：子代理不执行代码',
  ledgerToolRemoveNotInWhitelist: '不在白名单',
  ledgerToolRemoveNotInAllow: '不在方案白名单',
  ledgerToolCol: '工具',
  ledgerToolReasonCol: '移除原因',
  ledgerPrecheckTitle: '派发前 · 安全检查',
  ledgerParentSessionLabel: '父会话',
  ledgerRequestHuman: '请求参数',
  ledgerPromptQuote: '任务指令（派发前）',
  ledgerDecisionQuote: '决策原文（派发后）',
  ledgerExecInterval: '{start} → {end}（共 {dur}）',
  ledgerExecToolCalls: '工具调用 {n} 次',
  ledgerExecLiveNote: '后台执行中：过程事件随活动更新',
  ledgerEventStart: '开始执行',
  ledgerEventCall: '第 {n} 次工具调用',
  ledgerEventStall: '⚠ 停滞 {s}s 无活动（超过 {t}s 上限）',
  ledgerEventStalling: '⚠ 停滞中（已 {s}s 无活动）',
  ledgerEventIntervene: '主 agent 干预',
  ledgerEventResume: '恢复执行',
  ledgerEventDone: '完成',
  ledgerEventRunning: '执行中…',
  ledgerEventMoreCalls: '…其间还有 {n} 次调用',
  ledgerStallThresholdNote: '停滞上限 30s（待实测）',
  ledgerSettleOutput: '输出摘要',
  ledgerSettleCostBreakdown: '成本分解',
  ledgerSettleInheritNote: '未指定模型，按继承父会话估算',
  ledgerSafetyRejectDist: '安全检查拒绝分布',
  ledgerScopeNote: '本页仅展示本会话的决策轨迹，成本为「本会话」口径；跨会话进化台账、审计记录与「全局」成本口径见设置页。',
  ledgerWindowNote: '已加载最近 {n} 条，尚有更早记录',
  ledgerCostLine: '本会话口径 · 估算成本 ≈{actual} 元（若继承父会话 ≈{counter} 元 · 省 ≈{saving} 元 · 约 {ratio}×）',
  ledgerInheritCost: '继承父会话模型派发 {count} 次（{ratio}%）——未指定模型，无降本机会',
  costNoPrice: '无单价/无用量，成本不显示',
  costInheritModel: '未指定模型（继承父会话）',
  inheritModelShort: '继承父会话模型',
  tokenDetailPrefix: 'Token：',
  whyUsable: '安全检查',
  toolAllowlist: '工具',
  toolHostNarrow: '工具由系统最终授予',
  gateFixUnknown: '未能识别的安全检查拒绝，请核对请求参数',
  ignoredChipTitle: '请求值 "{value}" 已忽略',
  ignoredChipTitleEmpty: '请求值已忽略',
  // 逃生舱（放行非官方预设）
  escapeTitle: '逃生舱（放行非官方预设）',
  escapeCardDesc: '放行非官方预设的高风险通道，默认关闭',
  escapeWarn: '逃生舱已开启：允许派发非官方预设。风险自负——其余安全检查仍全量生效，每个放行都会留审计记录。',
  escapeEmpty: '暂无放行预设',
  escapeAdd: '添加',
  escapeRemove: '移除',
  escapeInputPlaceholder: '非官方预设 id',
  escapeAddEmpty: '逃生舱预设 id 不能为空',
  // 派发优化建议注入（开关 + 只提示面板）
  adviceTitle: '派发优化建议',
  advicePanelDesc: '根据历史派发数据向父会话附优化提示（例：某方案近期成功率偏低，可考虑换方案）。只提示，不自动改配置',
  adviceEnableLabel: '开启建议',
  adviceSectionReason: '理由',
  adviceSectionPerf: '近期表现',
  adviceSectionDetail: '派发明细',
  adviceSwitchOn: '开（只提示，不自动改配置）',
  adviceSwitchOff: '关（只提示，不自动改配置）',
  advicePanelEmpty: '暂无建议（近期派发表现不佳时才会生成）',
  advicePanelGlobal: '全局',
  advicePanelReadonly: '（仅提示：统计与建议不改变派发行为）',
  adviceDirUp: '可上调预算',
  adviceDirDown: '建议降级',
  adviceDirFlat: '维持现状',
  adviceConfidence: '置信度：',
  confidenceZh: { low: '低', medium: '中等', high: '高' },
  adviceRowLocate: '定位到方案管理',
  // 建议行/理由行（建议直接带对象；理由灰字小字）
  adviceSuggestionPrefix: '建议：',
  adviceReasonPrefix: '理由：',
  adviceDirShortDown: '降级',
  adviceDirShortUp: '升预算',
  // 建议对象标题（摘要行对象与底部备注共用）
  adviceTitleNoProfile: '手动配置的派发',
  adviceTitleProfilePrefix: '方案：',
  costEditProfile: '定位方案',
  costNoProfile: '无对应方案',
  advancedSafetyLine: '安全保证：派发不豁免审批 · 子代理工具不会超出父会话 · 成本与深度有硬上限。',
  resetAllBuiltins: '重置所有内置方案',
  statusLost: '审计丢失',
  profilesIntro: '在此管理「派发子 Agent」工具可用的 profile。内置方案可编辑、可删除、可在此重置回默认；每个方案可单独启用/禁用。',
  draftSavedWithId: '已保存到 draft，可在设置页「方案管理」中应用；方案 id：{id}',
  draftCopyId: '复制 id',
  ledgerCopyTarget: '复制',
  ledgerCopied: '已复制 ✓',
  costEstimated: '估算成本',
  costInherit: '继承父会话成本',
  costSaving: '节省',
  costPriced: '可计价',
  costInheritRatio: '继承占比',
  costByModel: '按模型',
  draftPreview: '安全检查预览',
  draftPreviewPass: '安全检查：全部通过 ✓',
  draftPreviewFail: '安全检查：存在拒绝项',
  // 建议面板候选方案区（三层：标题行 → 说明句 → 候选项列表；有效期徽标在候选行右侧；
  // 应用确认流随后续版本开放，不可应用提示收进展开区尾部）。
  candidateTitle: '候选方案',
  candidateNotApplied: '（未应用）',
  candidateCountSuffix: ' 个 · 单选',
  candidateCountNote: ' · 应用前需你确认',
  candidateIntro: '系统基于近期表现生成的改进方案；应用前需要你确认，并进入观察期。',
  candidateRegenerate: '重新生成候选',
  candidateSafetyPending: '安全检查：正在核对…',
  candidateGroupChanges: '改动',
  candidateGroupGenerated: '生成信息',
  candidateSafetyPrefix: '安全检查：',
  candidateSafetyPass: '全部通过 ✓',
  candidateSafetyFail: '存在拒绝项',
  candidateNotApplicable: '应用功能在后续版本开放（届时会先经你确认）',
  // 观察期/撤销建议/确认流（用户可见面零内部词：观察中/表现变差/撤销/调整前）
  adviceStatusObservingSuffix: '——表现下降会提醒你撤销',
  adviceApplyConfirm: '确认调整方案',
  adviceApplyCancel: '取消',
  adviceApplyModalSummary: '候选摘要',
  adviceApplyModalImpact: '成本与能力影响',
  adviceApplyImpactDown: '能力配置降级，工具面不扩大，成本通常更低',
  adviceApplyImpactUp: '预算上调，成本可能上升',
  adviceApplyImpactFlat: '能力配置不变，成本不受影响',
  adviceApplySafetyNote: '安全检查：',
  adviceApplyDefaultNote: '本建议改的是方案默认值；派发时显式参数仍会覆盖它',
  adviceApplyObserveNote: '应用后进入观察期（5 次派发），表现下降时会提醒你撤销，不会自动修改',
  adviceApplySuccess: '已应用，进入观察期',
  adviceApplyObservingTitle: '观察中，暂不支持再次调整',
  adviceApplySelectTitle: '请先选择一个候选方案',
  adviceRollbackBoxAdvice: '建议撤销这次调整，恢复调整前的配置。',
  adviceRollbackRestorePrefix: '恢复为：',
  adviceRollbackEvidence: '对比：调整前表现分 {before} · 调整后 {after}（近 {n} 次派发）',
  adviceRollbackKeepDone: '已选择：继续使用当前配置（已留痕）',
  adviceRollbackBtn: '撤销上次调整',
  adviceRollbackKeepBtn: '继续用当前方案',
  adviceRollbackSuccess: '已恢复调整前配置，观察期终止',
  adviceKeepSuccess: '已选择保留当前配置（已留痕）',
  adviceRollbackModalTitle: '撤销这次调整？',
  adviceRollbackModalRestore: '恢复为',
  adviceRollbackModalChange: '会改变',
  adviceRollbackModalNote: '若方案已被手动修改，将无法一键撤销；本次撤销会记入审计',
  adviceRollbackConfirm: '确认撤销',
  adviceRollbackChangeSuffix: '调整前自定义项一并恢复',
  adviceTimelineTitle: '进化轨迹',
  adviceTimelinePending: '待你处理',
  adviceTimelineSep: ' → ',
  adviceRestoreFallback: '调整前的完整配置',
  adviceReminderView: '查看建议',
  candidateValidityForever: '⏱ 无期限',
  candidateValidityPrefix: '⏱ 至 ',
  candidateGeneratedPrefix: '生成于 ',
  candidateSamplesPrefix: '基于最近 ',
  candidateSamplesSuffix: ' 次派发',
  candidatePerfPrefix: '近期表现 ',
  candidatePerfSuffix: '（满分 100）',
  candidateNoSample: '暂无近期派发样本',
  // 候选卡底部：无对应方案存来源配置为新方案；有对应方案调整按钮灰置 + 定位。
  adviceSaveProfile: '保存为方案',
  adviceApplyDisabled: '按建议调整方案',
  adviceSavedNotice: '已保存为新方案：{id}',
  adviceFootNoteSave: '仅保存预设、模型与提供方；自定义人格与工具过滤无法还原（隐私保护不落盘），如需完整配置请手动编辑方案。',
  adviceFootNoteMatchedPrefix: '对应方案：',
  // 建议摘要行（v8：对象/建议/置信度；展开后见理由与明细）
  adviceNoProfileTag: '无方案',
  // 安全页签：安全保证卡 + 审计健康卡（只读明细表）
  safetyCardTitle: '安全保证',
  safetyCardDesc: '派发与审计的安全保证，明细只读',
  safetyCheckNote: '派发前安全检查：白名单 / 成本 / 工具面 / 审批不豁免——拒绝分布见下方审计明细。',
  auditCardTitle: '审计健康',
  auditCardDesc: '治理审计状态与留痕，异常红字提示',
  auditDetailToggle: '查看审计明细（点击展开）',
  auditDetailEmpty: '暂无审计明细（历史操作与事件会在这里留痕）',
  auditDetailScope: '只读展示，暂不提供导出与过滤',
  auditColTime: '时间',
  auditColEvent: '事件',
  auditColObject: '对象',
  auditColResult: '结果',
  auditEventZh: { 'adoption-false': '派发未采纳', 'escape-allow': '逃生舱放行', 'audit-degraded': '审计降级', 'dispatch-budget-limit': '派发预算中止' },
  auditResultPending: '未处理',
  auditResultRead: '已读',
  auditResultActedPrefix: '已处理：',
  // 近期派发明细折叠表
  adviceDetailTogglePrefix: '近期派发明细 · ',
  adviceDetailToggleSuffix: ' 次（点击展开）',
  adviceDetailEmpty: '近期暂无明细',
  adviceDetailColTime: '时间',
  adviceDetailColSession: '主会话（发起者）',
  adviceDetailColChild: '子 Agent',
  adviceDetailColOutcome: '结果',
  adviceDetailColElapsed: '耗时',
  adviceDetailColMode: '模式',
  dispatchOutcomeZh: { completed: '完成', failed: '失败', killed: '终止' },
  // 候选管理设置（顶部设置行 + 就地浮层）
  candidateSettingsRow: '候选时效：',
  candidateSettingsEdit: '修改 ⚙',
  candidateSettingsSaved: '候选设置已保存',
  candidateModeAuto: '自动换新',
  candidateModeManual: '手动维护',
  candidateTtlLabel: '有效期',
  candidateTtl24: '24 小时',
  candidateTtl72: '3 天',
  candidateTtl168: '7 天',
  candidateTtl0: '不自动过期',
  candidateTtlCustom: '自定义',
  candidateSettingsModeLabel: '更新模式',
  candidateSettingsModeAutoText: '自动换新：数据显著变化时换代',
  candidateSettingsModeManualText: '手动维护：不自动换代，候选保留，可点「重新生成候选」刷新',
  candidateSettingsCustomLabel: '自定义天数（1~365）',
  candidateSettingsCustomInvalid: '自定义有效期无效：请输入 1~365 的整数天数',
  candidateSettingsSave: '保存',
  candidateSettingsCancel: '取消',
  // 会话派发预算设置卡（成本与统计页签）：输入框/保存/越界提示/说明。
  budgetCardTitle: '会话派发预算',
  budgetCardDesc: '本会话派发子代理的 token 与并发上限，保存即时生效',
  budgetTokensLabel: '会话派发 token 上限',
  budgetConcurrentLabel: '并发派发数上限',
  budgetTokensInvalid: '会话派发 token 上限需为 100000~2000000 的整数',
  budgetConcurrentInvalid: '并发派发数上限需为 1~32 的整数',
  budgetSave: '保存',
  budgetSaved: '预算设置已生效',
  budgetExplain: '预算达到上限时，该会话将停止派发新的子代理；已完成的派发不受影响。本预算按会话计，换新会话不累计；仅统计子代理消耗，不包含主会话自身用量。本卡按子代理真实计费用量统计。',
  // 编辑表单档位选择器口径说明（档位是估算口径，不决定模型）
  tierFormHint: '档位仅影响估算与方案排序，不改变派发模型；显式选择模型才决定实际模型'
}

// profileKey 内部表示 → 人话（仅展示层；工具提示/日志保留原串）：preset:X→预设：X、
// persona:1→含自定义人格、toolFilter:1→含工具过滤，段组合以 · 连接；
// (inline) 即未存方案；空键兜底未指定方案特征。
function profileKeyZh(key) {
  const text = typeof key === 'string' ? key : ''
  const parts = text.split('|').filter((part) => part !== '').map((part) => {
    if (part === '(inline)') return '未存方案'
    const idx = part.indexOf(':')
    const head = idx >= 0 ? part.slice(0, idx) : part
    const value = idx >= 0 ? part.slice(idx + 1) : ''
    if (head === 'preset') return '预设：' + value
    if (head === 'provider') return '提供方：' + value
    if (head === 'model') return '模型：' + value
    if (head === 'persona') return '含自定义人格'
    if (head === 'toolFilter') return '含工具过滤'
    if (head === 'effort') return '推理强度：' + value
    return part
  })
  const zh = parts.join(' · ')
  return zh === '' ? '未指定方案特征' : zh
}

// ── 纯数据：设置页常量 ─────────────────────────────────────────────────────

const EMPTY_FORM = { id: '', description: '', preset: '', provider: '', model: '', reasoningEffort: '', tokenTier: 'balanced', toolMode: 'none', toolList: [] }
const EFFORT_ZH = { off: '关闭', high: '高', max: '最大' }
// 设置页五页签顺序（v9：维护并入方案管理尾部折叠卡；方案管理第一位并默认激活）。
const SETTINGS_TABS = [
  { key: 'profiles', label: '方案管理' },
  { key: 'cost', label: '成本与统计' },
  { key: 'advice', label: '自进化与建议' },
  { key: 'safety', label: '安全' },
  { key: 'reminders', label: '通知与提醒' }
]
const TOOL_MODES = [
  ['none', '不限制（继承父会话的全部工具，自动剔除 run_code）'],
  ['allow', '白名单（只允许勾选的工具）'],
  ['deny', '黑名单（排除勾选的工具）'],
]
const CORE_ORDER = ['文件', '终端', '网络', '任务', '子 Agent', '工作流', '交互', '图片', 'Cordis', '计划']
const LAYER_TITLES = { core: '核心预设', plugin: '第三方插件', custom: '自建预设' }
// 派发决策台账：闸名中文标签（展示层同时保留英文技术标识）。
const GATE_LABELS = { whitelist: '白名单', cost: '成本', intersection: '交集非空', approval: '审批不豁免', budget: '预算', other: '其它' }

const GATE_FIX_HINTS = {
  whitelist: '目标预设不在候选白名单内，可在设置页改用受信任的预设',
  cost: '参数超出模型目录或成本上限，可在设置页调整提供方/模型/推理强度',
  intersection: '方案勾选的工具父会话都没有，可在设置页调整该方案的「工具限制」',
  approval: '审批策略冲突，请核对审批配置',
  budget: '并发派发数或本会话累计 token 已达上限，请等待在途任务完成、开启新会话 或 在「成本与统计」调高预算上限'
}
// 安全检查项 → 人话映射（可见面零内部术语；title 保留原串供排查；未知项原样回退）。
const CHECK_ZH = { sanitize: '配置格式检查', id: '方案编号不冲突', whitelist: '工具范围安全检查', catalog: '模型目录有效' }
// 派发决策台账：决策轨迹字段键名 → 中文标签（字段级渲染去「JSON 墙」用）。
// 派发决策台账：决策轨迹字段键名 → 中文标签（FIELD_ZH，字段级渲染去「JSON 墙」用）。
// 未知键回退原样（fail-soft 不崩溃）；同义键（执行/结算/派发摘要字段）一并收录。
const FIELD_ZH = {
  parentPreset: '父预设', parentProvider: '父提供方', parentModel: '父模型', parentToolCount: '父工具数',
  tokenTier: '档位（估算口径）', persona_present: '是否设置人格', toolFilter_present: '是否设置工具过滤', envelope: '信封模式',
  prompt_excerpt: '任务摘要', prompt_truncated: '任务已截断',
  systemTrustCandidates: '候选白名单', resolvedPreset: '解析后预设', allowed: '放行',
  field: '检查项', checkedAgainst: '对照', verdict: '结论', cap: '上限',
  policy: '策略', applied: '应用值',
  mode: '模式', deferred: '延迟结算', background: '后台',
  concurrency: '当前并发', tokens: '当前 token', maxConcurrent: '并发上限', maxParentTokens: '父会话 token 上限',
  parentSessionId: '父会话', childSessionId: '子会话',
  id: '方案 id', description: '描述', preset: '目标预设', profile: '方案',
  requestedPreset: '目标预设', checks: '检查项', detail: '详情',
  effectiveAllowCount: '生效工具数', jobId: '任务ID', reason: '原因', limit: '上限',
  skipped: '跳过', allowFailOpen: '兼容模式', maxTokens: 'token 上限', maxDepth: '深度上限',
  requestedToolFilter: '请求工具过滤', providers: '提供方', modelEfforts: '模型支持的推理强度',
  effectiveToolNames: '生效工具', provider: '提供方', model: '模型',
  reasoningEffort: '推理强度',
  unknown_keys: '未知字段（已被拒绝）',
  outcome: '结果', status: '状态', stop_reason: '结束原因', elapsed_ms: '耗时',
  output_len: '输出长度', tool_count: '工具调用数'
}

const smallBtn = { height: '24px', padding: '0 8px', fontSize: '12px', borderRadius: '12px' }

// 审计分级的默认态（summary 缺 audit 字段 / 值非法时回退）：health ok、零丢失。
const AUDIT_DEFAULTS = { lostTelemetry: 0, lostGovernance: 0, health: 'ok' }

// 从 /options/summary 响应抽取 audit 分级；缺失/非法字段 fallback 到默认态。
function readAuditFromData(data) {
  const a = data !== null && typeof data === 'object' && data.audit !== null && typeof data.audit === 'object' ? data.audit : {}
  return {
    lostTelemetry: typeof a.lostTelemetry === 'number' ? a.lostTelemetry : 0,
    lostGovernance: typeof a.lostGovernance === 'number' ? a.lostGovernance : 0,
    health: a.health === 'degraded' ? 'degraded' : 'ok'
  }
}

// /options/summary 响应 → 设置页状态（enabled/options/audit/逃生舱开关与放行集）。
// set 为各 setter 的注入对象；escapePresets 非数组回退空数组，escapeEnabled 仅 true 才开；
// 候选设置（更新模式/有效期）缺失时回退默认。
function applySummaryData(data, set) {
  set.enabled(data.enabled !== false)
  set.options({
    models: Array.isArray(data.models) ? data.models : [],
    efforts: {},
    presets: Array.isArray(data.presets) ? data.presets : []
  })
  set.audit(readAuditFromData(data))
  set.escapeEnabled(data.escapeEnabled === true)
  set.escapePresets(Array.isArray(data.escapePresets) ? data.escapePresets : [])
  set.evolutionAdvice(data.evolutionAdvice === true)
  set.candidateSettings({
    candidateMode: data.candidateMode === 'manual' ? 'manual' : 'auto',
    candidateTtlH: Number.isFinite(data.candidateTtlH) ? data.candidateTtlH : 24
  })
}

// /options/budget 响应 → 预算表单与生效值（缺失回退默认 500000/8）。
function applyBudgetData(data, set) {
  const budget = data !== null && typeof data === 'object' && data.dispatchBudget !== null && typeof data.dispatchBudget === 'object' ? data.dispatchBudget : {}
  const maxParentTokens = Number.isInteger(budget.maxParentTokens) ? budget.maxParentTokens : 500000
  const maxConcurrent = Number.isInteger(budget.maxConcurrent) ? budget.maxConcurrent : 8
  set.dispatchBudget({ maxParentTokens, maxConcurrent })
  set.budgetForm({ maxParentTokens: String(maxParentTokens), maxConcurrent: String(maxConcurrent), error: '' })
}

// 预算设置动作：表单字段、保存（区间校验 fail-loud → POST /set-budget →
// 服务端值回填 + 「已生效」提示）。越界时只在表单内报错，不发请求。
function attachBudgetActions(api, s, applyWrite, actions) {
  actions.setBudgetTokens = (event) => s.setBudgetForm((prev) => ({ ...(prev ?? {}), maxParentTokens: event && event.target ? event.target.value : '', error: '' }))
  actions.setBudgetConcurrent = (event) => s.setBudgetForm((prev) => ({ ...(prev ?? {}), maxConcurrent: event && event.target ? event.target.value : '', error: '' }))
  actions.saveBudget = () => {
    const form = s.budgetForm !== null && typeof s.budgetForm === 'object' ? s.budgetForm : {}
    const maxParentTokens = Number(form.maxParentTokens)
    const maxConcurrent = Number(form.maxConcurrent)
    if (!Number.isInteger(maxParentTokens) || maxParentTokens < 100000 || maxParentTokens > 2000000) {
      s.setBudgetForm((prev) => ({ ...(prev ?? {}), error: ZH.budgetTokensInvalid }))
      return
    }
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 32) {
      s.setBudgetForm((prev) => ({ ...(prev ?? {}), error: ZH.budgetConcurrentInvalid }))
      return
    }
    s.setError('')
    api('/set-budget', { maxParentTokens, maxConcurrent })
      .then((data) => {
        const saved = data !== null && typeof data === 'object' && data.dispatchBudget !== null && typeof data.dispatchBudget === 'object' ? data.dispatchBudget : { maxParentTokens, maxConcurrent }
        s.setDispatchBudget({ maxParentTokens: saved.maxParentTokens, maxConcurrent: saved.maxConcurrent })
        s.setBudgetForm({ maxParentTokens: String(saved.maxParentTokens), maxConcurrent: String(saved.maxConcurrent), error: '' })
        applyWrite(data, ZH.budgetSaved)
      })
      .catch((err) => s.setError(String((err && err.message) || err)))
  }
}

// 会话派发预算设置卡：两输入框（token 上限/并发上限）+ 保存；越界 fail-loud 表单
// 错误；保存成功即时生效并回填。说明文字人话化（无内部词）。
function buildBudgetSettings(el, s, actions) {
  const form = s.budgetForm !== null && typeof s.budgetForm === 'object' ? s.budgetForm : {}
  return el('div', null,
    el('div', { className: 'sap-candidateSettingsPanel' },
      el('div', { className: 'sap-candidateSettingsField' },
        el('span', { className: 'sap-fieldLabel' }, ZH.budgetTokensLabel),
        el('input', { className: 'sap-input', value: form.maxParentTokens ?? '', placeholder: '500000', onChange: actions.setBudgetTokens })),
      el('div', { className: 'sap-candidateSettingsField' },
        el('span', { className: 'sap-fieldLabel' }, ZH.budgetConcurrentLabel),
        el('input', { className: 'sap-input', value: form.maxConcurrent ?? '', placeholder: '8', onChange: actions.setBudgetConcurrent })),
      form.error !== '' ? el('p', { className: 'sap-warn', role: 'alert' }, form.error) : null,
      el('div', { className: 'sap-candidateSettingsActions' },
        el('button', { type: 'button', className: 'sap-primaryButton', onClick: actions.saveBudget }, ZH.budgetSave))
    ),
    el('p', { className: 'sap-desc' }, ZH.budgetExplain)
  )
}

// ── 纯函数：api / 样式注入 / 文案映射 ──────────────────────────────────────

// loopback HTTP，host 侧服务 /subagent-profiles/*。
async function api(path, payload) {
  const init = payload === undefined
    ? undefined
    : {
        method: 'POST',
        // 写请求带 CSRF 三件套里的 Content-Type + 自定义头（Origin 由浏览器自动带）。
        // 缺自定义头会被 host 侧写路由 CSRF 守卫 403 拒绝。
        headers: { 'Content-Type': 'application/json', 'X-DSH-Plugin': 'dsh-subagent-profile' },
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

function ensureStyles() {
  const tagId = 'dsh-subagent-profile/ProfilesSection.css'
  if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') !== null) return
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-subagent-profile'
  style.dataset.pluginCss = tagId
  style.textContent = CSS
  document.head.appendChild(style)
}

const effortZh = (id) => {
  if (id === undefined || id === null || id === '') return ZH.inherit
  if (id === '(default)') return ZH.effortDefault
  if (id === '(parent)' || id === 'undefined') return ZH.inherit
  return EFFORT_ZH[id] ? `${EFFORT_ZH[id]}（${id}）` : id
}
const presetZh = (v) => (v === 'inherit' ? ZH.inherit : (typeof v === 'string' && v !== '' ? v : ZH.inherit))
const profileZh = (v) => (v === undefined || v === '' || v === '(inline)' ? ZH.inlineProfile : v)
// profile id → 中文显示名：注册表有 name 时「标准编码（swap-standard）」中英双表达，
// 无 name（自定义方案可能只填了 description）时回退纯 id。技术标识 id 恒保留。
function profileDisplay(profileId, profileNames) {
  if (profileId === undefined || profileId === '' || profileId === '(inline)') return ZH.inlineProfile
  const name = profileNames !== undefined && profileNames !== null ? profileNames[profileId] : undefined
  return typeof name === 'string' && name !== '' ? `${name}（${profileId}）` : profileId
}
const rawOrInherit = (v) => (v === '(parent)' ? ZH.inherit : (typeof v === 'string' && v !== '' ? v : ZH.inherit))

// ── 省 token 证据（client 侧反事实对照）─────────────────────────
// 与 host 侧 lib/core/cost-evidence.mjs 同源同价（估算、非精确计费）；只读展示。
const CLIENT_MODEL_AVG_COST = { 'deepseek-v4-flash': 0.0039, 'deepseek-v4-pro': 0.0104 }
const clientPriceKey = (model) => {
  if (typeof model !== 'string' || model === '') return undefined
  const m = model.trim().toLowerCase()
  if (CLIENT_MODEL_AVG_COST[m] !== undefined) return m
  if (m.includes('flash')) return 'deepseek-v4-flash'
  if (m.includes('pro')) return 'deepseek-v4-pro'
  return undefined
}
const clientAvgCost = (model) => {
  const key = clientPriceKey(model)
  return key === undefined ? undefined : CLIENT_MODEL_AVG_COST[key]
}
// 单条派发的估算成本（元）。trace 已归一；请求值 requested.model 才是「显式选了什么」，
// effective.model 会把继承父会话模型名写进去，不能用于判定继承。
function traceCostInfo(trace) {
  if (!trace) return null
  const requestedModel = trace.requested && typeof trace.requested.model === 'string' ? trace.requested.model : ''
  const parentModel = trace.parentContext && typeof trace.parentContext.parentModel === 'string' ? trace.parentContext.parentModel : ''
  if (requestedModel === '') {
    const actual = clientAvgCost(parentModel)
    if (actual === undefined) return null
    return { inherit: true, actual, counterfactual: actual, saving: 0, ratio: null }
  }
  const actual = clientAvgCost(requestedModel)
  const counterfactual = clientAvgCost(parentModel)
  if (actual === undefined || counterfactual === undefined) return null
  const saving = Number((counterfactual - actual).toFixed(6))
  return { inherit: false, actual, counterfactual, saving, ratio: actual > 0 ? Number((counterfactual / actual).toFixed(2)) : null }
}
function recordCostInfo(record) {
  return traceCostInfo(record && record.trace)
}

// 供 ② 决策段与行摘要 chip 使用；所有判定只读 trace 记录面，不做模型偏好推断。
function auditModelChoice(trace) {
  if (!trace) return []
  const requested = trace.requested || {}
  const effective = trace.effective || {}
  const out = []
  const profile = typeof requested.profile === 'string' && requested.profile !== '' && requested.profile !== '(inline)' ? requested.profile : ''
  const snapshot = Array.isArray(requested.profiles_snapshot) ? requested.profiles_snapshot : []
  if (profile !== '' && snapshot.length > 0 && !snapshot.some((e) => e && e.id === profile)) {
    out.push({ key: 'outside-snapshot', label: '快照外选择', title: '请求的方案不在记录面目录快照内（可能被截断或已变更）' })
  }
  const requestedModel = typeof requested.model === 'string' && requested.model !== '' ? requested.model : ''
  const effectiveModel = typeof effective.model === 'string' && effective.model !== '' ? effective.model : ''
  if (requestedModel !== '' && effectiveModel !== '' && requestedModel !== effectiveModel) {
    out.push({ key: 'rewritten', label: '请求被改写', title: '请求模型与生效模型不一致（命中即 bug 信号）' })
  }
  const info = traceCostInfo(trace)
  if (info && !info.inherit && info.actual !== undefined) {
    const cheaper = snapshot.find((e) => e && typeof e.avgCost === 'number' && Number.isFinite(e.avgCost) && e.avgCost < info.actual * 0.7)
    if (cheaper !== undefined) {
      out.push({ key: 'cheaper-available', label: '更便宜候选可用', title: '目录内存在成本低 30% 以上的候选方案（仅供参考）' })
    }
  }
  return out
}

const effortLabel = (effort) => {
  const id = effort && effort.id
  return EFFORT_ZH[id] ? `${EFFORT_ZH[id]}（${id}）` : (effort && effort.name) || id
}

// 不同 provider 列表，由模型列表派生。
function deriveProviders(models) {
  const providers = []
  const seenProvider = new Set()
  for (const model of models) {
    if (seenProvider.has(model.provider)) continue
    seenProvider.add(model.provider)
    providers.push({ id: model.provider, name: model.providerName || model.provider })
  }
  return providers
}

// provider 由 model 一对一派生（不可独立编辑）：返回选中 model 的 { id, name }；
// 未选中/未知 model 返回 null（调用方回退表单存量 provider 值照常展示）。
function providerOfModel(models, modelId) {
  if (typeof modelId !== 'string' || modelId === '') return null
  const model = Array.isArray(models) ? models.find((m) => m && m.id === modelId) : undefined
  if (model === undefined) return null
  const entry = deriveProviders(models).find((p) => p.id === model.provider)
  return entry !== undefined ? entry : { id: model.provider, name: model.provider }
}

// ── 纯函数：dispatch 块解析 ────────────────────────────────────────────────

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
    // unparsable argsRaw：保持默认（继承父会话 / 未存方案）。
  }
  return out
}

// 结果 meta（生效值）：宿主 render 行（"[dispatch] …"）是持久回放的唯一
// 生效值来源——结构化 value 只存在于执行局部（dsh-tools 约定）。output.presentationMeta
// 现投影 decisionTrace（block.meta 承载决策轨迹，非生效值），生效值仍需从 render 行解析。
// 解析成功返回 {kind, id, fields, ignored}；任何一步不符预期返回 null，调用方回退请求值。
const DISPATCH_RESULT_KEYS = ['profile', 'preset', 'provider', 'model', 'reasoningEffort', 'tokenTier', 'childTotalTokens', 'childUsage', 'elapsedMs', 'stopReason']
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
    if (value === 'undefined') value = ''   // 旧版把该字段渲染为字面 undefined，此处归一为空
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


// 生效画像一行（派发卡片/台账行展示）：优先 B3 交付的 meta.imageText（后端同源
// 格式，；分隔转 UI 的 · 分隔、路由段加「模型」前缀）；旧结果无 imageText 时按
// 生效字段同格式合成。未绑定方案 → 「继承父方案 · …」；两者都不可得返回空串
// （不渲染该行）。fail-soft：坏输入绝不 throw。
function imageTextOfBlock(meta, eff) {
  const e = eff && typeof eff === 'object' ? eff : {}
  const m = meta && typeof meta === 'object' ? meta : {}
  let base = typeof m.imageText === 'string' && m.imageText !== '' ? m.imageText : ''
  if (base === '') {
    const profile = typeof e.profile === 'string' && e.profile !== '' && e.profile !== '(inline)' ? e.profile : ''
    const provider = typeof e.provider === 'string' && e.provider !== '' && e.provider !== '(parent)' ? e.provider : ''
    const model = typeof e.model === 'string' && e.model !== '' && e.model !== '(parent)' ? e.model : ''
    const route = provider !== '' && model !== '' ? provider + '/' + model : '继承父'
    const tier = typeof m.tokenTier === 'string' && m.tokenTier !== '' ? m.tokenTier : 'balanced'
    base = profile !== '' ? `方案 ${profile}；${route}；档位 ${tier}` : `继承父方案；${route}；档位 ${tier}`
  }
  const parts = base.split('；').map((p) => p.trim()).filter((p) => p !== '')
  if (parts.length >= 2) parts[1] = '模型 ' + parts[1]
  return parts.join(' · ')
}

// 结算数字提取：token 值优先取真实计费五段总和（input+缓存读+缓存写+output，
// 与「缓存命中 M」同源），无 usage 回退 tokenMeter 估算；real 标记依值源决定
// 摘要行是否带 ≈。tokens 不可得返回 null。
function summaryNumbersOf(result, block) {
  const usage = usageFrom(result, block)
  if (usage !== null) {
    let sum = null
    for (const key of ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']) {
      if (typeof usage[key] === 'number' && Number.isFinite(usage[key]) && usage[key] >= 0) sum = (sum ?? 0) + usage[key]
    }
    if (sum !== null) return { tokens: sum, real: true }
  }
  let tokens = null
  if (result && result.fields && result.fields.childTotalTokens !== undefined && result.fields.childTotalTokens !== '') {
    const n = typeof result.fields.childTotalTokens === 'number' ? result.fields.childTotalTokens : Number(result.fields.childTotalTokens)
    if (Number.isFinite(n)) tokens = n
  } else if (block && block.meta && typeof block.meta === 'object' && block.meta.childTotalTokens !== undefined) {
    const n = typeof block.meta.childTotalTokens === 'number' ? block.meta.childTotalTokens : Number(block.meta.childTotalTokens)
    if (Number.isFinite(n)) tokens = n
  }
  return { tokens, real: false }
}

// 耗时 + 结束原因提取：键名中文「耗时 X / 结束原因：Y」，
// 时间单位规则（≥1s 秒一位小数，<1s 毫秒）由 formatDurationMs 统一。
function summaryObservablesOf(result, block) {
  let elapsedRaw = null
  let stopRaw = null
  if (result && result.fields) {
    if (result.fields.elapsedMs !== undefined && result.fields.elapsedMs !== '') elapsedRaw = result.fields.elapsedMs
    if (result.fields.stopReason !== undefined && result.fields.stopReason !== '') stopRaw = result.fields.stopReason
  } else if (block && block.meta && typeof block.meta === 'object') {
    if (block.meta.elapsedMs !== undefined) elapsedRaw = block.meta.elapsedMs
    if (block.meta.stopReason !== undefined) stopRaw = block.meta.stopReason
  }
  const ms = typeof elapsedRaw === 'number' ? elapsedRaw : (typeof elapsedRaw === 'string' && elapsedRaw !== '' ? Number(elapsedRaw) : NaN)
  const stopZh = typeof stopRaw === 'string' ? (ZH.stopReasonZh[stopRaw] || stopRaw) : ''
  return { ms: Number.isFinite(ms) ? ms : null, stopZh }
}

// dispatch 卡片摘要行：分隔符统一「·」、键名中文、缓存命中并入
// token 括号、成本前缀「成本 ≈X 元」、括号单层不嵌套；拒绝时走拒绝分支。
function dispatchSummaryText(request, result, block, trace, kindLabel) {
  const usage = usageFrom(result, block)
  const numbers = summaryNumbersOf(result, block)
  const cacheRead = usage && typeof usage.cacheReadTokens === 'number' && usage.cacheReadTokens > 0 ? usage.cacheReadTokens : 0
  const rejected = trace !== null && Array.isArray(trace.gates) && trace.gates.some((g) => g && g.verdict === 'fail')
  if (rejected) {
    const gate = trace.gates.find((g) => g && g.verdict === 'fail')
    const reason = gate && typeof gate.reason === 'string' && gate.reason !== '' ? gate.reason : ZH.ledgerReject
    return [ZH.toolLabel, ZH.ledgerReject + '：' + reason, ZH.ledgerRejectFix + '：' + gateFixHint(gate ? gate.name : '')].join(' · ')
  }
  const parts = [ZH.toolLabel + ' · ' + kindLabel]
  if (numbers.tokens !== null) parts.push((numbers.real ? '' : '≈') + numbers.tokens + ' tokens' + (cacheRead > 0 ? '（' + ZH.cacheHit + ' ' + cacheRead + '）' : ''))
  const obs = summaryObservablesOf(result, block)
  if (obs.ms !== null) parts.push(ZH.ledgerElapsed + ' ' + formatDurationMs(obs.ms))
  if (obs.stopZh !== '') parts.push(ZH.ledgerStopReason + '：' + obs.stopZh)
  const info = traceCostInfo(trace)
  if (info !== null) {
    if (info.inherit) parts.push(ZH.costEstimated + ' ≈' + info.actual + ' 元 · ' + ZH.inheritModelShort)
    else parts.push(ZH.costEstimated + ' ≈' + info.actual + ' 元（' + ZH.ledgerCostCardCounter + ' ≈' + info.counterfactual + ' 元 · ' + ZH.ledgerCostCardSave + ' ≈' + info.saving + ' 元）')
  }
  return parts.join(' · ')
}

// 卡片安全检查行（差异驱动）：全过「安全检查 ✅」单徽标；失败展开具体项
// （如「安全检查：交集非空 ❌ 为空」）；审批不豁免并入五项徽标，不再单列。
function safetyLineText(trace) {
  if (!trace || !Array.isArray(trace.gates) || trace.gates.length === 0) return ''
  const names = ['whitelist', 'cost', 'intersection', 'approval', 'budget']
  const found = names.map((n) => trace.gates.find((g) => g && g.name === n)).filter((g) => g !== undefined)
  if (found.length === 0) return ''
  const failed = found.filter((g) => g.verdict === 'fail')
  if (failed.length > 0) {
    return ZH.ledgerSafetyBadge + '：' + failed.map((g) => (ZH.ledgerGateBadgeZh[g.name] || g.name) + ' ❌ ' + (typeof g.reason === 'string' && g.reason !== '' ? g.reason : '')).join(' · ')
  }
  return ZH.ledgerSafetyBadge + ' ✅'
}

// 卡片工具行：continuable 有真实交集时显示数量（工具 34 → 32，剔
// run_code）；非 continuable 诚实降级「工具由系统最终授予」。
function toolLineText(request, trace) {
  const effective = trace && trace.effective
  const count = effective && Number.isFinite(effective.effectiveToolCount) ? effective.effectiveToolCount : null
  if (request && request.continuable) {
    const allow = request.toolFilter && Array.isArray(request.toolFilter.allow) ? request.toolFilter.allow : null
    if (allow !== null) {
      const granted = trace && Array.isArray(trace.gates)
        ? trace.gates.find((g) => g && g.name === 'intersection' && g.output && Number.isFinite(g.output.effectiveAllowCount))
        : null
      const m = granted && granted.output ? granted.output.effectiveAllowCount : allow.length
      return ZH.toolAllowlist + ' ' + allow.length + ' → ' + m + '（剔 run_code）'
    }
    return ZH.toolHostNarrow
  }
  if (count !== null) return ZH.toolAllowlist + ' ' + count
  return ZH.toolHostNarrow
}

// 详情 token 行：前缀「Token：」定义单位域，数字不带单位；
// 缓存读统一为「缓存命中」。
function usageDetailText(usage) {
  if (usage === null || typeof usage !== 'object') return ''
  const parts = []
  const push = (label, value) => {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) parts.push(label + ' ' + value)
  }
  push(ZH.usageInput, usage.inputTokens)
  push(ZH.usageOutput, usage.outputTokens)
  push(ZH.cacheHit, usage.cacheReadTokens)
  push(ZH.usageReasoning, usage.reasoningTokens)
  return parts.length > 0 ? ZH.tokenDetailPrefix + parts.join(' · ') : ''
}
// 把 childUsage 的（render 行 JSON 字符串或 block.meta 对象）归一为五段对象；
// 非 object / 非 number 段忽略，无任何有效段返回 null。可选字段（缓存读/写/推理）
// 缺值省略键，与 host 侧 collectChildUsage 输出对齐。
function parseChildUsage(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  let usage = raw
  if (typeof raw === 'string') {
    try { usage = JSON.parse(raw) } catch { return null }
  }
  if (typeof usage !== 'object' || Array.isArray(usage)) return null
  const out = {}
  let any = false
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
    const value = usage[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      out[key] = value
      any = true
    }
  }
  return any ? out : null
}

// 读取真实计费五段分解：result.fields.childUsage（render 行 JSON 串）优先，回退
// block.meta.childUsage（对象，向前兼容旧结果/未来 presentationMeta 投射）。
function usageFrom(result, block) {
  if (result && result.fields && result.fields.childUsage !== undefined && result.fields.childUsage !== '') {
    const parsed = parseChildUsage(result.fields.childUsage)
    if (parsed !== null) return parsed
  }
  if (block && block.meta && typeof block.meta === 'object' && block.meta.childUsage !== undefined) {
    return parseChildUsage(block.meta.childUsage)
  }
  return null
}

// 五段分解行文案（纯函数，供卡片详情区渲染）；无任何有效段返回空串。
function usageBreakdownText(usage) {
  if (usage === null || typeof usage !== 'object') return ''
  const parts = []
  const push = (label, value) => {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) parts.push(`${label} ${value}`)
  }
  push(ZH.usageInput, usage.inputTokens)
  push(ZH.usageOutput, usage.outputTokens)
  push(ZH.usageCacheRead, usage.cacheReadTokens)
  push(ZH.usageCacheWrite, usage.cacheWriteTokens)
  push(ZH.usageReasoning, usage.reasoningTokens)
  return parts.join(' · ')
}

// ── 纯函数：派发决策台账数据层（快照遍历 / 轨迹归一 / 汇总统计 / 失败合并）────

// 把 string|number 归一为有限数，不可得返回 null（汇总与行级数字的统一口径）。
function toFiniteNumber(v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN)
  return Number.isFinite(n) ? n : null
}

// 非数组对象守卫：对象原样返回，其它（null/数组/原始值）返回空对象。
function asObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

// 从 result 内容块取首行文本（只取第一块非空文本，无文本返回空串）。
function firstContentLine(content) {
  if (!Array.isArray(content)) return ''
  for (const item of content) {
    if (item && typeof item === 'object' && typeof item.text === 'string' && item.text !== '') {
      return item.text.split('\n')[0] ?? ''
    }
  }
  return ''
}

// argsRaw 摘要：dispatch 参数为单行 JSON，取首行即完整摘要；空/坏返回空串。
function summarizeArgsRaw(argsRaw) {
  if (typeof argsRaw !== 'string' || argsRaw === '') return ''
  return argsRaw.split('\n')[0] ?? ''
}

// gate 条目归一：只保留渲染需要的五字段，name/verdict/reason 逐字段 typeof 守卫、
// 缺失补空串；input/output 缺省为空对象；非对象条目整条丢弃。
function normalizeGateEntries(gates) {
  if (!Array.isArray(gates)) return []
  const out = []
  for (const gate of gates) {
    if (gate === null || typeof gate !== 'object' || Array.isArray(gate)) continue
    out.push({
      name: typeof gate.name === 'string' ? gate.name : '',
      input: asObject(gate.input),
      output: asObject(gate.output),
      verdict: typeof gate.verdict === 'string' ? gate.verdict : '',
      reason: typeof gate.reason === 'string' ? gate.reason : ''
    })
  }
  return out
}

// decisionTrace 归一：坏数据/缺字段 fail-soft（逐段 typeof 守卫，不 throw）。
// 非对象或无任何可识别 shape（version/startedAt/gates 三者皆缺）返回 null；
// 各段缺失补空对象，settled 缺省为 null（区分「未结算」与「结算但为空」）。
function normalizeDecisionTrace(raw) {
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (typeof raw.version !== 'number' && typeof raw.startedAt !== 'number' && !Array.isArray(raw.gates)) return null
  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : null,
    parentContext: asObject(raw.parentContext),
    requested: asObject(raw.requested),
    gates: normalizeGateEntries(raw.gates),
    effective: asObject(raw.effective),
    execution: asObject(raw.execution),
    settled: raw.settled && typeof raw.settled === 'object' && !Array.isArray(raw.settled) ? raw.settled : null
  }
}

// 从 tool-result 节点读决策轨迹：宿主 presentationMeta 把 decisionTrace 直接投影为
// 节点 meta（meta 即 trace 本身）；同时兼容未来包一层 .decisionTrace 的形态，
// 两种都尝试、绝不 throw。
function readNodeTrace(node) {
  const meta = node && typeof node === 'object' ? node.meta : null
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return null
  const direct = normalizeDecisionTrace(meta)
  if (direct !== null) return direct
  if (meta.decisionTrace && typeof meta.decisionTrace === 'object' && !Array.isArray(meta.decisionTrace)) {
    return normalizeDecisionTrace(meta.decisionTrace)
  }
  return null
}

// ── 子会话页头 banner（层 1）─────────────────────────────────────

// 从父会话快照节点解析该子会话的 preset（本插件自产 dispatch 节点，零 host 依赖）：
// 按 decisionTrace.execution.childSessionId 匹配，读生效值 preset；解析不到返回 null（显「继承父会话」）。
function parentDispatchPresetOf(parentNodes, childSessionId) {
  if (!Array.isArray(parentNodes) || typeof childSessionId !== 'string' || childSessionId === '') return null
  for (const node of parentNodes) {
    if (!node || typeof node !== 'object' || node.kind !== 'tool-result') continue
    if (!node.call || typeof node.call !== 'object' || node.call.name !== 'dispatch') continue
    const trace = readNodeTrace(node)
    const execChild = trace !== null && trace.execution !== null && typeof trace.execution === 'object' && typeof trace.execution.childSessionId === 'string' ? trace.execution.childSessionId : ''
    if (execChild !== childSessionId) continue
    const result = readDispatchResult(node)
    const preset = result !== null && result.fields !== null && typeof result.fields === 'object' && typeof result.fields.preset === 'string' && result.fields.preset !== '' ? result.fields.preset : ''
    return preset !== '' ? preset : 'inherit'
  }
  return null
}

// 从父会话快照节点解析该子会话的派发模式（前台/后台/持久）：按
// decisionTrace.execution.childSessionId 匹配 execution.kind；后台派发在父 trace
// 无 childSessionId，匹配不到返回 null（调用方经 /ledger/jobs 兜底识别）。
function parentDispatchKindOf(parentNodes, childSessionId) {
  if (!Array.isArray(parentNodes) || typeof childSessionId !== 'string' || childSessionId === '') return null
  for (const node of parentNodes) {
    if (!node || typeof node !== 'object' || node.kind !== 'tool-result') continue
    if (!node.call || typeof node.call !== 'object' || node.call.name !== 'dispatch') continue
    const trace = readNodeTrace(node)
    const execution = trace !== null && trace.execution !== null && typeof trace.execution === 'object' ? trace.execution : null
    const execChild = execution !== null && typeof execution.childSessionId === 'string' ? execution.childSessionId : ''
    if (execChild !== childSessionId) continue
    const kind = execution !== null && typeof execution.kind === 'string' ? execution.kind : ''
    return kind === 'continuable' ? 'continuable' : (kind === 'background' ? 'background' : 'foreground')
  }
  return null
}

// banner 数据装载（副作用助手）：preset/模式解析自父会话快照，model/effort 订阅每会话
// 共享目录 store（ModelDirectoryResolver，宿主唯一事实源）；均 fail-soft，不可得显
// 「继承父会话」。后台派发父 trace 无 childSessionId 匹配时，经 /ledger/jobs 按子会话 id 兜底。
function loadSubagentBanner(subagent, sessionId, setParentPreset, setModelState, getModelDirectories, getSessions, setBannerMode) {
  const address = subagent.address !== null && typeof subagent.address === 'object' ? subagent.address : {}
  const parentId = typeof address.parentSessionId === 'string' ? address.parentSessionId : ''
  const childSessionId = typeof address.childSessionId === 'string' ? address.childSessionId : ''
  try {
    const parent = getSessions().binding(parentId)
    const nodes = parent !== undefined && parent !== null && parent.session !== undefined ? parent.session.chat?.legacy?.nodes : undefined
    setParentPreset(parentDispatchPresetOf(nodes, childSessionId) ?? '')
    const kind = parentDispatchKindOf(nodes, childSessionId)
    if (kind !== null) setBannerMode(kind)
    else if (parentId !== '' && childSessionId !== '') {
      api('/ledger/jobs?session=' + encodeURIComponent(parentId)).then((data) => {
        const jobs = Array.isArray(data.jobs) ? data.jobs : []
        if (jobs.some((job) => job !== null && typeof job === 'object' && job.childSessionId === childSessionId)) setBannerMode('background')
      }).catch(() => {})
    }
  } catch { setParentPreset('') }
  try {
    const directories = getModelDirectories()
    if (directories === undefined || directories === null || typeof directories.directoryFor !== 'function') { setModelState(null); return undefined }
    const dir = directories.directoryFor(sessionId)
    const store = dir !== null && typeof dir === 'object' && dir.store !== null && typeof dir.store === 'object' ? dir.store : null
    if (store === null || typeof store.getSnapshot !== 'function') { setModelState(null); return undefined }
    setModelState(store.getSnapshot())
    return typeof store.subscribe === 'function' ? store.subscribe(() => setModelState(store.getSnapshot())) : undefined
  } catch { setModelState(null); return undefined }
}

// banner 模式短词：持久/后台/前台（fail-soft，未知值按前台）。
function bannerModeText(mode) {
  if (mode === 'continuable') return ZH.bannerModePersistent
  if (mode === 'background') return ZH.modeBackground
  return ZH.modeForeground
}

function bannerModelText(model) {
  return model !== '' ? model : ZH.bannerInheritValue
}

function bannerEffortText(effort) {
  if (effort === '') return ZH.bannerInheritValue
  return EFFORT_ZH[effort] !== undefined ? EFFORT_ZH[effort] : effort
}

function bannerPresetText(preset) {
  return preset !== '' && preset !== 'inherit' ? presetZh(preset) : ZH.bannerInheritValue
}

// 摘要：全继承场景固定「继承父会话 · 模式」；有值场景按「模型 · 强度 · 模式」摘要。
function bannerSummaryText(model, effort, preset, mode) {
  const inherited = model === '' && effort === '' && (preset === '' || preset === 'inherit')
  if (inherited) return ZH.bannerInheritValue + ' · ' + bannerModeText(mode)
  return [bannerModelText(model), bannerEffortText(effort), bannerModeText(mode)].join(' · ')
}

// title 全量详情（原生多行悬停）：模型/推理强度/预设/模式/来源（完整父会话 id）。
function bannerTitleText(model, effort, preset, mode, parentId) {
  return [
    ZH.chipModel + '：' + bannerModelText(model),
    ZH.chipEffort + '：' + bannerEffortText(effort),
    ZH.chipPreset + '：' + bannerPresetText(preset),
    ZH.chipMode + '：' + bannerModeText(mode),
    ZH.bannerOriginTitle + (parentId !== '' ? '（' + parentId + '）' : '')
  ].join('\n')
}

// banner 渲染：单一摘要标签 + title 全量详情。标签上限 260px 且 ellipsis，任何窗口
// 宽度下宿主 Session log/返回按钮完整可见；来源不再单独渲染常驻行。
function buildSubagentBanner(el, subagent, parentPreset, modelState, bannerMode) {
  const current = modelState !== null && typeof modelState === 'object' && modelState.current !== null && typeof modelState.current === 'object' ? modelState.current : null
  const model = current !== null && current !== undefined && typeof current.model === 'string' ? current.model : ''
  const effort = current !== null && current !== undefined && typeof current.reasoningEffort === 'string' ? current.reasoningEffort : ''
  const address = subagent.address !== null && typeof subagent.address === 'object' ? subagent.address : {}
  const addressMode = typeof address.mode === 'string' && address.mode !== '' ? address.mode : 'one-shot'
  const mode = bannerMode !== '' ? bannerMode : addressMode
  const parentId = typeof address.parentSessionId === 'string' ? address.parentSessionId : ''
  return el('div', { className: 'sap-subagentBanner' },
    el('span', { className: 'sap-subagentBannerTag', title: bannerTitleText(model, effort, parentPreset, mode, parentId) },
      bannerSummaryText(model, effort, parentPreset, mode)
    )
  )
}

// ── 提醒系统 ─────────────────────────────────────────────────────

// 通知中心（设置页通知与提醒页签）：读 /reminders（与审计同源 host store），全动作
// （标记已读/采纳/忽略/拒绝/关闭）经 POST 回写 host 并刷新——一条提醒 = 一条审计记录。
// sessions 服务供条目主/子会话标题查询与跳转；跳转失败静默（设置页不被导航异常打断）。
// 归档视图每页条数（防大量已处理条目一次性渲染卡 UI）。
const ARCHIVED_PAGE_SIZE = 20

function makeReminderCenter(el, useState, useEffect, openChild, getSessions) {
  function ReminderCenter(props) {
    const [reminders, setReminders] = useState([])
    const [error, setError] = useState('')
    const [archived, setArchived] = useState({ open: false, list: [], total: 0, offset: 0, loading: false })
    const refresh = () => {
      api('/reminders').then((data) => setReminders(Array.isArray(data.reminders) ? data.reminders : [])).catch(() => {})
    }
    useEffect(() => { refresh() }, [])
    const act = (id, action) => () => {
      setError('')
      const request = action === 'ack' ? api('/reminders/ack', { ids: [id] }) : api('/reminders/action', { id, action })
      request.then(refresh).catch((err) => setError(String((err && err.message) || err)))
    }
    // 归档视图分页加载：打开时取第一页，「加载更早」按 offset 追加（存储只读）。
    const loadArchivedPage = (offset) => {
      setArchived((prev) => ({ ...prev, loading: true }))
      api('/reminders/archived?offset=' + offset + '&limit=' + ARCHIVED_PAGE_SIZE)
        .then((data) => {
          const rows = Array.isArray(data.reminders) ? data.reminders : []
          setArchived((prev) => ({ ...prev, loading: false, total: typeof data.total === 'number' ? data.total : prev.total, offset, list: offset === 0 ? rows : [...prev.list, ...rows] }))
        })
        .catch(() => setArchived((prev) => ({ ...prev, loading: false })))
    }
    const toggleArchived = () => {
      const nextOpen = !archived.open
      setArchived((prev) => ({ ...prev, open: nextOpen }))
      if (nextOpen && archived.list.length === 0) loadArchivedPage(0)
    }
    const jumpToAdvice = props !== null && typeof props === 'object' && typeof props.jumpToAdvice === 'function' ? props.jumpToAdvice : null
    return buildReminderCenter(el, reminders, error, act, getSessions(), openChild, jumpToAdvice, archived, toggleArchived, loadArchivedPage)
  }
  return ReminderCenter
}

// 归档视图区：折叠开关（总条数）+ 只读行列表（已处理条目复渲染）+ 加载更早。
function buildArchivedReminderSection(el, archived, act, sessions, openChild, jumpToAdvice, toggleArchived, loadArchivedPage) {
  const rows = Array.isArray(archived.list) ? archived.list : []
  const hasMore = archived.list.length < archived.total
  return el('details', { className: 'sap-customized sap-customizedArrowEnd sap-reminderHandled', open: archived.open === true },
    el('summary', { className: 'sap-customizedSummary', onClick: toggleArchived }, '已归档（' + archived.total + '）', el('span', { className: 'sap-customizedEndArrow' }, '▸')),
    el('div', { className: 'sap-customizedBody' },
      rows.length === 0
        ? el('p', { className: 'sap-desc' }, ZH.reminderArchivedEmpty)
        : [
            el('ul', { className: 'sap-rows' }, rows.map((r) => buildReminderRow(el, r, act, sessions, openChild, jumpToAdvice))),
            hasMore
              ? el('button', { type: 'button', className: 'sap-secondaryButton', style: smallBtn, disabled: archived.loading === true, onClick: () => loadArchivedPage(archived.offset + ARCHIVED_PAGE_SIZE) }, ZH.reminderArchivedMore)
              : null
          ]
    )
  )
}

// 提醒中心分层：未终态条目（action 为空）进默认列表；已终态条目折叠为「已处理（N）」
// 可展开区（原生 details，展开后仍按现有行渲染并保留已处理标注，可追溯）；归档后的
// 条目进入「已归档（N）」只读分页视图（存储与审计保留）。审计留痕由 host 侧动作回写。
function buildReminderCenter(el, reminders, error, act, sessions, openChild, jumpToAdvice, archived, toggleArchived, loadArchivedPage) {
  const handled = reminders.filter((r) => typeof r.action === 'string' && r.action !== '')
  const pending = reminders.filter((r) => !(typeof r.action === 'string' && r.action !== ''))
  const pendingList = pending.length > 0
    ? el('ul', { className: 'sap-rows' }, pending.map((r) => buildReminderRow(el, r, act, sessions, openChild, jumpToAdvice)))
    : null
  const handledList = handled.length > 0
    ? el('details', { className: 'sap-customized sap-customizedArrowEnd sap-reminderHandled' },
        el('summary', { className: 'sap-customizedSummary' }, '已处理（' + handled.length + '）', el('span', { className: 'sap-customizedEndArrow' }, '▸')),
        el('div', { className: 'sap-customizedBody' },
          el('ul', { className: 'sap-rows' }, handled.map((r) => buildReminderRow(el, r, act, sessions, openChild, jumpToAdvice)))
        )
      )
    : null
  const archivedSection = archived !== null && typeof archived === 'object'
    ? buildArchivedReminderSection(el, archived, act, sessions, openChild, jumpToAdvice, toggleArchived, loadArchivedPage)
    : null
  return el('div', { className: 'sap-card sap-cardStatic' },
    el('div', { className: 'sap-cardHead' },
      el('div', { className: 'sap-cardTitleBox' },
        el('div', { className: 'sap-cardTitle' }, ZH.reminderCenterTitle),
        el('div', { className: 'sap-cardDesc' }, ZH.reminderCenterDesc)
      )
    ),
    el('div', { className: 'sap-cardBody' },
      error !== '' ? el('p', { className: 'sap-notice' }, error) : null,
      pendingList === null && handledList === null
        ? el('p', { className: 'sap-desc' }, ZH.reminderEmpty)
        : [pendingList, handledList],
      archivedSection
    )
  )
}

// 提醒会话标识：非全局时截断前 8 位加省略号（悬停显示完整会话标识），避免长串撑破卡片。
function reminderSessionText(sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return { text: ZH.reminderGlobal, title: ZH.reminderGlobal }
  return { text: ZH.reminderSessionLabel + sessionId.slice(0, 8) + '…', title: sessionId }
}

// 会话标题查询：宿主 sessions 列表快照的 durable title 优先，其次 displayTitle
// （与 id 相同视为无标题）；快照缺失/异常返回空串（调用方退化 ID 截断）。
function reminderSessionTitle(sessions, id) {
  try {
    const summary = sessions.list.getSnapshot().byId[id]
    if (summary === undefined || summary === null) return ''
    if (typeof summary.title === 'string' && summary.title !== '') return summary.title
    const display = typeof summary.displayTitle === 'string' ? summary.displayTitle : ''
    return display !== '' && display !== id ? display : ''
  } catch {
    return ''
  }
}

// 主/子会话跳转行文案：有标题为「主会话 {标题} · id截断」，查不到退化为
// 「主会话 · id截断」；title 属性悬停显示完整 id。
function reminderJumpText(sessions, id, label) {
  const shortId = typeof id === 'string' && id !== '' ? id.slice(0, 8) + '…' : ''
  const title = reminderSessionTitle(sessions, id)
  const body = title !== '' ? title + ' · ' + shortId : shortId
  return { label, body, title: typeof id === 'string' ? id : '' }
}

// tracker 内部 mode → 宿主 SubagentAddress mode（前台/后台 one-shot 归一）。
function reminderChildMode(mode) {
  return mode === 'continuable' ? 'continuable' : 'one-shot'
}

// 未采纳条目结果行：stopReason 中文 · 耗时 · 估算成本；结算摘要缺失显示未结算。
function reminderResultText(r) {
  const settled = r.settled
  if (settled === null || typeof settled !== 'object') return ZH.reminderNoSettlement
  const parts = []
  const stop = typeof settled.stopReason === 'string' ? (ZH.stopReasonZh[settled.stopReason] || settled.stopReason) : ''
  if (stop !== '') parts.push(stop)
  const elapsed = formatDurationMs(settled.elapsedMs)
  if (elapsed !== '') parts.push(ZH.ledgerElapsed + ' ' + elapsed)
  const cost = typeof r.costEstimated === 'number' && Number.isFinite(r.costEstimated) ? '≈' + r.costEstimated + ' 元' : ''
  if (cost !== '') parts.push(cost)
  return parts.length > 0 ? parts.join(' · ') : ZH.reminderNoSettlement
}

function reminderFieldLine(el, label, value) {
  return el('p', { className: 'sap-reminderField' },
    el('span', { className: 'sap-reminderFieldLabel' }, label), ' ',
    el('span', { className: 'sap-reminderFieldValue' }, value)
  )
}

function reminderJumpButton(el, jump, disabled, onClick) {
  return el('button', { type: 'button', className: 'sap-reminderJump', title: jump.title, disabled: disabled === true, onClick },
    el('span', { className: 'sap-reminderFieldLabel' }, jump.label), ' ',
    el('span', { className: 'sap-reminderJumpText' }, jump.body)
  )
}

// 会话存在性探测（孤儿灰置）：跳转引用指向已删会话（binding 拿不到）时灰置跳转
// 按钮——回溯安全，不点进不可达会话。空 id/异常一律视为不可用（fail-soft）。
function sessionExists(sessions, id) {
  if (typeof id !== 'string' || id === '') return false
  try { return sessions.binding(id) !== undefined } catch { return false }
}

// 未采纳条目五字段区：主会话/子会话可点击跳转，任务/结果/说明只读展示。
function buildUnadoptedFields(el, r, sessions, openChild) {
  const childId = r.childSessionId !== null && r.childSessionId !== undefined && r.childSessionId !== '' ? r.childSessionId : r.childId
  const parentJump = reminderJumpText(sessions, r.sessionId, ZH.reminderParentLabel)
  const childJump = reminderJumpText(sessions, childId, ZH.reminderChildLabel)
  const parentGone = !sessionExists(sessions, r.sessionId)
  const childGone = !sessionExists(sessions, childId)
  const openParent = () => { try { sessions.open(r.sessionId) } catch { /* 会话不可用：静默 */ } }
  const childAddress = typeof r.sessionId === 'string' && r.sessionId !== '' && typeof r.childSessionId === 'string' && r.childSessionId !== ''
    ? { parentSessionId: r.sessionId, childSessionId: r.childSessionId, mode: reminderChildMode(r.childMode) }
    : null
  const jumpChild = () => { if (childAddress !== null) { try { openChild(childAddress) } catch { /* 子会话不可用：静默 */ } } }
  const excerpt = typeof r.promptExcerpt === 'string' && r.promptExcerpt !== '' ? '「' + r.promptExcerpt + '」' : ZH.reminderNoExcerpt
  return el('div', { className: 'sap-reminderFields' },
    reminderJumpButton(el, parentJump, parentGone, openParent),
    reminderJumpButton(el, childJump, childAddress === null || childGone, jumpChild),
    reminderFieldLine(el, ZH.reminderTaskLabel, excerpt),
    reminderFieldLine(el, ZH.reminderResultLabel, reminderResultText(r)),
    reminderFieldLine(el, ZH.reminderNoteLabel, r.detail)
  )
}

// 未采纳条目按钮三件套：查看子会话（跳转，恒保留）/ 标记已读（未读显示）/ 关闭。
// 已终态条目隐藏标记已读与关闭（只留只读跳转），防对终态条目重复处置产生重复审计；
// 提醒上的处置只改变提醒自身状态（已读/终态），不改变采纳判定——采纳与否由事件流自动汇总。
// 子会话已删（孤儿）时查看按钮灰置（回溯安全）。
function buildUnadoptedActions(el, r, act, childAddress, jumpChild, childGone) {
  const terminated = typeof r.action === 'string' && r.action !== ''
  return el('div', { className: 'sap-reminderActions' }, [
    el('button', { type: 'button', className: 'sap-detailToggle', disabled: childAddress === null || childGone === true, onClick: jumpChild }, ZH.reminderViewChild),
    terminated ? null : r.unread === true ? el('button', { type: 'button', className: 'sap-detailToggle', onClick: act(r.id, 'ack') }, ZH.reminderAck) : null,
    terminated ? null : el('button', { type: 'button', className: 'sap-dangerButton', onClick: act(r.id, 'dismiss') }, ZH.reminderDismiss)
  ])
}

// 未采纳提醒条目（完整版）：标题 + 五字段 + 按钮三件套 + 已处理标注。
function buildUnadoptedReminderRow(el, r, act, sessions, openChild) {
  const severityCls = r.severity === 'P0' ? 'sap-reminderP0' : 'sap-reminderP1'
  const severityText = r.severity === 'P0' ? '紧急' : '注意'
  const childId = r.childSessionId !== null && r.childSessionId !== undefined && r.childSessionId !== '' ? r.childSessionId : r.childId
  const childAddress = typeof r.sessionId === 'string' && r.sessionId !== '' && typeof r.childSessionId === 'string' && r.childSessionId !== ''
    ? { parentSessionId: r.sessionId, childSessionId: r.childSessionId, mode: reminderChildMode(r.childMode) }
    : null
  const childGone = !sessionExists(sessions, childId)
  const jumpChild = () => { if (childAddress !== null) { try { openChild(childAddress) } catch { /* 子会话不可用：静默 */ } } }
  return el('li', { key: String(r.id), className: 'sap-rowCard' + (r.unread === true ? ' sap-reminderUnread' : '') },
    el('div', { className: 'sap-reminderHead' },
      el('span', { className: 'sap-chip ' + severityCls }, severityText),
      el('span', { className: 'sap-reminderTitle', title: r.title }, r.title)
    ),
    buildUnadoptedFields(el, r, sessions, openChild),
    buildUnadoptedActions(el, r, act, childAddress, jumpChild, childGone),
    typeof r.action === 'string' && r.action !== ''
      ? el('p', { className: 'sap-metaValueDefault' }, ZH.reminderActed.replace('{action}', ZH.reminderActionZh[r.action] || r.action))
      : null
  )
}

// 回滚建议提醒行：标题/说明只读 + 「查看建议」跳转到自进化与建议页签（只读跳转，
// 无采纳/忽略按钮）；与通知类提醒同款「标记已读/关闭」。
function buildRollbackReminderRow(el, r, act, jumpToAdvice) {
  const severityCls = r.severity === 'P0' ? 'sap-reminderP0' : 'sap-reminderP1'
  const severityText = r.severity === 'P0' ? '紧急' : '注意'
  const jump = () => { if (typeof jumpToAdvice === 'function') { try { jumpToAdvice() } catch { /* 页签不可用：静默 */ } } }
  return el('li', { key: String(r.id), className: 'sap-rowCard' + (r.unread === true ? ' sap-reminderUnread' : '') },
    el('div', { className: 'sap-reminderHead' },
      el('span', { className: 'sap-chip ' + severityCls }, severityText),
      el('span', { className: 'sap-reminderTitle', title: r.title }, r.title)
    ),
    el('p', { className: 'sap-desc' }, r.detail),
    typeof r.action === 'string' && r.action !== ''
      ? null
      : el('div', { className: 'sap-reminderActions' }, [
        typeof jumpToAdvice === 'function' ? el('button', { type: 'button', className: 'sap-detailToggle', onClick: jump }, ZH.adviceReminderView) : null,
        r.unread === true ? el('button', { type: 'button', className: 'sap-detailToggle', onClick: act(r.id, 'ack') }, ZH.reminderAck) : null,
        r.severity !== 'P0' || r.unread !== true
          ? el('button', { type: 'button', className: 'sap-dangerButton', onClick: act(r.id, 'dismiss') }, ZH.reminderDismiss)
          : null
      ]),
    typeof r.action === 'string' && r.action !== ''
      ? el('p', { className: 'sap-metaValueDefault' }, ZH.reminderActed.replace('{action}', ZH.reminderActionZh[r.action] || r.action))
      : null
  )
}

// 通知类提醒行：P0 未读只保留「标记已读」（常驻至已读，不可跳过未读）；已读后出现
// 「关闭」（与 P1/P2 同）；P1/P2 恒保留「标记已读 / 关闭」。已终态条目隐藏动作按钮，
// 只显示已处理灰字标注（折叠区可追溯、防对终态条目误点产生重复审计）。
function buildReminderRow(el, r, act, sessions, openChild, jumpToAdvice) {
  if (r.kind === 'suggestion-rollback') return buildRollbackReminderRow(el, r, act, jumpToAdvice)
  if (r.kind === 'adoption-false') return buildUnadoptedReminderRow(el, r, act, sessions, openChild)
  const severityCls = r.severity === 'P0' ? 'sap-reminderP0' : 'sap-reminderP1'
  const severityText = r.severity === 'P0' ? '紧急' : '注意'
  const session = reminderSessionText(r.sessionId)
  return el('li', { key: String(r.id), className: 'sap-rowCard' + (r.unread === true ? ' sap-reminderUnread' : '') },
    el('div', { className: 'sap-reminderHead' },
      el('span', { className: 'sap-chip ' + severityCls }, severityText),
      el('span', { className: 'sap-reminderTitle', title: r.title }, r.title)
    ),
    el('div', { className: 'sap-reminderMeta', title: session.title }, session.text),
    el('p', { className: 'sap-desc' }, r.detail),
    typeof r.action === 'string' && r.action !== ''
      ? null
      : el('div', { className: 'sap-reminderActions' }, [
        r.unread === true ? el('button', { className: 'sap-detailToggle', onClick: act(r.id, 'ack') }, ZH.reminderAck) : null,
        r.severity !== 'P0' || r.unread !== true
          ? el('button', { className: 'sap-dangerButton', onClick: act(r.id, 'dismiss') }, ZH.reminderDismiss)
          : null
      ]),
    typeof r.action === 'string' && r.action !== ''
      ? el('p', { className: 'sap-metaValueDefault' }, ZH.reminderActed.replace('{action}', ZH.reminderActionZh[r.action] || r.action))
      : null
  )
}

// P0 角标（shell.overlay 根悬浮层）：红色常驻角标 + 未读 P0 数 + 最近一条的 session
// 标识；点击展开面板逐条「标记已读」。P0 三要件：①severity 上色（红）②常驻至已读
// （unread>0 恒渲染，绝不自动消失）③带 session 标识（全局异常显「全局」）。
// 高价值提醒无 toast（toast 只留写失败瞬态，本版不实现）。
function makeReminderOverlayBadge(el, useState, useEffect) {
  function ReminderOverlayBadge() {
    const [data, setData] = useState({ reminders: [], unread: 0 })
    const [open, setOpen] = useState(false)
    const refresh = () => {
      api('/reminders').then((d) => setData({ reminders: Array.isArray(d.reminders) ? d.reminders : [], unread: typeof d.unread === 'number' ? d.unread : 0 })).catch(() => {})
    }
    useEffect(() => {
      refresh()
      const timer = setInterval(refresh, 10000)
      return () => clearInterval(timer)
    }, [])
    const p0Unread = data.reminders.filter((r) => r.severity === 'P0' && r.unread === true)
    if (p0Unread.length === 0) return null
    const latest = p0Unread[0]
    const session = reminderSessionText(latest.sessionId)
    return el('div', { className: 'sap-overlayBadge' },
      el('button', { type: 'button', className: 'sap-overlayBadgeBtn', onClick: () => setOpen((prev) => !prev) }, ZH.reminderP0Badge.replace('{n}', String(p0Unread.length)) + ' · ' + session.text),
      open ? el('div', { className: 'sap-overlayPanel' },
        p0Unread.map((r) => el('div', { key: String(r.id), className: 'sap-overlayRow' },
          el('span', null, r.title + '（' + reminderSessionText(r.sessionId).text + '）'),
          el('button', { type: 'button', className: 'sap-detailToggle', onClick: () => { api('/reminders/ack', { ids: [r.id] }).then(refresh).catch(() => {}) } }, ZH.reminderAck)
        ))
      ) : null
    )
  }
  return ReminderOverlayBadge
}

// 子会话页头 utilities 组件（conversation.session.header.utilities 槽）：仅在子会话渲染。
// bannerMode 为空时回退地址 mode（one-shot/continuable）；父快照解析到的前台/后台/
// 持久模式优先，后台经 /ledger/jobs 兜底异步回填。
function makeSubagentHeaderUtility(el, useState, useEffect, getModelDirectories, getSessions) {
  function SubagentHeaderUtility({ useSession, sessionId }) {
    const subagent = useSession((s) => (s !== undefined && s !== null && s.subagent !== null && s.subagent !== undefined ? s.subagent : null))
    const [parentPreset, setParentPreset] = useState('')
    const [modelState, setModelState] = useState(null)
    const [bannerMode, setBannerMode] = useState('')
    useEffect(() => {
      if (subagent === null) return
      return loadSubagentBanner(subagent, sessionId, setParentPreset, setModelState, getModelDirectories, getSessions, setBannerMode)
    }, [subagent])
    if (subagent === null) return null
    return buildSubagentBanner(el, subagent, parentPreset, modelState, bannerMode)
  }
  return SubagentHeaderUtility
}

// 快照遍历：过滤 chat.legacy.nodes 中 kind==='tool-result' 且 call.name==='dispatch'
// 的节点，产出台账记录。记录携带 callId/time/isError/trace（已归一，null 即旧记录
// 降级 legacy）/request/result/argsSummary/contentFirstLine。输入为空或非数组返回
// 空数组；逐节点守卫、坏节点跳过。
// 派发节点前后的可见父文字（非 CoT）：向前/向后各取 1 条带文本的非 tool-result 节点，
// 用于「父消息（派发前/后）」上下文展示，不读取内部推理。
function surroundingText(nodes, index) {
  if (!Array.isArray(nodes)) return { before: '', after: '' }
  const pick = (dir) => {
    let i = index + dir
    while (i >= 0 && i < nodes.length) {
      const node = nodes[i]
      if (node && typeof node === 'object' && node.kind !== 'tool-result' && node.kind !== 'tool-call') {
        const text = firstContentLine(node.content)
        if (text !== '') return text.slice(0, 200)
      }
      i += dir
    }
    return ''
  }
  return { before: pick(-1), after: pick(1) }
}

// 台账 tab 后台任务 live 轮询的待配对 jobId：仅未结算的后台派发记录（前台/continuable
// /已结算不启动）。来自快照 trace.execution，无 jobId 忽略。
function pendingBackgroundJobIds(nodes) {
  const out = []
  for (const record of collectDispatchRecords(nodes)) {
    const trace = record && record.trace
    if (trace === null || trace === undefined || trace.execution === null || typeof trace.execution !== 'object' || trace.execution.kind !== 'background') continue
    if (trace.settled !== null && trace.settled !== undefined) continue
    const jobId = trace.execution !== null && typeof trace.execution.jobId === 'string' ? trace.execution.jobId : ''
    if (jobId !== '') out.push(jobId)
  }
  return out
}

function collectDispatchRecords(nodes) {
  if (!Array.isArray(nodes)) return []
  const records = []
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (!node || typeof node !== 'object') continue
    if (node.kind !== 'tool-result') continue
    if (!node.call || typeof node.call !== 'object' || node.call.name !== 'dispatch') continue
    const trace = readNodeTrace(node)
    if (trace !== null) trace.parentText = surroundingText(nodes, index)
    records.push({
      callId: typeof node.callId === 'string' ? node.callId : '',
      time: typeof node.time === 'number' ? node.time : (typeof node.callTime === 'number' ? node.callTime : null),
      isError: node.isError === true,
      legacy: trace === null,
      trace,
      request: readDispatchRequest(node),
      result: readDispatchResult(node),
      argsSummary: summarizeArgsRaw(node.call.argsRaw),
      contentFirstLine: firstContentLine(node.content),
      imageText: node.meta !== null && typeof node.meta === 'object' && typeof node.meta.imageText === 'string' ? node.meta.imageText : ''
    })
  }
  return records
}

// 从单条记录提取结算数字：trace.settled 优先，缺失回退 result.fields（旧记录口径）。
// 返回 { tokens, cacheRead, elapsedMs }；不可得字段为 null/0。
function recordNumbers(record) {
  let tokens = null
  let elapsedMs = null
  let cacheRead = 0
  const trace = record && record.trace
  const result = record && record.result
  const settled = trace && trace.settled
  if (settled) {
    tokens = toFiniteNumber(settled.childTotalTokens)
    elapsedMs = toFiniteNumber(settled.elapsedMs)
    if (settled.childUsage && typeof settled.childUsage.cacheReadTokens === 'number') cacheRead = settled.childUsage.cacheReadTokens
  }
  if (result && result.fields) {
    if (tokens === null) tokens = toFiniteNumber(result.fields.childTotalTokens)
    if (elapsedMs === null) elapsedMs = toFiniteNumber(result.fields.elapsedMs)
    if (cacheRead === 0) {
      const usage = parseChildUsage(result.fields.childUsage)
      if (usage && typeof usage.cacheReadTokens === 'number') cacheRead = usage.cacheReadTokens
    }
  }
  return { tokens, cacheRead, elapsedMs }
}

// 判定记录是否被拒绝：trace 任一闸 verdict==='fail' 视为闸拒绝；无 trace 且 isError
// 视为拒绝（旧错误块无法区分闸拒绝与运行时错误，统一计拒绝）。
function recordIsRejected(record) {
  if (!record) return false
  const gates = record.trace && Array.isArray(record.trace.gates) ? record.trace.gates : []
  if (gates.some((gate) => gate.verdict === 'fail')) return true
  return record.isError === true
}

// 累加记录各失败闸到闸拒绝分布；未知闸名归入 other（counts 已含五键）。
function countGateRejects(record, counts) {
  if (!record || !record.trace || !Array.isArray(record.trace.gates)) return
  for (const gate of record.trace.gates) {
    if (gate.verdict !== 'fail') continue
    const key = Object.prototype.hasOwnProperty.call(counts, gate.name) ? gate.name : 'other'
    counts[key] += 1
  }
}

// 记录归属方案：effective.profile → requested.profile → request.profile 依次回退；
// 缺失返回空串（不参与 byProfile 计数）。
function recordProfile(record) {
  if (!record) return ''
  const trace = record.trace
  if (trace && trace.effective && typeof trace.effective.profile === 'string' && trace.effective.profile !== '') return trace.effective.profile
  if (trace && trace.requested && typeof trace.requested.profile === 'string' && trace.requested.profile !== '') return trace.requested.profile
  if (record.request && typeof record.request.profile === 'string') return record.request.profile
  return ''
}

// 累加单条记录的反事实成本到汇总。
function accumulateRecordCost(summary, record) {
  const cost = recordCostInfo(record)
  if (cost === null) return
  summary.pricedCount += 1
  summary.estimatedCost += cost.actual
  summary.estimatedInheritCost += cost.counterfactual
  summary.estimatedSaving += cost.saving
  if (cost.inherit) summary.inheritCount += 1
}

// 成本汇总定稿：四舍五入到可展示精度，继承占比按百分数取整。
function finalizeLedgerCost(summary) {
  summary.estimatedCost = Number(summary.estimatedCost.toFixed(4))
  summary.estimatedInheritCost = Number(summary.estimatedInheritCost.toFixed(4))
  summary.estimatedSaving = Number(summary.estimatedSaving.toFixed(4))
  summary.inheritRatio = summary.pricedCount > 0 ? Number(((summary.inheritCount / summary.pricedCount) * 100).toFixed(0)) : 0
}

// 会话汇总：与台账汇总带对齐。records 为合并后的完整记录列表（含失败记录）。
// 旧记录贡献可得字段（次数/耗时/token），不可得记 0/省略；闸拒绝按 trace.gates
// 的 fail verdict 分布。byProfile/byModel/byTier 均按次数降序。
function computeLedgerSummary(records) {
  const list = Array.isArray(records) ? records : []; const summary = {
    dispatchCount: list.length,
    successCount: 0,
    rejectCount: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    totalElapsedMs: 0,
    estimatedCost: 0,
    estimatedInheritCost: 0,
    estimatedSaving: 0,
    inheritCount: 0,
    inheritRatio: 0,
    pricedCount: 0,
    gateRejectCounts: { whitelist: 0, cost: 0, intersection: 0, approval: 0, other: 0 },
    byProfile: [],
    byModel: [],
    byTier: []
  }
  const profileMap = new Map(), modelMap = new Map(), tierMap = new Map()
  for (const record of list) {
    if (recordIsRejected(record)) summary.rejectCount += 1
    else summary.successCount += 1
    const { tokens, cacheRead, elapsedMs } = recordNumbers(record)
    if (tokens !== null) summary.totalTokens += tokens
    summary.cacheHitTokens += cacheRead
    if (elapsedMs !== null) summary.totalElapsedMs += elapsedMs
    accumulateRecordCost(summary, record)
    countGateRejects(record, summary.gateRejectCounts)
    const profile = recordProfile(record)
    if (profile !== '') profileMap.set(profile, (profileMap.get(profile) || 0) + 1)
    // 模型：空/'(parent)'（继承父会话标记）并入继承桶（键为空串，展示层经 rawOrInherit 归一）。
    const model = recordModel(record)
    if (model === '' || model === '(parent)') modelMap.set('', (modelMap.get('') || 0) + 1)
    else modelMap.set(model, (modelMap.get(model) || 0) + 1)
    const tier = recordTier(record)
    if (tier !== '') tierMap.set(tier, (tierMap.get(tier) || 0) + 1)
  }
  summary.byProfile = [...profileMap.entries()]
    .map(([profile, count]) => ({ profile, count }))
    .sort((a, b) => b.count - a.count)
  summary.byModel = [...modelMap.entries()]
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count)
  summary.byTier = [...tierMap.entries()]
    .map(([tier, count]) => ({ tier, count }))
    .sort((a, b) => b.count - a.count)
  finalizeLedgerCost(summary)
  return summary
}

// 拉取失败台账：经既有 api() 走 GET /ledger/failures?session=<id>，失败项同样经
// normalizeDecisionTrace 归一。host 侧经 stateFile（subagent-profiles.failed-traces.json）
// 落盘，重启后仍可读；host 不可达/路由缺失/坏数据一律 fail-soft 返回空数组。
async function fetchLedgerFailures(sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return []
  try {
    const data = await api(`/ledger/failures?session=${encodeURIComponent(sessionId)}`)
    const list = Array.isArray(data.failures) ? data.failures : []
    const out = []
    for (const item of list) {
      const trace = normalizeDecisionTrace(item)
      if (trace !== null) out.push(trace)
    }
    return out
  } catch {
    return []
  }
}

// 拉取后台派发结算台账：GET /ledger/jobs?session=<id>，按 jobId join 到后台记录。
async function fetchLedgerJobs(sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return []
  try {
    const data = await api(`/ledger/jobs?session=${encodeURIComponent(sessionId)}`)
    return Array.isArray(data.jobs) ? data.jobs : []
  } catch {
    return []
  }
}

// 全部待配对 jobId 都已在拉取结果中出现 settled → 轮询可以停止。
function allJobsSettled(list, pending) {
  const settled = new Set()
  for (const item of list) {
    if (item !== null && typeof item === 'object' && typeof item.jobId === 'string' && item.settled !== null && item.settled !== undefined) settled.add(item.jobId)
  }
  for (const id of pending) {
    if (!settled.has(id)) return false
  }
  return true
}

// 台账 tab 后台任务 live 轮询：与派发卡片同节奏（3 秒、100 次上限），仅待配对
// jobId 非空时启动；配对齐全或达上限即停。返回清理函数。
function startLedgerJobsPoll(sessionId, pendingJobIds, setJobs) {
  let cancelled = false
  let timer = null
  let attempts = 0
  const pending = new Set(Array.isArray(pendingJobIds) ? pendingJobIds : [])
  const poll = () => {
    fetchLedgerJobs(sessionId).then((list) => {
      if (cancelled) return
      setJobs(list)
      if (allJobsSettled(list, pending) && timer !== null) clearInterval(timer)
    }).catch(() => {})
  }
  poll()
  if (pending.size > 0) {
    timer = setInterval(() => {
      attempts += 1
      if (attempts >= 100) { if (timer !== null) clearInterval(timer); return }
      poll()
    }, 3000)
  }
  return () => { cancelled = true; if (timer !== null) clearInterval(timer) }
}

// 把后台结算台账按 jobId join 回记录：仅补 execution.kind==='background' 且尚无
// settled 的记录；已结算/非后台/无 jobId 原样返回（幂等、不覆盖已有 settled）。
function mergeBackgroundJobs(records, jobs) {
  if (!Array.isArray(records) || !Array.isArray(jobs) || jobs.length === 0) return records
  const byJob = new Map()
  for (const item of jobs) {
    if (item === null || typeof item !== 'object' || typeof item.jobId !== 'string') continue
    byJob.set(item.jobId, item.settled)
  }
  if (byJob.size === 0) return records
  return records.map((record) => {
    const trace = record && record.trace
    const jobId = trace && trace.execution && typeof trace.execution.jobId === 'string' ? trace.execution.jobId : ''
    if (jobId === '' || trace.settled !== null && trace.settled !== undefined) return record
    const settled = byJob.get(jobId)
    if (settled === undefined) return record
    return { ...record, trace: { ...trace, settled } }
  })
}

// 由失败 trace 构造独立台账记录（快照内无对应错误块时）：request 从 requested/
// execution 还原，callId/argsSummary/contentFirstLine 为空，标记 failureOnly。
function failureRecord(failure) {
  const requested = asObject(failure && failure.requested)
  const execution = asObject(failure && failure.execution)
  const request = {
    profile: typeof requested.profile === 'string' ? requested.profile : '',
    preset: typeof requested.preset === 'string' ? requested.preset : '',
    provider: typeof requested.provider === 'string' ? requested.provider : '',
    model: typeof requested.model === 'string' ? requested.model : '',
    reasoningEffort: typeof requested.reasoningEffort === 'string' ? requested.reasoningEffort : '',
    continuable: execution.kind === 'continuable' || execution.mode === 'continuable',
    runInBackground: execution.kind === 'background'
  }
  return {
    callId: '',
    time: failure && typeof failure.startedAt === 'number' ? failure.startedAt : null,
    isError: true,
    legacy: false,
    trace: failure,
    request,
    result: null,
    argsSummary: '',
    contentFirstLine: '',
    failureOnly: true
  }
}

// 失败记录合并：把失败台账与快照错误块按 startedAt 就近匹配（±2s 窗口）。
// 匹配成功 → 失败 trace 回填进对应错误块记录（isError 且无 trace）；匹配失败 →
// 独立列为新记录（failureOnly 标记）。返回合并后的完整记录列表，不修改输入数组。
function mergeFailureRecords(settledRecords, failures) {
  const records = (Array.isArray(settledRecords) ? settledRecords : []).map((record) => ({ ...record }))
  const failureList = Array.isArray(failures) ? failures : []
  const unmatched = []
  for (const failure of failureList) {
    const ts = failure && typeof failure.startedAt === 'number' ? failure.startedAt : null
    let matched = false
    if (ts !== null) {
      for (const record of records) {
        if (record.isError !== true || record.trace !== null) continue
        if (typeof record.time !== 'number') continue
        if (Math.abs(record.time - ts) <= 2000) {
          record.trace = failure
          record.legacy = false
          matched = true
          break
        }
      }
    }
    if (!matched) unmatched.push(failure)
  }
  for (const failure of unmatched) records.push(failureRecord(failure))
  return records
}

// ── dispatch 工具卡（React 依赖经参数注入）─────────────────────────────────

// 生效值：结果解析成功用结果（优先），字段缺失回退请求值。
function resolveDispatchState(request, result, settled) {
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
  // 请求≠生效：被忽略字段的生效值 = 确定性降级值。
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
  return { eff, ignored, kindLabel }
}

function buildDispatchChips(el, chip, eff, result, block, ignored, request) {
  const chips = []
  chips.push(chip('profile', ZH.chipProfile, profileZh(eff.profile)))
  // preset 继承值（'inherit' 或未请求即空串，均渲染为「继承父会话」）与
  // provider·model / effort 一样弱显。
  chips.push(chip('preset', ZH.chipPreset, presetZh(eff.preset), { dim: eff.preset === 'inherit' || eff.preset === '' }))
  const p = rawOrInherit(eff.provider)
  const m = rawOrInherit(eff.model)
  chips.push(chip('providerModel', `${ZH.chipProvider}·${ZH.chipModel}`, p === ZH.inherit && m === ZH.inherit ? ZH.inherit : `${p} / ${m}`, { dim: p === ZH.inherit && m === ZH.inherit }))
  chips.push(chip('effort', ZH.chipEffort, effortZh(eff.reasoningEffort), { dim: eff.reasoningEffort === '' || eff.reasoningEffort === '(default)' }))
  // tokenTier：宿主 render 行已产出；result.fields 缺失时回退 block.meta（向前兼容旧结果）。
  let tier = ''
  if (result && result.fields && typeof result.fields.tokenTier === 'string' && result.fields.tokenTier !== '') {
    tier = result.fields.tokenTier
  } else if (block && block.meta && typeof block.meta === 'object' && typeof block.meta.tokenTier === 'string' && block.meta.tokenTier !== '') {
    tier = block.meta.tokenTier
  }
  if (tier !== '') chips.push(chip('tier', ZH.chipTier, ZH.tierZh[tier] || tier))
  // ignored 项：警示色、置于 chip 行末尾（非静默）。
  for (const key of ignored) {
    const reqVal = request[key] || ''
    chips.push(el('span', {
      key: `ignored-${key}`,
      className: 'sap-chip sap-chipWarn',
      title: reqVal !== '' ? `请求值 "${reqVal}" 已忽略` : '请求值已忽略'
    }, `⬆${FIELD_ZH[key] || key}(${ZH.ignoredMark})`))
  }
  return chips
}

/** 统一 chip 元素：label + value，dim=继承/默认值弱显。 */
function makeChip(el) {
  const chip = (key, label, value, opts) => {
    const valueCls = opts && opts.dim ? 'sap-chipValueDim' : 'sap-chipValue'
    const dot = opts && opts.dot === true ? el('span', { className: 'sap-chipDot' }, ' · ') : null
    return el('span', {
      key,
      className: 'sap-chip',
      ...(opts && typeof opts.title === 'string' && opts.title !== '' ? { title: opts.title } : {})
    },
      el('span', { className: 'sap-chipLabel' }, label),
      dot,
      el('span', { className: valueCls }, value)
    )
  }
  return chip
}

// 从一次派发快照生成 draft 建议（只取配置快照，不落 prompt/persona 原文）。
function draftSuggestionFromDispatch(request, trace, result) {
  const ts = Date.now().toString(36).slice(-4)
  const profile = request && typeof request.profile === 'string' && request.profile !== '' && request.profile !== '(inline)' ? request.profile : 'inline'
  const config = { id: 'captured-' + profile + '-' + ts }
  if (request.preset) config.preset = request.preset
  if (request.provider) config.provider = request.provider
  if (request.model) config.model = request.model
  if (request.reasoningEffort) config.reasoningEffort = request.reasoningEffort
  const tier = result && result.fields && typeof result.fields.tokenTier === 'string' ? result.fields.tokenTier : (trace && trace.effective && typeof trace.effective.tokenTier === 'string' ? trace.effective.tokenTier : '')
  if (tier) config.tokenTier = tier
  return {
    config,
    name: profile === 'inline' ? '我的派发方案' : '我的 ' + profile + ' 方案',
    description: '来自一次 dispatch 的配置快照，可继续编辑。'
  }
}

// draft 捕获的 hooks 与渲染分离，保持 DispatchToolview 短小。
function useDraftCapture(useState, suggestion) {
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftDesc, setDraftDesc] = useState('')
  const [draftError, setDraftError] = useState('')
  const [draftSaved, setDraftSaved] = useState(false)
  const [draftCopied, setDraftCopied] = useState(false)
  const openDraft = () => { setDraftName(suggestion.name); setDraftDesc(suggestion.description); setDraftError(''); setDraftSaved(false); setDraftOpen(true) }
  const closeDraft = () => setDraftOpen(false)
  const saveDraft = () => {
    setDraftError(''); setDraftSaved(false)
    api('/draft', { source: 'dispatch', config: suggestion.config, name: draftName, description: draftDesc })
      .then(() => setDraftSaved(true))
      .catch((err) => setDraftError(String((err && err.message) || err)))
  }
  // 成功文案的「复制方案 id」动作（clipboard fail-soft，反馈经 draftCopied 状态）。
  const copyDraftId = () => { copyToClipboard(suggestion.config.id); setDraftCopied(true) }
  return { draftOpen, draftName, setDraftName, draftDesc, setDraftDesc, draftError, draftSaved, draftCopied, draftConfigId: suggestion.config.id, openDraft, closeDraft, saveDraft, copyDraftId }
}

function buildDraftButton(el, draft) {
  return el('button', { type: 'button', className: 'sap-detailToggle', onClick: draft.openDraft }, draft.draftSaved ? '已存为方案 ✓' : '存为方案')
}

function buildDraftForm(el, draft) {
  if (!draft.draftOpen) return null
  return el('div', { className: 'sap-draftCard' },
    el('div', { className: 'sap-draftTitle' }, '存为方案（draft）'),
    el('div', { className: 'sap-field' },
      el('span', { className: 'sap-fieldLabel' }, '方案名'),
      el('input', { className: 'sap-input', value: draft.draftName, onChange: (event) => draft.setDraftName(event && event.target ? event.target.value : '') })
    ),
    el('div', { className: 'sap-field' },
      el('span', { className: 'sap-fieldLabel' }, '描述'),
      el('input', { className: 'sap-input', value: draft.draftDesc, onChange: (event) => draft.setDraftDesc(event && event.target ? event.target.value : '') })
    ),
    el('div', { className: 'sap-editorActions' },
      el('button', { className: 'sap-secondaryButton', onClick: draft.closeDraft }, '取消'),
      el('button', { className: 'sap-primaryButton', onClick: draft.saveDraft }, '确认保存')
    ),
    draft.draftError !== '' ? el('p', { className: 'sap-notice' }, draft.draftError) : null,
    draft.draftSaved ? el('div', { className: 'sap-toolSummary' },
      el('p', { className: 'sap-savedNotice' }, ZH.draftSavedWithId.replace('{id}', draft.draftConfigId)),
      el('button', { type: 'button', className: 'sap-detailToggle', onClick: draft.copyDraftId }, draft.draftCopied ? ZH.ledgerCopied : ZH.draftCopyId)
    ) : null
  )
}

// ── 派发链路 live 状态机 ──────────────────────────────────────

// phase 徽标推导（纯函数）：前台 execute 返回即终态（静态 ✅/❌）；后台运行中块无
// jobId，靠 /ledger/jobs 轮询结果（jobSettled）按 callId 精确配对 live
// 「执行中 → 完成/失败」；continuable 启动即返回 subagentId，无结算概念 →「已启动」。
function phaseStepsOf(request, result, settled, trace, jobSettled) {
  const steps = [{ key: 'initiate', label: ZH.phaseInitiate, state: 'done' }]
  if (jobSettled !== null && jobSettled !== undefined && typeof jobSettled === 'object') {
    const completed = jobSettled.status === 'completed'
    steps.push({ key: 'guards', label: ZH.phaseGuards, state: 'done' })
    steps.push({ key: 'create', label: ZH.phaseCreate, state: 'done' })
    steps.push({ key: 'run', label: ZH.phaseRun, state: 'done' })
    steps.push({ key: 'end', label: completed ? ZH.phaseDone : ZH.phaseFailed, state: completed ? 'done' : 'fail' })
    return steps
  }
  if (settled && result !== null) {
    const gates = trace !== null && Array.isArray(trace.gates) ? trace.gates : []
    const gateFailed = gates.some((g) => g && g.verdict === 'fail')
    steps.push({ key: 'guards', label: ZH.phaseGuards, state: gateFailed ? 'fail' : 'done' })
    steps.push({ key: 'create', label: ZH.phaseCreate, state: 'done' })
    steps.push({ key: 'run', label: ZH.phaseRun, state: 'done' })
    const stop = result.fields && typeof result.fields.stopReason === 'string' ? result.fields.stopReason : ''
    const failed = stop !== '' && stop !== 'completed'
    steps.push({ key: 'end', label: failed ? ZH.phaseFailed : ZH.phaseDone, state: failed ? 'fail' : 'done' })
    return steps
  }
  if (settled && result === null) {
    steps.push({ key: 'settled', label: ZH.phaseLegacy, state: 'done' })
    return steps
  }
  // 运行中：未知安全检查/创建态不虚报，只宣告 发起 → 执行中。
  steps.push({ key: 'run', label: ZH.phaseRun, state: 'running' })
  return steps
}

// phase 徽标行渲染：恒在摘要行上方（未展开即渲染）。
function buildDispatchPhaseLine(el, request, result, settled, trace, jobSettled) {
  const steps = phaseStepsOf(request, result, settled, trace, jobSettled)
  return el('div', { className: 'sap-dispatchPhase' },
    steps.map((s, index) => el('span', { key: s.key, className: 'sap-phaseStep sap-phaseStep-' + s.state }, (index > 0 ? '→ ' : '') + s.label))
  )
}

// 后台派发 live 轮询（兜底）：每 3 秒拉 /ledger/jobs?session=，按 callId 配对
// 结算；配对成功或达到轮询上限（100 次 ≈ 5 分钟）即停。非后台/已结算/无 callId 不启动。
function useBackgroundJobPoll(useState, useEffect, api, sessionId, callId, settled, request) {
  const [jobSettled, setJobSettled] = useState(null)
  useEffect(() => {
    if (settled || !request || request.runInBackground !== true) return
    if (typeof sessionId !== 'string' || sessionId === '' || typeof callId !== 'string' || callId === '') return
    let attempts = 0
    let timer = null
    const poll = () => {
      attempts += 1
      api('/ledger/jobs?session=' + encodeURIComponent(sessionId))
        .then((data) => {
          const jobs = Array.isArray(data.jobs) ? data.jobs : []
          const hit = jobs.find((j) => j && j.callId === callId && j.settled !== null && j.settled !== undefined)
          if (hit !== undefined) {
            setJobSettled(hit.settled)
            if (timer !== null) clearInterval(timer)
          } else if (attempts >= 100) {
            if (timer !== null) clearInterval(timer)
          }
        })
        .catch(() => {})
    }
    poll()
    timer = setInterval(poll, 3000)
    return () => { if (timer !== null) clearInterval(timer) }
  }, [sessionId, callId, settled, request])
  return jobSettled
}

function makeDispatchToolview(el, chip, useState, useEffect) {
  function DispatchToolview(props) {
    const block = props && props.block; const request = readDispatchRequest(block); const result = readDispatchResult(block)
    const settled = !!(block && typeof block === 'object' && 'kind' in block); const trace = block && block.meta ? normalizeDecisionTrace(block.meta) : null
    const { eff, ignored, kindLabel } = resolveDispatchState(request, result, settled)
    const chips = buildDispatchChips(el, chip, eff, result, block, ignored, request)
    // 生效画像行并入 meta 行（B3 imageText 回读；旧结果按生效字段合成，空则不出现）。
    const safetyLine = safetyLineText(trace); const toolLine = toolLineText(request, trace); const imageText = imageTextOfBlock(block && typeof block === 'object' ? block.meta : null, eff)
    const metaLine = (safetyLine !== '' || toolLine !== '' || imageText !== '') ? el('div', { className: 'sap-toolMeta' },
      safetyLine !== '' ? el('span', { className: 'sap-toolMetaItem' }, safetyLine) : null,
      toolLine !== '' ? el('span', { className: 'sap-toolMetaItem' }, toolLine) : null,
      imageText !== '' ? el('span', { className: 'sap-toolMetaItem' }, imageText) : null
    ) : null
    const usage = usageFrom(result, block)
    const jobSettled = useBackgroundJobPoll(useState, useEffect, api, props.sessionId, props.callId, settled, request)
    const [open, setOpen] = useState(false); const suggestion = draftSuggestionFromDispatch(request, trace, result); const draft = useDraftCapture(useState, suggestion)
    // 摘要行只承载动态结果（成本/耗时/结束原因/缓存命中）；静态配置（方案/预设/
    // 提供方/模型/推理强度/档位）全部在 chip 行——避免同一组信息重复两遍。
    const text = dispatchSummaryText(request, result, block, trace, kindLabel)
    // 详情折叠入口：仅当存在真实计费分解（childUsage）时渲染；无分解数据
    // （旧结果/无 usage 会话）不显示折叠区，向前兼容。
    const detailToggle = usage === null ? null : el('button', {
      type: 'button',
      className: 'sap-detailToggle',
      'aria-expanded': open,
      onClick: () => setOpen((prev) => !prev)
    }, open ? ZH.detailClose : ZH.detailOpen)
    // 无分解数据时保持原摘要行结构（零漂移）；有分解时才加折叠入口与详情行。
    const summary = usage === null
      ? el('div', { className: 'sap-toolText' }, text)
      : el('div', { className: 'sap-toolSummary' },
          el('div', { className: 'sap-toolText' }, text),
          detailToggle
        )
    const detailBody = open && usage !== null
      ? el('div', { className: 'sap-toolDetail' }, usageDetailText(usage))
      : null
    const draftButton = buildDraftButton(el, draft); const draftForm = buildDraftForm(el, draft)
    return el('div', { className: 'sap-toolview' },
      buildDispatchPhaseLine(el, request, result, settled, trace, jobSettled),
      el('div', { className: 'sap-chips' }, chips),
      metaLine,
      summary,
      detailBody,
      draftButton,
      draftForm
    )
  }
  return DispatchToolview
}

// ── 设置页：事件处理工厂（state 统一经 s 注入）─────────────────────────────

// 写路径契约：HTTP 200 但 persisted:false 时 host 附 persistWarning
// 「已保存但未持久化」——这里改为 amber 警示（非绿色成功态）。
function makeApplyWrite(s) {
  const applyWrite = (data, successNotice) => {
    if (data && data.persisted === false) {
      s.setSavedNotice('')
      s.setPersistWarning(typeof data.persistWarning === 'string' && data.persistWarning !== '' ? data.persistWarning : ZH.persistFail)
      return
    }
    s.setPersistWarning('')
    if (typeof successNotice === 'string' && successNotice !== '') s.setSavedNotice(successNotice)
    else s.setSavedNotice('')
  }
  return applyWrite
}

function makeFormActions(s, loadEfforts, loadTools) {
  const setField = (key) => (event) => {
    const value = event && event.target ? event.target.value : ''
    s.setForm((prev) => {
      const next = { ...prev, [key]: value }
      if (key === 'model') {
        next.reasoningEffort = '' // 换模型时重置推理强度
        // provider 由 model 联动派生：选中模型即同步表单 provider（不可独立编辑）。
        const derived = providerOfModel(s.options.models, value)
        if (derived !== null) next.provider = derived.id
      }
      return next
    })
    if (key === 'model' && value !== '') {
      loadEfforts(value) // 选中模型 → 懒拉该模型 efforts
    }
  }
  const setToolMode = (mode) => () => {
    if (mode !== 'none') loadTools() // 工具限制面板启用 → 拉完整工具目录
    s.setForm((prev) => ({ ...prev, toolMode: mode }))
  }
  const toggleTool = (name) => () => {
    s.setForm((prev) => {
      const cur = Array.isArray(prev.toolList) ? prev.toolList : []
      const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]
      return { ...prev, toolList: next }
    })
  }
  const selectLayer = (layer) => () => s.setForm((prev) => {
    const layerNames = s.tools.filter((t) => t.layer === layer).map((t) => t.name)
    return { ...prev, toolList: [...new Set([...(Array.isArray(prev.toolList) ? prev.toolList : []), ...layerNames])] }
  })
  const clearLayer = (layer) => () => s.setForm((prev) => {
    const layerSet = new Set(s.tools.filter((t) => t.layer === layer).map((t) => t.name))
    return { ...prev, toolList: (Array.isArray(prev.toolList) ? prev.toolList : []).filter((n) => !layerSet.has(n)) }
  })
  const invertLayer = (layer) => () => s.setForm((prev) => {
    const layerNames = s.tools.filter((t) => t.layer === layer).map((t) => t.name)
    const cur = Array.isArray(prev.toolList) ? prev.toolList : []
    const toAdd = layerNames.filter((n) => !cur.includes(n))
    const toRemove = new Set(layerNames.filter((n) => cur.includes(n)))
    return { ...prev, toolList: [...cur.filter((n) => !toRemove.has(n)), ...toAdd] }
  })
  return { setField, setToolMode, toggleTool, selectLayer, clearLayer, invertLayer }
}

function makeEditActions(s, loadEfforts, loadTools) {
  const openAdd = () => {
    s.setError('')
    s.setSavedNotice('')
    s.setPersistWarning('')
    s.setForm(EMPTY_FORM)
    s.setEditingId(null)
    s.setAdding(true)
  }
  const openEdit = (profile) => () => {
    s.setError(''); s.setSavedNotice(''); s.setPersistWarning('')
    const tf = profile.toolFilter && typeof profile.toolFilter === 'object' ? profile.toolFilter : {}
    const allowArr = Array.isArray(tf.allow) ? tf.allow.slice() : []
    const denyArr = Array.isArray(tf.deny) ? tf.deny.slice() : []
    const toolMode = allowArr.length > 0 ? 'allow' : (denyArr.length > 0 ? 'deny' : 'none')
    if (toolMode !== 'none') loadTools() // 编辑含 toolFilter 的 profile → 预拉工具目录
    if (typeof profile.model === 'string' && profile.model !== '') {
      loadEfforts(profile.model) // 编辑含 model 的 profile → 预拉该模型 efforts（下拉不空白）
    }
    s.setForm({
      id: profile.id,
      description: typeof profile.description === 'string' ? profile.description : '',
      preset: typeof profile.preset === 'string' ? profile.preset : '',
      provider: typeof profile.provider === 'string' ? profile.provider : '',
      model: typeof profile.model === 'string' ? profile.model : '',
      reasoningEffort: typeof profile.reasoningEffort === 'string' ? profile.reasoningEffort : '',
      tokenTier: typeof profile.tokenTier === 'string' && (profile.tokenTier === 'cheap' || profile.tokenTier === 'balanced' || profile.tokenTier === 'premium') ? profile.tokenTier : 'balanced',
      toolMode,
      toolList: toolMode === 'allow' ? allowArr : denyArr
    })
    s.setEditingId(profile.id)
    s.setAdding(true)
  }
  const closeAdd = () => {
    s.setAdding(false)
    s.setEditingId(null)
    s.setError('')
    s.setPersistWarning('')
    s.setForm(EMPTY_FORM)
  }
  return { openAdd, openEdit, closeAdd }
}

function makeSubmitActions(api, s, refresh, applyWrite) {
  const submit = () => {
    const payload = { id: typeof s.form.id === 'string' ? s.form.id.trim() : '' }
    // 字符串字段总是发送（含空串）：后端 merge 语义里空串 = 清除该字段，
    // 否则把字段清回“继承父会话/默认”会被静默忽略（保留旧值）。
    const add = (key, value) => { if (typeof value === 'string') payload[key] = value.trim() }
    add('description', s.form.description)
    add('preset', s.form.preset)
    add('provider', s.form.provider)
    add('model', s.form.model)
    add('reasoningEffort', s.form.reasoningEffort)
    if (typeof s.form.tokenTier === 'string' && s.form.tokenTier !== '') payload.tokenTier = s.form.tokenTier
    const list = Array.isArray(s.form.toolList) ? s.form.toolList : []
    if (s.form.toolMode === 'allow' && list.length > 0) payload.toolFilter = { allow: list }
    else if (s.form.toolMode === 'deny' && list.length > 0) payload.toolFilter = { deny: list }
    else payload.toolFilter = {}   // 不限制：空对象 = 清除（后端会 delete）
    if (typeof payload.id !== 'string' || payload.id === '') { s.setError('profile id 不能为空'); return }
    // 编辑：保留原 name 和 enabled 状态
    const existing = s.profiles.find((p) => p.id === s.form.id)
    if (existing) {
      if (typeof existing.name === 'string' && existing.name !== '') payload.name = existing.name
      if (existing.enabled === false) payload.enabled = false
    }
    api('/add', payload)
      .then((data) => {
        s.setForm(EMPTY_FORM); s.setAdding(false); s.setEditingId(null); s.setError('')
        applyWrite(data, `已保存 ${payload.id}`)
        refresh()
      })
      .catch((err) => s.setError(String((err && err.message) || err)))
  }
  return { submit }
}

// 乐观开关：next=!get() 先落 UI，成功保留；失败回滚 + 经 setError 展示。
function makeToggle(api, path, payloadKey, get, set, setError) {
  return () => {
    const next = !get()
    set(next)
    setError('')
    api(path, { [payloadKey]: next })
      .catch((err) => {
        set(!next)
        setError(String((err && err.message) || err))
      })
  }
}

function makeRowActions(api, s, refresh, applyWrite) {
  const toggleEnabled = makeToggle(api, '/set-enabled', 'enabled', () => s.enabled, s.setEnabled, s.setError)
  const toggleEscape = makeToggle(api, '/set-escape', 'enabled', () => s.escapeEnabled, s.setEscapeEnabled, s.setError)
  // 建议开关切换后立即刷新 /list：候选随建议链同生共死（开→生成可见，关→不再下发）。
  const toggleAdvice = () => {
    const next = !s.evolutionAdvice
    s.setEvolutionAdvice(next)
    s.setError('')
    api('/set-evolution-advice', { advice: next })
      .then(() => refresh())
      .catch((err) => {
        s.setEvolutionAdvice(!next)
        s.setError(String((err && err.message) || err))
      })
  }
  const setProfileEnabled = (profile, next) => () => {
    s.setError('')
    api('/set-profile-enabled', { id: profile.id, enabled: next })
      .then((data) => { applyWrite(data, ''); refresh() })
      .catch((err) => s.setError(String((err && err.message) || err)))
  }
  const resetAll = () => {
    if (!window.confirm('将所有内置方案重置为默认配置？已删除的内置也会恢复。')) return
    s.setError('')
    api('/reset-all', {})
      .then((data) => { applyWrite(data, '已重置所有内置方案'); refresh() })
      .catch((err) => s.setError(String((err && err.message) || err)))
  }
  const remove = (profile) => () => {
    if (!window.confirm(`删除方案「${profile.name || profile.id}」？${profile.builtin === true ? '内置方案删除后可在上方「重置内置方案」恢复' : ''}`)) return
    api('/remove', { id: profile.id })
      .then((data) => {
        s.setError('')
        applyWrite(data, `已删除 ${profile.id}`)
        refresh()
      })
      .catch((err) => s.setError(String((err && err.message) || err)))
  }
  return { toggleEnabled, toggleEscape, toggleAdvice, setProfileEnabled, resetAll, remove }
}

// 逃生舱放行集增删：/escape-add 成功后用响应 presets 刷新本地列表并清空输入；
// /escape-remove 成功后同样用响应 presets 刷新。失败统一经 s.setError 展示。
function makeEscapeActions(api, s) {
  const escapeAdd = () => {
    const value = typeof s.escapeInput === 'string' ? s.escapeInput.trim() : ''
    if (value === '') { s.setError(ZH.escapeAddEmpty); return }
    s.setError('')
    api('/escape-add', { preset: value })
      .then((data) => {
        s.setEscapeInput('')
        if (Array.isArray(data.presets)) s.setEscapePresets(data.presets)
      })
      .catch((err) => s.setError(String((err && err.message) || err)))
  }
  const escapeRemove = (id) => () => {
    s.setError('')
    api('/escape-remove', { preset: id })
      .then((data) => {
        if (Array.isArray(data.presets)) s.setEscapePresets(data.presets)
      })
      .catch((err) => s.setError(String((err && err.message) || err)))
  }
  return { escapeAdd, escapeRemove }
}

// 选中模型 → 懒拉 /options/efforts（按模型 id 存入 options.efforts）。
function makeEffortsLoader(api, setOptions) {
  return (model) => {
    const q = `?model=${encodeURIComponent(model)}`
    api(`/options/efforts${q}`)
      .then((data) => {
        const list = Array.isArray(data.efforts) ? data.efforts : []
        setOptions((prev) => ({ ...prev, efforts: { ...prev.efforts, [model]: list } }))
      })
      .catch(() => {})
  }
}

// 工具限制面板启用 → 拉 /options/tools（完整工具目录）。
function makeToolsLoader(api, setTools) {
  return () => {
    api('/options/tools')
      .then((data) => setTools(Array.isArray(data.tools) ? data.tools : []))
      .catch(() => {})
  }
}

// 版本探测 → 拉 /options/versions；维护区 0.5.0 再统一设计归属，数据暂留。
function makeVersionsLoader(api, setVersionWarnings, setPluginVersion) {
  return () => {
    api('/options/versions')
      .then((data) => {
        setVersionWarnings(Array.isArray(data.warnings) ? data.warnings : [])
        setPluginVersion(typeof data.pluginVersion === 'string' ? data.pluginVersion : '')
      })
      .catch(() => {})
  }
}

// 会话服务快照（派发明细表查主会话标题用）；拿不到回退 null（fail-soft）。
function sessionsSnapshot(getSessions) {
  try {
    return typeof getSessions === 'function' ? getSessions() : null
  } catch {
    return null
  }
}

// 定位方案：展开方案管理区 + 高亮对应卡片 + 滚动到可视区（建议/成本行的去向）。
function makeLocateProfile(s) {
  return (profileId) => () => {
    s.setActiveTab('profiles')
    s.setHighlightId(String(profileId))
    setTimeout(() => {
      const node = document.getElementById('sap-profile-' + String(profileId))
      if (node !== null && typeof node.scrollIntoView === 'function') node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 60)
    setTimeout(() => s.setHighlightId(null), 8000)
  }
}

// 候选动作：行点击展开/收起（默认收起，展开态不持久化；展开时复用 /draft/preview
// 只读安全检查流）；radio 仅选中（不改展开态）；安全检查在展开区内部默认收起；
// 派发明细折叠行独立开关。
function makeCandidateActions(api, s) {
  const previewCandidate = (candidate) => () => {
    s.setError('')
    api('/draft/preview', { config: candidate.config ?? {}, name: candidate.name ?? '', description: candidate.description ?? '', source: 'evolution' })
      .then((data) => {
        const previews = { ...(s.draftPreviews || {}) }
        previews[candidate.id] = { ok: data.ok === true, checks: Array.isArray(data.checks) ? data.checks : [] }
        s.setDraftPreviews(previews)
      })
      .catch((err) => s.setError(String((err && err.message) || err)))
  }
  const toggleCandidateOpen = (candidate) => () => {
    const openState = s.candidateOpen !== null && typeof s.candidateOpen === 'object' ? s.candidateOpen : {}
    if (openState[candidate.id] === true) {
      s.setCandidateOpen({ ...openState, [candidate.id]: false })
    } else {
      s.setCandidateOpen({ ...openState, [candidate.id]: true })
      previewCandidate(candidate)()
    }
  }
  const toggleCandidateSafety = (candidate) => () => {
    const openState = s.candidateSafetyOpen !== null && typeof s.candidateSafetyOpen === 'object' ? s.candidateSafetyOpen : {}
    s.setCandidateSafetyOpen({ ...openState, [candidate.id]: openState[candidate.id] !== true })
  }
  const selectCandidate = (profileKey, candidateId) => () => {
    const map = s.candidateSelected !== null && typeof s.candidateSelected === 'object' ? s.candidateSelected : {}
    s.setCandidateSelected({ ...map, [profileKey]: candidateId })
  }
  const toggleDetail = (profileKey) => () => {
    const openState = s.detailOpen !== null && typeof s.detailOpen === 'object' ? s.detailOpen : {}
    s.setDetailOpen({ ...openState, [profileKey]: openState[profileKey] !== true })
  }
  return { previewCandidate, toggleCandidateOpen, toggleCandidateSafety, selectCandidate, toggleDetail }
}

// 表单 → 有效期小时数：自定义档按天数×24（1~365 整数），其余档原样；
// 非法输入返回 null（调用方就地报错不提交）。
function candidateTtlFromForm(form) {
  if (form.candidateTtlChoice === 'custom') {
    const days = Number(String(form.customDays ?? '').trim())
    if (!Number.isInteger(days) || days < 1 || days > 365) return null
    return days * 24
  }
  const ttlH = Number(form.candidateTtlChoice)
  if (!Number.isInteger(ttlH) || !(ttlH === 0 || (ttlH >= 1 && ttlH <= 8760))) return 24
  return ttlH
}

// 页签内交互动作：建议摘要行展开（按 profileKey）与审计明细折叠。
function makeTabActions(s) {
  return {
    toggleAdviceOpen: (profileKey) => () => {
      const map = s.adviceOpen !== null && typeof s.adviceOpen === 'object' ? s.adviceOpen : {}
      s.setAdviceOpen({ ...map, [profileKey]: map[profileKey] !== true })
    },
    toggleAuditDetail: () => s.setAuditDetailOpen(!(s.auditDetailOpen === true))
  }
}

// 候选管理设置动作：设置浮层开合、表单字段、保存（POST /settings/candidate）与
// 取消；重新生成候选（POST /evolution/regenerate）与保存为方案（POST /advice/save-profile）。
function makeCandidateSettingsActions(api, s, refresh, applyWrite) {
  const formOf = () => (s.candidateSettingsForm !== null && typeof s.candidateSettingsForm === 'object' ? s.candidateSettingsForm : {})
  const openSettings = () => {
    const settings = s.candidateSettings !== null && typeof s.candidateSettings === 'object' ? s.candidateSettings : { candidateMode: 'auto', candidateTtlH: 24 }
    const choice = candidateTtlChoiceOf(settings.candidateTtlH)
    s.setCandidateSettingsOpen(true)
    s.setCandidateSettingsForm({ candidateMode: settings.candidateMode, candidateTtlChoice: choice, customDays: choice === 'custom' ? String(settings.candidateTtlH / 24) : '', error: '' })
  }
  const closeSettings = () => {
    s.setCandidateSettingsOpen(false)
    s.setCandidateSettingsForm((prev) => ({ ...(prev ?? {}), error: '' }))
  }
  const setForm = (patch) => s.setCandidateSettingsForm((prev) => ({ ...(prev ?? {}), ...patch, error: '' }))
  const save = () => {
    const form = formOf()
    const ttlH = candidateTtlFromForm(form)
    if (ttlH === null) {
      s.setCandidateSettingsForm((prev) => ({ ...(prev ?? {}), error: ZH.candidateSettingsCustomInvalid }))
      return
    }
    s.setError('')
    api('/settings/candidate', { candidateMode: form.candidateMode === 'manual' ? 'manual' : 'auto', candidateTtlH: ttlH })
      .then((data) => {
        s.setCandidateSettings({ candidateMode: data.candidateMode === 'manual' ? 'manual' : 'auto', candidateTtlH: Number.isFinite(data.candidateTtlH) ? data.candidateTtlH : 24 })
        s.setCandidateSettingsOpen(false)
        applyWrite(data, ZH.candidateSettingsSaved)
        refresh()
      })
      .catch((err) => s.setError(String((err && err.message) || err)))
  }
  const post = (path, body, onData) => {
    s.setError('')
    api(path, body).then(onData).catch((err) => s.setError(String((err && err.message) || err)))
  }
  return {
    toggleCandidateSettings: () => (s.candidateSettingsOpen === true ? closeSettings() : openSettings()),
    setCandidateFormMode: (mode) => () => setForm({ candidateMode: mode }),
    setCandidateFormTtl: (choice) => () => setForm({ candidateTtlChoice: choice }),
    setCandidateFormCustomDays: (value) => setForm({ customDays: value }),
    saveCandidateSettings: save,
    cancelCandidateSettings: closeSettings,
    regenerateCandidates: (profileKey) => () => post('/evolution/regenerate', { profileKey }, () => { s.setSavedNotice(ZH.candidateRegenerate + ' 完成'); refresh() }),
    saveAdviceProfile: (profileKey) => () => post('/advice/save-profile', { profileKey }, (data) => { applyWrite(data, ZH.adviceSavedNotice.replace('{id}', String(data.id ?? ''))); refresh() }),
  }
}

// 应用确认流动作：按建议调整方案（POST /evolution/apply，humanConfirmed 由确认按钮
// 触发）、撤销上次调整（action=rollback）、继续用当前方案（action=keep）。成功即刷新
// 并置顶部成功提示；失败原因回显在各自弹窗内（不静默）。
function makeApplyFlowActions(api, s, refresh) {
  const closeApply = () => s.setApplyModal((prev) => ({ ...(prev ?? {}), open: false, error: '' }))
  const closeRollback = () => s.setRollbackModal((prev) => ({ ...(prev ?? {}), open: false, error: '' }))
  const applyCandidate = () => {
    const modal = s.applyModal ?? {}
    if (modal.candidateId === '') return
    s.setError('')
    api('/evolution/apply', { assetId: modal.candidateId, human_confirmed: true })
      .then(() => { closeApply(); s.setSavedNotice(ZH.adviceApplySuccess); refresh() })
      .catch((err) => s.setApplyModal((prev) => ({ ...(prev ?? {}), error: String((err && err.message) || err) })))
  }
  const rollbackAsset = () => {
    const modal = s.rollbackModal ?? {}
    if (modal.assetId === '') return
    s.setError('')
    api('/evolution/rollback', { assetId: modal.assetId, human_confirmed: true, action: 'rollback' })
      .then(() => { closeRollback(); s.setSavedNotice(ZH.adviceRollbackSuccess); refresh() })
      .catch((err) => s.setRollbackModal((prev) => ({ ...(prev ?? {}), error: String((err && err.message) || err) })))
  }
  const keepAsset = (assetId) => () => {
    s.setError('')
    api('/evolution/rollback', { assetId, human_confirmed: true, action: 'keep' })
      .then(() => { s.setSavedNotice(ZH.adviceKeepSuccess); refresh() })
      .catch((err) => s.setError(String((err && err.message) || err)))
  }
  return {
    openApplyModal: (profileKey, candidateId) => () => s.setApplyModal({ profileKey, candidateId, open: true, error: '' }),
    closeApplyModal: closeApply,
    applyCandidate,
    openRollbackModal: (assetId) => () => s.setRollbackModal({ assetId, open: true, error: '' }),
    closeRollbackModal: closeRollback,
    rollbackAsset,
    keepAsset,
  }
}

function makeProfilesActions(api, s, refresh, applyWrite, loadEfforts, loadTools) {
  return {
    ...makeFormActions(s, loadEfforts, loadTools),
    ...makeEditActions(s, loadEfforts, loadTools),
    ...makeSubmitActions(api, s, refresh, applyWrite),
    ...makeRowActions(api, s, refresh, applyWrite),
    ...makeEscapeActions(api, s),
    ...makeCandidateActions(api, s),
    ...makeCandidateSettingsActions(api, s, refresh, applyWrite),
    ...makeApplyFlowActions(api, s, refresh),
    ...makeTabActions(s),
    locateProfile: makeLocateProfile(s),
  }
}

// ── 设置页：渲染 helpers ────────────────────────────────────────────────────

function buildSelectField(el, s, setField, label, key, optionsList, renderOption) {
  return el('div', { className: 'sap-field' },
    el('span', { className: 'sap-fieldLabel' }, label),
    el('select', { className: 'sap-input sap-select', value: s.form[key], onChange: setField(key) },
      el('option', { value: '' }, '继承父会话（不指定）'),
      optionsList.map(renderOption)
    )
  )
}

function renderTool(el, s, actions, t) {
  const checked = Array.isArray(s.form.toolList) && s.form.toolList.includes(t.name)
  return el('label', { key: t.name, className: 'sap-toolItem' },
    el('input', { type: 'checkbox', checked, onChange: actions.toggleTool(t.name) }),
    el('span', null, t.zh ? `${t.zh} ${t.name}` : t.name)
  )
}

function buildLayerGroups(tools, layer) {
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

function buildToolModePicker(el, s, actions) {
  return el('div', { className: 'sap-toolModes' },
    TOOL_MODES.map(([mode, label]) => el('label', { key: mode, className: 'sap-toolItem' },
      el('input', { type: 'radio', name: 'sap-toolMode', checked: s.form.toolMode === mode, onChange: actions.setToolMode(mode) }),
      el('span', null, label)
    ))
  )
}

function buildToolLayerCard(el, s, actions, layer, groups) {
  const layerTools = s.tools.filter((t) => t.layer === layer)
  const count = layerTools.length
  const selectedCount = layerTools.filter((t) => Array.isArray(s.form.toolList) && s.form.toolList.includes(t.name)).length
  const summaryText = selectedCount > 0
    ? `${LAYER_TITLES[layer]}（${count}）· 已选 ${selectedCount}`
    : `${LAYER_TITLES[layer]}（${count}）`
  return el('details', { key: layer, className: 'sap-toolLayerCard' },
    el('summary', { className: 'sap-customizedSummary' }, summaryText),
    el('div', { className: 'sap-toolLayerBody' },
      el('div', { className: 'sap-toolActions', style: { marginTop: '2px' } },
        el('button', { type: 'button', className: 'sap-secondaryButton', style: smallBtn, onClick: actions.selectLayer(layer) }, '全选'),
        el('button', { type: 'button', className: 'sap-secondaryButton', style: smallBtn, onClick: actions.clearLayer(layer) }, '清空'),
        el('button', { type: 'button', className: 'sap-secondaryButton', style: smallBtn, onClick: actions.invertLayer(layer) }, '反选')
      ),
      groups.map(([g, list]) => el('div', { key: g, className: 'sap-toolGroup' },
        el('div', { className: 'sap-toolGroupTitle' }, `${g}（${list.length}）`),
        el('div', { className: 'sap-toolList' }, list.map((t) => renderTool(el, s, actions, t)))
      ))
    )
  )
}

function buildToolLayers(el, s, actions) {
  return el('div', { className: 'sap-toolGroups' },
    ['core', 'plugin', 'custom']
      .filter((layer) => s.tools.some((t) => t.layer === layer))
      .map((layer) => buildToolLayerCard(el, s, actions, layer, buildLayerGroups(s.tools, layer)))
  )
}

function buildToolSection(el, s, actions) {
  return el('div', { className: 'sap-field' },
    el('span', { className: 'sap-fieldLabel' }, '工具限制'),
    buildToolModePicker(el, s, actions),
    s.form.toolMode === 'none'
      ? null
      : (s.tools.length === 0
          ? el('span', { className: 'sap-metaValueDefault' }, '（无可用工具列表）')
          : buildToolLayers(el, s, actions))
  )
}

function buildProfileRows(el, chip, s, actions) {
  return s.profiles.map((profile) => {
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
    const highlighted = s.highlightId !== null && s.highlightId !== undefined && String(profile.id) === String(s.highlightId)
    return el('li', { key: String(profile.id), id: 'sap-profile-' + String(profile.id), className: highlighted ? 'sap-rowCard sap-rowHighlight' : 'sap-rowCard' },
      el('div', { className: 'sap-rowHead' },
        el('span', { className: 'sap-rowIdentity' },
          el('span', { className: 'sap-rowName' }, hasName ? profile.name : String(profile.id)),
          hasName ? el('span', { className: 'sap-rowId' }, String(profile.id)) : null,
          builtin ? el('span', { className: 'sap-rowTag' }, '内置') : null
        ),
        el('span', { className: 'sap-rowActions' },
          el('label', { className: 'sap-switch', title: '启用/禁用' },
            el('input', { type: 'checkbox', checked: !isDisabled, onChange: actions.setProfileEnabled(profile, isDisabled) }),
            el('span', null, isDisabled ? '已禁用' : '已启用')
          ),
          el('button', { className: 'sap-secondaryButton', style: { height: '28px', padding: '0 10px', fontSize: '12px', borderRadius: '14px' }, onClick: actions.openEdit(profile) }, '编辑'),
          el('button', { className: 'sap-dangerButton', onClick: actions.remove(profile) }, '删除')
        )
      ),
      el('div', { className: 'sap-chips' }, chipItems),
      typeof profile.description === 'string' && profile.description !== ''
        ? el('p', { className: 'sap-desc' }, profile.description)
        : null,
      (typeof profile.avgCost === 'number' || typeof profile.successRate === 'number')
        ? el('p', { className: 'sap-costLine' },
            [
              typeof profile.avgCost === 'number' ? `平均 ≈${profile.avgCost} 元/次` : '',
              typeof profile.successRate === 'number' ? `近期表现 ${Math.round(profile.successRate * 100)}/100${typeof profile.n === 'number' ? `（基于最近 ${profile.n} 次派发）` : ''}` : ''
            ].filter(Boolean).join(' · '))
        : null
    )
  })
}

// 档位选择器（估算口径）：仅影响估算与方案排序，不决定模型；下方附口径说明。
function buildTierField(el, s, actions) {
  return el('div', { className: 'sap-field' },
    el('span', { className: 'sap-fieldLabel' }, ZH.chipTier),
    el('select', { className: 'sap-input sap-select', value: s.form.tokenTier, onChange: actions.setField('tokenTier') },
      Object.entries(ZH.tierZh).map(([id, label]) => el('option', { key: id, value: id }, label))
    ),
    el('p', { className: 'sap-metaValueDefault', style: { margin: '4px 0 0' } }, ZH.tierFormHint)
  )
}

// 提供方只读展示：provider 由已选 model 联动派生；未选模型时回退表单存量
// provider 值（编辑存量 profile 时照常展示），不可独立编辑。
function buildProviderReadonlyLine(el, s) {
  const derived = providerOfModel(s.options.models, s.form.model)
  const fallback = typeof s.form.provider === 'string' && s.form.provider !== '' ? s.form.provider : ''
  const display = derived !== null
    ? (derived.name && derived.name !== derived.id ? derived.name + '（' + derived.id + '）' : derived.id)
    : fallback
  return el('div', { className: 'sap-field' },
    el('span', { className: 'sap-fieldLabel' }, '提供方（由模型联动，只读）'),
    el('span', { className: 'sap-metaValueDefault' }, display === '' ? '选择模型后自动确定' : display)
  )
}

function buildAddCard(el, s, actions, toolSection) {
  const effortsForModel = s.form.model ? (s.options.efforts[s.form.model] ?? []) : []
  const renderEffortOption = (effort) => el('option', { key: effort.id, value: effort.id }, effortLabel(effort))
  return el('div', { className: 'sap-addCard' },
    el('div', { className: 'sap-editorHeader' },
      el('span', { className: 'sap-editorTitle' }, s.editingId !== null ? '编辑 profile' : '新增 profile')
    ),
    el('div', { className: 'sap-field' },
      el('span', { className: 'sap-fieldLabel' }, 'profile id（唯一标识，必填）'),
      el('input', { className: 'sap-input', value: s.form.id, placeholder: '小写字母/数字/连字符，如 my-focus', disabled: s.editingId !== null, onChange: actions.setField('id') })
    ),
    el('div', { className: 'sap-field' },
      el('span', { className: 'sap-fieldLabel' }, '描述（一句话定位）'),
      el('input', { className: 'sap-input', value: s.form.description, placeholder: '说明这个 profile 适合什么场景，帮助模型选择', onChange: actions.setField('description') })
    ),
    buildSelectField(el, s, actions.setField, '模型（子 agent 使用的模型）', 'model', s.options.models,
      (m) => el('option', { key: m.id, value: m.id }, m.name && m.name !== m.id ? `${m.name}（${m.providerName || m.provider}）` : m.id)),
    s.options.models.length === 0 ? el('p', { className: 'sap-metaValueDefault', style: { margin: '0' } }, '未检测到模型目录（headless 部署）——派发成本安全检查将按「兼容模式」开关决定放行或拒绝') : null,
    el('details', { className: 'sap-customized sap-customizedArrowEnd' },
      el('summary', { className: 'sap-customizedSummary' }, '高级选项', el('span', { className: 'sap-customizedEndArrow' }, '▸')),
      el('div', { className: 'sap-customizedBody' },
        el('p', { className: 'sap-metaValueDefault', style: { margin: '0' } }, 'continuable 模式忽略 preset 换用与推理强度（子 Agent 继承父会话预设），派发结果以「ignored」标注'),
        buildSelectField(el, s, actions.setField, '目标预设（切换子 agent 使用的 Agent 预设）', 'preset', s.options.presets,
          (p) => el('option', { key: p.id, value: p.id }, p.name && p.name !== p.id ? `${p.name}（${p.id}）` : p.id)),
        s.options.presets.length === 0 ? el('p', { className: 'sap-metaValueDefault', style: { margin: '0' } }, '未检测到受信任预设名册（rosterless）——目标预设下拉不可用') : null,
        buildProviderReadonlyLine(el, s),
        s.form.model === ''
          ? el('div', { className: 'sap-field' },
              el('span', { className: 'sap-fieldLabel' }, '推理强度（思考深度）'),
              el('select', { className: 'sap-input sap-select', value: '', disabled: true },
                el('option', { value: '' }, '先选择模型')
              )
            )
          : buildSelectField(el, s, actions.setField, '推理强度（思考深度）', 'reasoningEffort', effortsForModel, renderEffortOption),
        buildTierField(el, s, actions),
        toolSection
      )
    ),
    el('div', { className: 'sap-editorActions' },
      el('button', { className: 'sap-secondaryButton', onClick: actions.closeAdd }, '取消'),
      el('button', { className: 'sap-primaryButton', onClick: actions.submit }, '保存')
    )
  )
}

// 按 profileKey 的 preset/model 段匹配方案管理区的 profile 卡片（建议行的去向）。
function matchingProfileOf(profiles, profileKey) {
  if (!Array.isArray(profiles) || typeof profileKey !== 'string') return null
  const segment = (prefix) => {
    for (const part of profileKey.split('|')) {
      if (part.startsWith(prefix)) return part.slice(prefix.length)
    }
    return ''
  }
  const preset = segment('preset:')
  const model = segment('model:')
  if (preset !== '') { const hit = profiles.find((p) => p && p.preset === preset); if (hit !== undefined) return hit }
  if (model !== '') { const hit = profiles.find((p) => p && p.model === model); if (hit !== undefined) return hit }
  return null
}

// ── 建议面板纯函数（epoch 格式化 / 文案换算 / 建议一句话）────────────────────

// epoch ms → MM-DD HH:mm（本地时区，与原型同口径）；非有限数返回空串。
function formatMonthDayTime(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return ''
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 候选有效期徽标文案：null（不自动过期）= ⏱ 无期限；数字 = ⏱ 至 MM-DD HH:mm。
function candidateValidityText(expiry) {
  if (typeof expiry !== 'number' || !Number.isFinite(expiry)) return ZH.candidateValidityForever
  return ZH.candidateValidityPrefix + formatMonthDayTime(expiry)
}

// 指标行：把「平均耗时 <ms>ms」换算成短时（40.4s 等）；第 1 个指标恒为成功分行，
// 历史台账里的旧标签「加权成功分」在此显示层映射为「近期表现分」（值保持 0~1
// 原样不改口径，0~100 视图在候选生成信息行）。其余指标原样（信息不删）。
function adviceMetricsOf(performanceText) {
  return adviceEvidenceOf(performanceText).metrics.map((metric, index) => {
    const hit = /^平均耗时 (.+)$/.exec(metric)
    if (hit !== null) {
      const ms = Number(hit[1])
      return Number.isFinite(ms) ? '平均耗时 ' + formatDurationMs(ms) : metric
    }
    if (index === 0) {
      const space = metric.indexOf(' ')
      return space > 0 ? '近期表现分 ' + metric.slice(space + 1) : metric
    }
    return metric
  })
}

// 方向与置信度中文（模块级共用：面板建议行与旧格式回退）。
function directionZh(d) {
  return d === '升' ? ZH.adviceDirUp : d === '降' ? ZH.adviceDirDown : ZH.adviceDirFlat
}

function confidenceZhOf(level) {
  return ZH.confidenceZh[level] || level
}

// 摘要行建议短句：只带对象与方向（置信度在摘要行独立成列，不再并入一句）。
function adviceSuggestionShort(a) {
  const object = typeof a.objectText === 'string' && a.objectText !== '' ? a.objectText : ''
  if (object === '') return directionZh(a.suggestion)
  const word = a.suggestion === '降' ? ZH.adviceDirShortDown : a.suggestion === '升' ? ZH.adviceDirShortUp : ''
  return ZH.adviceSuggestionPrefix + object + (word !== '' ? '（' + word + '）' : '')
}

// 摘要行对象文本：已有方案「方案：名称」；无方案「手动配置的派发（含自定义人格…）」
// 并附「无方案」小标签（特征取 profileKeyZh，与候选/对应关系同一口径）。
function adviceSummaryObjectText(profile, profileKey) {
  if (profile !== null) return adviceObjectTitleOf(profile)
  const features = profileKeyZh(profileKey).split(' · ').filter((part) => part !== '未存方案' && part !== '未指定方案特征').join(' · ')
  return adviceObjectTitleOf(null) + (features !== '' ? '（' + features + '）' : '')
}

// 卡头标题 = 建议对象：已有方案用「方案：名称」，未匹配用「手动配置的派发」。
function adviceObjectTitleOf(profile) {
  return profile !== null ? ZH.adviceTitleProfilePrefix + (profile.name || profile.id) : ZH.adviceTitleNoProfile
}

// 会话/子 Agent 标识截断（悬停由原生 title 保留全文；不足长度原样）。
function sessionIdShortOf(id) {
  const text = typeof id === 'string' ? id : ''
  return text.length > 12 ? text.slice(0, 12) + '…' : text
}

function childIdShortOf(id) {
  const text = typeof id === 'string' ? id : ''
  return text.length > 8 ? text.slice(0, 8) + '…' : text
}

// 派发模式中文（前台/后台/持久）；未知值原样（fail-soft）。
function dispatchModeZh(mode) {
  if (mode === 'background') return ZH.modeBackground
  if (mode === 'continuable') return ZH.bannerModePersistent
  if (mode === 'foreground') return ZH.modeForeground
  return mode
}

// 表现摘要拆两层：计数（完成/失败/终止）与指标（近期表现分/平均耗时/平均输出），
// 各渲染一遍；解析不出的部分原样保留（信息不删）。
function adviceEvidenceOf(performanceText) {
  const text = typeof performanceText === 'string' ? performanceText : ''
  const withoutWindow = text.replace(/^过去 \d+ 次：/, '')
  const parts = withoutWindow.split('，').map((part) => part.trim()).filter((part) => part !== '')
  return { counts: parts.length > 0 ? parts[0] : '', metrics: parts.slice(1) }
}

// 候选安全检查四项：缩进列表对齐折叠文字下方（margin-left 16px），人话映射；
// 只渲染四项本身，不重复「安全检查：全部通过 ✓」标题行（标题 = 折叠行）。
function buildCandidateSafetyChecks(el, preview) {
  const checks = Array.isArray(preview.checks) ? preview.checks : []
  return el('ul', { className: 'sap-candidateSafetyList' },
    checks.map((c) => el('li', { key: String(c.name), className: 'sap-candidateSafetyItem', title: c.name },
      (c.verdict === 'pass' ? '✅ ' : '❌ ') + (CHECK_ZH[c.name] || c.name) + (typeof c.reason === 'string' && c.reason !== '' ? '：' + c.reason : '')
    ))
  )
}

// 候选改动项：候选 config 与建议来源 profileKey 对比成人话列表（不加前缀，
// 展开区语境已是改动清单）。
// persona/toolFilter 从键里消失 = 去掉该结构；其余字段值不同 = 换成新值。
function candidateChangesOf(profileKey, cfg) {
  const config = cfg !== null && typeof cfg === 'object' ? cfg : {}
  const text = typeof profileKey === 'string' ? profileKey : ''
  const seg = {}
  for (const part of text.split('|')) {
    const idx = part.indexOf(':')
    if (idx >= 0) seg[part.slice(0, idx)] = part.slice(idx + 1)
  }
  const changes = []
  const changed = (field, value) => typeof value === 'string' && value !== '' && seg[field] !== value
  if (seg.persona === '1' && config.persona_present !== true) changes.push('去掉自定义人格')
  if (seg.toolFilter === '1' && config.toolFilter_present !== true) changes.push('去掉工具过滤')
  if (changed('preset', config.preset)) changes.push('预设 → ' + config.preset)
  if (changed('model', config.model)) changes.push('模型 → ' + config.model)
  if (changed('effort', config.reasoningEffort)) changes.push('推理强度 → ' + config.reasoningEffort)
  if (typeof config.maxTokens === 'number' && config.maxTokens > 0) changes.push('token 上限 → ' + String(config.maxTokens))
  return changes
}

// 建议大卡（v16）：卡头只留标题 + 右侧「开启建议」开关；卡体顶部 = 管理子卡
// （浅底紧凑，仅候选时效行 + 全局行，就地浮层随行）；下方 = 建议列表。
function buildAdvicePanel(el, s, actions, sessions) {
  const advice = Array.isArray(s.advice) ? s.advice : []
  const global = s.adviceGlobal !== null && typeof s.adviceGlobal === 'object' ? s.adviceGlobal : null
  const candidates = Array.isArray(s.evolutionCandidates) ? s.evolutionCandidates : []
  const candidatesOf = (profileKey) => candidates.filter((c) => c && typeof c === 'object' && c.profile_key === profileKey)
  if (global === null) return null
  return el('div', { className: 'sap-card sap-cardStatic' },
    el('div', { className: 'sap-cardHead sap-adviceCardHead' },
      el('div', { className: 'sap-adviceHeadTitleRow' },
        el('div', { className: 'sap-cardTitleBox' },
          el('div', { className: 'sap-cardTitle' }, ZH.adviceTitle)
        ),
        el('span', { className: 'sap-rowActions' },
          ZH.adviceEnableLabel,
          el('label', { className: 'sap-switch', title: ZH.adviceTitle },
            el('input', { type: 'checkbox', checked: s.evolutionAdvice, onChange: actions.toggleAdvice }),
            el('span', null, s.evolutionAdvice ? ZH.adviceSwitchOn : ZH.adviceSwitchOff)
          )
        )
      ),
      el('div', { className: 'sap-cardDesc' }, ZH.advicePanelDesc)
    ),
    el('div', { className: 'sap-cardBody' },
      el('div', { className: 'sap-adviceManageCard' },
        buildCandidateSettingsRow(el, s, actions),
        el('p', { className: 'sap-adviceGlobalLine' }, ZH.advicePanelGlobal + '：累计 ' + global.total + ' 次（完成 ' + global.completed + '、失败 ' + global.failed + '、终止 ' + global.killed + '）' + ZH.advicePanelReadonly),
        s.candidateSettingsOpen === true ? buildCandidateSettingsPanel(el, s, actions) : null
      ),
      advice.length === 0
        ? el('p', { className: 'sap-desc' }, ZH.advicePanelEmpty)
        : el('ul', { className: 'sap-rows' },
            advice.map((a) => buildAdviceCard(el, s, actions, a, candidatesOf(a.profileKey), sessions))
          )
    )
  )
}

// 详情小节：纯文字加粗小标题（12px label-primary）+ 内容（13px），无左线/无底块。
function adviceSectionOf(el, title, children) {
  return el('div', { className: 'sap-adviceSection' },
    el('p', { className: 'sap-adviceSectionTitle' }, title),
    children
  )
}

// 单张建议卡（v10）：摘要行 = 对象/建议/置信度/▸（结论三件套，无加权分）；
// 展开区 = 观察期状态行 → 小节序列（理由/近期表现/派发明细/候选方案）→ 撤销建议区
// （regress）→ 进化轨迹 → 操作区；确认/撤销弹窗就地渲染在卡内。
function buildAdviceCard(el, s, actions, a, candidates, sessions) {
  const profile = matchingProfileOf(s.profiles, a.profileKey)
  const metrics = adviceMetricsOf(a.performanceText)
  const rows = s.adviceDetails && typeof s.adviceDetails === 'object' && Array.isArray(s.adviceDetails[a.profileKey]) ? s.adviceDetails[a.profileKey] : []
  const openMap = s.adviceOpen !== null && typeof s.adviceOpen === 'object' ? s.adviceOpen : {}
  const open = openMap[a.profileKey] === true
  const assetView = adviceAssetViewOf(s, a.profileKey)
  const selectedId = candidateSelectedIdOf(s, a.profileKey, candidates)
  const selected = candidates.find((c) => c !== null && typeof c === 'object' && c.id === selectedId)
  const applyModal = s.applyModal ?? {}
  const rollbackModal = s.rollbackModal ?? {}
  const summary = el('button', { type: 'button', className: 'sap-adviceSummary', 'aria-expanded': open, onClick: actions.toggleAdviceOpen(a.profileKey) },
    el('span', { className: 'sap-adviceObjLine' },
      el('span', { className: 'sap-adviceObj' }, adviceSummaryObjectText(profile, a.profileKey)),
      profile === null ? el('span', { className: 'sap-adviceNoProfileTag' }, ZH.adviceNoProfileTag) : null
    ),
    el('span', { className: 'sap-adviceSummaryLine' },
      el('span', { className: 'sap-adviceSummaryText' }, adviceSuggestionShort(a)),
      el('span', { className: 'sap-adviceConf' }, ZH.adviceConfidence + confidenceZhOf(a.confidence)),
      el('span', { className: 'sap-adviceSummaryArrow' }, '▸')))
  const detail = open !== true ? null : el('div', { className: 'sap-adviceDetail' },
    buildAdviceStatusLine(el, assetView),
    typeof a.reasonText === 'string' && a.reasonText !== '' ? adviceSectionOf(el, ZH.adviceSectionReason, el('p', { className: 'sap-adviceSectionBody' }, a.reasonText)) : null,
    metrics.length > 0 ? adviceSectionOf(el, ZH.adviceSectionPerf, el('p', { className: 'sap-adviceSectionBody' }, metrics.join(' · '))) : null,
    adviceSectionOf(el, ZH.adviceSectionDetail, buildAdviceDetails(el, s, actions, a.profileKey, rows, sessions)),
    candidates.length > 0 ? buildAdviceCandidates(el, s, actions, a, candidates) : null,
    assetView !== null ? buildRollbackSuggestion(el, s, actions, assetView) : null,
    buildAdviceTimeline(el, assetView),
    buildAdviceFoot(el, s, actions, a, profile, candidates, assetView),
    applyModal.open === true && applyModal.profileKey === a.profileKey && selected !== undefined ? buildApplyModal(el, s, actions, a, profile, selected) : null,
    rollbackModal.open === true && assetView !== null && rollbackModal.assetId === assetView.id ? buildRollbackModal(el, s, actions, assetView) : null)
  return el('li', { key: String(a.profileKey), className: 'sap-adviceItem' + (open === true ? ' sap-adviceItemOpen' : '') }, summary, detail)
}

// 近期派发明细折叠行：▸ 近期派发明细 · N 次（点击展开）→ 六列表格；默认收起。
function buildAdviceDetails(el, s, actions, profileKey, rows, sessions) {
  const map = s.detailOpen !== null && typeof s.detailOpen === 'object' ? s.detailOpen : {}
  const open = map[profileKey] === true
  const header = el('tr', null,
    el('th', null, ZH.adviceDetailColTime), el('th', null, ZH.adviceDetailColSession), el('th', null, ZH.adviceDetailColChild),
    el('th', null, ZH.adviceDetailColOutcome), el('th', null, ZH.adviceDetailColElapsed), el('th', null, ZH.adviceDetailColMode))
  const cell = (row) => {
    const outcomeZh = ZH.dispatchOutcomeZh[row.outcome] || row.outcome || ''
    const bad = row.outcome === 'failed' || row.outcome === 'killed'
    const title = reminderSessionTitle(sessions, row.sessionId)
    return el('tr', { key: String(row.ts ?? '') + String(row.childId ?? '') },
      el('td', { className: 'sap-adviceDetailTime' }, formatMonthDayTime(row.ts)),
      el('td', null, title !== '' ? el('span', { className: 'sap-adviceDetailSession' }, title) : null,
        sessionIdShortOf(row.sessionId) !== '' ? el('span', { className: 'sap-adviceDetailSessionId' }, sessionIdShortOf(row.sessionId)) : null),
      el('td', { className: 'sap-adviceDetailChild' }, childIdShortOf(row.childId)),
      el('td', { className: bad ? 'sap-warn-x' : '' }, outcomeZh),
      el('td', null, formatDurationMs(row.elapsedMs)),
      el('td', null, dispatchModeZh(row.mode)))
  }
  return el('div', { className: 'sap-adviceDetailBlock' },
    el('button', { type: 'button', className: 'sap-adviceDetailToggle', 'aria-expanded': open, onClick: actions.toggleDetail(profileKey) },
      el('span', null, ZH.adviceDetailTogglePrefix + rows.length + ZH.adviceDetailToggleSuffix),
      el('span', { className: 'sap-adviceDetailArrow' }, '▸')),
    open !== true ? null : (rows.length === 0
      ? el('p', { className: 'sap-candidateHint' }, ZH.adviceDetailEmpty)
      : el('table', { className: 'sap-adviceDetailTable' }, el('thead', null, header), el('tbody', null, rows.map(cell))))
  )
}

// ── 观察期/撤销建议/进化轨迹（数据源 = /evolution/assets 派生视图）──────────

// 建议卡对应资产视图：同键资产取最近一条（观察期/已应用优先于纯草稿）；无资产 → null。
function adviceAssetViewOf(s, profileKey) {
  const assets = Array.isArray(s.evolutionAssets) ? s.evolutionAssets : []
  const owned = assets.filter((a) => a && typeof a === 'object' && a.profile_key === profileKey)
  if (owned.length === 0) return null
  const rank = (a) => (a && a.canary && typeof a.canary === 'object' && a.canary.state !== 'pendingApply' ? 1 : 0)
  return owned.sort((a, b) => rank(b) - rank(a) || (Number.isFinite(b.updatedAt) ? b.updatedAt : 0) - (Number.isFinite(a.updatedAt) ? a.updatedAt : 0))[0]
}

// 候选行徽标对应资产（按候选 id = 资产 id）。
function candidateAssetByIdOf(s, id) {
  const assets = Array.isArray(s.evolutionAssets) ? s.evolutionAssets : []
  return assets.find((a) => a && a.id === id) ?? null
}

// 观察期状态行：regress 警示强调（结论先行）；其余次级色；pendingApply 不显示。
function buildAdviceStatusLine(el, view) {
  const canary = view !== null && typeof view === 'object' ? view.canary : null
  if (canary === null || typeof canary !== 'object' || canary.state === 'pendingApply') return null
  const warn = canary.state === 'regress'
  const suffix = canary.state === 'observing' ? ZH.adviceStatusObservingSuffix : ''
  return el('div', { className: 'sap-adviceStatusLine' + (warn ? ' sap-adviceStatusLineWarn' : '') },
    el('span', null, String(canary.label ?? '') + suffix))
}

// 恢复目标名：fromSnapshot 方案名列表；空快照回退通用文案（回滚 = 移除应用方案）。
function rollbackRestoreNameOf(asset) {
  const snapshot = asset !== null && typeof asset === 'object' ? asset.fromSnapshot : null
  const profiles = snapshot !== null && typeof snapshot === 'object' && Array.isArray(snapshot.profiles) ? snapshot.profiles : []
  const names = profiles.map((p) => (p && p.config && typeof p.config.name === 'string' && p.config.name !== '' ? p.config.name : (p && p.config && p.config.id))).filter((n) => typeof n === 'string' && n !== '')
  return names.length > 0 ? names.join('、') : ZH.adviceRestoreFallback
}

// 表现分 → 百分制整数（证据对照行口径，与「满分 100」一致）。
function adviceScore100(score) {
  return Number.isFinite(score) ? Math.round(score * 100) : '—'
}

function rollbackEvidenceTextOf(asset) {
  const canary = asset !== null && typeof asset === 'object' && asset.canary !== null && typeof asset.canary === 'object' ? asset.canary : {}
  const post = canary.post !== null && typeof canary.post === 'object' ? canary.post : null
  const base = canary.baseline !== null && typeof canary.baseline === 'object' ? canary.baseline : null
  const n = post !== null && Number.isFinite(post.sampleN) ? post.sampleN : 0
  return ZH.adviceRollbackEvidence.replace('{before}', adviceScore100(base === null ? null : base.weighted_success)).replace('{after}', adviceScore100(post === null ? null : post.weighted_success)).replace('{n}', n)
}

function tierZhOf(tier) {
  return tier === 'cheap' ? '低' : tier === 'premium' ? '高' : '中'
}

// 撤销确认弹窗「会改变」行：模型/预算档位/推理强度变化 + 自定义项一并恢复。
function rollbackChangeTextOf(asset) {
  const parts = []
  const applied = asset !== null && typeof asset === 'object' && asset.applied_config !== null && typeof asset.applied_config === 'object' ? asset.applied_config : {}
  const snapshot = asset !== null && typeof asset === 'object' && asset.fromSnapshot !== null && typeof asset.fromSnapshot === 'object' && Array.isArray(asset.fromSnapshot.profiles) ? asset.fromSnapshot.profiles : []
  const before = snapshot.length > 0 && snapshot[0].config !== null && typeof snapshot[0].config === 'object' ? snapshot[0].config : {}
  if (before.model !== undefined || applied.model !== undefined) parts.push('模型 ' + (before.model || '未指定') + ' → ' + (applied.model || '未指定'))
  if (before.tokenTier !== undefined && applied.tokenTier !== undefined && before.tokenTier !== applied.tokenTier) {
    parts.push('预算档位 ' + tierZhOf(before.tokenTier) + ' → ' + tierZhOf(applied.tokenTier) + '，成本可能回升')
  } else if (before.reasoningEffort !== undefined && applied.reasoningEffort !== undefined && before.reasoningEffort !== applied.reasoningEffort) {
    parts.push('推理强度已上调，成本可能回升')
  }
  parts.push(ZH.adviceRollbackChangeSuffix)
  return parts.join('；')
}

// 撤销建议区（regress）：结论先行在状态行，本区 = 建议/恢复为/证据 + 双按钮；
// 用户已选择保留 → 只读「已选择」行；无表态前常驻只读（不自动执行任何动作）。
function buildRollbackSuggestion(el, s, actions, asset) {
  const canary = asset !== null && typeof asset === 'object' && asset.canary !== null && typeof asset.canary === 'object' ? asset.canary : {}
  if (canary.state !== 'regress') return null
  if (canary.kept === true) {
    return el('div', { className: 'sap-rollbackBox' }, el('p', { className: 'sap-rollbackBoxKeep' }, ZH.adviceRollbackKeepDone))
  }
  return el('div', { className: 'sap-rollbackBox' },
    el('p', { className: 'sap-applyModalLine' }, ZH.adviceRollbackBoxAdvice),
    el('p', { className: 'sap-rollbackBoxLine' }, ZH.adviceRollbackRestorePrefix, el('b', null, rollbackRestoreNameOf(asset))),
    el('p', { className: 'sap-rollbackBoxLine' }, rollbackEvidenceTextOf(asset)),
    el('div', { className: 'sap-rollbackBoxActions' },
      el('button', { type: 'button', className: 'sap-secondaryButton sap-rollbackDanger', style: smallBtn, onClick: actions.openRollbackModal(asset.id) }, ZH.adviceRollbackBtn),
      el('button', { type: 'button', className: 'sap-secondaryButton', style: smallBtn, onClick: actions.keepAsset(asset.id) }, ZH.adviceRollbackKeepBtn)))
}

// 成本与能力影响行（确认弹窗）：降级/上调方向 + 预算档位变化。
function applyImpactTextOf(profile, candidate, suggestion) {
  const cfg = candidate !== null && typeof candidate === 'object' && candidate.config !== null && typeof candidate.config === 'object' ? candidate.config : {}
  const parts = [suggestion === '降' ? ZH.adviceApplyImpactDown : suggestion === '升' ? ZH.adviceApplyImpactUp : ZH.adviceApplyImpactFlat]
  if (profile !== null && cfg.tokenTier !== undefined && profile.tokenTier !== undefined && cfg.tokenTier !== profile.tokenTier) {
    parts.push('预算档位 ' + tierZhOf(profile.tokenTier) + ' → ' + tierZhOf(cfg.tokenTier))
  }
  return parts.join('；')
}

// 应用确认弹窗：候选摘要（名称/方向/安全检查）/成本与能力影响/两条说明行；
// 主按钮「确认调整方案」即执行（humanConfirmed 由点击触发，无强制勾选），失败红字回显。
function buildApplyModal(el, s, actions, a, profile, candidate) {
  const modal = s.applyModal ?? {}
  const preview = s.draftPreviews !== null && typeof s.draftPreviews === 'object' ? s.draftPreviews[candidate.id] : undefined
  const checks = preview !== undefined && preview.checks !== null && typeof preview.checks === 'object' && Array.isArray(preview.checks) ? preview.checks : []
  const safety = preview === undefined ? ZH.candidateSafetyPending
    : preview.ok === true ? ZH.adviceApplySafetyNote + ZH.candidateSafetyPass.replace(' ✓', '') + ' ' + checks.length + '/' + checks.length
    : ZH.adviceApplySafetyNote + ZH.candidateSafetyFail
  return el('div', { className: 'sap-applyModal' },
    el('div', { className: 'sap-applyModalHead' }, el('span', { className: 'sap-applyModalTitle' }, ZH.adviceApplyConfirm)),
    el('div', null,
      el('p', { className: 'sap-applyModalLabel' }, ZH.adviceApplyModalSummary),
      el('p', { className: 'sap-applyModalLine' }, candidate.name + ' · ' + directionZh(a.suggestion)),
      el('p', { className: 'sap-applyModalLineDim' }, safety)),
    el('div', null,
      el('p', { className: 'sap-applyModalLabel' }, ZH.adviceApplyModalImpact),
      el('p', { className: 'sap-applyModalLine' }, applyImpactTextOf(profile, candidate, a.suggestion))),
    el('p', { className: 'sap-applyModalLineDim' }, ZH.adviceApplyDefaultNote),
    el('p', { className: 'sap-applyModalLineDim' }, ZH.adviceApplyObserveNote),
    modal.error !== '' ? el('p', { className: 'sap-notice' }, modal.error) : null,
    el('div', { className: 'sap-applyModalActions' },
      el('button', { type: 'button', className: 'sap-secondaryButton', onClick: actions.closeApplyModal }, ZH.adviceApplyCancel),
      el('button', { type: 'button', className: 'sap-primaryButton', onClick: actions.applyCandidate }, ZH.adviceApplyConfirm)))
}

// 撤销确认弹窗：恢复为/会改变/说明 + 确认撤销（朱砂描边）/取消；失败红字回显。
function buildRollbackModal(el, s, actions, asset) {
  const modal = s.rollbackModal ?? {}
  return el('div', { className: 'sap-applyModal' },
    el('div', { className: 'sap-applyModalHead' }, el('span', { className: 'sap-applyModalTitle' }, ZH.adviceRollbackModalTitle)),
    el('div', null,
      el('p', { className: 'sap-applyModalLabel' }, ZH.adviceRollbackModalRestore),
      el('p', { className: 'sap-applyModalLine' }, rollbackRestoreNameOf(asset))),
    el('div', null,
      el('p', { className: 'sap-applyModalLabel' }, ZH.adviceRollbackModalChange),
      el('p', { className: 'sap-applyModalLine' }, rollbackChangeTextOf(asset))),
    el('p', { className: 'sap-applyModalLineDim' }, ZH.adviceRollbackModalNote),
    modal.error !== '' ? el('p', { className: 'sap-notice' }, modal.error) : null,
    el('div', { className: 'sap-applyModalActions' },
      el('button', { type: 'button', className: 'sap-secondaryButton', onClick: actions.closeRollbackModal }, ZH.adviceApplyCancel),
      el('button', { type: 'button', className: 'sap-secondaryButton sap-rollbackDanger', onClick: actions.rollbackAsset }, ZH.adviceRollbackConfirm)))
}

// 轨迹单事件文案：生成（MM-DD）/应用（MM-DD · 人工确认）/观察（k/kTotal）/
// 判定：…/撤销·保留：…（未发生步骤灰字由 buildAdviceTimeline 补）。
function timelineEventTextOf(event) {
  if (event.event === 'generated') return '生成（' + formatMonthDayTime(event.ts) + '）'
  if (event.event === 'applied') return '应用（' + formatMonthDayTime(event.ts) + (typeof event.meta === 'string' && event.meta !== '' ? ' · ' + event.meta : '') + '）'
  if (event.event === 'observed') return '观察（' + (typeof event.meta === 'string' ? event.meta : '') + '）'
  if (event.event === 'judged') return '判定：' + (typeof event.meta === 'string' && event.meta !== '' ? event.meta : ZH.adviceTimelinePending)
  if (event.event === 'resolved') return '撤销/保留：' + (typeof event.meta === 'string' && event.meta !== '' ? event.meta : ZH.adviceTimelinePending)
  return event.event
}

// 进化轨迹小节：assets lifecycle 行式时间线；未应用（无 applied 事件）或缺生命周期
// 数据 → 隐藏小节。未发生步骤（判定/处理）灰字补位。
function buildAdviceTimeline(el, view) {
  const lifecycle = view !== null && typeof view === 'object' && Array.isArray(view.lifecycle) ? view.lifecycle : []
  if (lifecycle.length === 0 || !lifecycle.some((e) => e.event === 'applied')) return null
  const chain = []
  const push = (text, dim) => chain.push(el('span', { key: String(chain.length), className: dim === true ? 'sap-adviceTimelineStepDim' : 'sap-adviceTimelineStep' }, text))
  for (const event of lifecycle) {
    if (chain.length > 0) chain.push(el('span', { key: 'sep' + chain.length }, ZH.adviceTimelineSep))
    push(timelineEventTextOf(event), false)
  }
  const has = (kind) => lifecycle.some((e) => e.event === kind)
  if (!has('judged')) { chain.push(el('span', { key: 'sepd' }, ZH.adviceTimelineSep)); push('判定：' + ZH.adviceTimelinePending, true) }
  if (!has('resolved')) { chain.push(el('span', { key: 'sepr' }, ZH.adviceTimelineSep)); push('撤销/保留：' + ZH.adviceTimelinePending, true) }
  return adviceSectionOf(el, ZH.adviceTimelineTitle, el('p', { className: 'sap-adviceTimelineLine' }, chain))
}

// 候选管理设置（顶部一行 + 就地浮层）：更新模式与有效期用户可配；
// 自定义按天数输入（1~365），提交时换算小时数。
function candidateModeTextOf(mode) {
  return mode === 'manual' ? ZH.candidateModeManual : ZH.candidateModeAuto
}

function candidateTtlTextOf(ttlH) {
  if (ttlH === 0) return ZH.candidateTtl0
  if (ttlH === 24) return ZH.candidateTtl24
  if (ttlH === 72) return ZH.candidateTtl72
  if (ttlH === 168) return ZH.candidateTtl168
  return ttlH + ' 小时'
}

function candidateTtlChoiceOf(ttlH) {
  return ttlH === 0 || ttlH === 24 || ttlH === 72 || ttlH === 168 ? String(ttlH) : 'custom'
}

function buildCandidateSettingsRow(el, s, actions) {
  const settings = s.candidateSettings !== null && typeof s.candidateSettings === 'object' ? s.candidateSettings : { candidateMode: 'auto', candidateTtlH: 24 }
  return el('p', { className: 'sap-candidateSettingsRow' },
    el('b', null, ZH.candidateSettingsRow),
    el('span', null, candidateModeTextOf(settings.candidateMode) + ' · ' + ZH.candidateTtlLabel + ' ' + candidateTtlTextOf(settings.candidateTtlH)),
    el('button', { type: 'button', className: 'sap-candidateSettingsEdit', onClick: actions.toggleCandidateSettings }, ZH.candidateSettingsEdit))
}

function candidateSettingsRadio(el, label, value, current, onChange) {
  return el('label', { key: value, className: 'sap-candidateSettingsOption' },
    el('input', { type: 'radio', checked: current === value, onChange }),
    el('span', null, label))
}

function buildCandidateSettingsPanel(el, s, actions) {
  const form = s.candidateSettingsForm !== null && typeof s.candidateSettingsForm === 'object' ? s.candidateSettingsForm : {}
  const mode = form.candidateMode === 'manual' ? 'manual' : 'auto'
  const ttlChoice = typeof form.candidateTtlChoice === 'string' ? form.candidateTtlChoice : '24'
  const ttlOptions = [['24', ZH.candidateTtl24], ['72', ZH.candidateTtl72], ['168', ZH.candidateTtl168], ['0', ZH.candidateTtl0], ['custom', ZH.candidateTtlCustom]]
  return el('div', { className: 'sap-candidateSettingsPanel' },
    el('div', { className: 'sap-candidateSettingsField' },
      el('span', { className: 'sap-fieldLabel' }, ZH.candidateSettingsModeLabel),
      el('div', { className: 'sap-candidateSettingsOptions' },
        candidateSettingsRadio(el, ZH.candidateModeAuto + '（推荐）', 'auto', mode, actions.setCandidateFormMode('auto')),
        candidateSettingsRadio(el, ZH.candidateModeManual, 'manual', mode, actions.setCandidateFormMode('manual'))),
      el('p', { className: 'sap-metaValueDefault' }, mode === 'manual' ? ZH.candidateSettingsModeManualText : ZH.candidateSettingsModeAutoText)),
    el('div', { className: 'sap-candidateSettingsField' },
      el('span', { className: 'sap-fieldLabel' }, ZH.candidateTtlLabel),
      el('div', { className: 'sap-candidateSettingsOptions' },
        ttlOptions.map(([value, label]) => candidateSettingsRadio(el, label, value, ttlChoice, actions.setCandidateFormTtl(value)))),
      ttlChoice === 'custom'
        ? el('div', { className: 'sap-candidateSettingsCustom' },
            el('input', { className: 'sap-input', value: typeof form.customDays === 'string' ? form.customDays : '', placeholder: '1~365', onChange: (event) => actions.setCandidateFormCustomDays(event && event.target ? event.target.value : '') }),
            el('span', { className: 'sap-metaValueDefault' }, ZH.candidateSettingsCustomLabel))
        : null,
      form.error !== '' ? el('p', { className: 'sap-notice' }, form.error) : null),
    el('div', { className: 'sap-candidateSettingsActions' },
      el('button', { type: 'button', className: 'sap-primaryButton', onClick: actions.saveCandidateSettings }, ZH.candidateSettingsSave),
      el('button', { type: 'button', className: 'sap-secondaryButton', onClick: actions.cancelCandidateSettings }, ZH.candidateSettingsCancel)))
}

// 候选方案区（v10 小节）：纯文字加粗小节标题「候选方案（未应用）」+ 上分隔线 →
// 数量/单选说明行（手动维护附重新生成）→ 候选项列表（行点击只展开，radio 只选中）。
function buildAdviceCandidates(el, s, actions, a, candidates) {
  const manual = s.candidateSettings !== null && typeof s.candidateSettings === 'object' && s.candidateSettings.candidateMode === 'manual'
  const selected = candidateSelectedIdOf(s, a.profileKey, candidates)
  return el('div', { className: 'sap-candidates' },
    el('p', { className: 'sap-candidatesTitle' }, ZH.candidateTitle, el('span', { className: 'sap-candidatesNotApplied' }, ZH.candidateNotApplied)),
    el('p', { className: 'sap-candidatesCount' }, candidates.length + ZH.candidateCountSuffix + ZH.candidateCountNote),
    manual === true
      ? el('button', { type: 'button', className: 'sap-detailToggle', onClick: actions.regenerateCandidates(a.profileKey) }, ZH.candidateRegenerate)
      : null,
    candidates.map((candidate, index) => buildAdviceCandidateRow(el, s, actions, a, candidate, index, selected))
  )
}

// 默认选中第一条候选；用户选择存进状态（仅选中，行点击只展开）。
function candidateSelectedIdOf(s, profileKey, candidates) {
  const map = s.candidateSelected !== null && typeof s.candidateSelected === 'object' ? s.candidateSelected : {}
  const current = typeof map[profileKey] === 'string' ? map[profileKey] : ''
  if (current !== '' && candidates.some((c) => c && c.id === current)) return current
  return candidates.length > 0 ? candidates[0].id : ''
}

function buildAdviceCandidateRow(el, s, actions, a, candidate, index, selected) {
  const cfg = candidate.config && typeof candidate.config === 'object' ? candidate.config : {}
  const openState = s.candidateOpen !== null && typeof s.candidateOpen === 'object' ? s.candidateOpen : {}
  const safetyState = s.candidateSafetyOpen !== null && typeof s.candidateSafetyOpen === 'object' ? s.candidateSafetyOpen : {}
  const open = openState[candidate.id] === true
  const safetyOpen = safetyState[candidate.id] === true
  const preview = s.draftPreviews && typeof s.draftPreviews === 'object' ? s.draftPreviews[candidate.id] : undefined
  const changes = candidateChangesOf(a.profileKey, cfg)
  const onRadio = (event) => {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
    actions.selectCandidate(a.profileKey, candidate.id)()
  }
  const asset = candidateAssetByIdOf(s, candidate.id)
  const stateLabel = asset !== null && typeof asset.stateLabel === 'string' && asset.stateLabel !== '' ? asset.stateLabel : null
  return el('div', { key: String(candidate.id), className: 'sap-candidate' + (selected === candidate.id ? ' sap-candidateSelected' : '') },
    el('button', { type: 'button', className: 'sap-candidateRow', 'aria-expanded': open, onClick: actions.toggleCandidateOpen(candidate) },
      el('span', { role: 'radio', 'aria-checked': selected === candidate.id, className: 'sap-candidateRadio', onClick: onRadio }),
      el('span', { className: 'sap-candidateName' }, '候选 ' + (index + 1) + ' · ' + candidate.name),
      stateLabel !== null ? el('span', { className: 'sap-candidateState' }, stateLabel) : null,
      el('span', { className: 'sap-candidateValidity' }, candidateValidityText(candidate.expiry)),
      el('span', { className: 'sap-candidateArrow' }, '▸')),
    open === true ? el('div', { className: 'sap-candidateBody' },
      changes.length > 0 ? el('div', { className: 'sap-candidateGroup' },
        el('p', { className: 'sap-candidateGroupTitle' }, ZH.candidateGroupChanges),
        el('ul', { className: 'sap-candidateChanges' },
          changes.map((change) => el('li', { key: change, className: 'sap-candidateChange' }, change)))) : null,
      preview !== undefined
        ? el('div', { className: 'sap-candidateGroup' },
            el('button', { type: 'button', className: 'sap-candidateSafetyToggle' + (safetyOpen === true ? ' sap-candidateSafetyToggleOpen' : ''), onClick: actions.toggleCandidateSafety(candidate) },
              ZH.candidateSafetyPrefix + (preview.ok === true ? ZH.candidateSafetyPass : ZH.candidateSafetyFail),
              el('span', { className: 'sap-candidateSafetyArrow' }, '▸')),
            safetyOpen === true ? buildCandidateSafetyChecks(el, preview) : null)
        : el('div', { className: 'sap-candidateGroup' },
            el('p', { className: 'sap-candidateHint' }, ZH.candidateSafetyPending)),
      el('div', { className: 'sap-candidateGroup' },
        el('p', { className: 'sap-candidateGroupTitle' }, ZH.candidateGroupGenerated),
        candidateGeneratedLine(el, candidate),
        el('p', { className: 'sap-candidateHint' }, ZH.candidateNotApplicable))) : null)
}

// 生成信息行（最浅灰，两分支模板）：有样本 = 生成于 MM-DD · 基于最近 N 次派发 ·
// 近期表现 X（满分 100，X=round(表现分×100)）；无样本 = 生成于 MM-DD · 暂无近期派发
// 样本，仅供参考（不显示 0 分）；无生成时间省去「生成于」段。
function candidateGeneratedLine(el, candidate) {
  const basis = candidate.basis !== null && typeof candidate.basis === 'object' ? candidate.basis : {}
  const n = Number.isFinite(basis.n) ? basis.n : 0
  const score100 = Number.isFinite(basis.score) ? Math.round(basis.score * 100) : 0
  const generated = formatMonthDayTime(basis.generatedAt)
  const parts = []
  if (generated !== '') parts.push(ZH.candidateGeneratedPrefix + generated)
  if (n >= 1) {
    parts.push(ZH.candidateSamplesPrefix + n + ZH.candidateSamplesSuffix)
    parts.push(ZH.candidatePerfPrefix + score100 + ZH.candidatePerfSuffix)
  } else {
    parts.push(ZH.candidateNoSample)
  }
  return el('p', { className: 'sap-candidateHint' }, parts.join(' · '))
}

// 卡底部：无对应方案 = [保存为方案]（统一主按钮）+ 备注；有对应方案 = [按建议调整
// 方案] + 定位。按钮启用条件 = applyEnabled && 已选候选；禁用 title = 禁用原因
// （冷启动 = reasons.join('；') 并附卡脚一行灰字；观察中 = 暂不支持再次调整）。
function buildAdviceFoot(el, s, actions, a, profile, candidates, assetView) {
  const basis = (Array.isArray(candidates) && candidates.length > 0 && candidates[0] !== null && typeof candidates[0] === 'object' && candidates[0].basis !== null && typeof candidates[0].basis === 'object') ? candidates[0].basis : {}
  const generatedAt = formatMonthDayTime(basis.generatedAt)
  const generatedText = generatedAt !== '' ? ZH.candidateGeneratedPrefix + generatedAt : ''
  const noteLines = (lines) => el('div', { className: 'sap-adviceFootNotes' }, lines.map((line) => el('p', { key: line, className: 'sap-adviceFootNote' }, line)))
  if (profile === null) {
    return el('div', { className: 'sap-adviceFoot' },
      el('button', { type: 'button', className: 'sap-primaryButton', style: smallBtn, onClick: actions.saveAdviceProfile(a.profileKey) }, ZH.adviceSaveProfile),
      noteLines([ZH.adviceFootNoteSave]))
  }
  const status = s.evolutionStatus ?? {}
  const applyEnabled = status.applyEnabled === true
  const selectedId = candidateSelectedIdOf(s, a.profileKey, candidates)
  const canaryState = assetView !== null && assetView.canary !== null && typeof assetView.canary === 'object' ? assetView.canary.state : 'pendingApply'
  const observing = canaryState === 'observing' || canaryState === 'stalled' || canaryState === 'inconclusive' || canaryState === 'regress' || canaryState === 'aborted'
  let disabledTitle = ''
  if (observing) disabledTitle = ZH.adviceApplyObservingTitle
  else if (!applyEnabled) disabledTitle = Array.isArray(status.reasons) && status.reasons.length > 0 ? status.reasons.join('；') : ZH.candidateNotApplicable
  else if (selectedId === '') disabledTitle = ZH.adviceApplySelectTitle
  const disabled = disabledTitle !== ''
  const notes = [ZH.adviceFootNoteMatchedPrefix + (profile.name || profile.id) + '（' + profile.id + '）']
  if (generatedText !== '') notes.push(generatedText)
  if (!applyEnabled && !observing) notes.push(disabledTitle)
  return el('div', { className: 'sap-adviceFoot' },
    el('button', { type: 'button', className: 'sap-secondaryButton', style: smallBtn, disabled, title: disabledTitle, onClick: disabled ? undefined : actions.openApplyModal(a.profileKey, selectedId) }, ZH.adviceApplyDisabled),
    el('button', { type: 'button', className: 'sap-detailToggle', onClick: actions.locateProfile(profile.id) }, ZH.adviceRowLocate),
    noteLines(notes))
}

// 逃生舱卡片：开关 + （打开时）显式警告文案 + 放行集增删（输入框 + 添加按钮，
// 每项「移除」按钮）。增删走 /escape-add /escape-remove，成功后用响应 presets 刷新。
function buildEscapeSection(el, s, actions) {
  const list = Array.isArray(s.escapePresets) ? s.escapePresets : []
  return el('div', { className: 'sap-card sap-cardStatic' },
    el('div', { className: 'sap-cardHead' },
      el('div', { className: 'sap-cardTitleBox' },
        el('div', { className: 'sap-cardTitle' }, ZH.escapeTitle),
        el('div', { className: 'sap-cardDesc' }, ZH.escapeCardDesc)
      ),
      el('span', { className: 'sap-rowActions' },
        el('label', { className: 'sap-switch', title: '逃生舱开关' },
          el('input', { type: 'checkbox', checked: s.escapeEnabled, onChange: actions.toggleEscape }),
          el('span', null, s.escapeEnabled ? '已启用' : '已禁用')
        )
      )
    ),
    el('div', { className: 'sap-cardBody' },
      s.escapeEnabled
        ? el('p', { className: 'sap-notice', role: 'alert' }, ZH.escapeWarn)
        : null,
      el('div', { className: 'sap-escapeAdd' },
        el('input', {
          className: 'sap-input',
          style: { flex: '1 1 0', minWidth: '160px' },
          value: s.escapeInput,
          placeholder: ZH.escapeInputPlaceholder,
          onChange: (event) => s.setEscapeInput(event && event.target ? event.target.value : '')
        }),
        el('button', { type: 'button', className: 'sap-secondaryButton', style: smallBtn, onClick: actions.escapeAdd }, ZH.escapeAdd)
      ),
      el('div', { className: 'sap-chips' },
        list.length === 0
          ? el('span', { className: 'sap-chipValueDim' }, ZH.escapeEmpty)
          : list.map((id) => el('span', { key: String(id), className: 'sap-chip sap-chipWarn' },
              String(id),
              el('button', { type: 'button', className: 'sap-chipRemove', title: ZH.escapeRemove, onClick: actions.escapeRemove(id) }, ZH.escapeRemove)
            ))
      )
    )
  )
}

// 设置页卡片骨架：折叠卡 = 标题 + 一句话描述 + SVG chevron（固定 14px，展开旋转 180°）；
// 静态卡无 chevron，内容常驻展示。折叠的唯一理由是内容多占空间。
function buildSettingsCard(el, key, title, desc, open, toggle, body, isStatic) {
  const titleBox = el('div', { className: 'sap-cardTitleBox' },
    el('div', { className: 'sap-cardTitle' }, title),
    el('div', { className: 'sap-cardDesc' }, desc)
  )
  const head = isStatic === true
    ? el('div', { className: 'sap-cardHead' }, titleBox)
    : el('button', { type: 'button', className: 'sap-cardHead sap-cardToggle', 'aria-expanded': open, onClick: () => toggle(key) }, titleBox,
        el('svg', { className: 'sap-cardChevron', viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
          el('path', { d: 'M 4 6l4 4 4-4' })
        )
      )
  const cardClass = isStatic === true ? 'sap-card sap-cardStatic' : 'sap-card' + (open === true ? ' sap-cardOpen' : '')
  return el('div', { className: cardClass }, head,
    isStatic === true || open === true ? el('div', { className: 'sap-cardBody' }, body) : null
  )
}

// 审计健康状态行：health + 审计丢失（health 唯一位置；丢失 >0 红字）。目录/告警
// 计数不重复（版本告警正文在维护页签，一个数字只出现一次）；现挂在安全页签审计健康卡。
function buildStatusBar(el, s) {
  const degraded = s.audit.health === 'degraded'
  const lost = s.audit.lostTelemetry + s.audit.lostGovernance
  return el('div', { className: 'sap-statusBar' },
    el('span', { className: degraded ? 'sap-statusBad sap-statusBadFail' : 'sap-statusBad' }, degraded ? '健康 ⚠ 已降级' : '健康 ✅'),
    el('span', { className: lost > 0 ? 'sap-statusBadFail' : 'sap-statusDim' }, ZH.statusLost + ' ' + lost + (lost > 0 ? ' 条（请检查磁盘）' : ' 条'))
  )
}

function buildSectionNotices(el, s) {
  return [
    !s.enabled ? el('p', { className: 'sap-notice' }, '插件已禁用：「派发子 Agent」工具已从模型工具列表中移除，打开开关即可恢复。') : null,
    s.error !== '' ? el('p', { className: 'sap-notice' }, s.error) : null,
    s.savedNotice !== '' ? el('p', { className: 'sap-savedNotice', role: 'status' }, s.savedNotice) : null,
    s.persistWarning !== '' ? el('p', { className: 'sap-warn', role: 'alert' }, `${s.persistWarning}${ZH.persistFailHint}`) : null
  ]
}

// draft 安全检查预览结果：ok 全绿/存在拒绝，逐项展示 verdict + reason。
// 检查项名走 CHECK_ZH 人话映射（可见面零内部术语），title 保留原串供排查。
function buildDraftPreview(el, preview) {
  const checks = Array.isArray(preview.checks) ? preview.checks : []
  return el('div', { className: 'sap-draftPreview' },
    el('p', { className: preview.ok ? 'sap-savedNotice' : 'sap-warn', role: 'status' }, preview.ok ? ZH.draftPreviewPass : ZH.draftPreviewFail),
    el('ul', { className: 'sap-rows' },
      checks.map((c) => el('li', { key: String(c.name), className: 'sap-rowCard' },
        el('div', { className: 'sap-rowHead' }, el('span', { className: 'sap-rowName', title: c.name }, (c.verdict === 'pass' ? '✅ ' : '❌ ') + (CHECK_ZH[c.name] || c.name))),
        c.reason ? el('p', { className: 'sap-desc' }, c.reason) : null
      ))
    )
  )
}

// draft 列表（设置页 [1] 内）：每个 draft 可预览过闸结果、应用或删除。
function buildDraftRows(el, s, actions) {
  if (!Array.isArray(s.drafts) || s.drafts.length === 0) return null
  return el('div', { className: 'sap-drafts' },
    el('div', { className: 'sap-draftTitle' }, '待确认 draft'),
    el('ul', { className: 'sap-rows' },
      s.drafts.map((draft) => {
        const preview = s.draftPreviews && typeof s.draftPreviews === 'object' ? s.draftPreviews[draft.id] : undefined
        return el('li', { key: String(draft.id), className: 'sap-rowCard' },
          el('div', { className: 'sap-rowHead' },
            el('span', { className: 'sap-rowIdentity' },
              el('span', { className: 'sap-rowName' }, draft.name || draft.id),
              el('span', { className: 'sap-rowId' }, draft.config && draft.config.id || '')
            ),
            el('span', { className: 'sap-rowActions' },
              el('button', { className: 'sap-secondaryButton', style: smallBtn, onClick: actions.previewDraft(draft) }, ZH.draftPreview),
              el('button', { className: 'sap-secondaryButton', style: smallBtn, onClick: actions.applyDraft(draft) }, '应用'),
              el('button', { className: 'sap-dangerButton', onClick: actions.removeDraft(draft) }, '删除')
            )
          ),
          draft.description !== '' ? el('p', { className: 'sap-desc' }, draft.description) : null,
          preview !== undefined ? buildDraftPreview(el, preview) : null
        )
      })
    )
  )
}

// 全局成本数据行：只展示「全部会话」口径，不带内部技术词；各会话明细另行走会话页。
function buildCostGlobalCard(el, global) {
  if (global === null || typeof global !== 'object') return null
  return el('p', { className: 'sap-costLine' },
    [
      global.priced > 0 ? '全部会话估算 ≈' + global.estimated_cost + ' 元' : '',
      ZH.costInherit + ' ≈' + global.estimated_inherit_cost + ' 元',
      ZH.costSaving + ' ≈' + global.estimated_saving + ' 元',
      ZH.costPriced + ' ' + global.priced + ' 次',
      ZH.costInheritRatio + ' ' + Math.round((global.inherit_ratio ?? 0) * 100) + '%'
    ].filter(Boolean).join(' · ')
  )
}

function buildCostByModel(el, byModel, profiles, actions) {
  if (!Array.isArray(byModel) || byModel.length === 0) return null
  return el('div', null,
    el('div', { className: 'sap-draftTitle' }, ZH.costByModel),
    el('ul', { className: 'sap-rows' },
      byModel.map((m) => {
        const profile = Array.isArray(profiles) ? profiles.find((p) => p && p.model === m.model) : undefined
        return el('li', { key: String(m.model), className: 'sap-rowCard' },
          el('div', { className: 'sap-rowHead' },
            el('span', { className: 'sap-rowIdentity' },
              el('span', { className: 'sap-rowName' }, String(m.model)),
              el('span', { className: 'sap-rowId' }, m.deployments + ' 次')
            ),
            el('span', { className: 'sap-rowActions' },
              profile !== undefined
                ? el('button', { className: 'sap-detailToggle', onClick: actions.locateProfile(profile.id) }, ZH.costEditProfile)
                : el('span', { className: 'sap-metaValueDefault' }, ZH.costNoProfile)
            )
          ),
          el('p', { className: 'sap-costLine' },
            [
              m.avg_cost !== null && m.avg_cost !== undefined ? '平均 ≈' + m.avg_cost + ' 元/次' : '',
              m.priced > 0 ? '估算 ≈' + m.estimated_cost + ' 元' : ''
            ].filter(Boolean).join(' · '))
        )
      })
    )
  )
}

function buildCostObservabilitySection(el, s, actions) {
  const summary = s.costSummary
  const global = summary && typeof summary.global === 'object' ? summary.global : null
  const byModel = summary && Array.isArray(summary.byModel) ? summary.byModel : []
  const globalBlock = buildCostGlobalCard(el, global)
  const modelBlock = buildCostByModel(el, byModel, s.profiles, actions)
  const scopeGuide = el('p', { className: 'sap-metaValueDefault' }, '各会话的成本明细见会话页「派发决策台账」')
  if (globalBlock === null && modelBlock === null) {
    return el('div', null,
      el('p', { className: 'sap-desc' }, '估算成本按已记录的派发统计得出——记录较少时数值可能不准，会随使用逐步修正。'),
      scopeGuide
    )
  }
  return el('div', { className: 'sap-costSection' },
    globalBlock,
    modelBlock,
    scopeGuide
  )
}

// 六页签骨架：横向 tab（下划线激活 + 加粗，样式对齐官方「插件」节）+ 内容区。
function buildTabBar(el, s) {
  return el('div', { className: 'sap-tabs', role: 'tablist' },
    SETTINGS_TABS.map((tab) => el('button', {
      key: tab.key, type: 'button', role: 'tab', 'aria-selected': s.activeTab === tab.key,
      className: 'sap-tab' + (s.activeTab === tab.key ? ' sap-tabActive' : ''),
      onClick: () => s.setActiveTab(tab.key)
    }, tab.label))
  )
}

// 页签内容区：全部挂载、非激活隐藏（组件状态不因切换丢失）。
function buildTabZone(el, s, key, children) {
  return el('div', { role: 'tabpanel', className: 'sap-zone' + (s.activeTab === key ? ' sap-zoneActive' : '') }, children)
}

// 安全页签：三卡一律 sap-card（与①方案管理同款）——安全保证、逃生舱、
// 审计健康（状态行 + 只读审计明细折叠表，明细表类 = sap-audit*）。
function buildSafetySection(el, s, actions, reminders) {
  return el('div', null,
    buildSettingsCard(el, 5, ZH.safetyCardTitle, ZH.safetyCardDesc, true, () => {}, [
      el('p', { className: 'sap-desc' }, ZH.advancedSafetyLine),
      el('p', { className: 'sap-desc' }, ZH.safetyCheckNote)
    ], true),
    buildEscapeSection(el, s, actions),
    buildSettingsCard(el, 6, ZH.auditCardTitle, ZH.auditCardDesc, true, () => {}, [
      buildStatusBar(el, s),
      buildAuditDetails(el, s, actions, reminders)
    ], true)
  )
}

// 审计明细事件与结果人话（与提醒同源；未知类别原样回退，信息不删）。
function auditEventText(r) {
  const text = ZH.auditEventZh[r.kind] || r.kind
  return r.severity === 'P0' ? text + '（紧急）' : text
}

function auditResultText(r) {
  if (typeof r.action === 'string' && r.action !== '') {
    const time = formatMonthDayTime(r.actedAt)
    return ZH.auditResultActedPrefix + (ZH.reminderActionZh[r.action] || r.action) + (time !== '' ? ' ' + time : '')
  }
  return r.unread === true ? ZH.auditResultPending : ZH.auditResultRead
}

// 审计明细折叠表（只读展示，无导出/过滤）：最近 20 条治理留痕。
function buildAuditDetails(el, s, actions, reminders) {
  const rows = Array.isArray(reminders) ? reminders.slice(0, 20) : []
  const cell = (r) => el('tr', { key: String(r.id) },
    el('td', { className: 'sap-auditTime' }, formatMonthDayTime(r.createdAt)),
    el('td', { className: 'sap-auditEvent' }, auditEventText(r)),
    el('td', { className: 'sap-auditObject' }, r.title + ' · ' + (typeof r.sessionId === 'string' && r.sessionId !== '' ? '会话 ' + r.sessionId.slice(0, 8) + '…' : ZH.reminderGlobal)),
    el('td', null, auditResultText(r)))
  return el('div', null,
    el('button', { type: 'button', className: 'sap-auditCollapse', 'aria-expanded': s.auditDetailOpen === true, onClick: actions.toggleAuditDetail },
      el('span', null, ZH.auditDetailToggle),
      el('span', { className: 'sap-auditArrow' }, '▸')),
    s.auditDetailOpen !== true ? null : (rows.length === 0
      ? el('p', { className: 'sap-candidateHint' }, ZH.auditDetailEmpty)
      : [el('p', { className: 'sap-candidateHint' }, ZH.auditDetailScope),
          el('table', { className: 'sap-auditTable' },
            el('thead', null, el('tr', null,
              el('th', null, ZH.auditColTime), el('th', null, ZH.auditColEvent),
              el('th', null, ZH.auditColObject), el('th', null, ZH.auditColResult))),
            el('tbody', null, rows.map(cell)))])
  )
}

function buildSectionReturn(el, s, actions, rows, addCard, reminderCenter, sessions) {
  const notices = buildSectionNotices(el, s)
  return el('div', { className: 'sap-section' },
    el('div', { className: 'sap-titleRow' },
      el('h2', { className: 'sap-title' }, '子 Agent 方案'),
      el('label', { className: 'sap-switch' },
        el('input', { type: 'checkbox', checked: s.enabled, onChange: actions.toggleEnabled }),
        el('span', null, s.enabled ? '已启用' : '已禁用')
      )
    ),
    ...notices,
    buildTabBar(el, s),
    buildTabZone(el, s, 'profiles',
      el('div', { className: 'sap-zoneStack' },
        buildSettingsCard(el, 1, '方案管理', '管理派发可用的方案：启用、编辑、删除，含成本与成功率', true, () => {}, [
          el('p', { className: 'sap-intro' }, ZH.profilesIntro),
          el('ul', { className: 'sap-rows' }, rows),
          buildDraftRows(el, s, actions),
          el('div', { className: 'sap-addBlock' },
            s.adding ? addCard : el('div', { className: 'sap-addActions' },
              el('button', { className: 'sap-addButton', onClick: actions.openAdd }, '+ 新增 profile')
            )
          ),
          el('div', { className: 'sap-addActions', style: { marginTop: '4px' } },
            el('button', { type: 'button', className: 'sap-secondaryButton', style: smallBtn, onClick: actions.resetAll }, ZH.resetAllBuiltins)
          )
        ], true),
        buildMaintenanceCard(el, s, actions)
      )),
    buildTabZone(el, s, 'cost',
      el('div', { className: 'sap-zoneStack' },
        buildSettingsCard(el, 2, '全局成本', '跨全部会话的派发成本汇总，按模型与方案拆分', true, () => {}, [
          buildCostObservabilitySection(el, s, actions)
        ], true),
        buildSettingsCard(el, 4, ZH.budgetCardTitle, ZH.budgetCardDesc, true, () => {}, [
          buildBudgetSettings(el, s, actions)
        ], true)
      )),
    buildTabZone(el, s, 'advice', buildAdvicePanel(el, s, actions, sessions)),
    buildTabZone(el, s, 'safety', buildSafetySection(el, s, actions, s.auditReminders)),
    buildTabZone(el, s, 'reminders', el(reminderCenter, { jumpToAdvice: () => s.setActiveTab('advice') }))
  )
}

// draft 预览/应用/删除动作挂到设置页 actions（保持 ProfilesSection 短小）。
function attachDraftActions(api, s, refresh, applyWrite, actions) {
  actions.previewDraft = (draft) => () => {
    s.setError('')
    api('/draft/preview', { config: draft.config, name: draft.name, description: draft.description, source: draft.source })
      .then((data) => {
        const previews = { ...(s.draftPreviews || {}) }
        previews[draft.id] = { ok: data.ok === true, checks: Array.isArray(data.checks) ? data.checks : [] }
        s.setDraftPreviews(previews)
      })
      .catch((err) => s.setError(String((err && err.message) || err)))
  }
  actions.applyDraft = (draft) => () => {
    s.setError('')
    api('/draft/apply', { id: draft.id, name: draft.name, description: draft.description })
      .then((data) => {
        applyWrite(data, '已应用 draft：' + draft.name)
        // 闭环可视化：应用成功后展开方案管理区并高亮新方案卡片。
        if (typeof data.id === 'string' && data.id !== '') {
          s.setActiveTab('profiles')
          s.setHighlightId(data.id)
          setTimeout(() => s.setHighlightId(null), 8000)
        }
        refresh()
      })
      .catch((err) => s.setError(String((err && err.message) || err)))
  }
  actions.removeDraft = (draft) => () => {
    s.setError('')
    api('/draft/remove', { id: draft.id })
      .then((data) => { applyWrite(data, '已删除 draft'); refresh() })
      .catch((err) => s.setError(String((err && err.message) || err)))
  }
}

// ── 设置页：数据维护区（快照开关/单条查看 + 四区清理按钮组）───────────────────

// 快照区数据装载 hook：挂载拉一次，开关切换与清理后回读（单条查看状态同驻）。
function useSnapshotData(useState, useEffect) {
  const [snapshots, setSnapshots] = useState({ snapshotEnabled: false, count: 0, cap: 200, entries: [] })
  const [snapshotView, setSnapshotView] = useState({})
  const [maintenanceNotice, setMaintenanceNotice] = useState('')
  const refreshSnapshots = () => {
    api('/snapshots').then((data) => {
      setSnapshots({
        snapshotEnabled: data !== null && typeof data === 'object' && data.snapshotEnabled === true,
        count: data !== null && typeof data === 'object' && typeof data.count === 'number' ? data.count : 0,
        cap: data !== null && typeof data === 'object' && typeof data.cap === 'number' ? data.cap : 200,
        entries: data !== null && typeof data === 'object' && Array.isArray(data.entries) ? data.entries : []
      })
    }).catch(() => {})
  }
  useEffect(() => { refreshSnapshots() }, [])
  return { snapshots, refreshSnapshots, snapshotView, setSnapshotView, maintenanceNotice, setMaintenanceNotice }
}

// 数据维护动作：快照开关、单条查看（展开/收起）、四区清理（确认一次、结果 echo）。
function attachMaintenanceActions(api, s, refresh, actions) {
  actions.toggleSnapshots = () => {
    api('/snapshots/set-enabled', { snapshotEnabled: !s.snapshots.snapshotEnabled })
      .then((data) => {
        if (data !== null && typeof data === 'object' && data.persisted === false) s.setPersistWarning(ZH.persistFail)
        else s.setPersistWarning('')
        s.refreshSnapshots()
      })
      .catch((err) => s.setError(String((err && err.message) || err)))
  }
  actions.viewSnapshot = (id) => () => {
    const next = { ...s.snapshotView }
    if (next[id] !== undefined) { delete next[id]; s.setSnapshotView(next); return }
    api('/snapshot?id=' + encodeURIComponent(id))
      .then((data) => {
        if (data !== null && typeof data === 'object' && data.ok === true && data.snapshot !== undefined) {
          s.setSnapshotView({ ...s.snapshotView, [id]: data.snapshot })
        }
      })
      .catch(() => {})
  }
  actions.cleanZone = (zone, label) => () => {
    if (!window.confirm(ZH.maintenanceConfirm.replace('{zone}', label))) return
    api('/maintenance/clean', { zone })
      .then((data) => {
        const count = data !== null && typeof data === 'object' && typeof data.count === 'number' ? data.count : 0
        s.setMaintenanceNotice(ZH.maintenanceDone.replace('{zone}', label).replace('{count}', String(count)))
        s.refreshSnapshots()
        refresh()
      })
      .catch((err) => s.setError(ZH.maintenanceCleanErr + String((err && err.message) || err)))
  }
}

// 单条快照只读体：persona 默认折叠（本地只读允许看原文，UI 不默认展开）；其余
// 字段等宽 JSON 展示。
function snapshotViewBody(el, payload) {
  const cfg = payload !== null && typeof payload === 'object' && payload.config !== null && typeof payload.config === 'object' ? payload.config : {}
  const keys = Object.keys(cfg)
  const persona = typeof cfg.persona === 'string' ? cfg.persona : ''
  return el('div', { className: 'sap-reminderFields' },
    keys.length === 0 ? el('p', { className: 'sap-desc' }, ZH.snapshotEmptyConfig) : null,
    keys.map((key) => {
      if (key === 'persona') {
        return el('details', { key: 'snap-persona', className: 'sap-customized' },
          el('summary', { className: 'sap-customizedSummary' }, ZH.snapshotPersonaFold.replace('{n}', String(persona.length))),
          el('pre', { className: 'sap-metaValueDefault' }, persona)
        )
      }
      return reminderFieldLine(el, key, formatGateValue(cfg[key]))
    })
  )
}

// 快照开关说明三行分层：首行主说明，后两行小字次要色（数据落点与关闭语义）。
function snapshotSwitchDescRows(el) {
  return ZH.snapshotSwitchDesc.split('\n').filter((line) => line !== '').map((line, index) => el('p', { key: 'snap-desc-' + index, className: index === 0 ? 'sap-desc' : 'sap-descMinor' }, line))
}

// 数据维护卡（方案管理尾部）：快照开关 + B7 文案 + 数量/护栏提示 + 单条查看 +
// 维护按钮组（四区各自独立、一次确认、结果 echo、DOM 一行）。
function buildMaintenanceCard(el, s, actions) {
  const snap = s.snapshots
  const atCap = snap.count >= snap.cap && snap.count > 0
  const entries = Array.isArray(snap.entries) ? snap.entries : []
  const zoneButtons = [
    { zone: 'candidates', label: ZH.cleanCandidates },
    { zone: 'snapshots', label: ZH.cleanSnapshots },
    { zone: 'reminders', label: ZH.cleanReminders },
    { zone: 'stats', label: ZH.cleanStats }
  ].map((z) => el('button', { key: 'clean-' + z.zone, type: 'button', className: 'sap-secondaryButton', style: smallBtn, onClick: actions.cleanZone(z.zone, z.label) }, z.label))
  return buildSettingsCard(el, 11, ZH.maintenanceCardTitle, ZH.maintenanceCardDesc, true, () => {}, [
    el('label', { className: 'sap-switch' },
      el('input', { type: 'checkbox', checked: snap.snapshotEnabled === true, onChange: actions.toggleSnapshots }),
      el('span', null, '配置快照')
    ),
    el('div', { className: 'sap-maintenanceSwitchDesc' }, snapshotSwitchDescRows(el)),
    el('p', { className: 'sap-desc' },
      snap.count > 0 ? ZH.snapshotCount.replace('{n}', String(snap.count)).replace('{cap}', String(snap.cap)) : ZH.snapshotNone
    ),
    atCap ? el('p', { className: 'sap-notice' }, ZH.snapshotCapHint) : null,
    entries.map((entry) => {
      const payload = s.snapshotView[entry.id]
      return el('div', { key: 'snap-' + entry.id, className: 'sap-candidateSettingsPanel' },
        el('div', { className: 'sap-candidateSettingsRow' },
          el('b', null, ZH.snapshotMeta.replace('{id}', entry.id).replace('{ts}', formatMonthDayTime(entry.ts))),
          el('button', { type: 'button', className: 'sap-candidateSettingsEdit', onClick: actions.viewSnapshot(entry.id) }, payload !== undefined ? ZH.snapshotViewClose : ZH.snapshotView)
        ),
        payload !== undefined ? snapshotViewBody(el, payload) : null
      )
    }),
    s.maintenanceNotice !== '' ? el('p', { className: 'sap-notice' }, s.maintenanceNotice) : null,
    el('div', { className: 'sap-candidateSettingsActions' }, zoneButtons)
  ], true)
}

function makeProfilesSection(el, api, chip, useState, useEffect, useCallback, ReminderCenter, getSessions) {
  function ProfilesSection() {
    const [profiles, setProfiles] = useState([]); const [options, setOptions] = useState({ models: [], efforts: {}, presets: [] }); const [enabled, setEnabled] = useState(true)
    const [adding, setAdding] = useState(false); const [editingId, setEditingId] = useState(null); const [error, setError] = useState(''); const [savedNotice, setSavedNotice] = useState('')
    const [persistWarning, setPersistWarning] = useState(''); const [form, setForm] = useState(EMPTY_FORM); const [tools, setTools] = useState([]); const [versionWarnings, setVersionWarnings] = useState([])
    const [pluginVersion, setPluginVersion] = useState(''); const [audit, setAudit] = useState(AUDIT_DEFAULTS); const [escapeEnabled, setEscapeEnabled] = useState(false); const [escapePresets, setEscapePresets] = useState([]); const [escapeInput, setEscapeInput] = useState('')
    const [evolutionAdvice, setEvolutionAdvice] = useState(false); const [drafts, setDrafts] = useState([]); const [advice, setAdvice] = useState([]); const [evolutionCandidates, setEvolutionCandidates] = useState([])
    const [adviceGlobal, setAdviceGlobal] = useState(null); const [costSummary, setCostSummary] = useState({ global: null, byModel: [] }); const [draftPreviews, setDraftPreviews] = useState({}); const [candidateOpen, setCandidateOpen] = useState({})
    const [candidateSelected, setCandidateSelected] = useState({}); const [candidateSafetyOpen, setCandidateSafetyOpen] = useState({}); const [candidateSettings, setCandidateSettings] = useState({ candidateMode: 'auto', candidateTtlH: 24 }); const [candidateSettingsOpen, setCandidateSettingsOpen] = useState(false)
    const [candidateSettingsForm, setCandidateSettingsForm] = useState({ candidateMode: 'auto', candidateTtlChoice: '24', customDays: '', error: '' }); const [dispatchBudget, setDispatchBudget] = useState({ maxParentTokens: 500000, maxConcurrent: 8 }); const [budgetForm, setBudgetForm] = useState({ maxParentTokens: '500000', maxConcurrent: '8', error: '' }); const [adviceDetails, setAdviceDetails] = useState({}); const [detailOpen, setDetailOpen] = useState({})
    const [activeTab, setActiveTab] = useState('profiles'); const [highlightId, setHighlightId] = useState(null); const [adviceOpen, setAdviceOpen] = useState({}); const [auditDetailOpen, setAuditDetailOpen] = useState(false); const [auditReminders, setAuditReminders] = useState([])
    const [evolutionStatus, setEvolutionStatus] = useState({ applyEnabled: false, canaryEnabled: false, reasons: [] }); const [evolutionAssets, setEvolutionAssets] = useState([])
    const [applyModal, setApplyModal] = useState({ profileKey: '', candidateId: '', open: false, error: '' }); const [rollbackModal, setRollbackModal] = useState({ assetId: '', open: false, error: '' }); const snapshotCtl = useSnapshotData(useState, useEffect)
    const s = { profiles, options, enabled, adding, editingId, error, savedNotice, persistWarning, form, tools, versionWarnings, pluginVersion, audit, escapeEnabled, escapePresets, escapeInput, evolutionAdvice, drafts, advice, evolutionCandidates, adviceGlobal, costSummary, draftPreviews, candidateOpen, candidateSelected, candidateSafetyOpen, candidateSettings, candidateSettingsOpen, candidateSettingsForm, dispatchBudget, budgetForm, adviceDetails, detailOpen, activeTab, highlightId, adviceOpen, auditDetailOpen, auditReminders, evolutionStatus, evolutionAssets, applyModal, rollbackModal, snapshots: snapshotCtl.snapshots, snapshotView: snapshotCtl.snapshotView, maintenanceNotice: snapshotCtl.maintenanceNotice, refreshSnapshots: snapshotCtl.refreshSnapshots, setSnapshotView: snapshotCtl.setSnapshotView, setMaintenanceNotice: snapshotCtl.setMaintenanceNotice, setProfiles, setOptions, setEnabled, setAdding, setEditingId, setError, setSavedNotice, setPersistWarning, setForm, setTools, setVersionWarnings, setPluginVersion, setAudit, setEscapeEnabled, setEscapePresets, setEscapeInput, setEvolutionAdvice, setDrafts, setAdvice, setEvolutionCandidates, setAdviceGlobal, setCostSummary, setDraftPreviews, setCandidateOpen, setCandidateSelected, setCandidateSafetyOpen, setCandidateSettings, setCandidateSettingsOpen, setCandidateSettingsForm, setDispatchBudget, setBudgetForm, setAdviceDetails, setDetailOpen, setActiveTab, setHighlightId, setAdviceOpen, setAuditDetailOpen, setAuditReminders, setEvolutionStatus, setEvolutionAssets, setApplyModal, setRollbackModal }
    const refresh = useCallback(() => {
      api('/list')
        .then((data) => {
          setProfiles(Array.isArray(data.profiles) ? data.profiles : [])
          setAdvice(Array.isArray(data.advice) ? data.advice : [])
          setEvolutionCandidates(Array.isArray(data.evolutionCandidates) ? data.evolutionCandidates : [])
          setAdviceGlobal(data.adviceGlobal !== null && typeof data.adviceGlobal === 'object' ? data.adviceGlobal : null)
          setAdviceDetails(data.adviceDetails !== null && typeof data.adviceDetails === 'object' ? data.adviceDetails : {})
          setCostSummary(data && typeof data.costSummary === 'object' && data.costSummary !== null && typeof data.costSummary.global === 'object' ? { global: data.costSummary.global, byModel: Array.isArray(data.costSummary.byModel) ? data.costSummary.byModel : [] } : { global: null, byModel: [] })
          const status = data.evolutionStatus !== null && typeof data.evolutionStatus === 'object' ? data.evolutionStatus : {}
          setEvolutionStatus({ applyEnabled: status.applyEnabled === true, canaryEnabled: status.canaryEnabled === true, reasons: Array.isArray(status.reasons) ? status.reasons : [] })
        })
        .catch((err) => setError(String((err && err.message) || err)))
      api('/evolution/assets').then((data) => setEvolutionAssets(Array.isArray(data.assets) ? data.assets : [])).catch(() => {})
      api('/drafts').then((data) => setDrafts(Array.isArray(data.drafts) ? data.drafts : [])).catch(() => {})
      api('/reminders').then((data) => setAuditReminders(Array.isArray(data.reminders) ? data.reminders : [])).catch(() => {})
    }, [])
    const loadOptions = useCallback(() => {
      api('/options/summary')
        .then((data) => applySummaryData(data, { enabled: setEnabled, options: setOptions, audit: setAudit, escapeEnabled: setEscapeEnabled, escapePresets: setEscapePresets, evolutionAdvice: setEvolutionAdvice, candidateSettings: setCandidateSettings }))
        .catch(() => {})
      api('/options/budget').then((data) => applyBudgetData(data, { dispatchBudget: setDispatchBudget, budgetForm: setBudgetForm })).catch(() => {})
    }, [])
    const loadEfforts = makeEffortsLoader(api, setOptions); const loadTools = makeToolsLoader(api, setTools)
    const loadVersions = useCallback(() => makeVersionsLoader(api, setVersionWarnings, setPluginVersion)(), []) // 只挂载时拉一次：稳定引用防 effect 依赖恒变
    useEffect(() => { refresh(); loadOptions(); loadVersions() }, [refresh, loadOptions, loadVersions])
    const applyWrite = makeApplyWrite(s); const actions = makeProfilesActions(api, s, refresh, applyWrite, loadEfforts, loadTools)
    attachDraftActions(api, s, refresh, applyWrite, actions); attachMaintenanceActions(api, s, refresh, actions); attachBudgetActions(api, s, applyWrite, actions)
    const rows = buildProfileRows(el, chip, s, actions); const toolSection = buildToolSection(el, s, actions)
    return buildSectionReturn(el, s, actions, rows, buildAddCard(el, s, actions, toolSection), ReminderCenter, sessionsSnapshot(getSessions))
  }
  return ProfilesSection
}

// ── 派发决策台账：会话标签页（React 依赖经参数注入）──────────────────────────

// epoch ms → 本地 HH:MM:SS；非有限数返回空串。
function formatClockTime(time) {
  if (typeof time !== 'number' || !Number.isFinite(time)) return ''
  const d = new Date(time)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 毫秒 → 人读耗时：<1s 显示 ms，<1m 显示 s（1 位小数），否则 m+s；无值/0 返回空串。
function formatDurationMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return s > 0 ? `${m}m${s}s` : `${m}m`
}

// 闸输入/输出值 → 单行 JSON（等宽次级色展示）；不可序列化回退 String。
function formatGateValue(value) {
  if (value === undefined || value === null) return ''
  try {
    const s = JSON.stringify(value)
    return s === undefined ? '' : s
  } catch {
    return String(value)
  }
}

// 闸名中文标签（仅中文，供汇总带紧凑展示）；未知/空名原样返回。
function gateLabelZh(name) {
  return GATE_LABELS[name] || name
}

// 失败闸修复方向；未知闸给通用提示。
function gateFixHint(name) {
  return GATE_FIX_HINTS[name] || ZH.gateFixUnknown
}

// 失败闸的可操作目标：优先该记录的方案 id（成本/交集闸可去设置页改该方案），
// 其次 whitelist 闸的请求预设（逃生舱/白名单语境）。无目标返回空串。
function gateFixTarget(record, gate) {
  const profileId = recordProfile(record)
  if (profileId !== '') return profileId
  const requestedPreset = gate && gate.input && typeof gate.input.requestedPreset === 'string' ? gate.input.requestedPreset : ''
  return requestedPreset
}


// 记录档位：effective.tokenTier 优先，回退 result.fields.tokenTier（旧记录）。
function recordTier(record) {
  const trace = record && record.trace
  const result = record && record.result
  const eff = trace && trace.effective
  if (eff && typeof eff.tokenTier === 'string' && eff.tokenTier !== '') return eff.tokenTier
  if (result && result.fields && typeof result.fields.tokenTier === 'string') return result.fields.tokenTier
  return ''
}

// 记录模型：effective.model 优先，回退 result.fields.model（旧记录口径，同档位读取）。
function recordModel(record) {
  const trace = record && record.trace
  const result = record && record.result
  const eff = trace && trace.effective
  if (eff && typeof eff.model === 'string' && eff.model !== '') return eff.model
  if (result && result.fields && typeof result.fields.model === 'string') return result.fields.model
  return ''
}
function recordUsage(record) {
  const trace = record && record.trace
  const result = record && record.result
  if (trace && trace.settled) {
    const usage = parseChildUsage(trace.settled.childUsage)
    if (usage !== null) return usage
  }
  if (result && result.fields && result.fields.childUsage !== undefined && result.fields.childUsage !== '') {
    return parseChildUsage(result.fields.childUsage)
  }
  return null
}

// 逐次调用明细：读 trace.settled.calls（{calls:[{五段}], truncated, totalCalls}），
// 逐字段 typeof 守卫、坏条目跳过；无 calls 或全坏返回 null（整区不渲染）。calls 仅
// 台账展开区专用，不进 render 行 / 模型可见面。
function recordCalls(record) {
  const settled = record && record.trace && record.trace.settled
  const raw = settled && settled.calls
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!Array.isArray(raw.calls) || raw.calls.length === 0) return null
  const keys = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
  const calls = []
  for (const item of raw.calls) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const call = {}
    for (const key of keys) {
      const value = item[key]
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) call[key] = value
    }
    calls.push(call)
  }
  if (calls.length === 0) return null
  const totalCalls = typeof raw.totalCalls === 'number' && Number.isFinite(raw.totalCalls) && raw.totalCalls >= 0
    ? raw.totalCalls
    : calls.length
  return { calls, truncated: raw.truncated === true, totalCalls }
}

// 记录结束原因：结算 stopReason 优先，回退 result.fields.stopReason；映射中文。
function recordStopZh(record) {
  const settled = record && record.trace && record.trace.settled
  const result = record && record.result
  const raw = settled && typeof settled.stopReason === 'string' ? settled.stopReason
    : (result && result.fields && typeof result.fields.stopReason === 'string' ? result.fields.stopReason : '')
  return raw === '' ? '' : (ZH.stopReasonZh[raw] || raw)
}

// 记录行稳定 key：callId 优先，其次时间戳，最后下标兜底。
function ledgerKey(record, index) {
  if (record.callId !== '') return record.callId
  if (record.time !== null) return `ledger-${record.time}-${index}`
  return `ledger-${index}`
}

// ── 台账渲染 helpers（纯元素组装）──────────────────────────────────────────

// 汇总带单条统计段：label 次级色 + 值加粗，段间「·」分隔。
function summarySegments(el, pairs) {
  const out = []
  pairs.forEach((pair, i) => {
    if (i > 0) out.push(el('span', { key: `sep${i}`, className: 'sap-ledgerSep' }, ' · '))
    out.push(el('span', { key: `seg${i}`, className: 'sap-ledgerStatSeg' }, pair[0], ' ', el('span', { className: 'sap-ledgerStat' }, pair[1])))
  })
  return out
}

// 汇总带：派发/成功/拒绝/token/耗时 + 闸拒绝分布 + 按方案（中文名双表达）+ 按模型/按档位。
function buildLedgerSummary(el, summary, profileNames) {
  const elapsed = formatDurationMs(summary.totalElapsedMs)
  const pairs = [
    [ZH.ledgerDispatch, `${summary.dispatchCount} ${ZH.ledgerTimes}`],
    [ZH.ledgerSuccess, String(summary.successCount)],
    [ZH.ledgerReject, String(summary.rejectCount)],
    [ZH.ledgerTotalTokens, `≈${summary.totalTokens}（${ZH.cacheHit} ${summary.cacheHitTokens}）`]
  ]
  if (elapsed !== '') pairs.push([ZH.ledgerTotalElapsed, elapsed])
  const gateEntries = ['whitelist', 'cost', 'intersection', 'approval', 'other']
    .filter((name) => summary.gateRejectCounts[name] > 0)
    .map((name) => `${gateLabelZh(name)} ${summary.gateRejectCounts[name]}`)
  const profileText = summary.byProfile.map((item) => `${profileDisplay(item.profile, profileNames)} ×${item.count}`).join(' · ')
  // 模型原文显示；继承桶（空串）与 'inherit'/'(parent)'/以 '(' 开头的标记一律归一为「继承父会话」。
  const modelText = summary.byModel.map((item) => {
    const display = item.model === 'inherit' || item.model.startsWith('(') ? ZH.inherit : rawOrInherit(item.model)
    return `${display} ×${item.count}`
  }).join(' · ')
  const tierText = summary.byTier.map((item) => `${ZH.tierZh[item.tier] || item.tier} ×${item.count}`).join(' · ')
  return el('div', { className: 'sap-ledgerSummary' },
    el('div', { className: 'sap-ledgerSummaryTitle' }, ZH.ledgerSummary),
    el('div', { className: 'sap-ledgerSummaryLine' }, summarySegments(el, pairs)),
    gateEntries.length > 0
      ? el('div', { className: 'sap-ledgerSummaryLine' }, `${ZH.ledgerGateRejectDist}：${gateEntries.join(' · ')}`)
      : null,
    profileText !== ''
      ? el('div', { className: 'sap-ledgerSummaryLine' }, `${ZH.ledgerByProfile}：${profileText}`)
      : null,
    modelText !== ''
      ? el('div', { className: 'sap-ledgerSummaryLine' }, `${ZH.ledgerByModel}：${modelText}`)
      : null,
    tierText !== ''
      ? el('div', { className: 'sap-ledgerSummaryLine' }, `${ZH.ledgerByTier}：${tierText}`)
      : null,
    summary.pricedCount > 0
      ? el('div', { className: 'sap-ledgerSummaryLine' },
          ZH.ledgerCostLine
            .replace('{actual}', String(summary.estimatedCost))
            .replace('{counter}', String(summary.estimatedInheritCost))
            .replace('{saving}', String(summary.estimatedSaving))
            .replace('{ratio}', summary.estimatedSaving > 0 && summary.estimatedCost > 0 ? String(Number((summary.estimatedInheritCost / summary.estimatedCost).toFixed(2))) : '1'))
      : null,
    summary.inheritCount > 0
      ? el('div', { className: 'sap-ledgerSummaryLine' },
          ZH.ledgerInheritCost.replace('{count}', String(summary.inheritCount)).replace('{ratio}', String(summary.inheritRatio)))
      : null
  )
}

// 空态：暂无派发记录 + 一句引导。
function buildEmptyState(el) {
  return el('div', { className: 'sap-ledgerEmpty' },
    el('p', { className: 'sap-ledgerEmptyTitle' }, ZH.ledgerEmpty),
    el('p', { className: 'sap-intro' }, ZH.ledgerEmptyHint)
  )
}

// 「加载更早」按钮：hasMore 为真且未在补载时可用；点击逐页补载更早记录。
function buildLoadOlderButton(el, hasMore, loadingOlder, loadOlder) {
  return el('button', {
    type: 'button',
    className: 'sap-ledgerLoadOlder',
    disabled: !hasMore || loadingOlder,
    onClick: () => { loadOlder() }
  }, loadingOlder ? ZH.ledgerLoadingOlder : ZH.ledgerLoadOlder)
}

// 台账顶部说明行：定位说明（恒显）+ 窗口提示（hasMore 时显示已加载条数）。
function buildLedgerTopNote(el, hasMore, count) {
  return el('div', null,
    el('div', { className: 'sap-ledgerScope' }, ZH.ledgerScopeNote),
    hasMore
      ? el('div', { className: 'sap-ledgerWindowNote' }, ZH.ledgerWindowNote.replace('{n}', String(count)))
      : null
  )
}

// 标量 → 直接文本（字符串不带引号，null/undefined 空串）。
function formatGateScalar(v) {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  return String(v)
}

// 父会话 UUID 截断：前 8 位 + …，悬停 title 显示全文（不足 8 位原样，fail-soft）。
function truncateSessionId(v) {
  if (typeof v !== 'string' || v === '') return v
  return v.length > 8 ? v.slice(0, 8) + '…' : v
}

// 对象/数组 → 逐字段键值行数组（depth 上限 2 防深层爆炸）；标量 → 单行文本。
// 对象逐键「中文标签（键名）: 值」；嵌套容器递归 1 层并包缩进块（sap-ledgerGateNested，
// 左侧竖线视觉分层，profiles_snapshot 等嵌套结构可读）；数组前 5 项逐项展示，
// 超出补「…共 N 项」。未知键回退原样（不崩溃）。
function gateValueRows(el, value, depth = 0) {
  if (value === null || typeof value !== 'object') {
    return [el('div', { className: 'sap-ledgerGateKV' },
      el('span', { className: 'sap-ledgerGateValue' }, formatGateScalar(value)))]
  }
  if (Array.isArray(value)) {
    const rows = []
    for (const item of value.slice(0, 5)) {
      if (item !== null && typeof item === 'object' && depth < 2) {
        rows.push(el('div', { className: 'sap-ledgerGateNested' }, ...gateValueRows(el, item, depth + 1)))
      } else {
        rows.push(el('div', { className: 'sap-ledgerGateKV' },
          el('span', { className: 'sap-ledgerGateValue' }, formatGateScalar(item))))
      }
    }
    if (value.length > 5) {
      rows.push(el('div', { className: 'sap-ledgerGateKV' },
        el('span', { className: 'sap-ledgerGateValue' }, `…共 ${value.length} 项`)))
    }
    return rows
  }
  const rows = []
  for (const [key, v] of Object.entries(value)) {
    const label = FIELD_ZH[key] !== undefined ? `${FIELD_ZH[key]}（${key}）` : key
    if (v !== null && typeof v === 'object' && depth < 2) {
      rows.push(el('div', { className: 'sap-ledgerGateKV' },
        el('span', { className: 'sap-ledgerGateKey' }, label), ':'))
      rows.push(el('div', { className: 'sap-ledgerGateNested' }, ...gateValueRows(el, v, depth + 1)))
    } else {
      rows.push(el('div', { className: 'sap-ledgerGateKV' },
        el('span', { className: 'sap-ledgerGateKey' }, label), ':',
        key === 'parentSessionId' && typeof v === 'string' && v !== ''
          ? el('span', { className: 'sap-ledgerGateValue', title: v }, truncateSessionId(v))
          : el('span', { className: 'sap-ledgerGateValue' }, formatGateScalar(v))))
    }
  }
  return rows
}

// 子块卡片：标题 + 字段级行（空对象/空数组显示 `{}`/`[]` 单行，不空白）。
// 供步骤①（父会话上下文/请求值）与各闸（输入/输出）共用——每段独立卡片、
// 独立标题，与闸头/拒绝信息视觉分层（不再平铺扎堆）。
function buildSubBlock(el, title, value) {
  const rows = value !== null && typeof value === 'object' && Object.keys(value).length > 0
    ? gateValueRows(el, value, 0)
    : [el('div', { className: 'sap-ledgerGateKV' },
        el('span', { className: 'sap-ledgerGateValue' }, formatGateValue(value)))]
  return el('div', { className: 'sap-ledgerSubBlock' },
    el('div', { className: 'sap-ledgerSubBlockTitle' }, title),
    el('div', { className: 'sap-ledgerSubBlockBody' }, rows)
  )
}

// 区块视图切换按钮：字段视图 ↔ 原始 JSON（点击整体切换，非追加）。active 为真时
// 显示「字段视图」提示可切回。
function buildViewToggle(el, active, onToggle) {
  return el('button', {
    type: 'button',
    className: 'sap-ledgerRawJson',
    onClick: onToggle,
    'aria-expanded': active
  }, active ? ZH.ledgerFieldView : ZH.ledgerRawJson)
}

// JSON 视图内容：kv 各段原始 JSON 逐块展示（等宽可换行），与字段视图互斥。
function buildJsonBody(el, kv) {
  return el('div', { className: 'sap-ledgerJsonBody' },
    kv.map(({ label, value }) => el('div', { key: label, className: 'sap-ledgerJsonBlock' },
      el('div', { className: 'sap-ledgerGateKey' }, label),
      el('div', { className: 'sap-ledgerGateValue' }, formatGateValue(value))
    ))
  )
}


// ── 三层信息架构（结论层 / 证据层）纯渲染 ─────────────────────────

// 停滞检测上限（待实测：measured-params 回填惯例，展示层同步标注「待实测」）。
const STALL_THRESHOLD_MS = 30000

// 折叠态状态 chip：拒绝（红）/执行中（琥珀脉冲）/异常（琥珀）/成功（绿）。
function ledgerStatusOf(record) {
  if (recordIsRejected(record)) return { cls: 'sap-ledgerStatusFail', label: ZH.ledgerStatusReject }
  const settled = record.trace && record.trace.settled
  if (record.trace && !settled) return { cls: 'sap-ledgerStatusRun', label: ZH.ledgerStatusRunning }
  if (settled) {
    const stop = recordStopZh(record)
    if (stop !== '' && stop !== ZH.stopReasonZh.completed) return { cls: 'sap-ledgerStatusRun', label: ZH.ledgerStatusAbnormal + '（' + stop + '）' }
  }
  return { cls: 'sap-ledgerStatusOk', label: ZH.ledgerStatusSuccess }
}

// 折叠态工具数：continuable 交集实得数优先，其次子会话快照推导（实际调用过的工具）。
function ledgerToolsCountOf(record, proc) {
  if (recordIsRejected(record)) return ZH.ledgerToolsPending
  const n = effectiveToolsCountOf(record)
  if (n !== null) return ZH.toolAllowlist + ' ' + n
  if (proc !== null && proc.toolsUsed !== null) return ZH.toolAllowlist + ' ' + proc.toolsUsed.length
  return ''
}

// 执行过程事件线（台账记事实不记判断）：从子会话快照节点推导——
// 开始/工具调用/停滞/主 agent 干预/恢复/完成。干预 = 非 seed 的 user 节点（内容
// 只取 40 字摘要，不落原文）。nodes 不可得返回空事件集（fail-soft 不虚报）。
function processEventsOf(nodes, settled) {
  const out = { events: [], toolCalls: 0, interventions: 0, stalled: false, toolsUsed: null }
  if (!Array.isArray(nodes) || nodes.length === 0) return out
  const used = new Set()
  const first = nodes[0] && typeof nodes[0].time === 'number' ? nodes[0].time : null
  out.events.push({ kind: 'start', time: first })
  let lastActivity = null
  let stallOpen = false
  let sawUser = false
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (!node || typeof node !== 'object') continue
    const time = typeof node.time === 'number' ? node.time : null
    if (node.kind === 'tool-result') {
      const name = node.call && typeof node.call.name === 'string' ? node.call.name : ''
      if (name !== '') used.add(name)
      out.toolCalls += 1
      if (lastActivity !== null && time !== null && time - lastActivity > STALL_THRESHOLD_MS) {
        out.events.push({ kind: 'stall', time, seconds: Math.round((time - lastActivity) / 1000) })
        out.stalled = true
        stallOpen = true
      }
      if (stallOpen) { out.events.push({ kind: 'resume', time }); stallOpen = false }
      out.events.push({ kind: 'call', time, index: out.toolCalls, tool: name })
      lastActivity = time !== null ? time : lastActivity
    } else if (node.kind === 'user') {
      if (sawUser) {
        out.interventions += 1
        out.events.push({ kind: 'intervene', time, text: firstContentLine(node.content).slice(0, 40) })
        lastActivity = time !== null ? time : lastActivity
      }
      sawUser = true
    }
  }
  out.events.push(settled !== null && settled !== undefined ? { kind: 'done', time: null } : { kind: 'running', time: null })
  out.toolsUsed = [...used]
  return out
}

// 结论层进度点：拒绝只显示到达阶段；运行中执行琥珀脉冲；结算异常结算琥珀。
function progressStepsOf(record, proc) {
  const gates = record.trace && Array.isArray(record.trace.gates) ? record.trace.gates : []
  const gateFailed = gates.some((g) => g.verdict === 'fail')
  const settled = record.trace && record.trace.settled
  if (recordIsRejected(record)) {
    return [
      { key: 'start', label: ZH.ledgerProgressZh.start, state: 'done' },
      { key: 'decide', label: ZH.ledgerProgressZh.decide, state: gateFailed ? 'warn' : 'done' },
      { key: 'stop', label: ZH.ledgerProgressZh.stop, state: gateFailed ? 'warn' : 'done' }
    ]
  }
  if (record.trace && !settled) {
    return [
      { key: 'start', label: ZH.ledgerProgressZh.start, state: 'done' },
      { key: 'decide', label: ZH.ledgerProgressZh.decide, state: 'done' },
      { key: 'run', label: ZH.ledgerProgressZh.run, state: 'run' },
      { key: 'settle', label: ZH.ledgerProgressZh.settle, state: 'todo' }
    ]
  }
  const stop = recordStopZh(record)
  const settleState = stop !== '' && stop !== ZH.stopReasonZh.completed ? 'warn' : 'done'
  const runState = proc !== null && proc.stalled ? 'warn' : 'done'
  return [
    { key: 'start', label: ZH.ledgerProgressZh.start, state: 'done' },
    { key: 'decide', label: ZH.ledgerProgressZh.decide, state: 'done' },
    { key: 'run', label: ZH.ledgerProgressZh.run, state: runState },
    { key: 'settle', label: ZH.ledgerProgressZh.settle, state: settleState }
  ]
}

// 安全检查五道闸徽标汇总：全过（5/5）单徽标；有失败展开五项。
function safetyBadgesOf(record) {
  const names = ['whitelist', 'cost', 'intersection', 'approval', 'budget']
  const gates = record.trace && Array.isArray(record.trace.gates) ? record.trace.gates : []
  const badges = []
  let failedName = ''
  for (const name of names) {
    const gate = gates.find((g) => g.name === name)
    const verdict = gate ? gate.verdict : ''
    if (verdict === 'fail') { badges.push({ name, ok: false }); if (failedName === '') failedName = name } else if (verdict === 'pass' || verdict === 'deferred') badges.push({ name, ok: true })
  }
  const allPass = badges.length === names.length && failedName === ''
  return { allPass, failedName, badges }
}

// 结论层：安全检查徽标（全过单徽标；失败展开五项，❌ 项红色）。
function buildSafetyBadges(el, record) {
  const s = safetyBadgesOf(record)
  if (s.allPass) return el('div', { className: 'sap-ledgerSafety' },
    el('span', { className: 'sap-ledgerBadge sap-ledgerBadgeOk' }, ZH.ledgerSafetyAllPass)
  )
  return el('div', { className: 'sap-ledgerSafety' },
    el('span', { className: 'sap-ledgerBadge sap-ledgerBadgeFail' }, ZH.ledgerSafetyFail.replace('{gate}', ZH.ledgerGateBadgeZh[s.failedName] || s.failedName)),
    s.badges.map((b) => el('span', {
      key: 'gate-badge-' + b.name,
      className: b.ok ? 'sap-ledgerBadge sap-ledgerBadgeOk' : 'sap-ledgerBadge sap-ledgerBadgeFail'
    }, (ZH.ledgerGateBadgeZh[b.name] || b.name) + ' ' + (b.ok ? '✓' : '❌')))
  )
}

// 结论层：进度点一行（发起 → 决策 → 执行 → 结算）。
function buildProgressDots(el, record, proc) {
  const steps = progressStepsOf(record, proc)
  const items = []
  steps.forEach((step, i) => {
    items.push(el('span', { key: step.key, className: 'sap-ledgerProgressStep' },
      el('span', { className: 'sap-ledgerProgressDot sap-ledgerProgressDot-' + step.state }),
      el('span', null, step.label)
    ))
    if (i < steps.length - 1) items.push(el('span', { key: step.key + '-sep', className: 'sap-ledgerProgressSep' }))
  })
  return el('div', { className: 'sap-ledgerProgress' }, items)
}

// 结论层：成本卡（本会话口径 · ≈X 元 · 若继承父会话 ≈Y 元 · 省 ≈Z 元 · 模型/强度摘要）。
function buildCostCard(el, record) {
  const info = recordCostInfo(record)
  if (!info) return null
  const eff = record.trace && record.trace.effective ? record.trace.effective : {}
  const summary = ZH.chipModel + '：' + rawOrInherit(eff.model) + ' · ' + ZH.chipEffort + '：' + effortZh(eff.reasoningEffort)
  if (info.inherit) {
    return el('div', { className: 'sap-ledgerCostCard' },
      el('span', null, ZH.ledgerCostCardScope, ' · ', el('b', null, '≈' + info.actual + ' 元')),
      el('span', null, ZH.ledgerSettleInheritNote),
      el('span', null, summary)
    )
  }
  return el('div', { className: 'sap-ledgerCostCard' },
    el('span', null, ZH.ledgerCostCardScope, ' · ', el('b', null, '≈' + info.actual + ' 元')),
    el('span', null, ZH.ledgerCostCardCounter, ' ', el('b', null, '≈' + info.counterfactual + ' 元')),
    el('span', { className: 'sap-ledgerCostSave' }, ZH.ledgerCostCardSave, ' ', el('b', null, '≈' + info.saving + ' 元')),
    el('span', null, summary)
  )
}

// 结论层：拒绝块（拒绝：原因 + 修复方向可点击复制目标）。
function rejectGateOf(record) {
  const gates = record.trace && Array.isArray(record.trace.gates) ? record.trace.gates : []
  return gates.find((g) => g.verdict === 'fail') || null
}
function buildRejectBlock(el, record, copiedTarget, onCopyTarget) {
  const gate = rejectGateOf(record)
  if (gate === null && record.isError !== true) return null
  const reason = gate !== null && typeof gate.reason === 'string' && gate.reason !== '' ? gate.reason : ZH.ledgerReject
  const hint = gate !== null ? gateFixHint(gate.name) : ZH.gateFixUnknown
  const fixTarget = gate !== null ? gateFixTarget(record, gate) : ''
  return el('div', { className: 'sap-ledgerRejectBlock' },
    el('div', { className: 'sap-ledgerReject' }, ZH.ledgerReject + '：' + reason),
    el('div', { className: 'sap-ledgerRejectFix' },
      ZH.ledgerRejectFix + '：' + hint,
      fixTarget !== ''
        ? el('button', { type: 'button', className: 'sap-detailToggle', onClick: onCopyTarget(fixTarget) }, copiedTarget === fixTarget ? ZH.ledgerCopied : ZH.ledgerCopyTarget + ' ' + fixTarget)
        : null
    )
  )
}

// 结论层：干预摘要（仅存在干预事件时显示）。
function buildInterventionSummary(el, record, proc) {
  if (proc === null || proc.interventions === 0) return null
  const lead = proc.stalled ? '执行中出现停滞' : '执行过程'
  return el('div', { className: 'sap-ledgerIntervention' }, lead + '，主 agent 干预 ' + proc.interventions + ' 次')
}

// 结论层（点行展开）：进度点 → 安全检查徽标 → 成本卡 → 拒绝块 → 干预摘要 → 因果链入口。
function buildConclusionArea(el, record, proc, copiedTarget, onCopyTarget, evidenceOpen, setEvidence) {
  return el('div', { className: 'sap-ledgerExpand' },
    buildProgressDots(el, record, proc),
    buildSafetyBadges(el, record),
    buildCostCard(el, record),
    buildRejectBlock(el, record, copiedTarget, onCopyTarget),
    buildInterventionSummary(el, record, proc),
    el('button', { type: 'button', className: 'sap-ledgerEvidenceToggle', onClick: () => setEvidence(!evidenceOpen) }, evidenceOpen ? ZH.ledgerEvidenceClose : ZH.ledgerEvidenceToggle)
  )
}

// 请求参数人话格式（'=' 仅用于本行键值，非内部键残留）：模型=pro · 强度=未指定 · 档位=cheap。
function requestHumanText(requested) {
  const req = requested || {}
  const model = typeof req.model === 'string' && req.model !== '' ? req.model : ZH.ledgerVsUnset
  const effort = typeof req.reasoningEffort === 'string' && req.reasoningEffort !== '' ? effortZh(req.reasoningEffort) : ZH.ledgerVsUnset
  const tier = typeof req.tokenTier === 'string' && req.tokenTier !== '' ? (ZH.tierZh[req.tokenTier] || req.tokenTier) : ZH.ledgerVsUnset
  return ZH.chipModel + '=' + model + ' · ' + ZH.chipEffort + '=' + effort + ' · ' + ZH.chipTier + '=' + tier
}

// 证据层 ① 发起：时间 · 父会话（UUID 截断，悬停全文）· 请求参数 · 任务指令（派发前）。
// 任务指令取 trace.requested.prompt_excerpt（与任务摘要同源 200 字符截断）；旧记录
// 无摘要时不渲染该行，绝不拿结果块首行冒充指令。
function buildStartBlock(el, record, jsonView, toggleJson) {
  const trace = record.trace
  const startedText = formatClockTime(trace.startedAt)
  const head = startedText !== '' ? ZH.cogPerceiveDecide + ' · ' + startedText : ZH.cogPerceiveDecide
  const jsonMode = jsonView.start === true
  const execution = trace.execution || {}
  const parentSessionId = typeof execution.parentSessionId === 'string' ? execution.parentSessionId : ''
  const promptExcerpt = trace.requested && typeof trace.requested.prompt_excerpt === 'string' && trace.requested.prompt_excerpt !== '' ? trace.requested.prompt_excerpt : ''
  const kv = [
    { label: ZH.ledgerParentContext, value: trace.parentContext },
    { label: ZH.ledgerRequested, value: trace.requested }
  ]
  return el('div', { key: 'block-start', className: 'sap-ledgerStep' },
    el('div', { className: 'sap-ledgerStepHead' },
      el('span', null, head),
      buildViewToggle(el, jsonMode, () => toggleJson('start'))
    ),
    jsonMode
      ? buildJsonBody(el, kv)
      : el('div', { className: 'sap-ledgerStepBody' },
          parentSessionId !== ''
            ? el('div', { className: 'sap-ledgerGateKV' },
                el('span', { className: 'sap-ledgerGateKey' }, ZH.ledgerParentSessionLabel), ':',
                el('span', { className: 'sap-ledgerGateValue', title: parentSessionId }, truncateSessionId(parentSessionId)))
            : null,
          el('div', { className: 'sap-ledgerGateKV' },
            el('span', { className: 'sap-ledgerGateKey' }, ZH.ledgerRequestHuman), ':',
            el('span', { className: 'sap-ledgerGateValue' }, requestHumanText(trace.requested))),
          el('div', { className: 'sap-ledgerSource' }, '来源：系统（父会话快照）'),
          buildSubBlock(el, ZH.ledgerParentContext, trace.parentContext),
          el('div', { className: 'sap-ledgerSource' }, '来源：用户/父上下文（输入原文摘要）'),
          buildSubBlock(el, ZH.ledgerRequested, trace.requested),
          promptExcerpt !== ''
            ? el('div', { className: 'sap-cogParentText' }, ZH.ledgerPromptQuote + '：『' + promptExcerpt + '』')
            : null
        )
  )
}

// 生效工具数：continuable 交集实得数 → effective.effectiveToolCount → 未知 null。
function effectiveToolsCountOf(record) {
  const gates = record.trace && Array.isArray(record.trace.gates) ? record.trace.gates : []
  const inter = gates.find((g) => g.name === 'intersection')
  if (inter && inter.output && Number.isFinite(inter.output.effectiveAllowCount)) return inter.output.effectiveAllowCount
  const eff = record.trace && record.trace.effective
  if (eff && Number.isFinite(eff.effectiveToolCount)) return eff.effectiveToolCount
  return null
}

// 证据层 ② 决策 chips 行（中文对照，忽略项键名中文化）。
function buildEffectiveChips(el, chip, record, profileNames) {
  const eff = record.trace.effective || {}
  if (Object.keys(eff).length === 0) return null
  const requested = record.trace.requested || {}
  const chips = []
  chips.push(chip('profile', ZH.chipProfile, profileDisplay(eff.profile, profileNames)))
  chips.push(chip('preset', ZH.chipPreset, presetZh(eff.preset), { dim: !eff.preset || eff.preset === 'inherit' }))
  const p = rawOrInherit(eff.provider)
  const m = rawOrInherit(eff.model)
  chips.push(chip('providerModel', ZH.chipProvider + '·' + ZH.chipModel, p === ZH.inherit && m === ZH.inherit ? ZH.inherit : p + ' / ' + m, { dim: p === ZH.inherit && m === ZH.inherit }))
  chips.push(chip('effort', ZH.chipEffort, effortZh(eff.reasoningEffort), { dim: !eff.reasoningEffort || eff.reasoningEffort === '(default)' }))
  const tier = typeof eff.tokenTier === 'string' && eff.tokenTier !== '' ? eff.tokenTier : ''
  if (tier !== '') chips.push(chip('tier', ZH.chipTier, ZH.tierZh[tier] || tier))
  const toolsCount = effectiveToolsCountOf(record)
  if (toolsCount !== null) chips.push(chip('tools', ZH.toolAllowlist, String(toolsCount)))
  const ignored = Array.isArray(eff.ignored) ? eff.ignored : []
  for (const key of ignored) {
    const reqVal = typeof requested[key] === 'string' && requested[key] !== '' ? requested[key] : ''
    chips.push(el('span', {
      key: 'ignored-' + key,
      className: 'sap-chip sap-chipWarn',
      title: reqVal !== '' ? ZH.ignoredChipTitle.replace('{value}', reqVal) : ZH.ignoredChipTitleEmpty
    }, '⬆' + (FIELD_ZH[key] || key) + '(' + ZH.ignoredMark + ')'))
  }
  chips.push(...buildAuditChips(el, record.trace))
  return el('div', { className: 'sap-chips' }, chips)
}

// 请求 vs 生效对照表单行：差异标在生效侧，说明列写原因；继承表述「继承父会话（模型名）」。
function requestVsRowOf(key, label, requested, effective) {
  const ignored = Array.isArray(effective.ignored) ? effective.ignored : []
  const reqRaw = typeof requested[key] === 'string' ? requested[key] : ''
  const effRaw = typeof effective[key] === 'string' ? effective[key] : ''
  const zhOf = (v) => {
    if (v === '') return ZH.ledgerVsUnset
    if (key === 'reasoningEffort') return effortZh(v)
    if (key === 'tokenTier') return ZH.tierZh[v] || v
    return v
  }
  const reqText = zhOf(reqRaw)
  let effText = zhOf(effRaw)
  let note = ''
  let diff = false
  if (ignored.includes(key)) {
    diff = true
    effText = ZH.inherit
    note = ZH.ledgerVsIgnored.replace('{v}', reqText)
  } else if (key === 'model' && reqRaw === '' && effRaw !== '') {
    effText = ZH.ledgerVsInherit.replace('{model}', effRaw)
  } else if (reqRaw === '' && effRaw !== '') {
    note = ZH.ledgerVsDefault
  } else if (reqRaw !== '' && effRaw !== '' && reqRaw !== effRaw) {
    diff = true
    note = '请求了 ' + reqText + '，未生效'
  }
  return { key, label, request: reqText, effective: effText, note, diff }
}

// 证据层 ② 请求 vs 生效对照表（差异行微琥珀底；全一致折叠为「请求全部生效 ✓」）。
function buildRequestVsTable(el, record) {
  const trace = record.trace
  const requested = trace.requested || {}
  const effective = trace.effective || {}
  if (Object.keys(effective).length === 0) return null
  const rows = [
    requestVsRowOf('model', ZH.chipModel, requested, effective),
    requestVsRowOf('reasoningEffort', ZH.chipEffort, requested, effective),
    requestVsRowOf('tokenTier', ZH.chipTier, requested, effective)
  ]
  const diffCount = rows.filter((r) => r.diff).length
  const headText = diffCount === 0
    ? ZH.ledgerVsTitle + ' · ' + ZH.ledgerVsAllMatch
    : ZH.ledgerVsTitle + ' · ' + ZH.ledgerVsDiff.replace('{n}', String(diffCount))
  const table = el('table', { className: 'sap-ledgerVsTable' },
    el('thead', null, el('tr', null,
      el('th', null, ZH.ledgerVsItem),
      el('th', null, ZH.ledgerVsRequest),
      el('th', null, ZH.ledgerVsEffective),
      el('th', null, ZH.ledgerVsNote)
    )),
    el('tbody', null, rows.map((r) => el('tr', { key: r.key, className: r.diff ? 'sap-ledgerVsDiff' : null },
      el('td', null, r.label),
      el('td', null, r.request),
      el('td', null, el('span', { className: 'sap-ledgerVsEff' }, r.effective)),
      el('td', { className: 'sap-ledgerVsNote' }, r.note)
    )))
  )
  if (diffCount === 0) {
    return el('details', { className: 'sap-customized' },
      el('summary', { className: 'sap-customizedSummary' }, headText),
      el('div', { className: 'sap-customizedBody' }, table)
    )
  }
  return el('div', null,
    el('div', { className: 'sap-ledgerVsHead' }, headText),
    table
  )
}

// 白名单候选数（whitelist 闸 input，截断名单认 values）。
function whitelistCountOf(record) {
  const gates = record.trace && Array.isArray(record.trace.gates) ? record.trace.gates : []
  const wl = gates.find((g) => g.name === 'whitelist')
  const raw = wl && wl.input ? wl.input.systemTrustCandidates : null
  if (Array.isArray(raw)) return raw.length
  if (raw && typeof raw === 'object' && Array.isArray(raw.values)) return raw.values.length
  return null
}
function intersectionGateOf(record) {
  const gates = record.trace && Array.isArray(record.trace.gates) ? record.trace.gates : []
  return gates.find((g) => g.name === 'intersection') || null
}
function removedToolsOf(record) {
  const inter = intersectionGateOf(record)
  if (!inter || !inter.output) return null
  const raw = inter.output.removedTools
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object' && Array.isArray(raw.values)) return raw.values
  return null
}
// 工具名「英文（中文名）」（中文名查工具目录映射，查不到原样）。
function toolNameZh(name, toolZh) {
  const zh = toolZh !== null && typeof toolZh === 'object' ? toolZh[name] : undefined
  return typeof zh === 'string' && zh !== '' ? name + '（' + zh + '）' : name
}

// 证据层 ② 工具集子节（默认折叠）：白名单 X ∩ 父会话 Y → 实得 Z · 移除 N 个；
// 移除清单完整展示（表格滚动兜底）；非 continuable 诚实降级。
function buildToolsetSubSection(el, record, toolZh) {
  const x = whitelistCountOf(record)
  const inter = intersectionGateOf(record)
  const y = inter && inter.input ? inter.input.parentToolCount : null
  const z = effectiveToolsCountOf(record)
  const removed = removedToolsOf(record)
  const zText = z !== null ? String(z) : ZH.ledgerToolsetGranted
  const formula = ZH.ledgerToolsetFormula
    .replace('{x}', x !== null ? String(x) : '?')
    .replace('{y}', y !== undefined && y !== null ? String(y) : '?')
    .replace('{z}', zText)
  const removedText = removed !== null && removed.length > 0 ? ' · ' + ZH.ledgerToolsetRemoved.replace('{n}', String(removed.length)) : ''
  const body = removed !== null && removed.length > 0
    ? el('div', { className: 'sap-ledgerToolScroll' },
        el('table', { className: 'sap-ledgerToolTable' },
          el('thead', null, el('tr', null, el('th', null, ZH.ledgerToolCol), el('th', null, ZH.ledgerToolReasonCol))),
          el('tbody', null, removed.map((item) => el('tr', { key: item.name },
            el('td', { className: 'sap-ledgerToolName' }, toolNameZh(item.name, toolZh)),
            el('td', null, typeof item.reason === 'string' ? item.reason : '')
          )))
        ))
    : el('div', { className: 'sap-ledgerUsage' }, ZH.ledgerToolsetHostNarrow)
  return el('details', { className: 'sap-customized' },
    el('summary', { className: 'sap-customizedSummary' }, ZH.ledgerToolsetTitle + ' · ' + formula + removedText),
    el('div', { className: 'sap-customizedBody' }, body)
  )
}

// 证据层 ② 派发前 · 安全检查子节（默认折叠；失败默认展开并附拒绝块）。
function buildPrecheckSubSection(el, record, copiedTarget, onCopyTarget) {
  const s = safetyBadgesOf(record)
  const title = s.allPass
    ? ZH.ledgerPrecheckTitle + ' ✅ 5/5 ' + ZH.ledgerPass
    : ZH.ledgerPrecheckTitle + ' ' + ZH.ledgerSafetyFail.replace('{gate}', ZH.ledgerGateBadgeZh[s.failedName] || s.failedName)
  const badges = el('div', { className: 'sap-ledgerSafety' },
    s.badges.map((b) => el('span', {
      key: 'precheck-' + b.name,
      className: b.ok ? 'sap-ledgerBadge sap-ledgerBadgeOk' : 'sap-ledgerBadge sap-ledgerBadgeFail'
    }, (ZH.ledgerGateBadgeZh[b.name] || b.name) + ' ' + (b.ok ? '✓' : '❌')))
  )
  const reject = s.failedName !== '' ? buildRejectBlock(el, record, copiedTarget, onCopyTarget) : null
  return el('details', { className: 'sap-customized', open: !s.allPass },
    el('summary', { className: 'sap-customizedSummary' }, title),
    el('div', { className: 'sap-customizedBody' }, badges, reject)
  )
}

// 证据层 ② 决策 · 生效值：chips（中文对照）+ 决策原文 + 请求vs生效表 + 工具集 + 安全检查。
function buildDecisionBlock(el, chip, record, profileNames, toolZh, jsonView, toggleJson, copiedTarget, onCopyTarget) {
  const trace = record.trace
  const jsonMode = jsonView.decide === true
  const kv = [
    { label: ZH.ledgerEffectiveStep, value: trace.effective },
    { label: 'gates', value: trace.gates }
  ]
  return el('div', { key: 'block-decide', className: 'sap-ledgerStep' },
    el('div', { className: 'sap-ledgerStepHead' },
      el('span', null, ZH.cogDecide),
      buildViewToggle(el, jsonMode, () => toggleJson('decide'))
    ),
    jsonMode
      ? buildJsonBody(el, kv)
      : el('div', { className: 'sap-ledgerStepBody' },
          buildEffectiveChips(el, chip, record, profileNames),
          trace.parentText && trace.parentText.after
            ? el('div', { className: 'sap-cogParentText' }, ZH.ledgerDecisionQuote + '：『' + trace.parentText.after + '』')
            : null,
          buildRequestVsTable(el, record),
          buildToolsetSubSection(el, record, toolZh),
          buildPrecheckSubSection(el, record, copiedTarget, onCopyTarget)
        )
  )
}
// 模型选择审计标注 chips：警示色 chip，title 给出确定性判定依据。
function buildAuditChips(el, trace) {
  return auditModelChoice(trace).map((a) => el('span', {
    key: 'audit-' + a.key,
    className: 'sap-chip sap-chipWarn',
    title: a.title
  }, a.label))
}


// 证据层 ④ 结算：结束原因（中文）· 耗时 · tokens · 输出摘要 · 成本分解。
function buildSettleBlock(el, record, jsonView, toggleJson, openChild) {
  const settled = record.trace && record.trace.settled
  if (!settled) return null
  const jsonMode = jsonView.settle === true
  const kv = [{ label: ZH.ledgerSettledStep, value: settled }]
  const numbers = recordNumbers(record)
  const stopZh = recordStopZh(record)
  const parts = []
  if (stopZh !== '') parts.push(ZH.ledgerStopReason + '：' + stopZh)
  if (numbers.elapsedMs !== null) parts.push(ZH.ledgerElapsed + ' ' + formatDurationMs(numbers.elapsedMs))
  if (numbers.tokens !== null) parts.push('≈' + numbers.tokens + ' tokens')
  const usageText = usageBreakdownText(recordUsage(record))
  if (usageText !== '') parts.push(ZH.ledgerSettleCostBreakdown + '：' + usageText)
  const output = record.contentFirstLine
  const outputText = output !== '' ? ZH.ledgerSettleOutput + '：' + output : ''
  const execution = (record.trace && record.trace.execution) || {}
  const parentSessionId = typeof execution.parentSessionId === 'string' ? execution.parentSessionId : ''
  const childSessionId = typeof execution.childSessionId === 'string' ? execution.childSessionId : ''
  const mode = typeof execution.mode === 'string' ? execution.mode : ''
  const jump = parentSessionId !== '' && childSessionId !== '' && mode !== ''
    ? el('button', { type: 'button', className: 'sap-detailToggle', onClick: () => openChild({ parentSessionId, childSessionId, mode }) }, ZH.ledgerJumpChild + ' ▸')
    : null
  return el('div', { key: 'block-settle', className: 'sap-ledgerStep' },
    el('div', { className: 'sap-ledgerStepHead' },
      el('span', null, ZH.cogNewPerceive),
      buildViewToggle(el, jsonMode, () => toggleJson('settle'))
    ),
    jsonMode
      ? buildJsonBody(el, kv)
      : el('div', { className: 'sap-ledgerStepBody' },
          parts.length > 0 ? el('div', { className: 'sap-ledgerUsage' }, parts.join(' · ')) : null,
          outputText !== '' ? el('div', { className: 'sap-ledgerUsage' }, outputText) : null,
          jump
        )
  )
}
// 逐次调用明细折叠区（默认收起）：trace.settled.calls 逐条五段紧凑表格（序号 + 五列，
// 缺失段显示 —）+ 末行合计（∑已存 calls，未截断时与 childUsage 五段分解对账一致）+
// 截断提示。无 calls 数据时整区不渲染。
function buildCallDetailSection(el, record) {
  const data = recordCalls(record)
  if (data === null) return null
  const keys = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
  const labels = [ZH.usageInput, ZH.usageOutput, ZH.usageCacheRead, ZH.usageCacheWrite, ZH.usageReasoning]
  const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
  const rows = data.calls.map((call, i) => {
    const cells = keys.map((key) => {
      const value = call[key]
      if (typeof value === 'number') totals[key] += value
      return el('td', { key }, typeof value === 'number' ? String(value) : '—')
    })
    return el('tr', { key: i },
      el('td', { className: 'sap-ledgerCallsIndex' }, String(i + 1)),
      ...cells
    )
  })
  const totalCells = keys.map((key) => el('td', { key, className: 'sap-ledgerCallsTotal' }, String(totals[key])))
  const note = data.truncated
    ? el('div', { className: 'sap-ledgerCallsNote' },
        ZH.ledgerCallsTruncated.replace('{shown}', String(data.calls.length)).replace('{total}', String(data.totalCalls)))
    : null
  return el('details', { className: 'sap-customized' },
    el('summary', { className: 'sap-customizedSummary' }, ZH.ledgerCallDetail),
    el('div', { className: 'sap-customizedBody' },
      el('table', { className: 'sap-ledgerCallsTable' },
        el('thead', null,
          el('tr', null,
            el('th', { className: 'sap-ledgerCallsIndex' }, ZH.ledgerCallsIndex),
            keys.map((key, i) => el('th', { key }, labels[i]))
          )
        ),
        el('tbody', null,
          rows,
          el('tr', { key: 'total' },
            el('td', { className: 'sap-ledgerCallsIndex sap-ledgerCallsTotal' }, ZH.ledgerCallsTotal),
            ...totalCells
          )
        )
      ),
      note
    )
  )
}


// 证据层 ③ 执行：时间区间 + 工具调用次数 + 过程事件线（停滞/干预/恢复）+ 跳转 + 逐次调用明细。
function buildExecutionBlock(el, record, proc, toolZh, jsonView, toggleJson, openChild) {
  const trace = record.trace
  const execution = trace.execution || {}
  if (recordIsRejected(record) && Object.keys(execution).length === 0) return null
  const jsonMode = jsonView.execute === true
  const settled = trace.settled
  const numbers = recordNumbers(record)
  const startedText = formatClockTime(trace.startedAt)
  const endTime = settled && typeof settled.elapsedMs === 'number' && trace.startedAt !== null ? trace.startedAt + settled.elapsedMs : null
  const endText = endTime !== null ? formatClockTime(endTime) : ''
  const durText = formatDurationMs(numbers.elapsedMs)
  const interval = startedText !== '' && endText !== ''
    ? ZH.ledgerExecInterval.replace('{start}', startedText).replace('{end}', endText).replace('{dur}', durText)
    : (durText !== '' ? ZH.ledgerElapsed + ' ' + durText : '')
  const callsText = proc !== null && proc.toolCalls > 0 ? ZH.ledgerExecToolCalls.replace('{n}', String(proc.toolCalls)) : ''
  const parentSessionId = typeof execution.parentSessionId === 'string' ? execution.parentSessionId : ''
  const childSessionId = typeof execution.childSessionId === 'string' ? execution.childSessionId : ''
  const mode = typeof execution.mode === 'string' ? execution.mode : ''
  const jump = parentSessionId !== '' && childSessionId !== '' && mode !== ''
    ? el('button', { type: 'button', className: 'sap-detailToggle', onClick: () => openChild({ parentSessionId, childSessionId, mode }) }, ZH.ledgerJumpChild + ' ▸')
    : (childSessionId !== ''
        ? el('div', { className: 'sap-ledgerManual' }, ZH.ledgerChildManual + '：', el('code', { className: 'sap-ledgerManualId' }, childSessionId))
        : null)
  const kv = [
    { label: ZH.ledgerExecutionStep, value: execution },
    { label: 'calls', value: settled && settled.calls ? settled.calls : null }
  ]
  return el('div', { key: 'block-execute', className: 'sap-ledgerStep' },
    el('div', { className: 'sap-ledgerStepHead' },
      el('span', null, ZH.cogExecute),
      buildViewToggle(el, jsonMode, () => toggleJson('execute'))
    ),
    jsonMode
      ? buildJsonBody(el, kv)
      : el('div', { className: 'sap-ledgerStepBody' },
          interval !== '' ? el('div', { className: 'sap-ledgerUsage' }, interval) : null,
          callsText !== '' ? el('div', { className: 'sap-ledgerUsage' }, callsText) : null,
          !settled ? el('div', { className: 'sap-ledgerUsage' }, ZH.ledgerExecLiveNote) : null,
          proc !== null ? buildProcessTimeline(el, proc, toolZh) : null,
          jump,
          buildCallDetailSection(el, record)
        )
  )
}

// 过程事件线单条：时间 + 文案；停滞琥珀点、干预蓝点、里程碑绿点。
function buildProcessEvent(el, event, toolZh) {
  const time = event.time !== null && event.time !== undefined ? formatClockTime(event.time) : ''
  const cls = event.kind === 'stall' ? 'sap-ledgerEvent sap-ledgerEvent-warn'
    : (event.kind === 'intervene' ? 'sap-ledgerEvent sap-ledgerEvent-int' : 'sap-ledgerEvent sap-ledgerEvent-done')
  const bodyOf = () => {
    if (event.kind === 'start') return ZH.ledgerEventStart
    if (event.kind === 'call') return ZH.ledgerEventCall.replace('{n}', String(event.index)) + '（' + (event.tool !== '' ? toolNameZh(event.tool, toolZh) : '?') + '）'
    if (event.kind === 'stall') return ZH.ledgerEventStall.replace('{s}', String(event.seconds)).replace('{t}', String(STALL_THRESHOLD_MS / 1000))
    if (event.kind === 'intervene') return ZH.ledgerEventIntervene + '：' + event.text
    if (event.kind === 'resume') return ZH.ledgerEventResume
    if (event.kind === 'done') return ZH.ledgerEventDone
    return ZH.ledgerEventRunning
  }
  const body = bodyOf()
  return el('div', { key: event.kind + '-' + (event.time !== null ? String(event.time) : 'end'), className: cls },
    time !== '' ? el('span', { className: 'sap-ledgerEventTime' }, time) : null,
    event.kind === 'intervene' ? el('span', { className: 'sap-ledgerEventAct' }, body) : body
  )
}
// 过程事件线（工具调用 >4 次时节选：前 2 + 省略 + 最后 1；停滞/干预/恢复不节选）。
function buildProcessTimeline(el, proc, toolZh) {
  if (proc.events.length === 0) return null
  const calls = proc.events.filter((e) => e.kind === 'call')
  const showAll = calls.length <= 4
  const items = []
  let skipInserted = false
  for (const event of proc.events) {
    if (event.kind === 'call' && !showAll) {
      const callIdx = calls.indexOf(event)
      if (callIdx >= 2 && callIdx < calls.length - 1) {
        if (!skipInserted) { items.push(el('div', { key: 'call-more', className: 'sap-ledgerEvent sap-ledgerEvent-done' }, '…')); skipInserted = true }
        continue
      }
    }
    items.push(buildProcessEvent(el, event, toolZh))
  }
  return el('div', null,
    el('div', { className: 'sap-ledgerVsHead' }, ZH.ledgerStallThresholdNote),
    el('div', { className: 'sap-ledgerEventLine' }, items)
  )
}

// 证据层装配：① 发起 → ② 决策 → ③ 执行 → ④ 结算（拒绝场景 ③④ 自动省略）。
function buildEvidenceArea(el, chip, record, profileNames, toolZh, proc, jsonView, toggleJson, openChild, copiedTarget, onCopyTarget) {
  return el('div', { className: 'sap-ledgerExpand' },
    buildStartBlock(el, record, jsonView, toggleJson),
    buildDecisionBlock(el, chip, record, profileNames, toolZh, jsonView, toggleJson, copiedTarget, onCopyTarget),
    buildExecutionBlock(el, record, proc, toolZh, jsonView, toggleJson, openChild),
    buildSettleBlock(el, record, jsonView, toggleJson, openChild)
  )
}

// 折叠态行：时间 · 方案中文名 · 状态chip · 成本 · 工具数 · [⚠干预 N] · ▸。
function buildLedgerRowHead(el, record, profileNames, proc, open, onToggle) {
  const status = ledgerStatusOf(record)
  const rejected = recordIsRejected(record)
  const settled = record.trace && record.trace.settled
  const costInfo = recordCostInfo(record)
  const costText = rejected ? '—' : (!settled ? ZH.ledgerCostRunning : (costInfo !== null ? '≈' + costInfo.actual + ' 元' : ''))
  const profileId = recordProfile(record)
  const profileText = profileId !== '' ? profileDisplay(profileId, profileNames) : ZH.inlineProfile
  const imageText = imageTextOfBlock({ imageText: record.imageText }, record.trace !== null && typeof record.trace === 'object' ? record.trace.effective : null)
  const toolsText = ledgerToolsCountOf(record, proc)
  const interveneText = proc !== null && proc.interventions > 0 ? ZH.ledgerInterventionBadge.replace('{n}', String(proc.interventions)) : ''
  return el('button', {
    type: 'button',
    className: 'sap-ledgerRowHead',
    'aria-expanded': open,
    onClick: onToggle
  },
    el('span', { className: 'sap-ledgerTime' }, formatClockTime(record.time)),
    el('span', { className: 'sap-ledgerMeta' }, profileText),
    imageText !== ''
      ? el('span', { className: 'sap-ledgerMeta sap-ledgerImageText' }, imageText)
      : null,
    el('span', { className: 'sap-ledgerStatus ' + status.cls }, status.label),
    costText !== '' ? el('span', { className: 'sap-ledgerCostText' }, costText) : null,
    toolsText !== '' ? el('span', { className: 'sap-ledgerToolsText' }, toolsText) : null,
    interveneText !== ''
      ? el('span', { className: 'sap-ledgerBadge sap-ledgerBadgeWarn' }, interveneText)
      : null,
    el('span', { className: 'sap-ledgerToggle' }, '▸')
  )
}
// 剪贴板复制（fail-soft：无 clipboard API 时仍置反馈状态，目标文本可见可手动复制）。
function copyToClipboard(text) {
  try {
    if (window.navigator && window.navigator.clipboard && typeof window.navigator.clipboard.writeText === 'function') {
      window.navigator.clipboard.writeText(text)
    }
  } catch { /* 复制失败仍显示目标文本供手动复制 */ }
}

function makeCopyTarget(setCopiedTarget) {
  return (target) => () => {
    copyToClipboard(target)
    setCopiedTarget(target)
  }
}


// ── 台账 maker（React 依赖经参数注入）───────────────────────────────────────

// 单条记录三层：折叠态行 → 结论层（点行展开）→ 证据层（「查看完整因果链」再展开）。
function makeLedgerRow(el, chip, useState, openChild) {
  function LedgerRow({ record, profileNames, childNodesOf, toolZh }) {
    const [open, setOpen] = useState(false)
    const [evidenceOpen, setEvidenceOpen] = useState(false)
    // 修复方向复制反馈：点击「复制 <目标>」后按钮短暂显示「已复制」。
    const [copiedTarget, setCopiedTarget] = useState('')
    // 区块级视图切换：jsonView[key] 为 true 时该区块显示原始 JSON
    // （key='start'/'decide'/'execute'/'settle'）。各区块独立切换。
    const [jsonView, setJsonView] = useState({})
    const toggleJson = (key) => setJsonView((prev) => ({ ...prev, [key]: !(prev[key] === true) }))
    const isLegacy = record.legacy === true
    const rejected = recordIsRejected(record)
    const execution = record.trace && record.trace.execution ? record.trace.execution : {}
    const childSessionId = typeof execution.childSessionId === 'string' ? execution.childSessionId : ''
    const proc = childSessionId !== '' && typeof childNodesOf === 'function'
      ? processEventsOf(childNodesOf(childSessionId), record.trace && record.trace.settled)
      : processEventsOf(null, record.trace && record.trace.settled)
    const copyTarget = makeCopyTarget(setCopiedTarget)
    return el('li', {
      className: 'sap-ledgerRow' + (open ? ' sap-ledgerRowOpen' : '') + (rejected ? ' sap-ledgerRowFail' : '')
    },
      buildLedgerRowHead(el, record, profileNames, proc, open, () => setOpen((prev) => !prev)),
      open && isLegacy
        ? el('div', { className: 'sap-ledgerExpand' }, el('div', { className: 'sap-ledgerLegacy' }, ZH.ledgerLegacy))
        : null,
      open && !isLegacy
        ? buildConclusionArea(el, record, proc, copiedTarget, copyTarget, evidenceOpen, setEvidenceOpen)
        : null,
      open && !isLegacy && evidenceOpen
        ? buildEvidenceArea(el, chip, record, profileNames, toolZh, proc, jsonView, toggleJson, openChild, copiedTarget, copyTarget)
        : null
    )
  }
  return LedgerRow
}


// 台账后台任务状态 hook：挂载即拉一次；有待配对后台记录时 3 秒轮询至全部结算。
function useLedgerJobs(useState, useEffect, sessionId, pendingJobIds) {
  const [jobs, setJobs] = useState([])
  const pendingKey = Array.isArray(pendingJobIds) ? pendingJobIds.join(',') : ''
  useEffect(() => startLedgerJobsPoll(sessionId, pendingJobIds, setJobs), [sessionId, pendingKey])
  return jobs
}

// 台账视图数据装载 hook：失败台账 / 后台任务 / 方案名映射 / 工具中文名（name→zh）。
function useLedgerViewData(useState, useEffect, sessionId, pendingJobIds) {
  const [failures, setFailures] = useState([])
  const jobs = useLedgerJobs(useState, useEffect, sessionId, pendingJobIds)
  const [profileNames, setProfileNames] = useState({})
  const [toolZh, setToolZh] = useState({})
  useEffect(() => {
    let cancelled = false
    fetchLedgerFailures(sessionId).then((list) => {
      if (!cancelled) setFailures(list)
    })
    api('/options/tools').then((data) => {
      if (cancelled) return
      const map = {}
      for (const tool of (Array.isArray(data.tools) ? data.tools : [])) {
        if (tool !== null && typeof tool === 'object' && typeof tool.name === 'string' && typeof tool.zh === 'string' && tool.zh !== '') {
          map[tool.name] = tool.zh
        }
      }
      setToolZh(map)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [sessionId])
  useEffect(() => {
    let cancelled = false
    api('/list').then((data) => {
      if (cancelled || data === undefined || !Array.isArray(data.profiles)) return
      const map = {}
      for (const profile of data.profiles) {
        if (profile !== null && typeof profile === 'object' && typeof profile.id === 'string' && typeof profile.name === 'string' && profile.name !== '') {
          map[profile.id] = profile.name
        }
      }
      setProfileNames(map)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  return { failures, jobs, profileNames, toolZh }
}

// 记录行列表（含空态）。
function buildLedgerRows(el, records, LedgerRow, profileNames, childNodesOf, toolZh) {
  if (records.length === 0) return buildEmptyState(el)
  const ordered = records.slice().reverse()
  return el('ul', { className: 'sap-ledgerRows' },
    ordered.map((record, index) => el(LedgerRow, { key: ledgerKey(record, index), record, profileNames, childNodesOf, toolZh }))
  )
}

function makeDispatchLedgerView(el, chip, useState, useEffect, openChild, getSessions) {
  const LedgerRow = makeLedgerRow(el, chip, useState, openChild)
  function DispatchLedgerView({ useSession, sessionId, loadOlder = () => {} }) {
    const nodes = useSession((s) => s?.chat?.legacy?.nodes)
    const hasMore = useSession((s) => s?.hasMore)
    const loadingOlder = useSession((s) => s?.loadingOlder)
    const pendingJobs = pendingBackgroundJobIds(nodes)
    const data = useLedgerViewData(useState, useEffect, sessionId, pendingJobs)
    // 子会话快照读取（执行过程事件线数据源）；拿不到返回 null（fail-soft 不虚报）。
    const childNodesOf = (childSessionId) => {
      try {
        const child = getSessions().binding(childSessionId)
        const childNodes = child !== undefined && child !== null && child.session !== undefined ? child.session.chat?.legacy?.nodes : undefined
        return Array.isArray(childNodes) ? childNodes : null
      } catch {
        return null
      }
    }
    // 台账默认只统计已加载窗口；经「加载更早」逐页补载更早记录后 nodes 变多、统计自然扩大。
    const records = mergeBackgroundJobs(mergeFailureRecords(collectDispatchRecords(nodes), data.failures), data.jobs)
    const summary = records.length === 0 ? null : computeLedgerSummary(records)
    return el('div', { className: 'sap-ledger' },
      buildLedgerTopNote(el, hasMore, records.length),
      buildLoadOlderButton(el, hasMore, loadingOlder, loadOlder),
      summary === null ? null : buildLedgerSummary(el, summary, data.profileNames),
      buildLedgerRows(el, records, LedgerRow, data.profileNames, childNodesOf, data.toolZh)
    )
  }
  return DispatchLedgerView
}
// ── plugin 装配 ─────────────────────────────────────────────────────────────

window.__ModuleLoader__.load({
  id: 'dsh-subagent-profile',
  factory: (require) => {
    const React = require('react'); const { useEffect, useState, useCallback } = React
    const el = React.createElement

    // slots：槽注册；sessions：子会话跳转（openSubagent）。两者皆 client 核心服务。
    const inject = ['slots', 'sessions']

    const chip = makeChip(el)
    const DispatchToolview = makeDispatchToolview(el, chip, useState, useEffect)
    const ReminderOverlayBadge = makeReminderOverlayBadge(el, useState, useEffect)

    function apply(ctx) {
      // 提醒中心需要会话跳转（主会话 open / 子会话 openSubagent）与标题查询，
      // 与派发决策台账 openChild 同一 sessions 服务来源。
      const openChild = (address) => ctx.sessions.openSubagent(address)
      const ReminderCenter = makeReminderCenter(el, useState, useEffect, openChild, () => ctx.sessions)
      const ProfilesSection = makeProfilesSection(el, api, chip, useState, useEffect, useCallback, ReminderCenter, () => ctx.sessions)
      ensureStyles()
      const SubagentHeaderUtility = makeSubagentHeaderUtility(el, useState, useEffect, () => ctx.get('modelDirectories'), () => ctx.sessions)
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'dispatch' }, DispatchToolview))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'subagent-profiles',
        order: 100,
        label: '子 Agent 方案'
      }, ProfilesSection))
      // 子会话页头常驻 banner（仅子会话渲染；同 chip 族；宿主未投影前不渲染）。
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'dsh-subagent-profile-subagent', order: 20 }, SubagentHeaderUtility))
      // P0 红角标（severity 红 + 常驻至已读 + 带 session 标识）。
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-subagent-profile-reminders', order: 800 }, ReminderOverlayBadge))
      // 子会话跳转回调：经 sessions 服务按 SubagentAddress 打开子会话。
      const DispatchLedgerView = makeDispatchLedgerView(el, chip, useState, useEffect, openChild, () => ctx.sessions)
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'dispatch-ledger',
        order: 20,
        label: ZH.ledgerTab,
        inject: (sessionId) => {
          const session = ctx.sessions.binding(sessionId)?.session
          if (session === void 0) throw new Error(`dsh-subagent-profile: 会话 "${sessionId}" 不可用（可能已归档或未加载）`)
          return { loadOlder: async () => { await session.loadOlder() } }
        }
      }, DispatchLedgerView))
    }

    return { apply, inject }
  },
})