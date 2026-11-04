// 隔离目录验证新增来源、项目隔离、策略持久化及实际正文加载。
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = await mkdtemp(join(tmpdir(), "dssm-project-sources-"));
process.env.HOME = join(temp, "home");
process.env.USERPROFILE = join(temp, "home");
for (const key of [
  "DSH_HOME",
  "DSH_AGENTS_HOME",
  "DSH_CODEX_HOME",
  "DSH_CLAUDE_HOME",
  "DSH_GEMINI_HOME",
  "DSH_OPENCODE_HOME",
  "DSH_CURSOR_HOME",
  "DSH_COPILOT_HOME",
  "DSH_WINDSURF_HOME",
  "DSH_WINDSURF_USER_HOME",
  "DSH_TRAE_HOME",
  "DSH_TRAE_CN_HOME",
  "DSH_OPENCLAW_HOME",
  "DSH_CLAWDBOT_HOME",
  "DSH_ROO_HOME",
  "DSH_CODEBUDDY_HOME",
  "DSH_WORKBUDDY_HOME",
  "DSH_QODER_HOME",
  "DSH_QODER_CN_HOME",
  "DSH_LINGMA_HOME",
  "DSH_ANTIGRAVITY_HOME",
])
  process.env[key] = join(temp, key);
const core = await import("../lib/core.js");
const sessionId = "project-source-session";
let selectedMembers = [];
let fixtureId;
let excludedMembers = [];
async function selectMember(root, name, enabled, projectCwds = []) {
  selectedMembers = selectedMembers.filter(member => !(member.root === root.key && member.name === name));
  if (enabled && root.scope !== 'project') selectedMembers.push({ root: root.key, name });
  const result = fixtureId
    ? await core.updateLoadout(fixtureId, "Project fixture", null, selectedMembers, undefined, { projectCwds })
    : await core.createLoadout("Project fixture", null, selectedMembers, undefined, { projectCwds });
  assert.ok(result.loadout, JSON.stringify(result));
  fixtureId = result.loadout.id;
  await core.setSessionLoadout(sessionId, fixtureId);
  excludedMembers = excludedMembers.filter(member => !(member.root === root.key && member.name === name));
  if (!enabled) excludedMembers.push({ root: root.key, name });
  const exclusions = await core.setSessionSkillExclusions(sessionId, excludedMembers, undefined, { projectCwds });
  assert.notEqual(exclusions.ok, false, JSON.stringify(exclusions));
}
const candidatesFor = (options = {}) => core.listProviderCandidates({ ...options, sessionId });
const stateFor = (options = {}) => core.state({ ...options, sessionId });
async function skill(path, name) {
  await mkdir(path, { recursive: true });
  const file = join(path, "SKILL.md");
  await writeFile(file, `---\nname: ${name}\ndescription: 项目回归技能\n---\n${name} 正文`, "utf8");
  return file;
}
try {
  const source = await readFile(new URL("../lib/core.js", import.meta.url), "utf8");
  const rankSources = new Function(source.slice(source.indexOf("const EXTERNAL_SOURCE_ORDER"), source.indexOf("const PROJECT_SOURCES")) + "; return rankSources;")();
  assert.throws(() => rankSources([{ key: "newcomer" }], 210), /newcomer/, "单个未知来源也必须明确报错");
  assert.throws(() => rankSources([{ key: "codex" }, { key: "newcomer" }], 210), /newcomer/, "未知来源不能静默成为最高优先级");
  const firstTierUserKeys = [
    "copilot",
    "windsurf",
    "windsurf-user",
    "trae",
    "trae-cn",
    "openclaw",
    "clawdbot",
    "roo",
    "codebuddy",
    "workbuddy",
    "qoder",
    "qoder-cn",
    "lingma",
    "antigravity",
  ];
  for (const key of firstTierUserKeys)
    assert.ok(core.userRoots().some((root) => root.key === key), `注册全局 ${key} 来源`);
  const copilot = core.userRoots().find((root) => root.key === "copilot");
  await skill(join(copilot.path, "global"), "global-copilot");
  const oldState = (await core.readManagerState()).state;
  for (const key of ["copilot", "windsurf", "windsurf-user", "trae", "trae-cn", "openclaw", "clawdbot", "roo", "codebuddy", "workbuddy", "qoder", "qoder-cn", "lingma", "antigravity"]) {
    delete oldState.sources[key];
    delete oldState.disabledSkills[key];
    delete oldState.enabledSkills[key];
  }
  await mkdir(join(process.env.DSH_HOME, "skills-manager"), { recursive: true });
  await writeFile(core.managerStatePath(), JSON.stringify(oldState), "utf8");
  const migrated = await core.readManagerState();
  assert.equal(migrated.writable, true, "旧状态可兼容新来源");
  assert.equal(migrated.state.sources["windsurf-user"], undefined, "迁移补齐 Windsurf 主目录");
  assert.equal(migrated.state.sources["trae-cn"], undefined, "迁移补齐 Trae 国内版");
  assert.equal(migrated.state.sources.clawdbot, undefined, "迁移补齐 OpenClaw 旧目录");
  assert.equal(migrated.state.sources.codebuddy, undefined, "迁移补齐 CodeBuddy");
  assert.equal(migrated.state.sources.workbuddy, undefined, "迁移补齐 WorkBuddy");
  assert.equal(migrated.state.sources.qoder, undefined, "迁移补齐 Qoder");
  assert.equal(migrated.state.sources["qoder-cn"], undefined, "迁移补齐 Qoder CN CLI");
  assert.equal(migrated.state.sources.lingma, undefined, "迁移补齐 Qoder CN IDE");
  assert.equal(migrated.state.sources.antigravity, undefined, "迁移补齐 Google Antigravity");
  for (const field of ["sources", "disabledSkills"]) {
    const broken = structuredClone(migrated.state);
    delete broken[field].agents;
    await writeFile(core.managerStatePath(), JSON.stringify(broken), "utf8");
    assert.equal((await core.readManagerState()).writable, true, `旧策略 ${field} 缺失不影响会话加载`);
    assert.equal(await readFile(core.managerStatePath(), "utf8"), JSON.stringify(broken), "读取不能覆盖损坏状态");
  }
  await writeFile(core.managerStatePath(), JSON.stringify(migrated.state), "utf8");
  const project = join(temp, "project"), other = join(temp, "other");
  // 无 Git 时只使用当前 cwd，不向上猜测其他普通工作区。
  const plain = join(temp, "plain"), nested = join(plain, "nested");
  await mkdir(nested, { recursive: true });
  for (const directory of [".dsh", ".agents", ".github"]) {
    await skill(join(plain, directory, "skills", "plain-skill"), "plain-skill");
  }
  await skill(join(copilot.path, "plain-skill"), "plain-skill");
  const plainRoots = await core.projectRoots([plain]);
  assert.deepEqual(plainRoots.map((r) => r.kind), ["project-dsh", "project-agents", "project-copilot"], "非 Git 工作区发现原生及外部来源");
  assert.ok(plainRoots.every((r) => r.projectRoot === plain));
  assert.ok((await core.projectRoots([nested])).every((r) => r.projectRoot === nested), "无 Git 的子目录独立使用自身 cwd");
  const plainView = await stateFor({ projectCwds: [plain] });
  assert.equal(plainView.roots.filter((r) => r.scope === "project").flatMap((r) => r.skills).length, 3, "管理页面可见全部项目副本");
  await selectMember(copilot, "plain-skill", true);
  for (const root of plainRoots) await selectMember(root, "plain-skill", false, [plain]);
  const fallback = (await candidatesFor({ cwd: plain })).find((c) => c.name === "plain-skill");
  assert.equal(fallback.locator.rootKey, copilot.key, "停用项目副本回退全局");
  await selectMember(plainRoots[2], "plain-skill", true, [plain]);
  const restored = (await candidatesFor({ cwd: plain })).find((c) => c.name === "plain-skill");
  assert.equal(restored.locator.rootKey, plainRoots[2].key);
  assert.equal((await core.getProviderSkill(restored, { sessionId, cwd: plain })).content, "plain-skill 正文");
  assert.equal(await core.getProviderSkill(restored, { sessionId, cwd: nested }), undefined, "非 Git 工作区不能跨 cwd 读取");
  await mkdir(join(project, ".git"), { recursive: true });
  await mkdir(join(other, ".git"), { recursive: true });
  const sources = {
    copilot: ".github",
    codex: ".codex",
    claude: ".claude",
    gemini: ".gemini",
    opencode: ".opencode",
    cursor: ".cursor",
    windsurf: ".windsurf",
    trae: ".trae",
    "trae-cn": ".trae-cn",
    roo: ".roo",
    codebuddy: ".codebuddy",
    workbuddy: ".workbuddy",
    qoder: ".qoder",
    lingma: ".lingma",
  };
  for (const [key, directory] of Object.entries(sources)) {
    const file = await skill(join(project, directory, "skills", "group", key), `project-${key}`);
    const before = await readFile(file, "utf8");
    const root = (await core.projectRoots([project])).find((r) => r.kind === `project-${key}`);
    assert.ok(root, `注册项目 ${key}`);
    const candidate = (await candidatesFor({ cwd: project })).find((c) => c.name === `project-${key}`);
    assert.equal((await core.getProviderSkill(candidate, { sessionId, cwd: project })).content, `project-${key} 正文`);
    assert.equal(await core.getProviderSkill(candidate, { sessionId, cwd: other }), undefined, "不能跨项目读取");
    assert.equal((await core.setSkillEnabled(root, `group/${key}`, false)).code, "error.policy.sessionOnly");
    assert.equal((await candidatesFor({ cwd: project })).find((c) => c.name === `project-${key}`).invocation.modelInvocable, true, "rejected legacy toggle does not change project default");
    assert.equal((await core.deleteSkill(root, `group/${key}`)).code, "error.root.readonly");
    assert.equal(await readFile(file, "utf8"), before, "启停不修改来源正文");
    await selectMember(root, `group/${key}`, true, [project]);
  }
  const bare = join(temp, "bare");
  await mkdir(join(bare, ".git"), { recursive: true });
  assert.deepEqual(
    (await core.projectRoots([bare])).map((root) => root.kind),
    ["project-dsh"],
    "缺少目录的只读项目来源不进入 projectRoots",
  );
  const dsh = core.userRoots().find((root) => root.key === "dsh");
  await skill(join(dsh.path, "shared"), "shared");
  await skill(join(project, ".github", "skills", "shared"), "shared");
  const dshWinner = (await candidatesFor({ cwd: project })).find((c) => c.name === "shared");
  assert.equal(dshWinner.source, "project-copilot", "项目 Agent 优先于用户 DSH 同名技能");
  await skill(join(copilot.path, "same"), "same-name");
  await skill(join(project, ".github", "skills", "same"), "same-name");
  const winner = (await candidatesFor({ cwd: project })).find((c) => c.name === "same-name");
  assert.equal(winner.source, "project-copilot", "项目 Agent 优先于全局来源");
  const root = (await core.projectRoots([project])).find((r) => r.kind === "project-copilot");
  const projectSources = (await core.projectRoots([project])).filter((r) => !r.native);
  const userRanks = core.userRoots().map((r) => r.rank);
  assert.equal(new Set(projectSources.map((r) => r.rank)).size, projectSources.length, "项目来源 rank 唯一");
  assert.ok(projectSources.every((r) => r.rank < Math.min(...userRanks)), "新增项目来源全部排在用户来源之前");
  // 覆盖全部项目来源与全部用户来源的同名竞争，包括此前跨 Agent 的 10 组同分。
  for (const userRoot of core.userRoots()) {
    const name = `collision-${userRoot.key.toLowerCase()}`;
    await skill(join(userRoot.path, name), name);
    for (const projectRoot of projectSources) await skill(join(projectRoot.path, name), name);
  }
  for (const userRoot of core.userRoots()) {
    const name = `collision-${userRoot.key.toLowerCase()}`;
    selectedMembers.push({ root: userRoot.key, name });
    // Project collision copies are available by cwd defaults, not group references.
  }
  assert.ok((await core.updateLoadout(fixtureId, "Project fixture", null, selectedMembers, undefined, { projectCwds: [project, plain] })).loadout);
  const collisionState = await stateFor({ projectCwds: [project] });
  const candidates = await candidatesFor({ cwd: project });
  for (const userRoot of core.userRoots()) {
    const name = `collision-${userRoot.key.toLowerCase()}`;
    const candidate = candidates.find((c) => c.name === name);
    assert.equal(candidate.locator.rootKey, projectSources[0].key, "Provider 选择最高优先级项目副本");
    for (const projectRoot of projectSources) {
      const view = collisionState.roots.find((r) => r.key === projectRoot.key).skills.find((s) => s.name === name);
      if (projectRoot.key === candidate.locator.rootKey) assert.equal(view.winner, true);
      else {
        assert.equal(view.shadowedBy.root, candidate.locator.rootKey, "项目 UI 与 Provider 的赢家一致");
        assert.notEqual(view.winner, true, "被覆盖项目副本不得标为赢家");
      }
    }
    await selectMember(userRoot, name, false, [project, plain]);
    const disabled = (await candidatesFor({ cwd: project })).find((c) => c.name === name);
    assert.equal(disabled.locator.rootKey, projectSources[0].key, "停用全局副本不影响项目赢家");
    assert.equal(disabled.invocation.modelInvocable, true);
    await selectMember(userRoot, name, true, [project, plain]);
  }
  // 项目各副本分别停用后逐级回退，最终使用全局副本；全部停用才阻断调用。
  const cascadeName = "collision-codex";
  const globalCodex = core.userRoots().find((r) => r.key === "codex");
  for (let i = 0; i < projectSources.length; i++) {
    const disabledRoot = projectSources[i];
    await selectMember(disabledRoot, cascadeName, false, [project, plain]);
    const next = (await candidatesFor({ cwd: project })).find((c) => c.name === cascadeName);
    assert.equal(next.locator.rootKey, projectSources[i + 1]?.key ?? globalCodex.key);
    assert.equal(next.invocation.modelInvocable, true);
    const view = (await stateFor({ projectCwds: [project] })).roots.find((r) => r.key === disabledRoot.key).skills.find((s) => s.name === cascadeName);
    assert.equal(view.enabled, false, "已停用副本保持停用状态");
    assert.equal(view.shadowedBy, undefined, "已停用副本不标为被覆盖");
    assert.notEqual(view.winner, true);
    assert.deepEqual(view.fallbackTo, { root: next.locator.rootKey, name: cascadeName, scope: i + 1 < projectSources.length ? "project" : "user" }, "回退提示来自当前项目实际赢家");
  }
  await selectMember(globalCodex, cascadeName, false, [project, plain]);
  assert.equal((await candidatesFor({ cwd: project })).find((c) => c.name === cascadeName).invocation.modelInvocable, false);
  for (const r of (await stateFor({ projectCwds: [project] })).roots) {
    for (const skill of r.skills.filter((s) => s.name === cascadeName)) assert.equal(skill.fallbackTo, undefined, "全部停用不提示接管");
  }
  await selectMember(globalCodex, cascadeName, true, [project, plain]);
  assert.equal((await candidatesFor({ cwd: project })).find((c) => c.name === cascadeName).locator.rootKey, globalCodex.key);
  const restrictedPath = join(globalCodex.path, cascadeName, "SKILL.md");
  const originalCopy = await readFile(restrictedPath, "utf8");
  await writeFile(restrictedPath, "---\nname: " + cascadeName + "\ndescription: 受限副本\ndisable-model-invocation: true\nuser-invocable: false\n---\n受限正文", "utf8");

  const restricted = await stateFor({ projectCwds: [project] });
  assert.equal(restricted.roots.find((r) => r.key === projectSources[0].key).skills.find((s) => s.name === cascadeName).fallbackTo, undefined, "回退目标不可调用时不提示接管");
  await writeFile(restrictedPath, originalCopy, "utf8");
  await selectMember(projectSources[0], cascadeName, true, [project, plain]);
  assert.equal((await candidatesFor({ cwd: project })).find((c) => c.name === cascadeName).locator.rootKey, projectSources[0].key);
  assert.equal((await stateFor({ projectCwds: [project] })).roots.find((r) => r.key === projectSources[0].key).skills.find((s) => s.name === cascadeName).fallbackTo, undefined, "项目恢复后移除旧接管提示");
  await selectMember(copilot, "same", true, [project, plain]);
  assert.equal((await candidatesFor({ cwd: project })).find(c => c.name === "same-name").invocation.modelInvocable, true);
  assert.equal((await candidatesFor({ cwd: other })).find(c => c.name === "same-name").invocation.modelInvocable, true);
  assert.equal((await core.setSourceEnabled(root.key, false, undefined, { projectCwds: [project] })).code, "error.policy.sessionOnly");
  const validState = (await core.readManagerState()).state;
  for (const invalid of ["false", 0, null, {}, []]) {
    const broken = structuredClone(validState);
    broken.sources[root.key] = invalid;
    await writeFile(core.managerStatePath(), JSON.stringify(broken), "utf8");
    assert.equal((await core.readManagerState()).writable, true, "旧来源开关值不参与会话加载");
    assert.equal((await candidatesFor({ cwd: project })).find((c) => c.name === "project-copilot").invocation.modelInvocable, true);
    assert.equal((await core.setSourceEnabled(root.key, true, undefined, { projectCwds: [project] })).code, "error.policy.sessionOnly");
  }
  await writeFile(core.managerStatePath(), JSON.stringify(validState), "utf8");
  const afterDisable = await stateFor({ projectCwds: [project] });
  assert.equal(afterDisable.roots.find((item) => item.key === root.key).enabled, true);
  assert.equal(afterDisable.summary.total, afterDisable.roots.reduce((count, r) => count + r.skills.length, 0));
  assert.equal(afterDisable.summary.enabled, afterDisable.roots.flatMap((r) => r.skills).filter((skill) => skill.enabled === true).length);
  assert.equal(typeof afterDisable.summary.disabled, "number");
  assert.equal(typeof afterDisable.summary.issues, "number");
  assert.equal(afterDisable.roots.some((r) => r.kind === "project-openclaw"), false, "通用根目录 skills 不再属于项目技能来源");
  // 关闭的项目外部来源排名更高，也不能丢掉同名原生用户副本的禁用覆盖。
  const mixed = join(temp, "mixed-disabled");
  const mixedName = "mixed-disabled-native";
  await skill(join(mixed, ".codex", "skills", mixedName), mixedName);
  const mixedRoot = (await core.projectRoots([mixed])).find((r) => r.kind === "project-codex");
  await selectMember(mixedRoot, mixedName, false, [project, plain, mixed]);
  const mixedCandidate = async () => (await candidatesFor({ cwd: mixed })).find((c) => c.name === mixedName);
  assert.equal((await mixedCandidate()).invocation.modelInvocable, false, "未选择的外部副本发布阻断候选");
  const nativeRoot = core.userRoots().find((r) => r.key === "agents");
  await skill(join(nativeRoot.path, mixedName), mixedName);
  await core.setSourceEnabled("agents", false);
  const blocked = await mixedCandidate();
  assert.ok(blocked, "同名原生来源关闭时必须保留禁用覆盖");
  assert.equal(blocked.invocation.modelInvocable, false);
  assert.equal(blocked.invocation.userInvocable, false);
  await selectMember(nativeRoot, mixedName, true, [project, plain, mixed]);
  const enabledNative = await mixedCandidate();
  assert.equal(enabledNative.source, "agent-agents", "关闭的项目外部来源不阻止原生来源重新启用");
  assert.equal(enabledNative.invocation.modelInvocable, true);
  assert.equal(enabledNative.invocation.userInvocable, true);
  console.log("项目来源、Copilot 迁移与加载回归通过");
} finally {
  await rm(temp, { recursive: true, force: true });
}
