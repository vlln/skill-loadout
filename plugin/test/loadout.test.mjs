// loadout：跨来源的命名技能编组。只写管理器状态，不移动技能文件。
// 覆盖：创建/改名/删除、成员增删、整组启停（含不可加载成员的 skipped）、
// 排他应用（exclusive 停用组外技能）、成员悬空容忍、activeLoadout 记录、坏数据整段丢弃。
// v2 守门人：默认开、成员加载/非成员不加载、手动引用覆盖、手动排除优先、
// 无 activeLoadout 全不加载、关闭后回到 v1、scope 隔离、effectiveSkillPolicy 判定顺序。
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const temporary = await mkdtemp(join(tmpdir(), "dssm-loadout-"));
process.env.DSH_HOME = join(temporary, "dsh");
process.env.DSH_AGENTS_HOME = join(temporary, "agents");
process.env.DSH_CODEX_HOME = join(temporary, "codex");
process.env.HOME = process.env.USERPROFILE = join(temporary, "user");
const {
  createLoadout,
  renameLoadout,
  deleteLoadout,
  setLoadoutNote,
  addToLoadout,
  removeFromLoadout,
  setLoadoutEnabled,
  applyLoadout,
  currentLoadout,
  listLoadouts,
  setSessionLoadout,
  sessionLoadoutView,
  resolveEffectiveLoadout,
  storedSessionLoadout,
  readManagerState,
  state,
  projectRoots,
  managerStatePath,
  getGatekeeper,
  setGatekeeper,
  setSkillReferenced,
  setSkillEnabled,
  effectiveSkillPolicy,
  resolveActiveLoadout,
  listProviderCandidates,
} = await import("../lib/core.js");

const skillText = (name) => `---\nname: ${name}\ndescription: 测试技能\n---\n正文\n`;
const writeSkill = async (root, name, text = skillText(name)) => {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), text);
  return join(dir, "SKILL.md");
};
const dshEnabled = async (name) =>
  (await state()).roots.find((root) => root.key === "dsh").skills.find((item) => item.name === name).enabled;
const codexEnabled = async (name) =>
  (await state()).roots.find((root) => root.key === "codex").skills.find((item) => item.name === name).enabled;

const dsh = join(process.env.DSH_HOME, "skills");
const codex = join(process.env.DSH_CODEX_HOME, "skills");
const alphaDoc = await writeSkill(dsh, "alpha");
await writeSkill(dsh, "beta");
await writeSkill(dsh, "broken-skill", "没有 frontmatter\n");
await writeSkill(codex, "codex-skill");
await writeSkill(dsh, "ghost-skill");
const alphaBefore = await readFile(alphaDoc, "utf8");

// ── 守门人默认开：新状态文件缺省即守门人语义 ──────────────────────────────────
assert.equal(await getGatekeeper(), true, "守门人默认开（装了本插件就是这个语义）");
assert.equal((await state()).gatekeeper, true, "state 快照下发守门人开关");
assert.equal(await dshEnabled("alpha"), false, "守门人开且无 activeLoadout：什么都不加载");
assert.equal(
  (await state()).roots.find((root) => root.key === "dsh").skills.find((item) => item.name === "alpha").gated,
  true,
  "未加载技能带 gated 标记（与手动排除区分）",
);

// 以下 v1 行为断言在守门人关闭下进行：关掉 = 与现状逐字节一致。
await setGatekeeper(false);
assert.equal(await getGatekeeper(), false);
assert.equal((await state()).gatekeeper, false);
assert.equal(await dshEnabled("alpha"), true, "守门人关闭后回到 v1 默认启用");

// ── 创建（含 note 与初始成员）与字段校验 ─────────────────────────────────────
const created = await createLoadout("研发", "代码评审与重构", [
  { root: "dsh", name: "alpha" },
  { root: "codex", name: "codex-skill" },
]);
assert.equal(created.ok, undefined);
assert.match(created.loadout.id, /^[a-z0-9]{8,32}$/);
assert.equal(created.loadout.note, "代码评审与重构");
assert.deepEqual(created.loadout.members, [
  { root: "dsh", name: "alpha" },
  { root: "codex", name: "codex-skill" },
]);
const storedAfterCreate = await readManagerState();
assert.equal(storedAfterCreate.writable, true);
assert.deepEqual(
  storedAfterCreate.state.loadouts.map((item) => item.name),
  ["研发"],
  "创建落盘到状态文件",
);
assert.equal(await readFile(alphaDoc, "utf8"), alphaBefore, "创建编组不改技能文件");

const duplicate = await createLoadout("研发");
assert.equal(duplicate.ok, false);
assert.equal(duplicate.code, "error.loadout.duplicate");
assert.equal((await createLoadout("   ")).code, "error.loadout.name", "纯空白名称拒绝");
assert.equal((await createLoadout("x".repeat(25))).code, "error.loadout.name", "超过 24 字符拒绝");
assert.equal((await createLoadout("好名字", "n".repeat(141))).code, "error.loadout.noteTooLong", "备注超过 140 字符拒绝");
const badMember = await createLoadout("坏成员", undefined, [{ root: "dsh", name: "no-such-skill" }]);
assert.equal(badMember.ok, false);
assert.equal(badMember.code, "error.skill.notFound", "初始成员必须存在");
const badRoot = await createLoadout("坏来源", undefined, [{ root: "no-such-root", name: "alpha" }]);
assert.equal(badRoot.code, "error.loadout.root", "初始成员来源必须可解析");
assert.equal((await readManagerState()).state.loadouts.length, 1, "失败的创建不能落盘");

const second = await createLoadout("备用");
assert.equal(second.ok, undefined);
assert.equal(second.loadout.note, null, "缺省备注记为 null");

// ── 改名 / 备注 / 删除的基础校验 ─────────────────────────────────────────────
const renamed = await renameLoadout(created.loadout.id, "工作");
assert.equal(renamed.loadout.name, "工作");
assert.equal((await renameLoadout(created.loadout.id, "工作")).loadout.name, "工作", "重命名为自身名称保持幂等");
assert.equal((await renameLoadout(second.loadout.id, "工作")).code, "error.loadout.duplicate");
assert.equal((await renameLoadout("deadbeef", "x")).code, "error.loadout.notFound");
assert.equal((await renameLoadout(created.loadout.id, "  ")).code, "error.loadout.name");

const noted = await setLoadoutNote(second.loadout.id, "临时任务用");
assert.equal(noted.note, "临时任务用");
assert.equal((await setLoadoutNote(second.loadout.id, "n".repeat(141))).code, "error.loadout.noteTooLong");
assert.equal((await setLoadoutNote(second.loadout.id, "")).note, null, "备注可清空");
assert.equal((await setLoadoutNote("deadbeef", "x")).code, "error.loadout.notFound");

// ── 成员增删 ────────────────────────────────────────────────────────────────
const added = await addToLoadout(second.loadout.id, "dsh", "beta");
assert.equal(added.added, true);
const addedAgain = await addToLoadout(second.loadout.id, "dsh", "beta");
assert.equal(addedAgain.added, false, "重复加入幂等");
assert.equal(
  (await readManagerState()).state.loadouts.find((item) => item.id === second.loadout.id).members.length,
  1,
  "重复加入不产生重复成员",
);
assert.equal((await addToLoadout(second.loadout.id, "dsh", "no-such-skill")).code, "error.skill.notFound");
assert.equal((await addToLoadout(second.loadout.id, "no-such-root", "beta")).code, "error.loadout.root");
assert.equal((await addToLoadout("deadbeef", "dsh", "beta")).code, "error.loadout.notFound");
assert.equal(
  (await readManagerState()).state.loadouts.find((item) => item.id === second.loadout.id).members.length,
  1,
  "失败的加入不能落盘",
);

// 加入当时存在、随后被删的技能：成员引用悬空
const ghostAdded = await addToLoadout(created.loadout.id, "dsh", "ghost-skill");
assert.equal(ghostAdded.added, true);
await rm(join(dsh, "ghost-skill"), { recursive: true, force: true });

// 不可加载成员加入（存在但缺 frontmatter）
assert.equal((await addToLoadout(second.loadout.id, "dsh", "broken-skill")).added, true);

const removed = await removeFromLoadout(second.loadout.id, "dsh", "broken-skill");
assert.equal(removed.removed, true);
assert.equal((await removeFromLoadout(second.loadout.id, "dsh", "broken-skill")).removed, false, "重复移除幂等");
assert.equal((await removeFromLoadout("deadbeef", "dsh", "beta")).code, "error.loadout.notFound");
// 移除后加回来，供后续启停用
await addToLoadout(second.loadout.id, "dsh", "broken-skill");

// ── 整组启停：不可加载与悬空成员计入 skipped ────────────────────────────────
const off = await setLoadoutEnabled(created.loadout.id, false);
assert.equal(off.enabled, false);
assert.equal(off.changed, 2, "alpha 与 codex-skill 被停用");
assert.deepEqual(off.skipped, ["dsh/ghost-skill"], "悬空成员跳过并计入 skipped");
assert.equal(await dshEnabled("alpha"), false);
assert.equal(await codexEnabled("codex-skill"), false);
assert.equal(await readFile(alphaDoc, "utf8"), alphaBefore, "整组启停不改技能文件");

const on = await setLoadoutEnabled(created.loadout.id, true);
assert.equal(on.changed, 2);
assert.deepEqual(on.skipped, ["dsh/ghost-skill"]);
assert.equal(await dshEnabled("alpha"), true);
assert.equal(await codexEnabled("codex-skill"), true);

const toggleBroken = await setLoadoutEnabled(second.loadout.id, false);
assert.equal(toggleBroken.changed, 1, "beta 被停用");
assert.deepEqual(toggleBroken.skipped, ["dsh/broken-skill"], "结构不完整的技能被跳过");
assert.equal(await dshEnabled("beta"), false);
const toggleBrokenOn = await setLoadoutEnabled(second.loadout.id, true);
assert.equal(toggleBrokenOn.changed, 1);
assert.deepEqual(toggleBrokenOn.skipped, ["dsh/broken-skill"]);
assert.equal(await dshEnabled("beta"), true);

// ── 排他应用：停用组外已启用技能，记录 activeLoadout ─────────────────────────
const appliedExclusive = await applyLoadout(created.loadout.id, { exclusive: true });
assert.equal(appliedExclusive.scope, "user");
assert.equal(appliedExclusive.applied, 2, "alpha 与 codex-skill 重新启用");
assert.deepEqual(appliedExclusive.skipped, ["dsh/ghost-skill"], "悬空成员应用时跳过并计入 skipped");
assert.equal(appliedExclusive.disabledOthers, 1, "排他应用停用了组外的 beta");
assert.equal(await dshEnabled("beta"), false, "组外技能被停用");
assert.equal(await dshEnabled("alpha"), true);
assert.equal(await codexEnabled("codex-skill"), true);
assert.equal(await currentLoadout("user"), created.loadout.id, "activeLoadout 记录到 user 作用域");
assert.equal(
  (await readManagerState()).state.activeLoadout.user,
  created.loadout.id,
  "activeLoadout 落盘",
);
const listed = await listLoadouts();
assert.equal(listed.scope, "user");
assert.equal(listed.active, created.loadout.id);
assert.equal(listed.loadouts.length, 2);

// 非排他应用不动组外技能
await setLoadoutEnabled(second.loadout.id, true);
const appliedLoose = await applyLoadout(created.loadout.id, { exclusive: false });
assert.equal(appliedLoose.disabledOthers, 0);
assert.equal(await dshEnabled("beta"), true, "非排他应用保留组外技能");

assert.equal((await applyLoadout("deadbeef", { exclusive: true })).code, "error.loadout.notFound");
assert.equal((await setLoadoutEnabled("deadbeef", true)).code, "error.loadout.notFound");

// ── 项目作用域：scopeKey 与项目成员 ──────────────────────────────────────────
const project = join(temporary, "workspace");
await mkdir(join(project, ".git"), { recursive: true });
await writeSkill(join(project, ".dsh", "skills"), "gamma");
const projectRoot = (await projectRoots([project])).find((item) => item.kind === "project-dsh");
assert.ok(projectRoot, "测试工作区应解析出项目 DSH 来源");
const projectLoadout = await createLoadout("项目组", undefined, [{ root: projectRoot.key, name: "gamma" }], undefined, { projectCwds: [project] });
assert.equal(projectLoadout.ok, undefined, "创建时可用项目来源成员");
const appliedProject = await applyLoadout(projectLoadout.loadout.id, { exclusive: false }, undefined, { projectCwds: [project] });
assert.ok(appliedProject.scope.startsWith("project:"), "项目作用域记录 project: 前缀键");
assert.equal(appliedProject.applied, 1);
assert.equal(await currentLoadout(appliedProject.scope), projectLoadout.loadout.id);
const listedProject = await listLoadouts({ projectCwds: [project] });
assert.equal(listedProject.scope, appliedProject.scope);
assert.equal(listedProject.active, projectLoadout.loadout.id);
assert.equal((await listLoadouts()).active, created.loadout.id, "项目作用域不覆盖 user 作用域的 active");

// ── 删除：清理 activeLoadout，不动技能 ───────────────────────────────────────
const deleted = await deleteLoadout(projectLoadout.loadout.id);
assert.equal(deleted.ok, undefined);
assert.equal(await currentLoadout(appliedProject.scope), null, "删除编组清掉其作用域的 active 记录");
assert.equal((await deleteLoadout(projectLoadout.loadout.id)).code, "error.loadout.notFound");

// ── 坏数据整段丢弃：状态仍可写、记 warning、不拖死其他字段 ────────────────────
const stateFile = managerStatePath();
const raw = JSON.parse(await readFile(stateFile, "utf8"));
raw.loadouts = { bad: true };
raw.activeLoadout = "not-an-object";
await writeFile(stateFile, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
const corrupted = await readManagerState();
assert.equal(corrupted.writable, true, "坏 loadout 段不把状态打入只读");
assert.equal(corrupted.warning && corrupted.warning.code, "warning.loadout.invalid", "坏段记 warning");
assert.deepEqual(corrupted.state.loadouts, [], "坏 loadout 段整段丢弃");
assert.equal(await dshEnabled("alpha"), true, "其他策略字段不受影响");
const recreated = await createLoadout("重建");
assert.equal(recreated.ok, undefined, "丢弃坏段后可以正常重建");
assert.equal((await listLoadouts()).loadouts.length, 1);

// ── 守门人模式（v2）：成员加载 / 手动引用 / 手动排除 / scope 隔离 ──────────────
// 先清掉 v1 段落写入的 enabledSkills（那些是"手动引用"），让成员只靠编组资格生效。
await setSkillReferenced(dsh, "alpha", false);
await setSkillReferenced(dsh, "beta", false);
await setSkillReferenced(codex, "codex-skill", false);
await setGatekeeper(true);
assert.equal(await getGatekeeper(), true);
assert.equal(await currentLoadout("user"), null, "坏段丢弃后 user scope 没有 activeLoadout");
assert.equal(await dshEnabled("alpha"), false, "无 activeLoadout 时全不加载");
assert.equal(await codexEnabled("codex-skill"), false);

// 应用 = 设为当前（守门人语义）：不写 disabled 列表，disabledOthers 恒为 0，悬空成员跳过。
await writeSkill(dsh, "vanishing");
const gatedLoadout = await createLoadout("守门", undefined, [
  { root: "dsh", name: "alpha" },
  { root: "codex", name: "codex-skill" },
  { root: "dsh", name: "vanishing" },
]);
await rm(join(dsh, "vanishing"), { recursive: true, force: true });
const gatedApply = await applyLoadout(gatedLoadout.loadout.id, { exclusive: true });
assert.equal(gatedApply.scope, "user");
assert.equal(gatedApply.disabledOthers, 0, "守门人下排他应用不再逐个写 disabled");
assert.equal(gatedApply.applied, 2, "可解析成员计入 applied");
assert.deepEqual(gatedApply.skipped, ["dsh/vanishing"], "悬空成员跳过并计入 skipped");
assert.equal(await currentLoadout("user"), gatedLoadout.loadout.id, "设为当前 scope 的 activeLoadout");
const stateAfterGatedApply = (await readManagerState()).state;
assert.deepEqual(stateAfterGatedApply.disabledSkills.dsh, [], "组外技能没有被写 disabled 列表");
assert.deepEqual(stateAfterGatedApply.enabledSkills.dsh, [], "成员靠编组资格生效，不写 enabledSkills");
assert.equal((await listLoadouts()).gatekeeper, true, "编组列表接口下发守门人开关");

// 成员加载、非成员不加载
assert.equal(await dshEnabled("alpha"), true, "成员加载");
assert.equal(await codexEnabled("codex-skill"), true, "跨来源成员加载");
assert.equal(await dshEnabled("beta"), false, "非成员不加载");
assert.equal(
  (await state()).roots.find((root) => root.key === "dsh").skills.find((item) => item.name === "beta").gated,
  true,
  "非成员带 gated 标记",
);
assert.equal(
  (await state()).roots.find((root) => root.key === "dsh").skills.find((item) => item.name === "alpha").gated,
  undefined,
  "成员不带 gated 标记",
);

// 手动引用覆盖守门人基线；取消引用只清 enabledSkills，不写 disabledSkills。
const referenced = await setSkillReferenced(dsh, "beta", true);
assert.equal(referenced.enabled, true);
assert.equal(await dshEnabled("beta"), true, "手动引用覆盖守门人基线");
await setSkillReferenced(dsh, "beta", false);
assert.equal(await dshEnabled("beta"), false, "取消引用后回到未加载");
assert.equal((await readManagerState()).state.disabledSkills.dsh.includes("beta"), false, "取消引用不写 disabled 列表");
assert.equal((await setSkillReferenced(dsh, "broken-skill", true)).code, "error.skill.noFrontmatter", "不可加载技能不能引用");

// 手动排除优先于成员资格
await setSkillEnabled(dsh, "alpha", false);
assert.equal(await dshEnabled("alpha"), false, "手动排除优先于成员资格");
await setSkillEnabled(dsh, "alpha", true);
assert.equal(await dshEnabled("alpha"), true, "解除排除后成员资格恢复生效");
// 清掉手动引用，让 alpha 只靠编组资格生效（成员不是 override，原生副本不需要覆盖层）。
await setSkillReferenced(dsh, "alpha", false);
assert.equal(await dshEnabled("alpha"), true, "取消引用后成员资格仍生效");

// listProviderCandidates 走同一决策点：非成员发布阻断覆盖层，成员照常提供。
await writeSkill(codex, "codex-other");
const gatedCandidates = await listProviderCandidates();
assert.equal(gatedCandidates.find((item) => item.name === "alpha"), undefined, "原生根成员无需覆盖层（宿主原生提供）");
const otherCandidate = gatedCandidates.find((item) => item.name === "codex-other");
assert.ok(otherCandidate, "外部非成员仍发布候选");
assert.equal(otherCandidate.invocation.modelInvocable, false, "外部非成员被阻断");
const betaCandidate = gatedCandidates.find((item) => item.name === "beta");
assert.ok(betaCandidate, "原生根非成员发布阻断覆盖层");
assert.equal(betaCandidate.invocation.userInvocable, false, "原生根非成员被阻断");
assert.equal(gatedCandidates.find((item) => item.name === "codex-skill").invocation.modelInvocable, true, "外部成员照常提供");

// 换 scope 互不影响：项目 scope 的 activeLoadout 独立解析。
const gatedWs = join(temporary, "gated-ws");
await mkdir(join(gatedWs, ".git"), { recursive: true });
await writeSkill(join(gatedWs, ".dsh", "skills"), "delta");
const gatedProjectRoot = (await projectRoots([gatedWs])).find((item) => item.kind === "project-dsh");
const projectScopeKey = (await listLoadouts({ projectCwds: [gatedWs] })).scope;
assert.ok(projectScopeKey.startsWith("project:"), "项目作用域键带 project: 前缀");
const projectView = await state({ projectCwds: [gatedWs] });
assert.equal(projectView.roots.find((root) => root.key === gatedProjectRoot.key).skills.find((item) => item.name === "delta").enabled, false, "项目 scope 无 activeLoadout：项目技能不加载");
assert.equal(projectView.roots.find((root) => root.key === "dsh").skills.find((item) => item.name === "alpha").enabled, false, "user 编组的成员资格不带进项目 scope");
const gatedProjectLoadout = await createLoadout("项目守门", undefined, [{ root: gatedProjectRoot.key, name: "delta" }], undefined, { projectCwds: [gatedWs] });
const appliedProjectGated = await applyLoadout(gatedProjectLoadout.loadout.id, {}, undefined, { projectCwds: [gatedWs] });
assert.equal(appliedProjectGated.applied, 1);
assert.equal(appliedProjectGated.disabledOthers, 0);
const projectView2 = await state({ projectCwds: [gatedWs] });
assert.equal(projectView2.roots.find((root) => root.key === gatedProjectRoot.key).skills.find((item) => item.name === "delta").enabled, true, "项目 activeLoadout 的成员加载");
assert.equal(projectView2.roots.find((root) => root.key === "dsh").skills.find((item) => item.name === "alpha").enabled, false, "项目 activeLoadout 只含自己的成员");
assert.equal(await dshEnabled("alpha"), true, "user scope 保持自己的 activeLoadout");
assert.equal(await currentLoadout("user"), gatedLoadout.loadout.id, "项目应用不改 user scope");

// 守门人关闭后完全回到 v1 行为。
await setGatekeeper(false);
assert.equal((await state()).gatekeeper, false, "快照下发关闭状态");
assert.equal(await dshEnabled("beta"), true, "关闭后非成员恢复默认启用");
assert.equal(
  (await state()).roots.find((root) => root.key === "dsh").skills.find((item) => item.name === "beta").gated,
  undefined,
  "关闭后不再带 gated 标记",
);
assert.equal((await listProviderCandidates()).find((item) => item.name === "beta"), undefined, "关闭后原生副本不再需要阻断覆盖层");
assert.equal((await listProviderCandidates()).find((item) => item.name === "codex-other").invocation.modelInvocable, true, "关闭后外部技能恢复提供");
assert.equal((await state({ projectCwds: [gatedWs] })).roots.find((root) => root.key === gatedProjectRoot.key).skills.find((item) => item.name === "delta").enabled, true, "关闭后项目技能恢复默认启用");

// ── 会话级编组（v3）：会话覆盖 → scope 默认 → 空（什么都不加载）─────────────────
await setGatekeeper(true);
const scopeDefault = await createLoadout("会话默认", undefined, [{ root: "dsh", name: "alpha" }]);
const sessionSetA = await createLoadout("会话甲", undefined, [{ root: "codex", name: "codex-skill" }]);
const sessionSetB = await createLoadout("会话乙", undefined, [{ root: "dsh", name: "beta" }]);
await applyLoadout(scopeDefault.loadout.id, {}, undefined);
assert.equal(await dshEnabled("alpha"), true, "scope 默认编组成员加载");
const sessionA = "session-aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const sessionB = "session-bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const sessionEnabled = async (sessionId, rootKey, name) => {
  const snapshot = await state({ sessionId });
  return snapshot.roots.find((root) => root.key === rootKey).skills.find((item) => item.name === name).enabled;
};

const selected = await setSessionLoadout(sessionA, sessionSetA.loadout.id);
assert.equal(selected.ok, undefined);
assert.equal(selected.loadoutId, sessionSetA.loadout.id);
const viewA = await sessionLoadoutView(sessionA);
assert.equal(viewA.sessionId, sessionA, "GET 形状：回传会话 id");
assert.equal(viewA.loadoutId, sessionSetA.loadout.id, "GET 形状：原样回传会话覆盖值");
assert.equal(viewA.effective.source, "session", "会话覆盖优先于 scope 默认");
assert.equal(viewA.effective.loadout.id, sessionSetA.loadout.id);
assert.deepEqual(viewA.effective.skills, ["codex-skill"], "生效技能清单只含会话编组里可加载的成员");

// 别的会话不受影响，回落到 scope 的 activeLoadout。
const viewB = await sessionLoadoutView(sessionB);
assert.equal(viewB.loadoutId, null, "未选的会话没有覆盖值");
assert.equal(viewB.effective.source, "scope");
assert.deepEqual(viewB.effective.skills, ["alpha"], "未选的会话用 scope 编组的成员");

// 会话覆盖落到 state()（请求头会话）与 provider 候选。
assert.equal(await sessionEnabled(sessionA, "dsh", "alpha"), false, "会话甲：scope 成员被会话编组挤掉");
assert.equal(await sessionEnabled(sessionA, "codex", "codex-skill"), true, "会话甲：会话成员加载");
assert.equal(await sessionEnabled(sessionB, "dsh", "alpha"), true, "会话乙回落 scope 默认");
assert.equal(await sessionEnabled(sessionB, "codex", "codex-skill"), false, "会话乙：会话甲的成员不加载");
const candidatesA = await listProviderCandidates({ sessionId: sessionA });
assert.equal(candidatesA.find((item) => item.name === "codex-skill").invocation.modelInvocable, true, "会话成员照常发布候选");
assert.equal(candidatesA.find((item) => item.name === "codex-other").invocation.modelInvocable, false, "会话外的外部技能被阻断覆盖层遮住");
const candidatesB = await listProviderCandidates({ sessionId: sessionB });
assert.equal(candidatesB.find((item) => item.name === "codex-skill").invocation.modelInvocable, false, "同一个外部技能在别的会话里不是成员，被阻断覆盖层遮住");

// 显式「不加载」：覆盖 scope，但不改动 scope 的 activeLoadout。
const none = await setSessionLoadout(sessionA, "");
assert.equal(none.loadoutId, "");
const viewNone = await sessionLoadoutView(sessionA);
assert.equal(viewNone.loadoutId, "");
assert.equal(viewNone.effective.source, "none");
assert.equal(viewNone.effective.loadout, null);
assert.deepEqual(viewNone.effective.skills, []);
assert.equal(await sessionEnabled(sessionA, "dsh", "alpha"), false, "显式不加载：连 scope 成员也不加载");
assert.equal(await sessionEnabled(sessionA, "codex", "codex-skill"), false);
assert.equal(await sessionEnabled(sessionB, "dsh", "alpha"), true, "显式不加载不影响别的会话");
assert.equal(await currentLoadout("user"), scopeDefault.loadout.id, "显式不加载不改 scope 的 activeLoadout");
assert.equal((await readManagerState()).state.sessionLoadouts[sessionA], "", "显式不加载落盘为空字符串");

// 清除覆盖（null）→ 回落到 scope。
const cleared = await setSessionLoadout(sessionA, null);
assert.equal(cleared.loadoutId, null);
assert.equal((await readManagerState()).state.sessionLoadouts[sessionA], undefined, "清除覆盖从状态里删掉该键");
const viewCleared = await sessionLoadoutView(sessionA);
assert.equal(viewCleared.loadoutId, null);
assert.equal(viewCleared.effective.source, "scope");
assert.deepEqual(viewCleared.effective.skills, ["alpha"]);

// 非法输入：写侧拒绝，读侧视为未选。
assert.equal((await setSessionLoadout("bad session!", sessionSetA.loadout.id)).code, "error.session.invalid", "非法会话 id 拒绝写入");
assert.equal((await setSessionLoadout("", sessionSetA.loadout.id)).code, "error.session.invalid", "空会话 id 拒绝写入");
assert.equal((await setSessionLoadout(sessionA, "missing00")).code, "error.loadout.notFound", "不存在的编组拒绝写入");
assert.equal((await readManagerState()).state.sessionLoadouts[sessionA], undefined, "失败的写入不落盘");
const viewInvalid = await sessionLoadoutView("bad session!");
assert.equal(viewInvalid.sessionId, null, "非法会话 id 读取为 null");
assert.equal(viewInvalid.loadoutId, null);
assert.equal(viewInvalid.effective.source, "scope", "非法会话 id 视为未选，回落 scope");

// 删除编组清理指向它的会话覆盖，不留下悬空引用。
await setSessionLoadout(sessionB, sessionSetA.loadout.id);
assert.equal((await readManagerState()).state.sessionLoadouts[sessionB], sessionSetA.loadout.id);
await deleteLoadout(sessionSetA.loadout.id);
assert.equal((await readManagerState()).state.sessionLoadouts[sessionB], undefined, "删除编组清掉指向它的会话覆盖");
assert.equal((await sessionLoadoutView(sessionB)).effective.source, "scope", "覆盖悬空时回落 scope");
await deleteLoadout(sessionSetB.loadout.id);
assert.equal((await deleteLoadout(scopeDefault.loadout.id)).ok, undefined);
assert.equal((await sessionLoadoutView(sessionB)).effective.source, "none", "没有任何编组时不加载");

// ── effectiveSkillPolicy 判定顺序（假数据驱动，逐条对应契约 v2）────────────────
const fakeEntry = (name, extra = {}) => ({
  name, declaredName: name, description: "", modelInvocable: true, userInvocable: true,
  invocationPolicyValid: true, hasFrontmatter: true, loadable: true, diagnostics: [],
  kind: "bundle", docPath: "", entryPath: "", realDocPath: "", realEntryPath: "", linked: false,
  ...extra,
});
const fakeRoot = { key: "dsh" };
const fakeState = (over = {}) => ({
  version: 1,
  sources: { dsh: true, codex: true },
  disabledSkills: { dsh: [], codex: [] },
  enabledSkills: { dsh: [], codex: [] },
  gatekeeper: true,
  loadouts: [{ id: "loadout1", name: "L", note: null, members: [{ root: "dsh", name: "member" }] }],
  activeLoadout: { user: "loadout1" },
  ...over,
});
const fakePolicy = (policyState, writable = true) => ({ state: policyState, writable, warning: null });

// 1. 手动排除 → 禁用（即使是成员）。
assert.equal(effectiveSkillPolicy(fakePolicy(fakeState({ disabledSkills: { dsh: ["member"], codex: [] } })), fakeRoot, fakeEntry("member")).enabled, false);
// 2. 手动引用 → 启用（即使不是成员）。
assert.equal(effectiveSkillPolicy(fakePolicy(fakeState({ enabledSkills: { dsh: ["other"], codex: [] } })), fakeRoot, fakeEntry("other")).enabled, true);
// 3a. 守门人开：成员启用。
const memberPolicy = effectiveSkillPolicy(fakePolicy(fakeState()), fakeRoot, fakeEntry("member"));
assert.equal(memberPolicy.enabled, true);
assert.equal(memberPolicy.gated, undefined, "成员不带 gated 标记");
// 3b. 守门人开：非成员禁用且带 gated 标记。
const gatedPolicy = effectiveSkillPolicy(fakePolicy(fakeState()), fakeRoot, fakeEntry("other"));
assert.equal(gatedPolicy.enabled, false);
assert.equal(gatedPolicy.gated, true);
// 3c. 无 activeLoadout：全不加载，手动引用仍生效。
assert.equal(effectiveSkillPolicy(fakePolicy(fakeState({ activeLoadout: {} })), fakeRoot, fakeEntry("member")).enabled, false);
assert.equal(effectiveSkillPolicy(fakePolicy(fakeState({ activeLoadout: {}, enabledSkills: { dsh: ["member"], codex: [] } })), fakeRoot, fakeEntry("member")).enabled, true);
// 3d. 成员资格认别名：成员引用可以指向被去重隐藏的副本（policyAliases）。
const aliasPolicy = effectiveSkillPolicy(fakePolicy(fakeState()), { key: "codex" }, fakeEntry("renamed", { policyAliases: [{ rootKey: "dsh", name: "member" }] }));
assert.equal(aliasPolicy.enabled, true, "成员引用命中 policyAliases 中的副本");
// 3e. 换 scope 互不影响：别的 scope 的 activeLoadout 不参与判定。
assert.equal(effectiveSkillPolicy(fakePolicy(fakeState()), fakeRoot, fakeEntry("member"), "project:0123456789abcdef").enabled, false, "别的 scope 没有 activeLoadout");
// 4. 守门人关 → 现状（默认启用）。
assert.equal(effectiveSkillPolicy(fakePolicy(fakeState({ gatekeeper: false })), fakeRoot, fakeEntry("other")).enabled, true);
// 硬条件照旧优先：不可写状态与来源停用先于一切。
assert.equal(effectiveSkillPolicy(fakePolicy(fakeState({ enabledSkills: { dsh: ["other"], codex: [] } }), false), fakeRoot, fakeEntry("other")).enabled, false, "不可写状态优先于手动引用");
assert.equal(effectiveSkillPolicy(fakePolicy(fakeState({ sources: { dsh: false, codex: true } })), fakeRoot, fakeEntry("member")).enabled, false, "来源停用优先于成员资格");

// resolveActiveLoadout：悬空 id 与未知 scope 解析为 null。
assert.equal(resolveActiveLoadout(fakeState(), "user").id, "loadout1");
assert.equal(resolveActiveLoadout(fakeState(), "project:0123456789abcdef"), null);
assert.equal(resolveActiveLoadout(fakeState({ activeLoadout: { user: "missing00" } }), "user"), null, "悬空 id 解析为 null");

// ── 会话级判定（v3，假数据驱动）：覆盖优先、显式不加载、非法/悬空回落 ───────────
const fakeSession = "session-11111111-1111-4111-8111-111111111111";
const fakeSessionState = (over = {}) => fakeState({
  loadouts: [
    { id: "loadout1", name: "L1", note: null, members: [{ root: "dsh", name: "member" }] },
    { id: "loadout2", name: "L2", note: null, members: [{ root: "dsh", name: "other" }] },
  ],
  activeLoadout: { user: "loadout1" },
  ...over,
});
const sessionPolicy = (policyState, name, sessionId = fakeSession, scopeKey = "user") => effectiveSkillPolicy(fakePolicy(policyState), fakeRoot, fakeEntry(name), scopeKey, sessionId);
// 会话覆盖命中：成员换成 loadout2 的 other。
assert.equal(sessionPolicy(fakeSessionState({ sessionLoadouts: { [fakeSession]: "loadout2" } }), "other").enabled, true, "会话覆盖：会话编组成员启用");
assert.equal(sessionPolicy(fakeSessionState({ sessionLoadouts: { [fakeSession]: "loadout2" } }), "member").enabled, false, "会话覆盖：scope 成员不再启用");
// 未选 / 非法 / 悬空 → 回落 scope。
assert.equal(sessionPolicy(fakeSessionState({ sessionLoadouts: { [fakeSession]: "loadout2" } }), "member", "session-other").enabled, true, "别的会话回落 scope");
assert.equal(sessionPolicy(fakeSessionState(), "member", fakeSession).enabled, true, "没有覆盖时用 scope");
assert.equal(sessionPolicy(fakeSessionState({ sessionLoadouts: { [fakeSession]: "loadout2" } }), "member", "bad session!").enabled, true, "非法会话 id 视为未选");
assert.equal(sessionPolicy(fakeSessionState({ sessionLoadouts: { [fakeSession]: "missing00" } }), "member").enabled, true, "悬空编组视为未选");
// 显式不加载：连 scope 成员也不加载。
const nonePolicy = sessionPolicy(fakeSessionState({ sessionLoadouts: { [fakeSession]: "" } }), "member");
assert.equal(nonePolicy.enabled, false, "显式不加载：什么都不加载");
assert.equal(nonePolicy.gated, true, "显式不加载表现为未加载（gated）而非手动排除");
// 手动排除/引用优先于会话覆盖。
assert.equal(sessionPolicy(fakeSessionState({ sessionLoadouts: { [fakeSession]: "loadout2" }, disabledSkills: { dsh: ["other"], codex: [] } }), "other").enabled, false, "手动排除优先于会话成员资格");
assert.equal(sessionPolicy(fakeSessionState({ sessionLoadouts: { [fakeSession]: "" }, enabledSkills: { dsh: ["member"], codex: [] } }), "member").enabled, true, "手动引用优先于显式不加载");
// 守门人关：会话覆盖完全不参与判定。
assert.equal(sessionPolicy(fakeSessionState({ gatekeeper: false, sessionLoadouts: { [fakeSession]: "" } }), "member").enabled, true, "守门人关闭后回到 v1 行为");
// resolveEffectiveLoadout / storedSessionLoadout 的三种来源与原始覆盖值。
assert.deepEqual(
  [
    resolveEffectiveLoadout(fakeSessionState({ sessionLoadouts: { [fakeSession]: "loadout2" } }), "user", fakeSession).source,
    resolveEffectiveLoadout(fakeSessionState(), "user", fakeSession).source,
    resolveEffectiveLoadout(fakeSessionState({ activeLoadout: {} }), "user", fakeSession).source,
    resolveEffectiveLoadout(fakeSessionState({ sessionLoadouts: { [fakeSession]: "" } }), "user", fakeSession).source,
  ],
  ["session", "scope", "none", "none"],
  "生效顺序：session → scope → 空",
);
assert.equal(resolveEffectiveLoadout(fakeSessionState({ sessionLoadouts: { [fakeSession]: "" } }), "user", fakeSession).explicitNone, true);
assert.equal(storedSessionLoadout(fakeSessionState({ sessionLoadouts: { [fakeSession]: "" } }), fakeSession), "", "原始覆盖值保留显式空串");
assert.equal(storedSessionLoadout(fakeSessionState(), fakeSession), undefined, "没有覆盖时返回 undefined");
assert.equal(storedSessionLoadout(fakeSessionState({ sessionLoadouts: {} }), "bad session!"), undefined, "非法会话 id 不读覆盖");

// ── 会话段坏数据：形状合法但内容悬空 → 逐项丢弃；整段形状非法 → 丢段记 warning ──
const sessionStateFile = managerStatePath();
const sessionRaw = JSON.parse(await readFile(sessionStateFile, "utf8"));
const keptSession = "session-cccccccc-3333-4333-8333-cccccccccccc";
await setSessionLoadout(keptSession, "");
sessionRaw.sessionLoadouts = { "bad session!": "abcdefgh", [keptSession]: "missing00", "": "abcdefgh" };
await writeFile(sessionStateFile, `${JSON.stringify(sessionRaw, null, 2)}\n`, "utf8");
const tolerantState = await readManagerState();
assert.equal(tolerantState.writable, true);
assert.equal(tolerantState.warning, null, "形状合法的会话段不记 warning（悬空项按未选处理）");
assert.deepEqual([...Object.keys(tolerantState.state.sessionLoadouts)], [], "非法会话键与悬空编组逐项丢弃");
assert.ok(tolerantState.state.loadouts.some((item) => item.name === "重建"), "会话段清洗不影响 loadouts 段");

await setSessionLoadout(keptSession, "");
const brokenRaw = JSON.parse(await readFile(sessionStateFile, "utf8"));
brokenRaw.sessionLoadouts = "not-an-object";
await writeFile(sessionStateFile, `${JSON.stringify(brokenRaw, null, 2)}\n`, "utf8");
const brokenState = await readManagerState();
assert.equal(brokenState.writable, true, "坏会话段不把状态打入只读");
assert.equal(brokenState.warning && brokenState.warning.code, "warning.loadout.invalid", "坏会话段与 loadout 段共用 warning");
assert.deepEqual([...Object.keys(brokenState.state.sessionLoadouts)], [], "坏会话段整段丢弃");
assert.equal(await getGatekeeper(), true, "其他策略字段不受影响");

await rm(temporary, { recursive: true, force: true });
console.log("loadout ok");
