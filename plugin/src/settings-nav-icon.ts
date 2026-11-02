/**
 * 技能管理器在 DSH 设置侧边导航栏中的专属图标。
 *
 * 图标矢量路径与 dsh-codex-ui (observeSettingsNavIcons) 保持一致：
 * 卡片入槽（dsh-loadout 的品牌标）。
 *
 * 渲染方式使用独立的 CSS mask span，而不是改写宿主 svg 的内容：
 * 第三方皮肤（如 orca-link / dsh-deep-whale）会按 svg 内部形状识别图标，
 * 给 svg 打标记后用 CSS 隐藏其子节点。直接替换 svg.innerHTML 会与皮肤的
 * 内容级识别机制互相覆盖，并残留皮肤标记，最终导致图标整体不可见 (#49)。
 * mask span 不参与皮肤对 svg 子节点的识别与隐藏，宿主 svg 只负责被隐藏。
 */

export const NAV_ICON_MARKER = "data-dssm-nav-icon";
export const NAV_ROW_SELECTOR = '[role="dialog"] nav button';

/** 100% 对齐 dsh-codex-ui 官方的技能专属矢量路径（viewBox: 0 0 16 16） */
export const SKILL_PATHS = '<rect fill="currentColor" x="2.2" y="3.4" width="6.8" height="8.6" rx="1.1" opacity="0.45" transform="rotate(-9 6 7.7)"/><rect fill="currentColor" x="6.8" y="2.4" width="6.8" height="8.6" rx="1.1"/><rect fill="currentColor" x="2.6" y="12.7" width="10.8" height="1.5" rx="0.75"/>';

/** mask 只取 alpha 通道，因此把 currentColor 固定为黑色即可 */
const SKILL_ICON_MASK = `url(\"data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\">${SKILL_PATHS.replace(/fill=\"currentColor\"/g, 'fill=\"black\"')}</svg>`,
)}\")`;

const NAV_ICON_STYLE_ID = "dssm-settings-nav-icon-style";
const NAV_ICON_CSS = [
  `[${NAV_ICON_MARKER}] > svg { display: none !important; }`,
  `[${NAV_ICON_MARKER}]::before {`,
  `  content: '';`,
  `  flex: none;`,
  `  width: 16px;`,
  `  height: 16px;`,
  `  background-color: currentColor;`,
  `  -webkit-mask: ${SKILL_ICON_MASK} center / contain no-repeat;`,
  `  mask: ${SKILL_ICON_MASK} center / contain no-repeat;`,
  `  -webkit-mask-repeat: no-repeat;`,
  `  mask-repeat: no-repeat;`,
  `  -webkit-mask-position: center;`,
  `  mask-position: center;`,
  `  -webkit-mask-size: 16px 16px;`,
  `  mask-size: 16px 16px;`,
  `}`,
].join("\n");

export function isOwnNavRow(rowText: string | null | undefined, wantedLabel: string | null | undefined): boolean {
  const wanted = String(wantedLabel ?? "").trim();
  if (wanted.length === 0) return false;
  const current = String(rowText ?? "").trim();
  return current === wanted;
}

/** 注入导航图标的样式；重复安装时复用同一个 style 元素 */
function ensureNavIconStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(NAV_ICON_STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = NAV_ICON_STYLE_ID;
  style.textContent = NAV_ICON_CSS;
  (document.head ?? document.documentElement).appendChild(style);
}

/**
 * 100% 对齐 dshmarket：用纯属性标记控制 ::before 伪元素渲染图标。
 * 不修改任何 DOM 节点，避免移动端列表项排版下与文字重叠冲突。
 */
export function applySettingsNavIcon(button: Element, wantedLabel: () => string): boolean {
  const isOwn = isOwnNavRow(button.textContent, wantedLabel());
  if (isOwn) {
    if (button.getAttribute(NAV_ICON_MARKER) === "") return false;
    button.setAttribute(NAV_ICON_MARKER, "");
    return true;
  }
  if (button.hasAttribute(NAV_ICON_MARKER)) {
    button.removeAttribute(NAV_ICON_MARKER);
    return true;
  }
  return false;
}

/** 移除本插件添加的标记，宿主 svg 恢复显示 */
export function restoreSettingsNavIcon(button: Element): boolean {
  if (!button.hasAttribute(NAV_ICON_MARKER)) return false;
  button.removeAttribute(NAV_ICON_MARKER);
  return true;
}

export interface NavIconContext {
  effect(callback: () => unknown, label?: string): void;
}

export function installSettingsNavIcon(ctx: NavIconContext, resolveLabel: () => string): void {
  if (typeof document === "undefined") return;
  ensureNavIconStyle();

  ctx.effect(() => {
    let disposed = false;
    let scheduled = false;

    const sync = () => {
      scheduled = false;
      if (disposed) return;
      for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) {
        applySettingsNavIcon(row, resolveLabel);
      }
    };

    const schedule = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      queueMicrotask(sync);
    };

    sync();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      disposed = true;
      observer.disconnect();
      for (const row of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) {
        restoreSettingsNavIcon(row);
      }
    };
  }, "skills-manager: settings nav icon");
}
