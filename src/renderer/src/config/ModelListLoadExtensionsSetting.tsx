import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";
import { desktopApi } from "../desktopApi";
import { SettingSwitchRow } from "../components/app/settings/SettingRows";

/**
 * 「模型列表加载扩展（慢速档）」开关。
 *
 * 这是 PiDeck 侧设置（不是 pi `settings.json` 的字段），入口刻意放在「默认供应商与模型」：
 * 它只影响模型列表的数据来源，和默认供应商/模型是同一件事的两面——关掉它，扩展贡献的
 * model provider（如 pi-clinepass 的 `clinepass`）在模型选择器里就不会出现。
 *
 * 因此不复用 SettingsTab 的 draft + 「保存」链路：直接走 `settings:update` 即时生效。
 * 若跟着 pi settings.json 的保存一起提交，用户会以为「开了开关但模型列表没变」是开关坏了。
 */
export function ModelListLoadExtensionsSetting() {
	const [checked, setChecked] = useState<boolean | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void desktopApi.settings
			.get()
			.then((settings) => {
				if (!cancelled) setChecked(settings.piModelListLoadExtensions === true);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	const onChange = useCallback((next: boolean) => {
		// 乐观更新：开关必须立刻响应，写盘失败（极罕见）时回退为读取值由下一次挂载纠正。
		setChecked(next);
		setSaving(true);
		void desktopApi.settings
			.update({ piModelListLoadExtensions: next })
			.catch(() => undefined)
			.finally(() => setSaving(false));
	}, []);

	// 读设置是异步的：首帧不渲染，避免开关先显示成关再跳到真实值。
	if (checked === null) return null;
	return <SettingSwitchRow anchor="config-model-list-load-extensions" title={t("config.defaults.modelListLoadExtensions")} description={t("config.defaults.modelListLoadExtensionsDesc")} checked={checked} disabled={saving} onChange={onChange} />;
}
