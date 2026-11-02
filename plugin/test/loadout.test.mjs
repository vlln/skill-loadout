// loadout：跨来源的命名技能编组。只写管理器状态，不移动技能文件。
// 覆盖：创建/改名/删除、成员增删、整组启停（含不可加载成员的 skipped）、
// 排他应用（exclusive 停用组外技能）、成员悬空容忍、activeLoadout 记录、坏数据整段丢弃。
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
  readManagerState,
  state,
  projectRoots,
  managerStatePath,
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

await rm(temporary, { recursive: true, force: true });
console.log("loadout ok");
