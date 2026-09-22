import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/**
 * 状态行是否预热 runtime 的判据（src/renderer/src/utils/statusLineRuntimeActivation.ts）。
 *
 * 用户可见的问题：状态行是扩展产出的，纯历史会话点开时是空的，必须先在输入框里
 * 触发一次交互（引用文件 / `/` 命令）才出现——因为 PiDeck 默认懒启动。
 * 因此三档里只有 `prewarm` 触发激活，且要同时满足
 * 「pi 后端 / 有会话记录 / 目前没有活 runtime / 本次挂载没请求过」。
 */

const { shouldActivateRuntimeForStatusLine } = loadTsCommonJs("src/renderer/src/utils/statusLineRuntimeActivation.ts");

const base = {
	mode: "prewarm",
	backend: "pi",
	hasSessionRecord: true,
	runtimeLive: false,
	alreadyRequested: false,
};

test("prewarm 档 + pi 后端 + 有会话记录 + 无活 runtime → 需要预热", () => {
	assert.equal(shouldActivateRuntimeForStatusLine(base), true);
});

test("off / on 档都不预热：on 档只是「有活进程就显示」，不为状态行起进程", () => {
	assert.equal(shouldActivateRuntimeForStatusLine({ ...base, mode: "off" }), false);
	assert.equal(shouldActivateRuntimeForStatusLine({ ...base, mode: "on" }), false);
});

test("非 pi 后端不预热（DSH/生图不产生 pi 扩展状态）", () => {
	assert.equal(shouldActivateRuntimeForStatusLine({ ...base, backend: "dsh" }), false);
	assert.equal(shouldActivateRuntimeForStatusLine({ ...base, backend: "imagegen" }), false);
});

test("引导页虚拟会话（无会话记录）不预热：激活只会失败", () => {
	assert.equal(shouldActivateRuntimeForStatusLine({ ...base, hasSessionRecord: false }), false);
});

test("已有活 runtime 时不重复请求", () => {
	assert.equal(shouldActivateRuntimeForStatusLine({ ...base, runtimeLive: true }), false);
});

test("每次挂载只请求一次：已请求过就不再预热（用户手动停掉的会话不被反复拉起）", () => {
	assert.equal(shouldActivateRuntimeForStatusLine({ ...base, alreadyRequested: true }), false);
	// 但换会话（新挂载/新 sessionId）后护栏重置，仍会为新会话预热。
	assert.equal(shouldActivateRuntimeForStatusLine({ ...base, alreadyRequested: false }), true);
});
