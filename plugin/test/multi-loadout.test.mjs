// Multi-group session selection: union/provenance, compatibility, atomicity, HTTP and provider parity.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const temporary = await mkdtemp(join(tmpdir(), "loadout-multi-"));
process.env.HOME = process.env.USERPROFILE = join(temporary, "home");
process.env.DSH_HOME = join(temporary, "dsh");
process.env.DSH_AGENTS_HOME = join(temporary, "agents");
process.env.DSH_CODEX_HOME = join(temporary, "codex");
const moduleUrl = name => process.env.DSH_LOADOUT_TEST_LIB ? pathToFileURL(join(process.env.DSH_LOADOUT_TEST_LIB, name + ".js")) : new URL("../lib/" + name + ".js", import.meta.url);
const core = await import(moduleUrl("core"));
const plugin = await import(moduleUrl("index"));
const ref = (name, root = "dsh") => ({ root, name });
const routes = new Map(), effects = [];
let invalidations = 0;
plugin.apply({
  connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } },
  skills: { registerProvider(factory) { factory({ invalidate() { invalidations++; }, signal: new AbortController().signal }); return () => {}; } },
  tools: { register() { return () => {}; } }, sessions: {},
  effect(fn) { const stop = fn(); if (typeof stop === "function") effects.push(stop); }, get() {}, on() { return () => {}; }, emit() {},
});
async function call(path, body, session = "session-a") {
  const response = await routes.get("/api/vlln/dsh-loadout" + path).fetch(new Request("http://localhost/api/vlln/dsh-loadout" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-dsh-skills-session": session, "x-dsh-loadout": "1", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  return { status: response.status, body: await response.json() };
}
try {
  for (const name of ["alpha", "beta", "gamma", "missing", "invalid"]) {
    const dir = join(process.env.DSH_HOME, "skills", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), name === "invalid" ? "No frontmatter" : `---\nname: ${name}\ndescription: Test\n---\nBody\n`);
  }
  const external = join(process.env.DSH_CODEX_HOME, "skills", "beta-other");
  await mkdir(external, { recursive: true });
  await writeFile(join(external, "SKILL.md"), "---\nname: beta\ndescription: Collision\n---\nOther\n");
  const create = async (name, members) => (await core.createLoadout(name, null, members)).loadout;
  const l1 = await create("L1", [ref("alpha"), ref("beta")]);
  const l2 = await create("L2", [ref("beta"), ref("gamma")]);
  const l3 = await create("L3", [ref("alpha")]);
  const before = JSON.parse(await readFile(core.managerStatePath(), "utf8"));
  before.sessionLoadouts = { "session-a": l1.id, "legacy-empty": "", "legacy-missing": "missing00" };
  before.activeLoadout = { user: l2.id };
  before.gatekeeper = false;
  await writeFile(core.managerStatePath(), JSON.stringify(before));
  const legacyBytes = await readFile(core.managerStatePath(), "utf8");
  assert.deepEqual((await core.sessionLoadoutView("session-a")).loadoutIds, [l1.id]);
  assert.deepEqual((await core.sessionLoadoutView("legacy-empty")).loadoutIds, []);
  assert.deepEqual((await core.sessionLoadoutView("legacy-missing")).loadoutIds, []);
  assert.equal(await readFile(core.managerStatePath(), "utf8"), legacyBytes, "legacy GET never writes migration");
  await core.setSessionLoadouts("session-a", [l1.id, l2.id, l1.id]);
  await core.setSessionLoadouts("session-b", [l3.id]);
  assert.deepEqual(JSON.parse(await readFile(core.managerStatePath(), "utf8")).sessionLoadouts["session-a"], [l1.id, l2.id]);
  let view = await core.sessionLoadoutView("session-a");
  assert.deepEqual(view.loadoutIds, [l1.id, l2.id]);
  assert.equal(view.loadoutId, null);
  assert.equal(view.effective.loadout, null);
  assert.deepEqual(view.effective.loadouts.map(item => item.id), [l1.id, l2.id]);
  assert.deepEqual(view.effective.skills, ["alpha", "beta", "gamma"]);
  assert.equal(view.effective.members.length, 3);
  assert.deepEqual(view.effective.members.find(item => item.name === "beta").loadoutIds, [l1.id, l2.id]);
  for (const endpoint of ["/state", "/loadouts"]) {
    const data = (await call(endpoint)).body.data;
    assert.equal(data.active, null);
    assert.deepEqual(data.activeIds, [l1.id, l2.id]);
  }
  const atomicBefore = await readFile(core.managerStatePath(), "utf8");
  for (const ids of [[l1.id, "missing00"], [l1.id, 42], [""], null, l1.id, {}, [null]]) {
    assert.equal((await core.setSessionLoadouts("session-a", ids)).ok, false);
    assert.equal(await readFile(core.managerStatePath(), "utf8"), atomicBefore);
  }
  for (const payload of [{ loadoutIds: [l1.id], loadoutId: null }, { loadoutIds: [false] }, { loadoutIds: null }]) {
    const count = invalidations;
    assert.equal((await call("/session-loadout", payload)).status, 400);
    assert.equal(invalidations, count);
  }
  const count = invalidations;
  assert.equal((await call("/session-loadout", { loadoutIds: [l2.id] })).status, 200);
  assert.ok(invalidations > count);
  assert.deepEqual((await core.sessionLoadoutView("session-a")).effective.skills, ["beta", "gamma"], "removing L1 retains shared beta");
  assert.deepEqual((await core.sessionLoadoutView("session-b")).loadoutIds, [l3.id]);
  await core.setSessionLoadouts("session-a", [l1.id, l2.id]);
  await core.updateLoadout(l1.id, "L1 edited", null, [ref("alpha"), ref("beta-other", "codex"), ref("missing"), ref("invalid")]);
  const missingPath = join(temporary, "dsh", "skills", "missing");
  assert.ok(missingPath.startsWith(temporary + "/"));
  await rm(missingPath, { recursive: true });
  view = await core.sessionLoadoutView("session-a");
  assert.equal(view.effective.members.find(item => item.name === "beta-other").status, "shadowed");
  assert.deepEqual(view.effective.members.find(item => item.name === "beta-other").loadoutIds, [l1.id]);
  assert.equal(view.effective.members.find(item => item.name === "missing").status, "missing");
  assert.equal(view.effective.members.find(item => item.name === "invalid").status, "invalid");
  const actual = (await core.listProviderCandidates({ sessionId: "session-a" })).filter(item => item.invocation.modelInvocable || item.invocation.userInvocable).map(item => item.name).sort();
  assert.deepEqual([...view.effective.skills].sort(), actual);
  const l4 = await create("Append", [ref("alpha")]);
  await core.setSessionLoadouts("session-a", [...view.loadoutIds, l4.id]);
  await core.deleteLoadout(l1.id);
  assert.deepEqual((await core.sessionLoadoutView("session-a")).loadoutIds, [l2.id, l4.id], "delete removes only target group");
  assert.deepEqual((await core.sessionLoadoutView("session-a")).effective.skills, ["beta", "gamma", "alpha"]);
  await core.setSessionLoadout("session-a", l4.id);
  assert.deepEqual((await core.sessionLoadoutView("session-a")).loadoutIds, [l4.id], "legacy singular setter replaces set");
  assert.equal((await core.sessionLoadoutView("session-a")).effective.loadout.id, l4.id);
  await core.setSessionLoadout("session-a", "");
  assert.deepEqual(JSON.parse(await readFile(core.managerStatePath(), "utf8")).sessionLoadouts["session-a"], []);
  assert.deepEqual((await core.sessionLoadoutView("session-a")).effective.skills, []);
  await core.deleteLoadout(l3.id);
  assert.deepEqual((await core.sessionLoadoutView("session-b")).loadoutIds, []);
  assert.equal((await core.createLoadout("Remote", null, [ref("not-installed", "remote:search")])).ok, false);
  console.log("multi-group session core and routes ok");
} finally {
  for (const stop of effects) stop();
  assert.ok(temporary.startsWith(join(tmpdir(), "loadout-multi-")));
  await rm(temporary, { recursive: true, force: true });
}
