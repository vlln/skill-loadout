// HTTP session context, mutation protection, atomic drafts, migration and invalidation.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const temporary = await mkdtemp(join(tmpdir(), "loadout-session-routes-"));
process.env.HOME = process.env.USERPROFILE = join(temporary, "user");
process.env.DSH_HOME = join(temporary, "dsh");
process.env.DSH_AGENTS_HOME = join(temporary, "agents");
process.env.DSH_CODEX_HOME = join(temporary, "codex");
for (const name of ["alpha", "beta"]) {
  await mkdir(join(process.env.DSH_HOME, "skills", name), { recursive: true });
  await writeFile(join(process.env.DSH_HOME, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: Test\n---\nBody\n`);
}
const plugin = await import(process.env.DSH_LOADOUT_TEST_LIB ? pathToFileURL(join(process.env.DSH_LOADOUT_TEST_LIB, "index.js")) : "../lib/index.js");
const core = await import(process.env.DSH_LOADOUT_TEST_LIB ? pathToFileURL(join(process.env.DSH_LOADOUT_TEST_LIB, "core.js")) : "../lib/core.js");
const routes = new Map();
const effects = [];
let invalidated = 0;
let registeredProvider;
const ctx = {
  connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } },
  skills: { registerProvider(factory) { registeredProvider = factory({ invalidate() { invalidated++; }, signal: new AbortController().signal }); return () => {}; } },
  tools: { register() { return () => {}; } }, sessions: {},
  effect(fn) { const stop = fn(); if (typeof stop === "function") effects.push(stop); },
  get() {}, on() { return () => {}; }, emit() {},
};
plugin.apply(ctx);
const headers = { "content-type": "application/json", "x-dsh-loadout": "1" };
async function call(path, options) {
  const response = await routes.get("/api/vlln/dsh-loadout" + path.split("?")[0]).fetch(new Request("http://localhost/api/vlln/dsh-loadout" + path, options));
  return { status: response.status, body: await response.json() };
}
const post = (path, body, custom = headers) => call(path, { method: "POST", headers: custom, body: JSON.stringify(body) });
const get = async (path, sessionId) => (await call(path, { headers: sessionId ? { "x-dsh-skills-session": sessionId } : {} })).body.data;
async function changed(path, body) {
  const before = invalidated;
  const result = await post(path, body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(invalidated > before, `invalidate after ${path}`);
  return result.body.data;
}
try {
  for (const candidate of await registeredProvider.list()) {
    assert.equal(candidate.provider, registeredProvider.name, "runtime requires candidate provider identity to match registration");
    const skill = await registeredProvider.get(candidate);
    assert.equal(skill.provider, registeredProvider.name);
  }
  const empty = await get("/session-loadout?sessionId=a");
  assert.equal(empty.effective.source, "none");
  assert.deepEqual(empty.effective.members, []);
  assert.equal((await post("/loadout-update", {}, { "content-type": "application/json" })).status, 403);
  assert.equal((await post("/loadout-import-legacy", {}, { "content-type": "application/json" })).status, 403);
  assert.equal((await post("/session-loadout", { loadoutId: "" })).status, 400);
  assert.equal((await post("/session-loadout", { sessionId: "bad session", loadoutId: null })).status, 400);
  assert.equal((await post("/session-loadout", { sessionId: "a", loadoutId: 42 })).status, 400);
  assert.equal((await post("/loadout-update", null)).status, 400);
  const a = (await changed("/loadout-create", { name: "A", members: [{ root: "dsh", name: "alpha" }] })).loadout;
  const b = (await changed("/loadout-create", { name: "B", members: [{ root: "dsh", name: "beta" }] })).loadout;
  await changed("/session-loadout", { sessionId: "a", loadoutId: a.id });
  await changed("/session-loadout", { sessionId: "b", loadoutId: b.id });
  for (const path of ["/state", "/loadouts"]) {
    assert.equal((await get(path, "a")).active, a.id);
    assert.equal((await get(path + "?sessionId=b", "a")).active, b.id, "query session takes same precedence on every GET");
  }
  assert.deepEqual((await get("/session-loadout", "a")).effective.skills, ["alpha"]);
  assert.equal((await get("/state", "a")).summary.total, 2);
  const beforeFailure = await readFile(core.managerStatePath(), "utf8");
  const beforeInvalidate = invalidated;
  assert.equal((await post("/loadout-update", { id: a.id, name: "Should not save", note: "draft", members: [{ root: "dsh", name: "missing" }] })).status, 400);
  assert.equal(await readFile(core.managerStatePath(), "utf8"), beforeFailure);
  assert.equal(invalidated, beforeInvalidate, "failed draft does not emit successful invalidation");
  await changed("/loadout-update", { id: a.id, name: "A updated", note: "complete", members: [{ root: "dsh", name: "beta" }] });
  assert.deepEqual((await get("/session-loadout", "a")).effective.skills, ["beta"]);
  await changed("/loadout-rename", { id: a.id, name: "A renamed" });
  await changed("/loadout-note", { id: a.id, note: "changed" });
  await changed("/loadout-add", { id: a.id, root: "dsh", name: "alpha" });
  await changed("/loadout-remove", { id: a.id, root: "dsh", name: "alpha" });
  for (const path of ["/enable", "/disable", "/skill-reference", "/source-enable", "/source-disable", "/category-enable", "/category-disable", "/loadout-toggle", "/gatekeeper", "/loadout-apply"]) {
    const result = await post(path, { id: a.id, root: "dsh", name: "alpha", enabled: true });
    assert.equal(result.status, 400, path);
    assert.equal(result.body.code, "error.policy.sessionOnly", path);
  }
  await changed("/loadout-apply", { id: a.id, sessionId: "a" });
  assert.equal((await get("/loadouts", "b")).active, b.id);
  await changed("/session-loadout", { sessionId: "a", loadoutId: "" });
  assert.equal((await get("/session-loadout", "a")).loadoutId, null);
  assert.deepEqual((await get("/session-loadout", "a")).effective.skills, []);
  await changed("/session-loadout", { sessionId: "a", loadoutId: null });
  assert.equal((await get("/loadouts", "a")).active, null);
  assert.equal((await post("/loadout-import-legacy", { name: "No references" })).status, 400);
  const raw = JSON.parse(await readFile(core.managerStatePath(), "utf8"));
  raw.enabledSkills.dsh = ["alpha"];
  raw.gatekeeper = false;
  raw.activeLoadout = { user: a.id };
  await writeFile(core.managerStatePath(), JSON.stringify(raw));
  const imported = (await changed("/loadout-import-legacy", { name: "Legacy" })).loadout;
  assert.deepEqual(imported.members, [{ root: "dsh", name: "alpha" }]);
  assert.equal((await get("/loadouts", "a")).active, null);
  assert.equal((await get("/loadouts")).migration.hasLegacyPolicy, true);
  assert.equal((await get("/gatekeeper")).enabled, true);
  await changed("/loadout-delete", { id: b.id });
  assert.deepEqual((await get("/session-loadout", "b")).effective.skills, []);
  assert.equal((await get("/session-loadout?sessionId=bad%20id")).effective.source, "none");
  console.log("session-first loadout routes ok");
} finally {
  for (const stop of effects) stop();
  assert.ok(temporary.startsWith(join(tmpdir(), "loadout-session-routes-")));
  await rm(temporary, { recursive: true, force: true });
}
