// 通过实际组件事件验证作用域与筛选，不依赖实现源码的字符串形状。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let definition, component, cursor = 0;
let state = [];
const outerState = [], effects = [];
let innerState = [], mountedKey, currentSession = "session-a";
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children }, children: children.flat(Infinity).filter((child) => child != null && typeof child !== "boolean") }),
  useState(initial) { const index = cursor++, store = state; if (!(index in store)) store[index] = initial; return [store[index], (next) => { store[index] = typeof next === "function" ? next(store[index]) : next; }]; },
  useRef(value) { const index = cursor++; return state[index] || (state[index] = { current: value }); },
  useEffect(effect) { const index = cursor++; if (!(index in state)) { state[index] = true; effects.push(effect); } },
  // 此测试不挂载 DOM；焦点恢复另由焦点单测与真实浏览器验证。
  useLayoutEffect() { cursor++; },
  forwardRef(render) { return render; },
  createContext() { return { Provider() {}, Consumer() {} }; },
  useMemo(fn) { return fn(); },
  useCallback(fn) { return fn; },
  useContext() { return {}; },
  useId() { return "id"; },
  memo(component) { return component; },
  Fragment: Symbol.for("react.fragment"),
  version: "18.3.1",
  Children: { map(children, fn) { return [].concat(children ?? []).filter((child) => child != null).map(fn); }, forEach() {}, count: () => 0, toArray: (children) => [].concat(children ?? []), only: (child) => child },
  isValidElement: (value) => !!value && typeof value === "object",
  cloneElement: (element) => element,
  createRef: () => ({ current: null }),
  Component: class { constructor(props) { this.props = props; } },
  PureComponent: class { constructor(props) { this.props = props; } },
};
const skill = (name) => ({ name, description: "LONG_DESCRIPTION_" + name, enabled: true, loadable: true });
const data = {
  writeDestinations: [
    { key: "dsh", path: "C:/u/.dsh/skills", label: "DSH", available: true },
    { key: "agents", path: "C:/u/.agents/skills", label: "Shared", available: true },
  ],
  projects: [{ root: "/a", name: "A" }, { root: "/b", name: "B" }], trash: [],
  roots: [
    { key: "dsh", mutable: true, skills: [skill("global-one")] },
    { key: "copilot", exists: true, enabled: true, skills: [skill("global-two")] },
    { key: "a-dsh", scope: "project", kind: "project-dsh", projectRoot: "/a", localeKey: "projectDsh", mutable: true, skills: [] },
    { key: "a-copilot", scope: "project", kind: "project-copilot", projectRoot: "/a", localeKey: "copilot", exists: true, toggleable: true, skills: [skill("project-a")] },
    { key: "b-dsh", scope: "project", kind: "project-dsh", projectRoot: "/b", localeKey: "projectDsh", mutable: true, skills: [skill("project-b")] },
  ],
};
function sessionData(options) {
  const project = options?.headers?.["x-dsh-skills-session"] === "session-a" ? "/a" : options?.headers?.["x-dsh-skills-session"] === "session-b" ? "/b" : "";
  return { ...data, projects: data.projects.filter((p) => p.root === project), roots: data.roots.filter((root) => root.scope !== "project" || root.projectRoot === project) };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_, options) => ({ ok: true, json: async () => ({ data: sessionData(options) }) });
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
        Modal: (props) => props.open ? react.createElement("div", { role: "dialog", title: props.title, description: props.description, className: props.className, onClose: props.onClose }, props.description, props.children, props.footer) : null,
        Menu: (props) => react.createElement("div", { "data-menu-open": props.open }, props.anchor, props.open ? props.items?.map(it => react.createElement("button", { key: it.id, onClick: () => props.onSelect(it.id) }, it.label)) : null),
      };
    }
    throw new Error("unexpected require: " + id);
  });
  client.apply({ effect() {}, slots: { inject(name, fn) { fn(); }, register(options, fn) { component = fn; } } });
  const t = (key, params = {}) => (client.DICT.zh[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? "{" + name + "}"));
  let tree;
  // 0.2 起只认 retainedBy.mainView；旧 current 字段已不再参与会话识别，夹具不得再模拟它。
  let snapshotFor = (id) => id
    ? { ids: [id], byId: { [id]: { retainedBy: { mainView: 1 } } } }
    : { ids: [], byId: {} };
  function render() {
    state = outerState; cursor = 0;
    const view = component({ t, onClose() {}, entry: { mode: "library" }, useSessions: (selector) => selector(snapshotFor(currentSession)) });
    if (mountedKey !== view.props.key) { mountedKey = view.props.key; innerState = []; }
    state = innerState; cursor = 0; tree = view.type(view.props);
  }
  async function selectSession(id) {
    currentSession = id; render();
    assert.equal(nodes().some((node) => node.props.className === "dssm-source"), false, "切换会话立即隐藏旧项目，等待新状态");
    effects.splice(0).forEach((effect) => effect());
    await new Promise((resolve) => setImmediate(resolve)); render();
  }
  function linkedNodes(value, out = []) {
    if (value == null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return out;
    if (Array.isArray(value)) { value.forEach((item) => linkedNodes(item, out)); return out; }
    out.push(value);
    return out;
  }
  function nodes(node = tree) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return [];
    // 筛选业务测试只驱动受控值；官方菜单交互由专用测试与真实浏览器验证。
    if (typeof node.type === "function" && Array.isArray(node.props?.options) && node.props.label && node.props.onChange) return [{ type: "select-fixture", props: { "aria-label": node.props.label, options: node.props.options, onChange: (event) => node.props.onChange(event?.target ? event.target.value : event) }, children: [] }];
    if (node.type?.name === "SkillSwitch" || node.props?.closeLabel || (typeof node.type === "function" && node.props && "on" in node.props && typeof node.props.label === "string")) return nodes(node.type({ ...node.props, children: node.children }));
    // 目标选择器是普通函数组件：渲染出它的子树，才能断言其中的控件。
    if (typeof node.type === "function" && node.props && "userDestinations" in node.props) return nodes(node.type(node.props));
    const nested = linkedNodes(node.children);
    if (typeof node.type === "function") {
      linkedNodes(node.props?.header, nested);
      linkedNodes(node.props?.extra, nested);
      linkedNodes(node.props?.actions, nested);
      linkedNodes(node.props?.title, nested);
      linkedNodes(node.props?.description, nested);
      if (Array.isArray(node.props?.items)) node.props.items.forEach((item) => { linkedNodes(item?.label, nested); linkedNodes(item?.extra, nested); linkedNodes(item?.children, nested); });
    }
    return [node, ...nested.flatMap((child) => nodes(child))];
  }
  const find = (predicate) => nodes().find(predicate);
  const rows = () => nodes(nodes().find(n=>n.props["data-inventory-scope"] === "global") || tree).filter((node) => node.props.className === "dssm-name").map((node) => node.children[0]);
  const change = (label, value) => { find((node) => node.props["aria-label"] === label).props.onChange({ target: { value } }); render(); };
  const action = label => nodes().find(node => node.props.onClick && (node.children.includes(label) || node.props['aria-label'] === label));
  const selectNavigation = (name) => {
    const openLibrary = () => {
      const back = action(t('library.back'));
      if (back) back.props.onClick();
      else {
        const tabs = nodes().find(node => node.props.label === t('scope.label') && node.props.items?.some(item => item.value === 'library'));
        assert.ok(tabs, '主导航提供技能库入口');
        tabs.props.onChange('library');
      }
      render();
    };
    if (name === t('scope.user') || name === t('scope.project')) { openLibrary(); return; }
    if (name === t('library.install')) {
      openLibrary();
      action(t('library.add')).props.onClick(); render();
      action(t('library.git')).props.onClick(); render();
      return;
    }
    if (!action(name)) openLibrary();
    assert.ok(action(name), '必须找到导航操作：' + name);
    action(name).props.onClick(); render();
  };
  const openCreate = async () => {
    const add = action(t('library.add'));
    assert.ok(add && !add.props.disabled, '技能库可打开添加技能');
    add.props.onClick(); render();
    const create = action(t('library.create'));
    assert.ok(create && !create.props.disabled, '添加方式中可编写新技能');
    create.props.onClick(); await new Promise(resolve => setImmediate(resolve)); render();
  };

  const tab = (name) => selectNavigation(name);
  render(); effects.splice(0).forEach((effect) => effect());
  await new Promise((resolve) => setImmediate(resolve)); render();
  const groups = () => nodes(nodes().find(n=>n.props["data-inventory-scope"] === "global")).filter((node) => node.props.className === "dssm-source");
  const expandAll = () => { groups().forEach((node) => { const toggle = nodes(node).find((child) => child.props.className === "dssm-source-toggle"); if (toggle?.props["aria-expanded"] !== true) toggle.props.onClick(); }); render(); };
  assert.deepEqual(rows(), [], "来源默认折叠，不平铺所有技能");
  assert.equal(groups().length, 2, "全局按来源分组");
  assert.ok(nodes(groups()[0]).some((node) => node.children.includes("1 个技能")), "来源数量使用翻译文案");
  expandAll();
  assert.deepEqual(rows(), ["global-one", "global-two"]);
  // Inventory refresh keeps expanded content, immediately announces scanning, and counts globals.
  const scanFetch=globalThis.fetch;let resolveScan,scanRequests=0;
  globalThis.fetch=async(url,options)=>{if(String(url).endsWith('/state')){scanRequests++;return new Promise(resolve=>{resolveScan=resolve;});}return scanFetch(url,options);};
  const scanControl=()=>action(t('btn.refresh'));
  const firstScan=scanControl();assert.ok(firstScan);firstScan.props.onClick();firstScan.props.onClick();render();
  assert.equal(scanRequests,1,'刷新进行中防止重复扫描');assert.equal(scanControl().props.disabled,true);
  assert.ok(nodes().some(n=>n.props.role==='status'&&n.children.includes(t('library.scanning'))),'刷新立即显示扫描状态');
  assert.deepEqual(rows(),['global-one','global-two'],'扫描时保留已展开库存，不闪烁替换列表');
  resolveScan({ok:true,json:async()=>({data:sessionData({headers:{'x-dsh-skills-session':'session-a'}})})});await new Promise(resolve=>setImmediate(resolve));render();
  assert.ok(nodes().some(n=>n.props.role==='status'&&n.children.includes(t('library.scanned',{count:2}))),'扫描完成数量只统计全局技能');assert.equal(scanControl().props.disabled,false);
  globalThis.fetch=scanFetch;
  const states = nodes(nodes().find(n=>n.props["data-inventory-scope"] === "global")).filter((node) => node.props.className === "dssm-row-state");
  assert.equal(states.length, 2, "每条技能都有独立状态操作组");
  assert.equal(nodes(states[0]).some((node) => String(node.props.label || "").includes(t("skill.toggle"))), false, "库存无技能启停开关");
  const skillActions = nodes(nodes().find(n=>n.props["data-inventory-scope"] === "global")).filter((node) => node.props.className === "dssm-skill-actions");
  assert.equal(skillActions.length, 2, "每条技能的操作在同一组");
  assert.ok(skillActions.every((node) => node.children.at(-1)?.props?.className === "dssm-row-state"), "技能开关在行的最右边");
  assert.equal(nodes().some((node) => node.props.className === "dssm-status dssm-enabled"), true, "会话可用状态以只读图标显示");
  const more = find((node) => node.props["aria-label"] === t("btn.more"));
  assert.ok(more.props.options.some((option) => option.value === "detail"), "查看详情放进更多");
  assert.equal(more.props.options.some(option => option.value === "trash"), false, "技能更多菜单不再暴露回收");
  assert.equal(nodes().some((node) => node.props["aria-label"] === t("btn.detail") && node.props.icon), false, "技能行不再单独放详情图标");
  assert.equal(nodes().some((node) => node.props["aria-label"] === t("btn.trash") && node.props.icon), false, "技能行不再单独放删除图标");
  more.props.onChange({ target: { value: "detail" } }); render();
  const detailDialog = find((node) => node.props.title === t("detail.title"));
  assert.ok(detailDialog, "详情菜单打开技能详情弹窗");
  assert.ok(detailDialog.props.className && detailDialog.props.className.includes("dssm-modal-wide"), "技能详情弹窗必须赋予 dssm-modal-wide 类名");
  detailDialog.props.onClose(); render();
  assert.ok(JSON.stringify(nodes()).includes("LONG_DESCRIPTION_global-one"), "展开来源后显示技能简介");
  nodes(groups()[0]).find((node) => node.props.className === "dssm-source-toggle").props.onClick(); render();
  assert.deepEqual(rows(), ["global-two"], "来源可独立折叠");
  change(t("search"), "two");
  assert.deepEqual(rows(), ["global-two"]);
  let toggleRequest;
  assert.equal(find(node => node.props['aria-label'] === t('filter.workspace')), undefined);
  assert.equal(nodes().some(node => node.props['data-inventory-scope'] === 'project'), false);
  assert.equal(find(node => node.props['aria-label'] === t('trash.title') || node.props['aria-label'] === t('btn.create')), undefined);
  const globalFilter = find(node => node.props['aria-label'] === t('search'));
  assert.ok(globalFilter);
  await selectSession('session-b'); expandAll();
  assert.equal(rows().some(name => name.startsWith('project-')), false, 'composer session changes do not expose project inventory');
  await selectSession(undefined); expandAll();
  assert.ok(rows().length > 0, 'global inventory remains usable without a session');
  console.log('全局筛选与会话重挂载边界通过');

  outerState.length = 0;
  innerState = [];
  mountedKey = undefined;
  currentSession = "session-a";
  globalThis.fetch = async (_, options) => ({ ok: true, json: async () => ({ data: sessionData(options) }) });
  render(); effects.splice(0).forEach((effect) => effect());
  await new Promise((resolve) => setImmediate(resolve)); render();
  // 项目页不再依赖会话是否被主视图保留：全局页在 alpha.2 的会话形态下照常工作。
  assert.deepEqual(rows(), [], "alpha.2 会话形态下全局来源默认折叠");
  expandAll();
  assert.ok(rows().length > 0, "alpha.2 会话形态下全局技能照常展示");
  await selectSession("session-b");
  expandAll();
  assert.ok(rows().length > 0, "alpha.2 切换主视图会话后全局页仍可用");
  await selectSession(undefined);
  assert.ok(find((node) => node.props.className === "dssm-source"), "alpha.2 没有会话时全局页仍可用");
  console.log("alpha.2 retainedBy.mainView 会话形态通过");

  // 自定义目录：空/失效来源仍保留，来源行可打开改目录弹窗并用系统选择器回填。
  data.roots.push(
    {
      key: "codex", path: "D:/skills/codex", defaultPath: "C:/u/.codex/skills",
      overridden: true, exists: false, enabled: true, skills: [],
    },
    {
      key: "claude", path: "C:/u/.claude/skills",
      overridden: false, exists: false, enabled: true, skills: [],
    },
    {
      key: "custom:xhs", path: "C:/u/Downloads", label: "XHS",
      overridden: false, exists: true, enabled: true, skills: [], custom: true,
    },
  );
  outerState.length = 0;
  innerState = [];
  mountedKey = undefined;
  currentSession = "session-a";
  let pickedPath = "E:/picked/codex";
  let browseRequests = 0;
  let removeRequest;
  globalThis.__DSH_DIRECTORY_PICKER__ = { pick: async () => pickedPath };
  globalThis.fetch = async (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : {};
    if (options?.method === "POST" && String(url).endsWith("/browse")) browseRequests++;
    if (options?.method === "POST" && String(url).endsWith("/root-path")) toggleRequest = { url, body };
    if (options?.method === "POST" && String(url).endsWith("/custom-source-remove")) {
      removeRequest = { url, body };
      data.roots = data.roots.filter((r) => r.key !== body.id);
      return { ok: true, json: async () => ({ ok: true, data: { removed: body.id } }) };
    }
    return { ok: true, json: async () => ({ data: sessionData(options) }) };
  };
  render(); effects.splice(0).forEach((effect) => effect());
  await new Promise((resolve) => setImmediate(resolve)); render();
  const customGroup = groups().find((node) => node.props["data-source-key"] === "codex");
  assert.ok(customGroup, "自定义目录即使不存在也保留来源行");
  assert.ok(JSON.stringify(nodes(customGroup)).includes(t("rootPath.custom")), "来源行显示自定义标记");
  assert.equal(groups().some((node) => node.props["data-source-key"] === "claude"), false, "默认缺失且无技能的外部来源在列表中隐藏");

  // 顶栏提供来源目录管理按钮，供首次配置尚未在列表中出现的外部来源
  const manageBtn = find((node) => node.props["aria-label"] === t("rootPath.manage"));
  assert.ok(manageBtn, "顶栏提供来源目录配置入口");

  const editPath = nodes(customGroup).find((node) => String(node.props["aria-label"] || "").startsWith(t("rootPath.edit")));
  assert.ok(editPath, "外部来源提供改目录按钮");
  editPath.props.onClick(); render();
  assert.ok(find((node) => node.props.title === t("rootPath.title", { name: t("root.codex") })), "改目录弹窗打开");
  assert.equal(find((node) => node.props.placeholder === t("rootPath.placeholder")).props.value, "D:/skills/codex", "弹窗预填当前生效目录，避免未修改直接保存误恢复默认");
  assert.ok(nodes().some((node) => node.children.includes(t("rootPath.reset"))), "已自定义时提供恢复默认");

  // 不修改直接点击保存，提交的是当前自定义路径，而不是被清空为默认值
  nodes().filter((node) => node.children.includes(t("rootPath.save"))).at(-1).props.onClick();
  await new Promise((resolve) => setImmediate(resolve)); render();
  assert.deepEqual(toggleRequest.body, { key: "codex", path: "D:/skills/codex" }, "未修改直接保存提交当前自定义路径");

  // 重新打开弹窗，测试来源切换下拉
  manageBtn.props.onClick(); render();
  assert.ok(find((node) => node.props["aria-label"] === t("rootPath.source")), "弹窗提供来源选择器");
  const sourceSelect = find((node) => node.props["aria-label"] === t("rootPath.source"));
  sourceSelect.props.onChange("claude"); render();
  assert.equal(find((node) => node.props.placeholder === t("rootPath.placeholder")).props.value, "C:/u/.claude/skills", "切换来源后预填该来源当前路径");

  // 切换回 codex 并测试浏览回填
  sourceSelect.props.onChange("codex"); render();
  find((node) => node.children.includes(t("rootPath.browse"))).props.onClick();
  await new Promise((resolve) => setImmediate(resolve)); render();
  assert.equal(find((node) => node.props.placeholder === t("rootPath.placeholder")).props.value, "E:/picked/codex", "浏览使用系统目录选择器回填路径");
  assert.equal(browseRequests, 0, "浏览不再请求插件内的目录接口");
  pickedPath = null;
  find((node) => node.children.includes(t("rootPath.browse"))).props.onClick();
  await new Promise((resolve) => setImmediate(resolve)); render();
  assert.equal(find((node) => node.props.placeholder === t("rootPath.placeholder")).props.value, "E:/picked/codex", "取消系统选择不改变路径");
  pickedPath = "F:/another/codex";
  find((node) => node.children.includes(t("rootPath.browse"))).props.onClick();
  await new Promise((resolve) => setImmediate(resolve)); render();
  nodes().filter((node) => node.children.includes(t("rootPath.save"))).at(-1).props.onClick();
  await new Promise((resolve) => setImmediate(resolve)); render();
  assert.ok(toggleRequest && toggleRequest.url.endsWith("/root-path"), "保存提交 root-path");
  assert.deepEqual(toggleRequest.body, { key: "codex", path: "F:/another/codex" }, "保存提交系统选择器返回的路径");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  render();

  // 重新打开弹窗测试自定义来源表单顺序与移除登记保留弹窗
  const currentManageBtn = find((node) => node.props["aria-label"] === t("rootPath.manage"));
  currentManageBtn.props.onClick(); render();
  assert.ok(find((node) => node.props["aria-label"] === t("rootPath.source")), "重新打开改目录弹窗");

  // 表单顺序：先显示名，后技能目录
  find((node) => node.children?.includes(t("customSource.add"))).props.onClick(); render();
  const formInputs = nodes().filter((node) =>
    node.props?.placeholder === t("customSource.label.placeholder") || node.props?.placeholder === t("customSource.path.placeholder")
  );
  assert.equal(formInputs.length, 2, "展开自定义来源表单包含名称与路径输入框");
  assert.equal(formInputs[0].props.placeholder, t("customSource.label.placeholder"), "第一个输入框是显示名");
  assert.equal(formInputs[1].props.placeholder, t("customSource.path.placeholder"), "第二个输入框是技能目录");

  // 切换至 custom:xhs 并移除登记：弹窗不关闭，切到剩余来源
  const currentSelect = find((node) => node.props["aria-label"] === t("rootPath.source"));
  currentSelect.props.onChange("custom:xhs"); render();
  assert.equal(find((node) => node.props.placeholder === t("rootPath.placeholder")).props.value, "C:/u/Downloads", "切到自定义来源预填其路径");
  const removeBtn = nodes().find((node) => node.children.includes(t("customSource.remove")));
  assert.ok(removeBtn, "自定义来源提供移除登记按钮");
  removeBtn.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 20));
  render();
  assert.ok(removeRequest && removeRequest.body.id === "custom:xhs", "发起移除自定义来源请求");
  assert.ok(find((node) => node.props["aria-label"] === t("rootPath.source")), "移除登记后不关闭弹窗");
  assert.equal(find(node => node.props['aria-label'] === t('rootPath.source')).props.options.some(option => option.value === 'custom:xhs'), false, "移除后弹窗只提供剩余有效来源");

  console.log("自定义技能目录弹窗通过");
} finally {
  delete globalThis.__DSH_DIRECTORY_PICKER__;
  globalThis.fetch = originalFetch;
}
