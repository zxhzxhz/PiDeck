import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/**
 * 状态行三档的解析与旧布尔开关迁移（src/main/settings/composerStatusLineMode.ts）。
 *
 * 关键回归点：旧布尔 `showComposerStatusLine: true` 在当时就是「显示 + 打开会话即预热」，
 * 迁移必须落到 "prewarm" 而不是 "on"——降成 "on" 会让老用户升级后又变成
 * 「要先在输入框敲点东西才出现状态行」，正是这次要修的怪现象。
 */

const { parseComposerStatusLineMode } = loadTsCommonJs("src/main/settings/composerStatusLineMode.ts");

test("三档原样保留", () => {
	assert.equal(parseComposerStatusLineMode("off"), "off");
	assert.equal(parseComposerStatusLineMode("on"), "on");
	assert.equal(parseComposerStatusLineMode("prewarm"), "prewarm");
});

test("旧布尔开关迁移：true → prewarm（旧行为就是显示+预热），false → off", () => {
	assert.equal(parseComposerStatusLineMode(undefined, true), "prewarm");
	assert.equal(parseComposerStatusLineMode(undefined, false), "off");
	// 磁盘上可能同时存在（用户既改过开关又存过新字段）：新字段优先。
	assert.equal(parseComposerStatusLineMode("on", true), "on");
});

test("缺省与脏值一律回落 off（磁盘 JSON 无类型）", () => {
	assert.equal(parseComposerStatusLineMode(undefined), "off");
	assert.equal(parseComposerStatusLineMode(null), "off");
	assert.equal(parseComposerStatusLineMode(""), "off");
	assert.equal(parseComposerStatusLineMode("ON"), "off");
	assert.equal(parseComposerStatusLineMode(1), "off");
	assert.equal(parseComposerStatusLineMode({ mode: "on" }), "off");
	assert.equal(parseComposerStatusLineMode("on", "yes"), "on");
});
