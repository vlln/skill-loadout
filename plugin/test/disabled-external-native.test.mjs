// 用真实 DSH scope 合并与 skill.execute 回归；仅使用临时用户目录。
// 默认使用开发宿主依赖；DSH_RUNTIME_DIR 可指定真实安装的 dsh 包目录。
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const req = process.env.DSH_RUNTIME_DIR
  ? createRequire(join(resolve(process.env.DSH_RUNTIME_DIR), "package.json"))
  : createRequire(createRequire(import.meta.url).resolve("@deepseek-ai/dsh-web-app/package.json"));
const load = (name) => import(pathToFileURL(req.resolve(name)).href);
const qa = await mkdtemp(join(tmpdir(), "dssm-disabled-external-"));
process.env.USERPROFILE = process.env.HOME = join(qa, "user");
process.env.DSH_HOME = join(qa, "home");
process.env.DSH_AGENTS_HOME = join(qa, "user", ".agents");
const skill = "bundled-regression";
const bundled = join(qa, "bundled");
const core = await import("../lib/core.js");
async function fixtureNamed(root, name, body) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: fixture\n---\n${body}`);
  return dir;
}
async function fixture(root, body) {
  return fixtureNamed(root, skill, body);
}
const roots = core.userRoots();
const cc = roots.find((r) => r.key === "ccswitch");
const wb = roots.find((r) => r.key === "workbuddy");
await fixture(bundled, "plugin fixture");
const ccDir = await fixture(cc.path, "ccswitch fixture");
await fixture(wb.path, "workbuddy fixture");

const { Context } = await load("@deepseek-ai/cordis");
const { SkillRegistry, isUserInvocable } = await load("@deepseek-ai/dsh-skill");
const { createScope } = await load("@deepseek-ai/dsh-scope");
const { FileSystemSkillProvider } = await load("@deepseek-ai/dsh-skill-filesystem");
const toolmod = await load("@deepseek-ai/dsh-tool-skill");
const ctx = new Context();
const registry = ctx.plugin(SkillRegistry);
await registry.await();
let scope;
let runRegression;
const harness = ctx.plugin({ name: "regression-harness", inject: ["skills"], apply(host) {
  host.skills.registerProvider((control) => new FileSystemSkillProvider(host, control, {
    providerName: "bundled-plugin", includeDefaultRoots: true, bundledSkillDir: bundled, watch: false,
  }));
  const agent = { id: "native-test-session", session: { header: { cwd: qa } } };
  scope = createScope(host, agent);
  let invalidate;
  scope.ctx.skills.registerProvider((control) => {
    invalidate = control.invalidate;
    return { name: "dsh-loadout-external", list: core.listProviderCandidates, get: core.getProviderSkill };
  });
  let tool;
  toolmod.apply({ skills: host.skills, tools: { register(t) { tool = t; } }, workingDirectory: { ensure: async () => qa }, on() {} });
  runRegression = async () => {
    const selected = async () => {
      invalidate();
      return (await host.skills.list({ cwd: qa, scope: agent })).find((s) => s.name === skill);
    };
    const execute = () => tool.execute({ name: skill }, { agent, signal: new AbortController().signal });
    const selectedNamed = async (name) => {
      invalidate();
      return (await host.skills.list({ cwd: qa, scope: agent })).find((s) => s.name === name);
    };
    const executeNamed = (name) => tool.execute({ name }, { agent, signal: new AbortController().signal });
    const choose = async (members) => {
      const created = await core.createLoadout(`Group ${Date.now()}-${Math.random().toString(16).slice(2, 5)}`.slice(0,24), null, members, undefined, { projectCwds: [qa] });
      assert.ok(created.loadout, JSON.stringify(created));
      await core.setSessionLoadout(agent.id, created.loadout.id);
    };
    assert.equal(isUserInvocable(await selected()), false, "unselected managed copies are blocked");
    await assert.rejects(execute, /not available for model invocation/);
    await choose([{ root: "ccswitch", name: skill }]);
    assert.equal((await selected()).source, "agent-ccswitch");
    await execute();
    await choose([{ root: "workbuddy", name: skill }]);
    assert.equal((await selected()).source, "agent-workbuddy");
    await execute();
    const agentsRoot = join(process.env.DSH_AGENTS_HOME, "skills");
    await fixture(agentsRoot, "native fixture");
    await choose([{ root: "agents", name: skill }]);
    assert.equal((await selected()).source, "agent-agents");
    await execute();
    await core.setSessionLoadout(agent.id, null);
    assert.equal(isUserInvocable(await selected()), false);
    await assert.rejects(execute, /not available for model invocation/);
    const projectSkills = join(qa, ".codex", "skills");
    await fixture(projectSkills, "project external fixture");
    const projectCodex = (await core.projectRoots([qa])).find(root => root.kind === "project-codex");
    assert.equal((await core.createLoadout('Reject project member', null, [{root:projectCodex.key,name:skill}], undefined, {projectCwds:[qa]})).code, 'error.loadout.globalOnly');
    await choose([]); // Current cwd project defaults, not group membership, supply this skill.
    assert.equal((await selected()).source, "project-codex");
    await execute();
    assert.ok(join(agentsRoot, skill).startsWith(qa + "/"));
    await rm(join(agentsRoot, skill), { recursive: true });
    await symlink(ccDir, join(agentsRoot, skill), process.platform === "win32" ? "junction" : "dir");
    await choose([{ root: "agents", name: skill }]);
    assert.equal(isUserInvocable(await selected()), true, "selected alias resolves canonical copy");
    await execute();
    const dshOnly = "native-dsh-only";
    await fixtureNamed(join(process.env.DSH_HOME, "skills"), dshOnly, "native dsh fixture");
    assert.equal(isUserInvocable(await selectedNamed(dshOnly)), false, "unselected native root does not bypass policy");
    await assert.rejects(executeNamed(dshOnly), /not available for model invocation/);
    await choose([{ root: "dsh", name: dshOnly }]);
    assert.equal(isUserInvocable(await selectedNamed(dshOnly)), true);
    await executeNamed(dshOnly);
    await core.setSessionLoadout(agent.id, "");
    assert.equal(isUserInvocable(await selectedNamed(dshOnly)), false);
    // A preset-only skill outside managed inventory remains available.
    await fixtureNamed(bundled, "preset-only", "unmanaged preset fixture");
    assert.equal(isUserInvocable(await selectedNamed("preset-only")), true);
    await executeNamed("preset-only");
    console.log("session-first real registry/native/external/project invocation passed");
  };
} });
await harness.await();
try {
  await runRegression();
} finally {
  await scope?.dispose();
  await harness.dispose();
  await registry.dispose();
  await rm(qa, { recursive: true, force: true });
}
