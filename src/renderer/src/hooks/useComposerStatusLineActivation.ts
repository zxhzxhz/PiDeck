import { useEffect, useRef } from "react";
import type { AgentBackend, ComposerStatusLineMode } from "../../../shared/types";
import { desktopApi } from "../desktopApi";
import { shouldActivateRuntimeForStatusLine } from "../utils/statusLineRuntimeActivation";

/**
 * 「扩展状态行」为 `prewarm` 档时，打开会话即预热 pi 运行进程。
 *
 * 为什么需要这一步：状态行是扩展 `ctx.ui.setStatus` 的产物，只有活着的 pi 进程才会发事件。
 * PiDeck 的既有策略是「输入后才预热 runtime」（见 ComposerArea 的 prewarm effect：
 * 避免用户仅浏览历史就创建进程），于是纯历史会话打开时这一行会一直空着，
 * 直到用户在输入框里触发一次交互（引用文件 / 引用对话 / `/` 命令）——用户可见的怪现象。
 *
 * 因此这里把它做成显式的成本选择：**只有用户选 `prewarm` 档**才预热，
 * 每个会话每次挂载只请求一次（ref 记录，与 prewarm 同款护栏）；
 * 已有活 runtime 时不重复请求（激活本身幂等，但没必要多走一趟 IPC）。
 * 请求失败静默处理：状态行缺失可接受，不能因为一个展示项弹错误提示。
 */
export function useComposerStatusLineActivation(options: { sessionId: string; mode: ComposerStatusLineMode; backend: AgentBackend; hasSessionRecord: boolean; runtimeLive: boolean }): void {
	const { sessionId, mode, backend, hasSessionRecord, runtimeLive } = options;
	const requestedRef = useRef<string | undefined>(undefined);

	useEffect(() => {
		if (!sessionId) return;
		const shouldActivate = shouldActivateRuntimeForStatusLine({
			mode,
			backend,
			hasSessionRecord,
			runtimeLive,
			alreadyRequested: requestedRef.current === sessionId,
		});
		if (!shouldActivate) return;
		// 先落护栏再发请求：激活是异步的，运行态变 live 之前 effect 可能因依赖变化重跑。
		requestedRef.current = sessionId;
		void desktopApi.sessions.activateRuntime(sessionId).catch(() => undefined);
	}, [sessionId, mode, backend, hasSessionRecord, runtimeLive]);
}
