// 验证真实 hooks/事件的筛选、折叠、安装位置选择、回收站卸载和更新行为。
import assert from "node:assert/strict";
import { mock } from "node:test";
// 文件内所有 setTimeout 均受控（含未来请求超时，需显式 tick），setImmediate 保持真实以驱动异步渲染。
mock.timers.enable({ apis: ["setTimeout"] });
import { readFile } from "node:fs/promises";
import { createRepositoryUI, repositoryLocales } from "../src/repository-ui.ts";
import { createDestinationKit, destinationLocales } from "../src/destination-picker.ts";
let values = [], cursor = 0, effects = [], dependencies = [], cleanups = [];
let active = true;
function flushEffects() { effects.splice(0).forEach(({ i, fn }) => { cleanups[i]?.(); cleanups[i] = fn(); }); }
function unmount() { effects = []; cleanups.forEach(cleanup => cleanup?.()); cleanups = []; }
function resetMount() { unmount(); values = []; cursor = 0; dependencies = []; active = true; }
const react = {
  createElement(type, props, ...children) {
    if (props?.className === "dssm-catalog-sentinel" && props.ref) props.ref.current = {};
    return { type, props: props || {}, children: children.flat(Infinity).filter((v) => v != null && typeof v !== "boolean") };
  },
  useState(initial) { const i = cursor++; if (!(i in values)) values[i] = initial; return [values[i], (v) => { values[i] = typeof v === "function" ? v(values[i]) : v; }]; },
  useRef(initial) { const i = cursor++; return values[i] || (values[i] = { current: initial }); },
  useEffect(fn, deps) { const i = cursor++; if (!dependencies[i] || deps.some((v, n) => dependencies[i][n] !== v)) { effects.push({ i, fn }); dependencies[i] = deps; } },
};
const repos = [{ id: "one", owner: "example", name: "skills", skills: [
  { path: "skills/pdf", name: "pdf", description: "PDF 文档", status: "available", installedRoot: null, canUninstall: false },
  { path: "skills/docx", name: "docx", description: "Word 文档", status: "conflict", installedRoot: null, canUninstall: false },
] }];
// 故意使用非默认、包含空格的配置路径，防止界面重新硬编码用户目录。
const configuredRoots = [
  { key: "dsh", path: "/configured/DSH Home/skills", label: "Backend DSH", available: true },
  { key: "agents", path: "/configured/shared agent/skills", label: "Backend Shared", available: true },
  { key: "codex", path: "/configured/codex-user/skills", label: "Backend Codex", available: true },
  { key: "claude", path: "/configured/claude-user/skills", label: "Backend Claude", available: true },
  { key: "gemini", path: "/configured/unsafe-gemini/skills", label: "Gemini configured", available: false, error: { code: "error.repo.invalid", error: "Unsafe configured Gemini path" } },
  { key: "windsurf", path: "/configured/windsurf-user/skills", label: "Backend Windsurf", localeKey: "windsurf-user", available: true },
];
let installRoots = structuredClone(configuredRoots);
const calls = [];
const catalogCalls = [];
const catalogSearchCalls = [];
let failCatalogRanking = false;
const skillshCalls = [];
const skillshResults = [{ id: "owner/skills/react-skill", source: "owner/skills", skillId: "react-skill", name: "React Skill", installs: 123456 }];
const catalogFetch = async (input) => {
  const url = new URL(input);
  if (url.pathname === "/clawhub/search") {
    catalogSearchCalls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ results: [
        { source: "clawhub", id: "clawhub:gill-helper", slug: "gill-helper", displayName: "Gill Helper", ownerHandle: "owner-gill", summary: "A real keyword result", downloads: 21 },
        { source: "skills-sh", id: "skills-sh:gill-guide", slug: "gill-guide", displayName: "Unrelated federated result", ownerHandle: "owner-other", summary: "Not part of ClawHub", downloads: 9000 },
      ] }),
    };
  }
  catalogCalls.push(url);
  if (failCatalogRanking) throw new Error("模拟榜单首次请求失败");
  const offset = Number(url.searchParams.get("cursor") || 0);
  const items = Array.from({ length: 10 }, (_value, index) => {
    const rank = offset + index + 1;
    return {
      ownerHandle: "owner-" + rank,
      slug: "skill-" + String(rank).padStart(3, "0"),
      displayName: "Skill " + String(rank).padStart(3, "0"),
      summary: "Live ClawHub summary " + rank,
      stats: { downloads: 1000 - rank, installs: rank, stars: rank },
    };
  });
  return {
    ok: true,
    status: 200,
    json: async () => ({ items, nextCursor: offset + 10 < 100 ? String(offset + 10) : null }),
  };
};
globalThis.fetch = async () => { throw new Error("目录客户端不得直连外部网络"); };
let workspaceRows = [];
let finishInstall, finishUninstall;
let failInstall = false, failUninstall = false, failAdd = false;
let finishRefresh, finishDetail;
let holdRefresh = false, failRefresh = false;
let installedCalls = 0, failInstalledRefresh = false, failRepositoryList = false;
let mockCatalogInstalls = ["clawhub:owner-2/skill-002"];
let mockCatalogCopies = [
  { id: "clawhub:owner-2/skill-002", name: "Skill 002", installedRoot: "dsh", installedWorkspace: "D:/work/beta", canUninstall: true },
  { id: "clawhub:owner-2/skill-002", name: "Skill 002", installedRoot: "dsh", canUninstall: true },
];
let mockCatalogUnknownIds = [], mockCatalogWarnings = [];
let holdCatalogPath = "", pendingCatalog = [];
const api = async (path, options) => {
  if (holdCatalogPath && path.startsWith(holdCatalogPath)) return new Promise(resolve => pendingCatalog.push({ path, signal: options?.signal, resolve }));
  const body = options?.body ? JSON.parse(options.body) : undefined;
  calls.push({ path, body });
  if (path === "/repositories" && failRepositoryList) throw new Error("目录列表刷新失败");
  if (path.startsWith("/clawhub/")) return (await catalogFetch("http://localhost" + path)).json();
  if (path.startsWith("/skills-sh/search")) {
    const url = new URL(path, "http://localhost");
    skillshCalls.push(url);
    return { skills: url.searchParams.get("q") === "react" ? structuredClone(skillshResults) : [] };
  }
  if (path === "/workspaces") return { items: structuredClone(workspaceRows) };
  if (path === "/catalog/detail") return { name: body.name, description: "目录技能说明", body: "# " + body.name, origin: body.catalog === "skillsh" ? body.source + "/" + body.skillId : body.owner + "/" + body.slug };
  if (path === "/catalog/install") {
    const catalogId = body.catalog === "skillsh" ? `skillsh:${body.source}/${body.skillId}` : `clawhub:${body.owner}/${body.slug}`;
        if (!mockCatalogInstalls.includes(catalogId)) mockCatalogInstalls.push(catalogId);
    const installedRoot = body.root || "dsh";
    const installedName = body.catalog === "clawhub" ? body.slug : body.skillId;
    if (!mockCatalogCopies.some(copy => copy.id === catalogId && copy.installedRoot === installedRoot && copy.installedWorkspace === body.workspace)) mockCatalogCopies.push({ id: catalogId, name: installedName, installedRoot, ...(body.workspace ? { installedWorkspace: body.workspace } : {}), canUninstall: true });
    return { name: installedName, root: installedRoot };
  }
  if (path.endsWith("/install")) {
    await new Promise((resolve) => { finishInstall = resolve; });
    if (failInstall) throw new Error("下载超时，请重试");
    Object.assign(repos[0].skills[0], { status: "installed", tracked: true, installedRoot: body.root, canUninstall: true });
  }
  if (path.endsWith("/uninstall")) {
    await new Promise((resolve) => { finishUninstall = resolve; });
    if (failUninstall) throw new Error("回收站写入失败");
    Object.assign(repos[0].skills[0], { status: "available", tracked: false, installedRoot: null, canUninstall: false, updateAvailable: false, canRollback: false });
  }
  if (path.endsWith("/add")) { if (failAdd) throw new Error("add rejected"); return { id: "two" }; }
  if (path.endsWith("/refresh")) { if (holdRefresh) await new Promise(resolve => { finishRefresh = resolve; }); if (failRefresh) throw new Error("仓库网络失败"); return { error: null }; }
  if (path.endsWith("/detail")) { await new Promise(resolve => { finishDetail = resolve; }); return { name: "pdf", body: "说明", commit: "abc", path: "skills/pdf" }; }
  if (path.endsWith("/preview")) return { token: "checked", commit: "a".repeat(40), localModified: true, changes: [{ kind: "modified", path: "SKILL.md" }] };
  if (path.endsWith("/update") || path.endsWith("/rollback")) repos[0].skills[0].status = "installed";
  // 每次返回独立快照，安装/卸载必须真正 reload 才能改变 UI。
  return structuredClone({ repositories: repos, installRoots, catalogInstalls: mockCatalogInstalls, catalogCopies: mockCatalogCopies, catalogUnknownIds: mockCatalogUnknownIds, catalogWarnings: mockCatalogWarnings });
};
const Input = Object.assign(() => {}, { TextArea: Symbol("官方只读说明框") });
const Button = Symbol("官方按钮");
const isAction = (node, key) => (node.type === "button" || node.type === Button) && (node.children.includes(key) || node.props["aria-label"] === key);
const OfficialSelect = Symbol("官方筛选");
let hostLocale;
const Collapse = (props) => {
  const items = props.items || [];
  const active = [].concat(props.activeKey ?? []);
  return react.createElement("div", { className: props.className }, items.map((item) => {
    const open = active.includes(item.key);
    return react.createElement("div", { key: item.key },
      react.createElement("button", { type: "button", "aria-expanded": open, onClick: () => props.onChange(open ? [] : [item.key]) }, item.label, item.extra),
      open ? item.children : null);
  }));
};
const useUI = createRepositoryUI({ react, Modal: "modal", Input, Button, Collapse, SourceSelect: OfficialSelect, destination: createDestinationKit({ react, SourceSelect: OfficialSelect, translateError: (_t, error) => error.error || error.message }), api, headers: {}, getLocale: () => hostLocale, translateError: (_t, e) => e.code === "error.repo.invalid" ? "已翻译的仓库错误" : e.error || e.message });
let languagePrefix = "";
const rootTranslations = { "root.codex": "Codex", "root.claude": "Claude", "root.windsurf-user": "Windsurf User" };
const t = (key) => key === "format.locale" ? "zh-CN" : languagePrefix + (rootTranslations[key] || key);
let ui;
let uiProps = {};
function render() { cursor = 0; ui = useUI({ active, t, ...uiProps, onInstalled: async () => { installedCalls++; if (failInstalledRefresh) throw new Error("本地列表刷新失败"); } }); }
// 目标选择器是函数组件：带 userDestinations 的节点展开成它渲染出的子树，其余沿用原遍历。
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node.type === "function" && node.props && ("userDestinations" in node.props || Array.isArray(node.props.items))) return nodes(node.type(node.props));
  const children = Array.isArray(node.children) ? node.children : [];
    const extra = node.props && node.props.footer ? [node.props.footer] : [];
    return [node, ...children.flatMap(nodes), ...extra.flatMap(nodes)];
}
const all = () => [...nodes(ui.actions), ...nodes(ui.content)];
const find = (predicate) => all().find(predicate);
const dialog = () => find(n => n.type === "modal");
const modalNodes = () => nodes(dialog());
const modalAction = key => modalNodes().find(n => isAction(n, key));
const rowAction = key => all().filter(n => n.props.className === "dssm-repo-row").flatMap(nodes).find(n => isAction(n, key));
const countCalls = path => calls.filter(call => call.path === path).length;
const settle = async () => {
  for (let cycle = 0; cycle < 4; cycle++) {
    await new Promise(setImmediate);
    flushEffects();
    render();
  }
  await new Promise(setImmediate);
  render();
};
const clickNode = async node => { assert.ok(node, "必须找到可点击元素"); assert.ok(!node.props.disabled, "真实点击不能触发禁用按钮"); node.props.onClick(); await settle(); };
const click = key => clickNode(find(n => isAction(n, key)));
const clickModal = key => clickNode(modalAction(key));
// 位置是并排在范围右侧的官方下拉：label 为翻译后的「位置」，选项为后端允许的位置。
const locationSelect = () => modalNodes().find(n => n.type === OfficialSelect && n.props.label === "repo.installDestination");
const locationOption = root => locationSelect()?.props.options.find(o => o.value === root);
// 与旧单选框同名的辅助：返回该位置的选项（不存在则 undefined），disabled 来自下拉选项
const radio = root => { const option = locationOption(root); return option && { props: { disabled: option.disabled === true || locationSelect().props.disabled === true, checked: locationSelect().props.value === root, value: root, onChange: () => locationSelect().props.onChange(root) } }; };
const chooseRoot = root => { const option = locationOption(root); assert.ok(option, "所选位置必须可见"); assert.ok(!option.disabled, "真实选择不能触发不可用位置"); locationSelect().props.onChange(root); render(); };
const checkedRoots = () => { const select = locationSelect(); return select && select.props.value ? [select.props.value] : []; };
const destinationLabels = () => locationSelect()?.props.options ?? [];
const pathLines = () => modalNodes().filter(n => n.type === "code").map(n => n.children.join(""));

const repoSource = await readFile(new URL("../src/repository-ui.ts", import.meta.url), "utf8");
assert.deepEqual(Object.keys(repositoryLocales.en).sort(), Object.keys(repositoryLocales.zh).sort());
const selectSubsource = async key => {
  const value = key.replace('repo.subsource.', '');
  find(n => n.type === OfficialSelect && n.props.label === 'repo.searchSource').props.onChange(value);
  render(); await settle();
};
const catalogRow = name => all().find(n => n.props.className === 'dssm-repo-row' && nodes(n).some(child => child.props.className === 'dssm-name' && child.children.includes(name)));
const assertSearch = source => {
  const search = nodes(ui.content).filter(n => n.type === Input && n.props.className === 'dssm-search');
  assert.equal(search.length, 1, '每个来源只渲染一个搜索框');
  const selector = find(n => n.type === OfficialSelect && n.props.label === 'repo.searchSource');
  assert.equal(selector.props.value, source);
  assert.deepEqual(selector.props.options.map(option => option.value), ['github', 'clawhub', 'skillsh']);
  assert.equal(find(n => n.props.className?.includes('dssm-subsource-btn')), undefined, '不再渲染来源按钮行');
  for (const key of ['repo.uninstall', 'repo.rollback', 'repo.confirmUninstall']) assert.equal(find(n => isAction(n, key)), undefined, '移除回收与恢复动作');
};
render(); flushEffects(); await settle();
assertSearch('github');
assert.equal(countCalls('/repositories'), 1);
assert.equal(find(n => n.children.includes('repo.hint')), undefined);
assert.equal(find(n => n.children.includes('repo.footer')), undefined);
const options = find(n => n.type === 'details');
assert.ok(options && !options.props.open, '次要状态和排序默认收起');
ui.setSearch('pdf'); render();
assert.ok(catalogRow('pdf'), 'Git 搜索本地技能并展开匹配');
assert.equal(catalogRow('docx'), undefined);
await click('repo.install');
assert.equal(modalNodes().some(n => n.props.label === 'dest.scope' || n.props.label === 'dest.workspace'), false, '安装仅全局位置，没有项目选择器');
assert.deepEqual(locationSelect().props.options.map(option => option.value), ['dsh', 'agents']);
locationSelect().props.onChange('workspace'); render();
assert.equal(locationSelect().props.value, 'dsh', '合成事件不可注入项目目标');
chooseRoot('agents');
assert.ok(pathLines().includes('/configured/shared agent/skills'));
await clickModal('repo.install');
assert.deepEqual(calls.findLast(call => call.path === '/repositories/install').body, {id:'one',path:'skills/pdf',root:'agents'});
assert.equal(locationSelect().props.disabled, true);
locationSelect().props.onChange('dsh'); render();
assert.equal(locationSelect().props.value, 'agents', '安装中不能更换目标');
finishInstall(); await settle();
assertSearch('github');
ui.openSource('skillsh', 'react'); render(); await settle(); mock.timers.tick(300); await settle();
assertSearch('skillsh');
assert.ok(catalogRow('React Skill'));
assert.ok(skillshCalls.every(url => url.origin === 'http://localhost'));
await clickNode(nodes(catalogRow('React Skill')).find(n => isAction(n, 'repo.install')));
assert.equal(modalNodes().some(n => n.props.label === 'dest.workspace'), false);
await clickModal('repo.install');
assert.equal(calls.findLast(call => call.path === '/catalog/install').body.root, 'agents');
assert.equal('workspace' in calls.findLast(call => call.path === '/catalog/install').body, false);
await selectSubsource('repo.subsource.clawhub');
assertSearch('clawhub');
assert.equal(all().filter(n => n.props.className === 'dssm-repo-row').length, 10);
await click('repo.catalog.loadMore');
assert.equal(all().filter(n => n.props.className === 'dssm-repo-row').length, 20);
ui.setSearch('gill'); render(); mock.timers.tick(300); await settle();
assert.ok(catalogRow('Gill Helper'));
assert.equal(catalogRow('Unrelated federated result'), undefined, '过滤非 ClawHub 联邦结果');
assertSearch('clawhub');
ui.openManage(); render();
assert.equal(dialog().props.title, 'repo.manage');
assert.ok(modalNodes().some(n => n.children.includes('repo.footer')));
dialog().props.onClose(); render();
assert.match(repositoryLocales.en['repo.installSuccess'], /library/i);
assert.doesNotMatch(repositoryLocales.en['repo.installSuccess'], /enabled|slash/i);
assert.doesNotMatch(repositoryLocales.zh['repo.installSuccess'], /已启用|斜杠/);
// Existing install records remain diagnostic-only; removal routes are not exposed.
assert.equal(countCalls('/delete') + countCalls('/repositories/uninstall') + countCalls('/repositories/rollback'), 0);
mockCatalogInstalls = []; mockCatalogCopies = [];
// 未知旧身份不猜安装位置：两种目录行均保留显式重关联安装入口。
mockCatalogUnknownIds = ["clawhub:owner-3/skill-003", "skillsh:owner/skills/react-skill", "clawhub:not-loaded/old"];
mockCatalogWarnings = [{ id: "clawhub:broken/recovery", code: "error.repo.installState", error: "恢复记录失败" }];
resetMount(); render(); flushEffects(); await settle();
assert.ok(find(n => n.props.role === "alert" && n.children.join("").includes("clawhub:broken/recovery") && n.children.join("").includes("恢复记录失败")), "恢复诊断必须可见且保留身份和错误");
assert.ok(find(n => n.props.role === "status" && n.children.includes("repo.catalog.unknownHint")), "未知身份即使未加载到目录行也有简短提示");
await selectSubsource("repo.subsource.clawhub");
assert.ok(nodes(catalogRow("Skill 003")).some(n => n.children.includes("repo.catalog.unknownLocation")), "ClawHub 旧身份标注位置未知");
assert.ok(nodes(catalogRow("Skill 003")).some(n => isAction(n, "repo.catalog.reassociate") && !n.props.disabled), "未知身份保留显式重关联安装入口");
assert.equal(nodes(catalogRow("Skill 003")).some(n => n.children.includes("repo.installed")), false, "未知身份不能冒充已定位安装");
await clickNode(nodes(catalogRow("Skill 003")).find(n => isAction(n, "repo.catalog.reassociate")));
assert.ok(dialog() && locationSelect(), "重关联必须先选择明确安装位置");
await clickModal("repo.cancel");
await selectSubsource("repo.subsource.skillsh");
find(n => n.props["aria-label"] === "repo.catalog.searchSkillsh").props.onChange({ target: { value: "react" } }); render();
mock.timers.tick(300); await settle();
assert.ok(nodes(catalogRow("React Skill")).some(n => n.children.includes("repo.catalog.unknownLocation")), "skills.sh 旧身份标注位置未知");
assert.ok(nodes(catalogRow("React Skill")).some(n => isAction(n, "repo.catalog.reassociate") && !n.props.disabled), "skills.sh 未知身份也保留重关联");
mockCatalogUnknownIds = []; mockCatalogWarnings = [];
// 榜单失败后，经关键词搜索再清空，必须重试榜单而不是保留旧错误态。
resetMount(); render(); flushEffects(); await settle();
failCatalogRanking = true;
await selectSubsource("repo.subsource.clawhub");
const failedRankingCalls = catalogCalls.length;
failCatalogRanking = false;
find(n => n.props["aria-label"] === "repo.catalog.searchClawhub").props.onChange({ target: { value: "gill" } }); render();
mock.timers.tick(300); await settle();
find(n => n.props["aria-label"] === "repo.catalog.searchClawhub").props.onChange({ target: { value: "" } }); render(); await settle();
assert.equal(catalogCalls.length, failedRankingCalls + 1, "清空搜索使用新关键词状态重试失败的榜单");
assert.equal(all().filter(n => n.props.className === "dssm-repo-row").length, 10, "清空后恢复真实榜单第一页");
// 通过真实 effect 依赖切换及卸载执行 cleanup，不手调生产取消函数。
for (const kind of ["list", "clawhub", "skillsh"]) {
  for (const exit of ["source", "inactive", "unmount"]) {
    resetMount(); render(); flushEffects(); await settle();
    holdCatalogPath = kind === "list" ? "/clawhub/list" : kind === "clawhub" ? "/clawhub/search" : "/skills-sh/search";
    pendingCatalog = [];
    await selectSubsource(kind === "skillsh" ? "repo.subsource.skillsh" : "repo.subsource.clawhub");
    if (kind !== "list") {
      find(n => n.props["aria-label"] === (kind === "skillsh" ? "repo.catalog.searchSkillsh" : "repo.catalog.searchClawhub")).props.onChange({ target: { value: "held" } });
      render(); mock.timers.tick(300); await settle();
    }
    const old = pendingCatalog.at(-1);
    assert.ok(old, "必须启动真实请求");
    if (exit === "source") await selectSubsource("repo.subsource.github");
    else if (exit === "inactive") { active = false; render(); flushEffects(); await settle(); }
    else unmount();
    assert.equal(old.signal?.aborted, true, `${kind}/${exit} 必须 abort`);
    if (exit === "unmount") { values = []; dependencies = []; active = true; render(); flushEffects(); await settle(); }
    else { active = true; render(); flushEffects(); await settle(); }
    await selectSubsource("repo.subsource.github");
    await selectSubsource(kind === "skillsh" ? "repo.subsource.skillsh" : "repo.subsource.clawhub");
    mock.timers.tick(300); await settle();
    if (exit === "unmount" && kind !== "list") {
      find(n => n.props["aria-label"] === (kind === "skillsh" ? "repo.catalog.searchSkillsh" : "repo.catalog.searchClawhub")).props.onChange({ target: { value: "held" } }); render();
      mock.timers.tick(300); await settle();
    }
    const fresh = pendingCatalog.at(-1);
    assert.notEqual(fresh, old, "旧请求不能阻挡重新进入");
    old.resolve(kind === "list" ? { items: [{ ownerHandle: "stale", slug: "stale", displayName: "STALE" }], nextCursor: "bad" } : kind === "skillsh" ? { skills: [{ id: "stale", name: "STALE", source: "stale", skillId: "stale" }] } : { results: [{ ownerHandle: "stale", slug: "stale", displayName: "STALE" }] });
    await settle();
    assert.equal(all().some(n => n.children.includes("STALE")), false, "陈旧响应不可更新列表");
    assert.equal(fresh.signal.aborted, false, "陈旧 finally 不可取消新请求");
    assert.ok(find(n => n.props.role === "status" && n.children.includes(kind === "list" ? "repo.catalog.loading" : kind === "skillsh" ? "repo.catalog.skillshLoading" : "repo.catalog.searchLoading")), "陈旧 finally 不可清除新请求的加载状态");
    holdCatalogPath = "";
    fresh.resolve(kind === "list" ? { items: [], nextCursor: null } : kind === "skillsh" ? { skills: [] } : { results: [] });
    await settle();
  }
}
for (const kind of ["clawhub", "skillsh"]) {
  for (const exit of ["source", "inactive", "unmount"]) {
    resetMount(); render(); flushEffects(); await settle();
    await selectSubsource(kind === "skillsh" ? "repo.subsource.skillsh" : "repo.subsource.clawhub");
    const before = kind === "skillsh" ? skillshCalls.length : catalogSearchCalls.length;
    find(n => n.props["aria-label"] === (kind === "skillsh" ? "repo.catalog.searchSkillsh" : "repo.catalog.searchClawhub")).props.onChange({ target: { value: "cancel-timer" } }); render();
    if (exit === "source") await selectSubsource("repo.subsource.github");
    else if (exit === "inactive") { active = false; render(); flushEffects(); }
    else unmount();
    mock.timers.tick(300);
    assert.equal(kind === "skillsh" ? skillshCalls.length : catalogSearchCalls.length, before, `${kind}/${exit} 必须清理防抖 timer`);
  }
}

resetMount(); uiProps = { initialSource: 'skillsh' }; render(); flushEffects(); await settle();
assertSearch('skillsh');
ui.openSource('github', 'pdf'); render(); await settle(); assertSearch('github');
assert.equal(find(n => n.props['aria-label'] === 'repo.search').props.value, 'pdf');
const savedRepos = repos.splice(0);
resetMount(); uiProps = { initialSource: 'github' }; render(); flushEffects(); await settle();
assertSearch('github');
assert.equal(find(n => n.type === 'details'), undefined, '空仓库没有无用的仓库筛选');
assert.equal(find(n => isAction(n, 'repo.refresh')), undefined);
assert.ok(find(n => isAction(n, 'repo.addGit')));
repos.push(...savedRepos);
const beforeOpenAdd = countCalls('/repositories/add');
ui.openAddRepository('example/seeded'); render();
assert.equal(dialog().props.title, 'repo.add');
assert.equal(modalNodes().find(n => n.props['aria-label'] === 'repo.url').props.value, 'example/seeded');
assert.equal(countCalls('/repositories/add'), beforeOpenAdd, '打开添加弹窗不触发写入');
await clickModal('repo.cancel');
ui.openAddRepository(); render();
assert.equal(modalNodes().find(n => n.props['aria-label'] === 'repo.url').props.value, '', '无参数打开重置上次地址');
failAdd = true;
await assert.rejects(ui.addRepository('example/retry'), /add rejected/); render();
assert.equal(dialog().props.title, 'repo.add', 'genuine failure leaves add form open');
assert.equal(find(n => n.props.role === 'alert' && n.children.includes('add rejected'))?.props.role, 'alert');
failAdd = false;
const retryStart = countCalls('/repositories/add');
assert.equal(await ui.addRepository('example/retry'), true); render();
assert.equal(countCalls('/repositories/add'), retryStart + 1);
assert.equal(dialog(), undefined, 'successful retry closes old add dialog');
assertSearch('github');
ui.openSource('skillsh'); render(); await settle();
failRefresh = true;
const partialStart = countCalls('/repositories/add');
const adding = ui.addRepository('example/partial');
assert.equal(await ui.addRepository('example/partial'), false, 'concurrent add is suppressed synchronously');
assert.equal(await adding, true, 'committed subscription remains success if scan fails'); render();
assert.equal(countCalls('/repositories/add'), partialStart + 1, 'partial failure never automatically retries add');
assertSearch('github');
assert.ok(find(n => n.props.role === 'alert' && n.children.includes('repo.addRefreshWarning')));
assert.equal(dialog(), undefined, 'no second modal after a committed add');
failRefresh = false; failRepositoryList = true;
assert.equal(await ui.addRepository('example/list-warning'), true); render();
assert.ok(find(n => n.props.role === 'alert' && n.children.includes('repo.addRefreshWarning')));
failRepositoryList = false;
assert.equal(await ui.addRepository('  '), false, 'empty input does not write');
uiProps = {}; unmount(); mock.timers.reset();
console.log('统一来源搜索、全局安装、安全取消与目录生命周期专项测试通过');
