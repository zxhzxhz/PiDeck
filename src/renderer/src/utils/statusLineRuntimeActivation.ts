import type { AgentBackend } from "../../../shared/types";

/**
 * 状态行是否值得为当前会话预热 pi 运行进程（纯判据，便于单测）。
 *
 * 背景：状态行内容来自扩展 `ctx.ui.setStatus`，而扩展只在活着的 pi 进程里跑。
 * PiDeck 默认懒启动（输入框有内容后才预热 runtime），所以「点开会话就能看到状态行」
 * 必须由本开关自己把进程拉起来——否则用户要先在输入框里敲点东西
 * （引用文件 / `/` 命令 / 引用对话）才看得到这一行。
 *
 * 全部满足才激活：
 * - `enabled`：开关关掉后行为与以前完全一致，绝不为状态行预热；
 * - `backend === "pi"`：DSH / 生图后端不产生 pi 扩展状态，不能为此多起一个 host；
 * - `hasSessionRecord`：引导页虚拟会话（GUIDE_BOOTSTRAP_SESSION_ID）没有会话记录，
 *   激活只会以「会话不存在」失败；
 * - `!runtimeLive`：已有活 runtime 时扩展状态会自己到达，重复激活只是白走一趟 IPC；
 * - `!alreadyRequested`：每个会话每次挂载只请求一次，用户手动停掉的会话不被反复拉起。
 */
export function shouldActivateRuntimeForStatusLine(input: { enabled: boolean; backend: AgentBackend; hasSessionRecord: boolean; runtimeLive: boolean; alreadyRequested: boolean }): boolean {
	return input.enabled && input.backend === "pi" && input.hasSessionRecord && !input.runtimeLive && !input.alreadyRequested;
}
