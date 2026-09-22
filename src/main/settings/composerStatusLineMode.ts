import type { ComposerStatusLineMode } from "../../shared/types/settings";

/**
 * 解析「输入框下方扩展状态行」的档位，含旧布尔开关的兼容迁移。
 *
 * 历史：该功能第一版是布尔开关 `showComposerStatusLine`，且 true 的行为是
 * 「显示 + 打开会话即预热 pi」。改成三档（off / on / prewarm）后，旧配置必须按
 * **当时的真实行为**映射：true → "prewarm"，false/缺省 → "off"，
 * 否则老用户升级后会莫名丢失预热（状态行又要等一次输入才出现）。
 *
 * 磁盘 JSON 无类型：非法的字符串/数字等脏值一律回落 "off"，不允许坏值渗到渲染层。
 */
export function parseComposerStatusLineMode(value: unknown, legacyBoolean?: unknown): ComposerStatusLineMode {
	if (value === "off" || value === "on" || value === "prewarm") return value;
	if (legacyBoolean === true) return "prewarm";
	return "off";
}
