import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/**
 * 扩展状态行合成（src/main/pi/extensionStatusLine.ts）。
 *
 * 这一行是「pi TUI 底栏最后一行」的桌面复刻：排序与清洗必须和 pi 内置 footer 逐字一致，
 * 否则同一台机器上 TUI 与 PiDeck 显示的状态条顺序/空白会漂移（用户对照截图就能看出来）。
 * 覆盖点：
 *  1. key 字典序排序 + 单空格拼接（不是 setStatus 到达顺序）；
 *  2. `\r \n \t` → 空格、连续空格折叠、去首尾空白；
 *  3. ANSI 颜色转义剥离（TUI 有颜色，DOM 里是乱码方块）；
 *  4. `text === undefined` / 全空白 = 清除条目（不得留下空段落）；
 *  5. 全空集合返回 undefined（调用方据此隐藏整行）。
 */

const { applyExtensionStatus, composeExtensionStatusLine, sanitizeStatusLineText } = loadTsCommonJs("src/main/pi/extensionStatusLine.ts");

test("composeExtensionStatusLine：按 key 字典序排序后用单空格拼接", () => {
	const statuses = new Map([
		["clinepass-cost", "Turn: $0.00000"],
		["magic-context", "mc: 0 (0%)"],
		["5h", "5h: 4%"],
	]);
	assert.equal(composeExtensionStatusLine(statuses), "5h: 4% Turn: $0.00000 mc: 0 (0%)");
});

test("composeExtensionStatusLine：换行/制表折成空格并折叠连续空格", () => {
	const statuses = new Map([["a", "  line1\n\tline2   line3  "]]);
	assert.equal(composeExtensionStatusLine(statuses), "line1 line2 line3");
});

test("composeExtensionStatusLine：剥离 ANSI 颜色转义", () => {
	const statuses = new Map([["a", "\u001b[32m✔ ready\u001b[0m"]]);
	assert.equal(composeExtensionStatusLine(statuses), "✔ ready");
});

test("composeExtensionStatusLine：空集合、全空白条目返回 undefined", () => {
	assert.equal(composeExtensionStatusLine(new Map()), undefined);
	assert.equal(composeExtensionStatusLine(undefined), undefined);
	assert.equal(composeExtensionStatusLine(new Map([["a", "   \n\t "]])), undefined);
});

test("applyExtensionStatus：undefined / 空白文本等于清除该 key", () => {
	const statuses = new Map();
	applyExtensionStatus(statuses, "k", "hello");
	assert.equal(statuses.get("k"), "hello");
	// 空白文本与 undefined 一样是「清除」：pi 的 setStatus 语义如此，
	// 若保留空条目，下一行合成会多出一个空段落且条目会无限堆积。
	applyExtensionStatus(statuses, "k", "   \n ");
	assert.equal(statuses.has("k"), false);
	applyExtensionStatus(statuses, "k", "hello");
	applyExtensionStatus(statuses, "k", undefined);
	assert.equal(statuses.has("k"), false);
});

test("applyExtensionStatus：忽略空 key（不清除也不写入）", () => {
	const statuses = new Map([["keep", "v"]]);
	applyExtensionStatus(statuses, "   ", "x");
	assert.deepEqual([...statuses.entries()], [["keep", "v"]]);
});

test("sanitizeStatusLineText 不改变正常文本", () => {
	assert.equal(sanitizeStatusLineText("Turn: $0.00000 | 5h: [██] 4% (resets 13:39)"), "Turn: $0.00000 | 5h: [██] 4% (resets 13:39)");
});

/**
 * 装配口径（源码级断言）：状态行是「主进程合成 → 渲染层只读」的链路，
 * 中间任何一处漏接都不会报错、只会静默不显示，所以用契约测试锁住三个挂载点：
 *  1. AgentManager 收到 setStatus 后累积并下发 statusLine，且随 runtime 生命周期清理；
 *  2. 渲染层把 statusLine 挂进运行期 UI 状态（session-atoms），ComposerArea 渲染该行；
 *  3. 开关（showComposerStatusLine）在设置页与两份 i18n 里都存在。
 */
test("status line wiring: main composes and replays, renderer mounts, setting exists", () => {
	const read = (path) => readFileSync(path, "utf8");

	const agentManager = read("src/main/pi/AgentManager.ts");
	// 累积 + 下发：setStatus 分支必须写入 per-agent 条目并带上合成结果。
	assert.match(agentManager, /this\.extensionStatusByAgent/, "AgentManager 必须持有 per-runtime 状态条目");
	assert.match(agentManager, /applyExtensionStatus\(statuses, statusKey/, "setStatus 必须累积到条目集合");
	assert.match(agentManager, /statusLine: composeExtensionStatusLine\(statuses\)/, "下发的 payload 必须带合成后的整行");
	// 回放：当前行要随 runtime 状态下发，渲染层重建/换绑后不必等下一次 setStatus。
	assert.match(agentManager, /const extensionStatusLine = composeExtensionStatusLine\(this\.extensionStatusByAgent\.get\(agentId\)\);/, "getRuntimeState 必须合成当前状态行快照");
	assert.match(agentManager, /\.\.\.\(extensionStatusLine \? \{ extensionStatusLine \} : \{\}\)/, "runtime 状态必须带 extensionStatusLine（无条目才省略）");
	// runtime 生命周期清理：否则重启后残留上一进程的状态行。
	assert.match(agentManager, /private clearAgentState\(agentId: string\) \{[\s\S]{0,4000}?this\.extensionStatusByAgent\.delete\(agentId\)/, "clearAgentState 必须清理状态条目");

	const composerArea = read("src/renderer/src/components/session/ComposerArea.tsx");
	assert.match(composerArea, /statusLine=\{<ComposerStatusLine sessionId=\{props\.sessionId\} \/>\}/, "ComposerArea 必须在输入卡下方挂载状态行");
	assert.match(composerArea, /\{props\.composerBox\}\s*\{props\.statsLine\}\s*\{props\.statusLine\}/, "状态行必须排在 statsLine 之后（TUI 底栏位置）");

	// 预热：只有 prewarm 档才在打开会话时激活 runtime（否则纯历史会话要等用户敲一次输入才出现状态行）。
	assert.match(composerArea, /useComposerStatusLineActivation\(\{/, "ComposerArea 必须接入状态行预热 hook");
	assert.match(composerArea, /mode: statusLineMode,/, "预热 hook 必须拿到三档模式");
	assert.match(composerArea, /runtimeLive: isLiveRuntimeStatus\(composer\.runtime\?\.status\)/, "预热判据必须带上当前 runtime 是否活着");
	const activationHook = read("src/renderer/src/hooks/useComposerStatusLineActivation.ts");
	assert.match(activationHook, /desktopApi\.sessions\.activateRuntime\(sessionId\)/, "预热必须走既有的 activateRuntime（幂等复用活进程）");
	assert.match(activationHook, /shouldActivateRuntimeForStatusLine\(/, "预热判据必须是可单测的纯函数（见 statusLineRuntimeActivation.test.mjs）");
	assert.match(activationHook, /requestedRef\.current = sessionId;/, "每个会话每次挂载只请求一次（护栏先落再发请求）");
	assert.match(read("src/renderer/src/utils/statusLineRuntimeActivation.ts"), /input\.mode === "prewarm"/, "只有 prewarm 档触发激活");

	// 渲染层：回放分支必须写进运行期 UI 状态。
	assert.match(read("src/renderer/src/atoms/session-atoms.ts"), /stateRecord\.extensionStatusLine/, "session-atoms 必须消费 runtime 状态里的 extensionStatusLine 回放");
	assert.match(read("src/renderer/src/components/session/ComposerStatusLine.tsx"), /mode === "off"/, "off 档不渲染状态行");

	// 三档设置：PiDeck 设置字段 + 默认值 + 设置页下拉（三个选项）+ 中英文案。
	const settingsType = read("src/shared/types/settings.ts");
	assert.match(settingsType, /composerStatusLineMode: ComposerStatusLineMode;/);
	assert.match(settingsType, /export type ComposerStatusLineMode = "off" \| "on" \| "prewarm";/);
	assert.match(read("src/main/settings/SettingsStore.ts"), /composerStatusLineMode: "off",/);
	// 旧布尔开关的迁移必须映射成 prewarm（旧 true 的行为就是「显示 + 打开即预热」）。
	assert.match(read("src/main/settings/SettingsStore.ts"), /parseComposerStatusLineMode\(this\.settings\.composerStatusLineMode/, "SettingsStore 必须迁移旧布尔开关");
	const commonTab = read("src/renderer/src/components/app/settings/CommonTab.tsx");
	assert.match(commonTab, /anchor="common-composer-status-line"/);
	for (const value of ["off", "on", "prewarm"]) {
		// 用字面量包含判断而不是正则：选项行里有未转义的 "(" 与引号，拼 RegExp 容易踩转义坑。
		assert.ok(commonTab.includes(`value: "${value}", label: t("settings.composerStatusLine`), `设置页缺少 ${value} 选项`);
	}
	for (const locale of ["zh-CN", "en-US"]) {
		const copy = read(`src/renderer/src/i18n/rendererCopy.${locale}.ts`);
		for (const key of ["settings.composerStatusLine", "settings.composerStatusLineOff", "settings.composerStatusLineOn", "settings.composerStatusLinePrewarm"]) {
			assert.match(copy, new RegExp(`"${key.replace(/\./g, "\.")}"`), `${locale} 缺少 ${key} 文案`);
		}
	}
});
