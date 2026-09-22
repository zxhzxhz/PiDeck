import { memo } from "react";
import { useAtomValue } from "jotai";
import { composerStatusLineModeAtom } from "../../atoms/app-ui-atoms";
import { sessionStatusLineBySessionIdAtomFamily } from "../../atoms/session-atoms";

/**
 * 输入卡正下方的「扩展状态行」：复刻 pi TUI 底栏的最后一行（等宽、不换行、超长省略）。
 *
 * 数据来源：pi 扩展 `ctx.ui.setStatus(key, text)` 在 RPC 模式下会作为
 * `extension_ui_request` 事件发给客户端，主进程按 pi footer 的同一套规则
 * （key 字典序 + 清洗 + 单空格拼接）合成为整行后经运行时事件下发；
 * 另外主进程把当前行作为 `AgentRuntimeState.extensionStatusLine` 随 runtime 状态回放
 * （参考 pi-web 把状态存在服务端会话状态里的做法），所以渲染层重建/换绑后也能立刻拿到
 * 当前行，而不必等下一次 setStatus。
 *
 * 与 TUI 的差异：pi 自家 footer 的 pwd / 花费 / 上下文百分比由交互层渲染，
 * RPC 模式不提供（setFooter 在 RPC 下是空实现），所以这一行只包含扩展状态条目。
 *
 * 档位（settings.composerStatusLineMode）：`off` 不渲染；`on` / `prewarm` 渲染
 * （`prewarm` 额外会在打开会话时预热 pi 进程，见 useComposerStatusLineActivation）。
 * 无任何条目时整条卸载，不占高度。
 */
export const ComposerStatusLine = memo(function ComposerStatusLine(props: { sessionId: string }) {
	const mode = useAtomValue(composerStatusLineModeAtom);
	const line = useAtomValue(sessionStatusLineBySessionIdAtomFamily(props.sessionId));
	if (mode === "off" || !line) return null;
	return (
		<div className="w-full min-w-0 px-1 pb-0 pt-0.5 text-center text-[12px] leading-5 text-text-tertiary" title={line} data-testid="composer-status-line">
			<span className="font-mono">{line}</span>
		</div>
	);
});
