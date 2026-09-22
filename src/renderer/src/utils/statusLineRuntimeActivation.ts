import type { AgentBackend, ComposerStatusLineMode } from "../../../shared/types";

/**
 * 状态行是否值得为当前会话预热 pi 运行进程（纯判据，便于单测）。
 *
 * 背景：状态行内容来自扩展 `ctx.ui.setStatus`，而扩展只在活着的 pi 进程里跑。
 * PiDeck 默认懒启动（输入框有内容后才预热 runtime），所以「点开会话就能看到状态行」
 * 必须由 `prewarm` 档自己把进程拉起来——否则用户要先在输入框里敲点东西
 * （引用文件 / `/` 命令 / 引用对话）才看得到这一行。
 * 对照：pi-web 把 pi 直接内嵌在服务端进程里，状态存在服务端会话状态随快照下发，
 * 因此没有「要预热」这一步；PiDeck 走子进程模型，只能把这件事显式化。
 *
 * 全部满足才激活：
 * - `mode === "prewarm"`：`off` / `on` 都不预热（`on` 就是「有活进程就显示，不为它起进程」）；
 * - `backend === "pi"`：DSH / 生图后端不产生 pi 扩展状态，不能为此多起一个 host；
 * - `hasSessionRecord`：引导页虚拟会话（GUIDE_BOOTSTRAP_SESSION_ID）没有会话记录，
 *   激活只会以「会话不存在」失败；
 * - `!runtimeLive`：已有活 runtime 时扩展状态会自己到达，重复激活只是白走一趟 IPC；
 * - `!alreadyRequested`：每个会话每次挂载只请求一次，用户手动停掉的会话不被反复拉起。
 */
export function shouldActivateRuntimeForStatusLine(input: { mode: ComposerStatusLineMode; backend: AgentBackend; hasSessionRecord: boolean; runtimeLive: boolean; alreadyRequested: boolean }): boolean {
	return input.mode === "prewarm" && input.backend === "pi" && input.hasSessionRecord && !input.runtimeLive && !input.alreadyRequested;
}
