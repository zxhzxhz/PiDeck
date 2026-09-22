import { stripAnsi } from "./agentUtils";

/**
 * 扩展状态行（pi TUI 底栏最后一行）合成。
 *
 * 为什么要有这一层：pi 交互层把扩展 `ctx.ui.setStatus(key, text)` 写入的条目
 * 按 key 字典序排序、清洗后拼成 footer 的最后一行；RPC 模式下同一个 setStatus
 * 会作为 `extension_ui_request` 事件转发给客户端，桌面端要显示「和 TUI 同一行」，
 * 就必须用完全相同的排序与清洗规则，否则同一台机器上两处顺序/空白会漂移。
 *
 * 清洗规则与 pi 内置 footer 一致（`sanitizeStatusText`）：
 * `\r \n \t` → 空格、连续空格折叠、去首尾空白。
 * 额外一步 `stripAnsi`：TUI 里状态文本带终端颜色转义，DOM 中会显示成乱码方块。
 */

/** 单行化 + 空白折叠（对齐 pi footer 的 sanitizeStatusText）。 */
export function sanitizeStatusLineText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * 按 pi 的规则合成状态行：key 字典序（localeCompare）排序、逐条清洗、单空格拼接。
 * 全空/无条目返回 undefined，调用方据此隐藏整行（与 TUI 无状态条目不占行一致）。
 */
export function composeExtensionStatusLine(statuses: ReadonlyMap<string, string> | undefined): string | undefined {
	if (!statuses || statuses.size === 0) return undefined;
	const parts = [...statuses.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => sanitizeStatusLineText(stripAnsi(text)))
		.filter((text) => text.length > 0);
	return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * 维护单个 runtime 的 status 条目集合。
 *
 * `text === undefined` / 空串 = pi 约定「清除该 key」（见 RPC 文档 setStatus），
 * 清除后条目必须真正从集合里删除：否则残留 key 会让下一次合成把空段落也算进去，
 * 且运行期间条目会随扩展刷新无限增长。
 */
export function applyExtensionStatus(statuses: Map<string, string>, key: string, text: string | undefined): void {
	const trimmedKey = key.trim();
	if (!trimmedKey) return;
	if (text === undefined) {
		statuses.delete(trimmedKey);
		return;
	}
	const sanitized = sanitizeStatusLineText(stripAnsi(text));
	if (sanitized.length === 0) {
		statuses.delete(trimmedKey);
		return;
	}
	statuses.set(trimmedKey, text);
}
