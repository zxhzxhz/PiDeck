import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { PiModelCapabilityCache, parseAvailableModelsResponse } = loadTsCommonJs("src/main/pi/PiModelCapabilityCache.ts");

function response(data) {
	return { success: true, data };
}

function failure(error) {
	return { success: false, error };
}

function plain(value) {
	return JSON.parse(JSON.stringify(value));
}

function createProcess(models, levelsByModel, options = {}) {
	const commands = [];
	let currentKey = "";
	let stopped = 0;
	const process = {
		async start(_sessionPath, _trustOverride, noSession) {
			assert.equal(noSession, true, "capability probe must use --no-session");
			return {
				async request(command) {
					commands.push(command);
					if (command.type === "get_available_models") {
						return response({ models });
					}
					if (command.type === "set_model") {
						currentKey = `${command.provider}\u0000${command.modelId}`;
						return options.setFailureKeys?.has(currentKey) ? failure("model unavailable") : response({ model: { provider: command.provider, id: command.modelId } });
					}
					if (command.type === "get_available_thinking_levels") {
						const value = levelsByModel.get(currentKey);
						return value instanceof Error ? failure(value.message) : response({ levels: value });
					}
					throw new Error(`unexpected command: ${command.type}`);
				},
			};
		},
		stop() {
			stopped += 1;
		},
	};
	return { process, commands, getStopped: () => stopped };
}

test("parseAvailableModelsResponse keeps only safe model fields and de-duplicates identities", () => {
	const models = parseAvailableModelsResponse(
		response({
			models: [
				{
					provider: "openai",
					id: "gpt-5",
					name: "GPT 5",
					contextWindow: 200_000,
					maxTokens: 32_000,
					reasoning: true,
					input: ["text", "image"],
					thinkingLevelMap: { off: null, high: "high", xhigh: "xhigh", ignored: "never" },
					apiKey: "must-not-cross-ipc",
				},
				{ provider: "openai", id: "gpt-5", name: "duplicate" },
				{ provider: "bad", id: "" },
			],
		}),
	);

	assert.deepEqual(plain(models), [
		{
			provider: "openai",
			id: "gpt-5",
			name: "GPT 5",
			contextWindow: 200_000,
			maxTokens: 32_000,
			reasoning: true,
			input: ["text", "image"],
			images: true,
			thinkingLevelMap: { off: null, high: "high", xhigh: "xhigh" },
		},
	]);
});

test("hydration queries every model in one no-session process and publishes exact levels", async () => {
	const models = [
		{ provider: "openai", id: "gpt-5", reasoning: true, input: ["text", "image"] },
		{ provider: "anthropic", id: "claude", reasoning: false, input: ["text"] },
	];
	const levels = new Map([
		["openai\u0000gpt-5", ["off", "low", "high", "xhigh"]],
		["anthropic\u0000claude", ["off"]],
	]);
	const fake = createProcess(models, levels);
	const cache = new PiModelCapabilityCache({ createProcess: () => fake.process });

	const snapshot = await cache.ensure();

	assert.deepEqual(
		plain(
			snapshot?.models.map((model) => ({
				provider: model.provider,
				id: model.id,
				images: model.images,
				thinkingLevels: model.thinkingLevels,
			})),
		),
		[
			{ provider: "openai", id: "gpt-5", images: true, thinkingLevels: ["off", "low", "high", "xhigh"] },
			{ provider: "anthropic", id: "claude", images: false, thinkingLevels: ["off"] },
		],
	);
	assert.deepEqual(
		fake.commands.map((command) => command.type),
		["get_available_models", "set_model", "get_available_thinking_levels", "set_model", "get_available_thinking_levels"],
	);
	assert.equal(fake.getStopped(), 1, "the probe must be stopped after publication");

	const cached = await cache.ensure();
	assert.equal(fake.commands.length, 5, "picker reads must reuse the published snapshot");
	cached.models[0].thinkingLevels.push("mutated");
	assert.deepEqual(plain(cache.getSnapshot().models[0].thinkingLevels), ["off", "low", "high", "xhigh"]);
});

test("one unavailable model remains listed without claiming an exact level", async () => {
	const models = [
		{ provider: "openai", id: "available", reasoning: true },
		{ provider: "openai", id: "removed", reasoning: true },
	];
	const levels = new Map([["openai\u0000available", ["off", "high"]]]);
	const fake = createProcess(models, levels, {
		setFailureKeys: new Set(["openai\u0000removed"]),
	});
	const cache = new PiModelCapabilityCache({ createProcess: () => fake.process });

	const snapshot = await cache.ensure();

	assert.deepEqual(plain(snapshot?.models[0].thinkingLevels), ["off", "high"]);
	assert.equal(snapshot?.models[1].thinkingLevels, undefined);
});

test("unsupported thinking RPC discards the exact snapshot instead of inventing levels", async () => {
	const models = [{ provider: "openai", id: "legacy", reasoning: true }];
	const levels = new Map([["openai\u0000legacy", new Error("Unknown command: get_available_thinking_levels")]]);
	const fake = createProcess(models, levels);
	const warnings = [];
	const cache = new PiModelCapabilityCache({
		createProcess: () => fake.process,
		onWarning: (message, detail) => warnings.push({ message, detail }),
	});

	assert.equal(await cache.ensure(), null);
	assert.equal(cache.getSnapshot(), null);
	assert.equal(fake.getStopped(), 1);
	assert.match(warnings[0].detail.error, /get_available_thinking_levels/i);
	await cache.ensure();
	assert.equal(fake.commands.filter((command) => command.type === "get_available_models").length, 1, "a failed generation must not respawn Pi for every picker open");
});

test("默认 hydration 档位：库缺省不加载扩展，注入设置读取函数后按设置走", async () => {
	// 背景：扩展加载是 hydration 冷启动的大头（本机实测 418 模型：带扩展 ~2.4s vs
	// --no-extensions ~0.37s），而扩展贡献的模型（pi.registerProvider，issue #181）
	// 只有装了此类插件的用户才有。库自身不读设置：不传 defaultLoadExtensions 时
	// 仍是快速档（保守默认），装配层注入 `() => settingsStore.get().piModelListLoadExtensions`。
	const models = [{ provider: "openai", id: "gpt-5", reasoning: true }];
	const levels = new Map([["openai\u0000gpt-5", ["off", "high"]]]);
	const spawnModes = [];
	const cache = new PiModelCapabilityCache({
		createProcess: (options) => {
			spawnModes.push(options.loadExtensions);
			return createProcess(models, levels).process;
		},
	});

	const fast = await cache.ensure();
	assert.deepEqual(spawnModes, [false], "未注入设置时首次 hydration 必须用 --no-extensions 快速档");
	assert.equal(fast.loadExtensions, false, "快照要标明自己没带扩展");

	// 已发布快照直接复用，不再 spawn。
	await cache.ensure();
	assert.deepEqual(spawnModes, [false]);

	const full = await cache.refresh({ loadExtensions: true });
	assert.deepEqual(spawnModes, [false, true], "手动刷新必须回到带扩展档");
	assert.equal(full.loadExtensions, true);

	// 无参 refresh = 配置保存/watcher 等自动失效重建：跟随默认档（此处未注入 = 快速档）。
	await cache.refresh();
	assert.deepEqual(spawnModes, [false, true, false]);
});

test("设置开启慢速档：ensure / 无参 refresh 都加载扩展，显式 false 可覆盖", async () => {
	// 对应设置 piModelListLoadExtensions = true（本 fork 默认值）：模型选择器首次打开
	// 就应包含扩展贡献的 provider（issue #181，如 pi-clinepass 的 clinepass），
	// 且配置保存 / watcher 触发的自动重建不得把扩展模型刷没。
	const models = [{ provider: "clinepass", id: "cline-pass/deepseek-v4.1-flash", reasoning: true }];
	const levels = new Map([["clinepass\u0000cline-pass/deepseek-v4.1-flash", ["off", "max"]]]);
	const spawnModes = [];
	let settingEnabled = true;
	const cache = new PiModelCapabilityCache({
		defaultLoadExtensions: () => settingEnabled,
		createProcess: (options) => {
			spawnModes.push(options.loadExtensions);
			return createProcess(models, levels).process;
		},
	});

	const first = await cache.ensure();
	assert.deepEqual(spawnModes, [true], "设置开启时首次 hydration 就要加载扩展");
	assert.equal(first.loadExtensions, true);

	// watcher / 配置保存触发的自动重建同样跟随设置（否则一次外部改文件就刷掉扩展模型）。
	const rebuilt = await cache.refresh();
	assert.deepEqual(spawnModes, [true, true]);
	assert.equal(rebuilt.loadExtensions, true);

	// 设置关闭后重建回到快速档，且显式 true（刷新按钮）仍能一次性补回。
	settingEnabled = false;
	await cache.refresh();
	const forced = await cache.refresh({ loadExtensions: true });
	assert.deepEqual(spawnModes, [true, true, false, true]);
	assert.equal(forced.loadExtensions, true);
});

test("装配口径：快速档传 piRpcNoExtensions，刷新按钮透传 loadExtensions，默认档读设置", () => {
	const indexSource = readFileSync("src/main/index.ts", "utf8");
	// 快速档：settings 上强制 piRpcNoExtensions（含内置扩展 -e 注入一并跳过）。
	assert.match(indexSource, /createProcess: \(\{ loadExtensions \}\) =>/);
	assert.match(indexSource, /\.\.\.\(loadExtensions \? \{\} : \{ piRpcNoExtensions: true \}\)/);
	// 默认档跟随设置：装配层必须注入设置读取函数，否则开关切了也不生效。
	assert.match(indexSource, /defaultLoadExtensions: \(\) => settingsStore\.get\(\)\.piModelListLoadExtensions/);

	const systemIpc = readFileSync("src/main/ipc/systemIpc.ts", "utf8");
	const manualReloadStart = systemIpc.indexOf("// 手动刷新（force）");
	assert.ok(manualReloadStart >= 0, "手动刷新分支必须保留注释锚点");
	assert.match(systemIpc.slice(manualReloadStart, manualReloadStart + 2000), /modelCapabilityCache\.refresh\(\{ loadExtensions: true \}\)/, "刷新按钮必须带 loadExtensions:true（扩展贡献模型的唯一入口）");
	// 自动失效重建（配置保存 / watcher / 备份恢复）保持快速档，不得带 loadExtensions。
	assert.match(systemIpc, /const refreshPiModelCatalogs = async \(\): Promise<void> => \{[\s\S]*?modelCapabilityCache\.refresh\(\)/);
});

test("a refresh invalidates a stale hydration generation before it can publish", async () => {
	let resolveFirstStart;
	const firstStarted = new Promise((resolve) => {
		resolveFirstStart = resolve;
	});
	let firstStopped = 0;
	const firstProcess = {
		async start() {
			await firstStarted;
			return {
				async request(command) {
					if (command.type === "get_available_models") return response({ models: [] });
					throw new Error("stale process should not query model levels");
				},
			};
		},
		stop() {
			firstStopped += 1;
		},
	};
	const second = createProcess([{ provider: "openai", id: "fresh", reasoning: true }], new Map([["openai\u0000fresh", ["off", "medium"]]]));
	let processCount = 0;
	const cache = new PiModelCapabilityCache({
		createProcess: () => {
			processCount += 1;
			return processCount === 1 ? firstProcess : second.process;
		},
	});

	const stale = cache.ensure();
	const fresh = cache.refresh();
	resolveFirstStart();

	assert.equal(await stale, null);
	assert.deepEqual(plain((await fresh)?.models[0].thinkingLevels), ["off", "medium"]);
	assert.equal(firstStopped, 1);
	assert.equal(cache.getSnapshot().models[0].id, "fresh");
});
