// composer 编组控件（conversation.input.dock）的客户端契约：
// 注册形状（id/order/locale/inject(sessionId)）、收起态文案（有编组 / 未加载）、
// popover 的单选项与生效技能清单、切换时的 POST、以及「在插件里管理」。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let definition, cursor = 0, state = [];
const effects = [];
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((child) => child != null && typeof child !== "boolean") }),
  useState(initial) { const index = cursor++, store = state; if (!(index in store)) store[index] = initial; return [store[index], (next) => { store[index] = typeof next === "function" ? next(store[index]) : next; }]; },
  useRef(value) { const index = cursor++; return state[index] || (state[index] = { current: value }); },
  useEffect(effect) { const index = cursor++; if (!(index in state)) { state[index] = true; effects.push(effect); } },
  useLayoutEffect() { cursor++; },
  useCallback(fn) { cursor++; return fn; },
  useMemo(fn) { cursor++; return fn(); },
  forwardRef(render) { return render; },
  createContext() { return { Provider() {}, Consumer() {} }; },
  useContext() { return {}; }, useId() { return "id"; }, memo(c) { return c; },
  Fragment: Symbol.for("react.fragment"), version: "18.3.1",
  Children: { map(children, fn) { return [].concat(children ?? []).filter((c) => c != null).map(fn); }, forEach() {}, count: () => 0, toArray: (c) => [].concat(c ?? []), only: (c) => c },
  isValidElement: (v) => !!v && typeof v === "object", cloneElement: (e) => e, createRef: () => ({ current: null }),
};

const SESSION = "session-12345678-1234-4123-8123-123456789abc";
const loadouts = [
  { id: "lo1", name: "研发", note: null, members: [{ root: "dsh", name: "alpha" }] },
  { id: "lo2", name: "写作", note: null, members: [] },
];
const TEN_SKILLS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"];
// 会话覆盖：null = 未选（回落 scope）、"" = 显式不加载、id = 选中。
let stored = "lo1";
const calls = [];

function view() {
  const selected = stored === null ? "lo1" : stored;
  const loadout = selected && selected !== "" ? loadouts.find((item) => item.id === selected) || null : null;
  return {
    sessionId: SESSION,
    scope: "user",
    loadoutId: stored,
    gatekeeper: true,
    effective: {
      source: stored === "" ? "none" : stored === null ? "scope" : "session",
      loadout,
      skills: loadout ? TEN_SKILLS : [],
    },
  };
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const path = String(url).replace("/api/vlln/dsh-loadout", "");
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : undefined;
  calls.push({ path, method, body, headers: options.headers });
  let data;
  if (path.startsWith("/session-loadout")) {
    if (method === "POST") {
      stored = body.loadoutId === undefined ? null : body.loadoutId;
      data = { sessionId: body.sessionId, loadoutId: stored, cleared: stored === null };
    } else data = view();
  } else if (path === "/loadouts") data = { scope: "user", loadouts, active: "lo1", gatekeeper: true };
  else if (path === "/sidebar-entry") data = { enabled: false };
  else if (path === "/online-update") data = { enabled: true, locked: false };
  else if (path === "/gatekeeper") data = { enabled: true };
  else data = { ok: true };
  return { ok: true, json: async () => ({ ok: true, data }) };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

const registrations = [];
const injections = new Map();
const layoutCalls = [];

try {
  new Function("window", await readFile(process.env.DSH_CLIENT_TEST_BUNDLE || new URL("../lib/client.js", import.meta.url), "utf8"))({ __ModuleLoader__: { load(value) { definition = value; } } });
  const client = definition.factory((id) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx: react.createElement, jsxs: react.createElement, Fragment: react.Fragment };
    if (id.startsWith("react-dom")) return { createPortal: (node) => node };
    if (id === "@deepseek-ai/dsh-client-ui-primitives") {
      return {
        Button: (props) => react.createElement("button", props, props.children),
        Tag: (props) => react.createElement("span", { "data-primitive": "tag", tone: props.tone, className: props.className }, props.children),
        Input: (props) => react.createElement("span", { className: props.className }, react.createElement("input", props)),
        Switch: (props) => react.createElement("span", { "data-switch": props.checked }, props.children),
        SegmentedTabs: (props) => react.createElement("div", { className: props.className }, props.items?.map((item) => react.createElement("button", { key: item.value }, item.label))),
        Modal: (props) => props.open ? react.createElement("div", { role: "dialog", title: props.title }, props.children, props.footer) : null,
        Menu: (props) => react.createElement("div", { "data-menu-open": props.open }, props.anchor, props.open ? props.items?.map((it) => react.createElement("button", { key: it.id, onClick: () => props.onSelect(it.id) }, it.label)) : null),
      };
    }
    throw new Error("unexpected require: " + id);
  });
  client.apply({
    effect() {},
    inject(deps, callback) {
      if (deps.includes("layout")) callback({ layout: { selectPanel: (id) => layoutCalls.push(id) } });
      else callback({});
    },
    slots: {
      inject(name, factory) { injections.set(name, factory); },
      register(options, component) { registrations.push({ options, component }); return () => {}; },
    },
  });

  // 宿主只在槽位被声明时才运行 inject 回调；这里手动触发一次。
  const chipInjection = injections.get("conversation.input.left");
  assert.equal(typeof chipInjection, "function", "composer 控件订阅了 conversation.input.left（权限旁边那排）");
  chipInjection();
  const chip = registrations.find((item) => item.options.name === "conversation.input.left");
  assert.ok(chip, "注册了 conversation.input.left");
  assert.equal(chip.options.id, "loadout", "list 槽位需要稳定的 id");
  assert.equal(chip.options.order, 20, "排在官方 queue(20) 同档、权限之后");
  assert.equal(chip.options.locale, "loadout", "沿用插件 locale 命名空间");
  assert.equal(typeof chip.options.inject, "function", "composer 控件靠 inject 拿会话 id");
  const injected = chip.options.inject(SESSION);
  assert.equal(injected.sessionId, SESSION, "inject 收到当前会话 id");

  const t = (key, params = {}) => (client.DICT.zh[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? "{" + name + "}"));
  let tree;
  function render() {
    cursor = 0;
    tree = chip.component({ t, ...injected });
  }
  function linkedNodes(value, out = []) {
    if (value == null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return out;
    if (Array.isArray(value)) { value.forEach((item) => linkedNodes(item, out)); return out; }
    out.push(value); return out;
  }
  function nodes(node = tree) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return [];
    if (typeof node.type === "function") return nodes(node.type({ ...node.props, children: node.children }));
    const nested = linkedNodes(node.children);
    return [node, ...nested.flatMap((child) => nodes(child))];
  }
  const find = (predicate) => nodes().find(predicate);
  const textOf = (node) => nodes(node).flatMap((item) => item.children.filter((child) => typeof child === "string")).join(" | ");
  const settle = async () => {
    render();
    effects.splice(0).forEach((effect) => effect());
    await tick(); await tick(); await tick();
    render();
  };

  // ── 收起态：与宿主权限 chip 同构的 trigger ────────────────────────────────
  await settle();
  const trigger = find((node) => node.props.className === "dssm-chip-trigger");
  assert.ok(trigger, "收起态是一个 chip 按钮");
  assert.equal(trigger.props["aria-label"], t("loadout.dock.label", { name: "研发" }), "按钮有本地化可访问名");
  assert.equal(textOf(trigger).includes("研发"), true, "有编组时直接显示编组名");
  assert.ok(nodes(trigger).some((node) => node.props.className === "dssm-chip-icon"), "带图标位（与权限 chip 一致）");
  assert.ok(nodes(trigger).some((node) => node.props.className === "dssm-chip-chevron"), "带下拉箭头");
  assert.ok(calls.some((call) => call.path.startsWith("/session-loadout?sessionId=") && call.method === "GET"), "按会话拉 GET /session-loadout");
  assert.equal(calls.find((call) => call.path.startsWith("/session-loadout")).headers["x-dsh-skills-session"], SESSION, "请求带会话头");

  // ── 展开：编组列表 + 不加载 + 管理 ────────────────────────────────────────
  trigger.props.onClick();
  render();
  const items = nodes().filter((node) => node.type === "button" && node.props.onClick && String(textOf(node)).length > 0);
  assert.ok(textOf(tree).includes("研发") && textOf(tree).includes("写作"), "列出两个编组");
  assert.ok(textOf(tree).includes(t("loadout.dock.noLoadout")), "列表含「不加载」");
  assert.ok(textOf(tree).includes(t("loadout.dock.manage")), "列表含「管理编组与技能」");

  // ── 切到「不加载」：POST { loadoutId: "" } ─────────────────────────────────
  const noneItem = items.find((node) => textOf(node).includes(t("loadout.dock.noLoadout")));
  noneItem.props.onClick();
  await settle();
  const postNone = calls.filter((call) => call.path === "/session-loadout" && call.method === "POST").at(-1);
  assert.ok(postNone, "切换编组发起 POST /session-loadout");
  assert.deepEqual(postNone.body, { sessionId: SESSION, loadoutId: "" }, "「不加载」写显式空串");
  assert.match(String(postNone.headers["x-dsh-loadout"]), /1/, "POST 带变更标记头");
  const noneTrigger = find((node) => node.props.className === "dssm-chip-trigger");
  assert.equal(textOf(noneTrigger).includes(t("loadout.dock.none")), true, "未加载时显示「未加载编组」");

  // ── 选回一个编组：POST 写入 id ─────────────────────────────────────────────
  find((node) => node.props.className === "dssm-chip-trigger").props.onClick();
  render();
  const back = nodes().find((node) => node.type === "button" && textOf(node) === "写作");
  back.props.onClick();
  await settle();
  const postBack = calls.filter((call) => call.path === "/session-loadout" && call.method === "POST").at(-1);
  assert.deepEqual(postBack.body, { sessionId: SESSION, loadoutId: "lo2" }, "选编组写入它的 id");

  // ── 「管理编组与技能」：就地弹模态框，不依赖侧栏 ───────────────────────────
  find((node) => node.props.className === "dssm-chip-trigger").props.onClick();
  render();
  const manage = nodes().find((node) => node.type === "button" && textOf(node).includes(t("loadout.dock.manage")));
  manage.props.onClick();
  await settle();
  const dialog = find((node) => node.props.role === "dialog" || node.props["data-modal"] === "dialog");
  assert.ok(dialog, "管理入口直接就地在会话里弹出管理面板");

  // 样式随控件自身渲染（composer 带不到面板里的 <style>）。
  const css = nodes().filter((node) => node.type === "style").map((node) => node.children.join("")).join("");
  assert.ok(css.includes(".dssm-chip-trigger"), "控件自带样式");
  assert.doesNotMatch(css, /#1677ff/i, "不写死颜色");

  console.log("session-loadout ui ok");
} finally {
  globalThis.fetch = originalFetch;
}
