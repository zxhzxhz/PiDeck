# fork mod 分支说明（zxhzxhz/PiDeck · `mod`）

本文件只描述**本 fork 的 `mod` 分支**相对上游 `ayuayue/PiDeck:main` 的改动。上游发版流程、CHANGELOG 约定不在本 fork 内维护（合并上游时本文件可能冲突，按「保留本 fork 功能」处理）。

## 本 fork 的本地约定（不要在 clone 里开 AtomGit 镜像）

上游仓库带着一个 `pre-push` 钩子（`.githooks/pre-push` → `scripts/atomgit-mirror.mjs`）：
每次 `git push` 都会顺带把本次引用镜像到 `atomgit.com/ayuayue/PiDeck`（上游镜像）；
`npm ci` / `npm install` 的 `prepare` 会跑 `scripts/install-git-hooks.mjs`，把
`core.hooksPath` 指回 `.githooks` 并重建 `atomgit` 远端——所以关掉后每次重装依赖都要再关一次。

本 fork 的 clone 里关闭镜像（三行，幂等）：

```bash
mkdir -p .githooks-off && echo ".githooks-off/" >> .git/info/exclude
git config --local core.hooksPath .githooks-off
git remote remove atomgit
```

更彻底的做法是设用户级环境变量（钩子脚本自带开关，`npm ci` 也不会绕过）：

```powershell
setx PI_DECK_SKIP_ATOMGIT 1   # 撤销：reg delete HKCU\Environment /v PI_DECK_SKIP_ATOMGIT /f
```

## 功能 1：模型列表加载扩展（慢速档开关）

- **位置**：「配置管理 → pi 配置管理 → 设置 → 默认供应商与模型」里的开关
  「模型列表加载扩展（慢速档）」（`src/renderer/src/config/ModelListLoadExtensionsSetting.tsx`）。
- **字段**：PiDeck 自己的设置 `piModelListLoadExtensions`（`AppSettings`），**默认开**；
  它不属于 pi 的配置，不会写进 `~/.pi/agent/settings.json`。
- **行为**：
  - 开：模型列表由**加载扩展**的 pi 进程水合（慢速档，本机实测 ≈2.4s），
    扩展通过 `pi.registerProvider` 贡献的 provider（如 pi-clinepass 的 `clinepass`）
    直接出现在模型选择器里；
  - 关：`--no-extensions` 快速档（≈0.4s），只列 `models.json` / 内置目录的模型；
  - 两档都由 `PiModelCapabilityCache` 的 `defaultLoadExtensions` 读设置决定，
    `ensure()` / 无参 `refresh()`（配置保存、目录 watcher、备份恢复）都跟随设置，
    不会出现「刷新后扩展模型忽然消失」；
  - 模型选择器右上角刷新按钮始终显式 `refresh({ loadExtensions: true })`，
    关掉开关时仍可一次性补回扩展模型；切换开关时主进程立即失效重建快照。
- **相关文件**：`src/main/pi/PiModelCapabilityCache.ts`、`src/main/index.ts`（装配 +
  `refreshModelCapabilities`）、`src/main/ipc/systemIpc.ts`（设置变更重建）、
  `src/shared/types/settings.ts`、`src/main/settings/SettingsStore.ts`、`previewApi.ts`。
- **测试**：`tests/piModelCapabilityCache.test.mjs`（含源码级装配断言）。
- **文档**：`docs/pi-model-capability-plan.md` 的「扩展加载分档」章节已同步。

## 功能 2：输入框下方显示 TUI 底栏（扩展状态行）

- **位置**：聊天输入卡正下方（`ComposerStatsLine` 之下）的一条等宽文本行；
  档位在「设置 → 常用 → 扩展状态行」，**三选一**（`composerStatusLineMode`，默认 `off`）：
  - `off` 关闭；
  - `on` 打开：显示这一行，但**不为它启动 pi**（纯浏览历史不起进程；只有该会话已有活进程时才有内容）；
  - `prewarm` 打开并预热：显示 + 打开会话即激活 pi 运行进程（见下）。
  旧版布尔开关 `showComposerStatusLine` 按当时行为迁移（`true → prewarm`、`false/缺省 → off`），
  见 `src/main/settings/composerStatusLineMode.ts`（纯函数 + 单测）。
- **数据来源**：pi 扩展 `ctx.ui.setStatus(key, text)` 在 RPC 模式下会作为
  `extension_ui_request` 事件下发（已用真实 pi 0.87 RPC 验证：
  `mcp`、`magic-context`、`pi-quotas-*` 等扩展在会话启动时就会写入）。
  主进程按 pi 内置 footer 的同一套规则合成整行：**key 字典序排序 → 清洗
  （`\r \n \t` 折空格、连续空格折叠、去首尾空白）→ 单空格拼接 → 剥 ANSI 颜色**，
  因此与 TUI 的顺序一致，渲染层不自己攒条目。
- **状态行回放（服务端快照）**：主进程持有权威条目集合，并把当前行作为
  `AgentRuntimeState.extensionStatusLine` 随 runtime 状态下发；渲染层换绑 / 新代际 /
  重挂载时会直接采用它，因此不用等「下一次 setStatus」就有内容，字段缺失即清空。
  这条链路借鉴 `@agegr/pi-web` 的做法（它把 pi 内嵌在服务端进程里、状态存会话状态随快照下发，
  所以那边不存在「要预热」的问题；PiDeck 走子进程模型，只能把启动成本显式化）。
- **prewarm 档：打开会话即预热 runtime**：状态来自扩展，只有活着的 pi 进程才会发事件；
  PiDeck 默认懒启动（输入框有内容才预热），不补这一步的话点开纯历史会话看不到状态行，
  要先在输入框里触发一次交互才出现。`prewarm` 档由
  `hooks/useComposerStatusLineActivation.ts` 在会话打开时调一次
  `sessions.activateRuntime`（幂等：已有活进程直接复用），
  每个会话每次挂载只请求一次；`off` / `on` 档行为与未引入该功能时完全一致。
  代价：为每个打开的会话起/复用 pi 进程（受闲置自动释放的保留数约束，聚焦中的会话不会被回收），
  这是用户显式选择的档位（设置项描述里已说明）。
- **边界**：pi 自家 footer 的 pwd / 花费 / 上下文百分比由 TUI 交互层渲染，
  RPC 模式不提供（`setFooter` 在 RPC 下是空实现）——这一行只包含扩展状态条目；
  无条目时整行卸载（不占高度）。
- **相关文件**：`src/main/pi/extensionStatusLine.ts`（纯函数 + 单测）、
  `src/main/pi/AgentManager.ts`（按 runtime 收集并合成下发 + 快照回放，`clearAgentState` 清理）、
  `src/shared/types/agent.ts`（`statusKey` / `statusLine` / `AgentRuntimeState.extensionStatusLine`）、
  `src/renderer/src/atoms/session-atoms.ts`（`SessionRuntimeUiState.statusLine` + 回放 +
  按 session 的 `selectAtom` family）、`src/renderer/src/components/session/ComposerStatusLine.tsx`、
  `ComposerArea.tsx`、`src/renderer/src/atoms/app-ui-atoms.ts`（档位 atom）、
  `src/renderer/src/utils/statusLineRuntimeActivation.ts`、`src/renderer/src/hooks/useComposerStatusLineActivation.ts`。
- **测试**：`tests/extensionStatusLine.test.mjs`（合成/清洗/清除规则 + 装配口径）、
  `tests/sessionRuntimeUi.test.mjs`（存/清 + 回放）、
  `tests/statusLineRuntimeActivation.test.mjs`（预热判据）、
  `tests/composerStatusLineMode.test.mjs`（三档解析与旧布尔迁移）。
