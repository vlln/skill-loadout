// 项目页顶部选择已登记工作区：只读取所选项，来源与技能复用全局绘制及显式工作区操作。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const projectCss = await readFile(new URL("../src/client.ts", import.meta.url), "utf8");
function assertSourceCleanup() {
  assert.doesNotMatch(projectCss, /dssm-workspace|renderWorkspace|project\.searchHint/, "删除旧工作区折叠渲染、CSS和展开搜索提示");
  assert.doesNotMatch(projectCss, /\.dssm-filters \.dssm-search\{[^}]*margin-left:auto/, "搜索框紧跟筛选，不被推到工具栏最右侧");
  assert.match(projectCss, /\.dssm-filter-actions\{[^}]*margin-left:auto/, "搜索旁按钮组对齐到工具栏最右侧");
  assert.match(projectCss, /\.dssm-filter-actions\{[^}]*display:flex[^}]*gap:8px;flex:none/, "搜索右侧图标按钮组间距稳定");
  assert.match(projectCss, /\.dssm-source\{[^}]*background:transparent/, "来源卡片背景透出页面底色");
  assert.match(projectCss, /\.dssm-source-title\{[^}]*white-space:nowrap[^}]*flex:none/, "来源标题不因长路径折行");
  assert.doesNotMatch(projectCss, /\.dssm-source-title\{[^}]*overflow-wrap:anywhere/, "来源标题不再任意折行");
  assert.match(projectCss, /\.dssm-count\{[^}]*white-space:nowrap[^}]*flex:none/, "技能数量不因长路径折行");
  assert.match(projectCss, /\.dssm-source-path\{[^}]*min-width:0[^}]*max-width:50%[^}]*text-overflow:ellipsis/, "全局和项目来源路径不超过右半边并省略");
  assert.doesNotMatch(projectCss, /\.dssm-source-path\{max-width:320px\}/, "窄容器不再把路径放宽到 320px");
  assert.match(projectCss, /\.dssm-source-toggle\{[^}]*overflow:hidden/, "来源头裁切溢出的路径，避免盖住加号");
}

let definition, component, cursor = 0, state = [];
const effects = [], outerState = [];
let innerState = [], mountedKey;
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((child) => child != null && typeof child !== "boolean") }),
  useState(initial) { const index = cursor++, store = state; if (!(index in store)) store[index] = initial; return [store[index], (next) => { store[index] = typeof next === "function" ? next(store[index]) : next; }]; },
  useRef(value) { const index = cursor++; return state[index] || (state[index] = { current: value }); },
  useEffect(effect) { const index = cursor++; if (!(index in state)) { state[index] = true; effects.push(effect); } },
  useLayoutEffect() { cursor++; },
  forwardRef(render) { return render; },
  createContext() { return { Provider() {}, Consumer() {} }; },
  useMemo(fn) { return fn(); }, useCallback(fn) { return fn; }, useContext() { return {}; }, useId() { return "id"; }, memo(c) { return c; },
  Fragment: Symbol.for("react.fragment"), version: "18.3.1",
  Children: { map(children, fn) { return [].concat(children ?? []).filter((c) => c != null).map(fn); }, forEach() {}, count: () => 0, toArray: (c) => [].concat(c ?? []), only: (c) => c },
  isValidElement: (v) => !!v && typeof v === "object", cloneElement: (e) => e, createRef: () => ({ current: null }),
  Component: class { constructor(props) { this.props = props; } }, PureComponent: class { constructor(props) { this.props = props; } },
};

const skill = (name) => ({ name, description: "DESC_" + name, enabled: true, loadable: true });
const globalData = { projects: [], trash: [], roots: [{ key: "dsh", mutable: true, path: "C:/u/.dsh/skills", skills: [skill("global-one")] }] };
const workspaces = [
  { name: "alpha", path: "D:/work/alpha", projectRoot: "D:/work/alpha", registeredPaths: ["D:/work/alpha/packages/web", "D:/work/alpha"], available: true, skillCount: 2 },
  { name: "beta", path: "D:/work/beta", projectRoot: "D:/work/beta", registeredPaths: ["D:/work/beta"], available: true, skillCount: 0 },
  { name: "ghost", path: "D:/work/ghost", registeredPaths: ["D:/work/ghost"], available: false, skillCount: 0 },
];
const details = {
  "D:/work/alpha": { project: { root: "D:/work/alpha", name: "alpha" }, warnings: [], roots: [
    { key: "project-dsh:a", scope: "project", kind: "project-dsh", localeKey: "projectDsh", label: "Project DSH", mutable: true, path: "D:/work/alpha/.dsh/skills", projectRoot: "D:/work/alpha", skills: [skill("alpha-one")] },
    { key: "project-claude:a", scope: "project", kind: "project-claude", localeKey: "claude", label: "Claude", exists: true, toggleable: true, enabled: true, path: "D:/work/alpha/.claude/skills", projectRoot: "D:/work/alpha", skills: [skill("alpha-two")] },
  ] },
  "D:/work/beta": { project: { root: "D:/work/beta", name: "beta" }, warnings: [], roots: [
    { key: "project-dsh:b", scope: "project", kind: "project-dsh", localeKey: "projectDsh", label: "Project DSH", mutable: true, path: "D:/work/beta/.dsh/skills", projectRoot: "D:/work/beta", skills: [] },
  ] },
};
const calls = [];
let holdDetails = false, holdLists = false;
const detailResponses = [], listResponses = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : undefined;
  calls.push({ url: String(url), method: options.method || "GET", body, headers: options.headers });
  const path = String(url).replace("/api/vlln/dsh-loadout", "");
  let data;
  if (path === "/state") data = globalData;
  else if (path === "/workspaces") {
    if (holdLists) return new Promise(resolve => listResponses.push({ resolve }));
    data = { items: workspaces.slice() };
  }
  else if (path === "/workspace-skills") {
    if (holdDetails) return new Promise(resolve => detailResponses.push({ workspace: body.workspace, resolve }));
    if (body.workspace === "D:/work/ghost") return { ok: false, status: 400, json: async () => ({ ok: false, code: "error.workspace.unavailable", error: "工作区目录不可用", params: { path: body.workspace } }) };
    if (!["D:/work/alpha/packages/web", "D:/work/alpha", "D:/work/beta"].includes(body.workspace)) return { ok: false, status: 400, json: async () => ({ ok: false, code: "error.workspace.unregistered", error: "请选择已登记的工作区" }) };
    data = details[body.workspace === "D:/work/alpha/packages/web" ? "D:/work/alpha" : body.workspace];
  } else data = { name: "ok" };
  return { ok: true, json: async () => ({ ok: true, data }) };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

try {
  new Function("window", await readFile(process.env.DSH_CLIENT_TEST_BUNDLE || new URL("../lib/client.js", import.meta.url), "utf8"))({ __ModuleLoader__: { load(value) { definition = value; } } });
  const client = definition.factory((id) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx: react.createElement, jsxs: react.createElement, Fragment: react.Fragment };
    if (id.startsWith("react-dom")) return { createPortal: (node) => node };
    if (id === "@deepseek-ai/dsh-client-ui-primitives") {
      return {
        Button: (props) => react.createElement("button", props, props.children),
        Input: (props) => react.createElement("span", { className: props.className }, react.createElement("input", props)),
        Modal: (props) => props.open ? react.createElement("div", { role: "dialog", title: props.title }, props.children, props.footer) : null,
        Menu: (props) => react.createElement("div", { "data-menu-open": props.open }, props.anchor, props.open ? props.items?.map(it => react.createElement("button", { key: it.id, onClick: () => props.onSelect(it.id) }, it.label)) : null),
      };
    }
    throw new Error("unexpected require: " + id);
  });
  client.apply({ effect() {}, slots: { inject(name, fn) { fn(); }, register(options, fn) { component = fn; } } });
  const t = (key, params = {}) => (client.DICT.zh[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? "{" + name + "}"));
  let tree, currentSession = undefined;
  function render() {
    state = outerState; cursor = 0;
    const view = component({ t, entry: { mode: "library" }, useSessions: (selector) => selector({ current: currentSession }) });
    if (mountedKey !== view.props.key) { mountedKey = view.props.key; innerState = []; }
    state = innerState; cursor = 0; tree = view.type(view.props);
  }
  function linkedNodes(value, out = []) {
    if (value == null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return out;
    if (Array.isArray(value)) { value.forEach((item) => linkedNodes(item, out)); return out; }
    out.push(value); return out;
  }
  function nodes(node = tree) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return [];
    if (typeof node.type === "function" && Array.isArray(node.props?.options) && node.props.label && node.props.onChange) return [{ type: "select-fixture", props: { "aria-label": node.props.label, value: node.props.value, disabled: node.props.disabled, options: node.props.options, onChange: (event) => node.props.onChange(event.target.value) }, children: [] }];
    if (node.type?.name === "SkillSwitch" || node.props?.closeLabel || (typeof node.type === "function" && node.props && "on" in node.props && typeof node.props.label === "string")) return nodes(node.type({ ...node.props, children: node.children }));
    // 目标选择器是普通函数组件：渲染出它的子树，才能断言其中的控件。
    if (typeof node.type === "function" && node.props && "userDestinations" in node.props) return nodes(node.type(node.props));
    const nested = linkedNodes(node.children);
    if (typeof node.type === "function") {
      for (const key of ["header", "extra", "actions", "title", "description"]) linkedNodes(node.props?.[key], nested);
      if (Array.isArray(node.props?.items)) node.props.items.forEach((item) => { linkedNodes(item?.label, nested); linkedNodes(item?.extra, nested); linkedNodes(item?.children, nested); });
    }
    return [node, ...nested.flatMap((child) => nodes(child))];
  }
  const find = (predicate) => nodes().find(predicate);
  const rows = () => nodes(nodes().find(n=>n.props["data-inventory-scope"] === "project") || tree).filter((node) => node.props.className === "dssm-name").map((node) => node.children[0]);
  const settle = async () => { render(); effects.splice(0).forEach((effect) => effect()); await tick(); await tick(); render(); };
  // This GUI is deliberately global-only; backend project APIs remain covered separately.
  await settle();
  const expandAll = () => { nodes().filter(n => n.props.className === 'dssm-source-toggle' && n.props['aria-expanded'] === false).forEach(n => n.props.onClick()); render(); };
  expandAll();
  assert.deepEqual(rows(), ['global-one']);
  for (const label of ['filter.workspace','btn.create','trash.title']) assert.equal(find(n => n.props['aria-label'] === t(label)), undefined, label + ' is not exposed in global inventory');
  assert.equal(nodes().some(n => n.props['data-inventory-scope'] === 'project'), false);
  assert.equal(nodes().some(n => ['h3','h4'].includes(n.type) && [t('scope.user'),t('scope.project')].includes(n.children.join(''))), false, 'no redundant scope headings');
  assert.equal(calls.some(call => call.url.endsWith('/workspace-skills')), false, 'global inventory never scans registered project contents');
  const search = () => find(n => n.props['aria-label'] === t('search'));
  search().props.onChange({target:{value:'missing'}}); await settle(); assert.deepEqual(rows(), []);
  search().props.onChange({target:{value:'global'}}); await settle(); assert.deepEqual(rows(), ['global-one']);
  const before = calls.filter(call => call.url.endsWith('/state')).length;
  globalData.roots[0].skills.push(skill('global-two'));
  find(n => n.props['aria-label'] === t('btn.refresh')).props.onClick(); await settle();
  assert.equal(calls.filter(call => call.url.endsWith('/state')).length, before + 1);
  assert.deepEqual(rows(), ['global-one','global-two']);
  // An open chat is not authority to switch the settings library to project scope.
  currentSession = 'another-session'; await settle();
  assert.deepEqual(rows(), ['global-one','global-two']);
  assert.equal(calls.some(call => call.url.endsWith('/workspace-skills')), false);
  const add = find(n => n.props.onClick && n.children.includes(t('library.add'))); assert.ok(add);
  add.props.onClick(); render();
  const addSource = find(n => n.props['aria-label'] === t('filter.source') && n.props.options?.some(option => option.value === 'git'));
  assert.deepEqual(addSource.props.options.map(option => option.value), ['git','local']);
  assert.equal(find(n => n.props.onClick && n.children.includes(t('library.create'))), undefined, 'new-skill creation is not in Add');
  assert.equal(calls.some(call => /\/(?:create|trash-restore|trash-delete|workspace-skills)$/.test(call.url)), false);
  console.log('全局技能库边界、搜索刷新与项目隔离回归通过');
} finally { globalThis.fetch = originalFetch; }
