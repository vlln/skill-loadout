// 会话级编组路由：GET /session-loadout 的形状、POST 的变更头校验（负控 403）、
// 写覆盖 / 写显式空 / 清除覆盖（回落 scope），以及请求头会话来源的兜底。
// 核心语义（覆盖优先、悬空容忍等）在 loadout.test.mjs；这里只管 HTTP 形状。
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporary = await mkdtemp(join(tmpdir(), "dssm-session-routes-"));
process.env.DSH_HOME = join(temporary, "dsh");
process.env.DSH_AGENTS_HOME = join(temporary, "agents");
process.env.DSH_CODEX_HOME = join(temporary, "codex");
process.env.HOME = process.env.USERPROFILE = join(temporary, "user");

const skillDirectory = join(process.env.DSH_HOME, "skills", "alpha");
await mkdir(skillDirectory, { recursive: true });
await writeFile(join(skillDirectory, "SKILL.md"), "---\nname: alpha\ndescription: 测试技能\n---\n正文\n");
await mkdir(join(process.env.DSH_HOME, "skills", "beta"), { recursive: true });
await writeFile(join(process.env.DSH_HOME, "skills", "beta", "SKILL.md"), "---\nname: beta\ndescription: 测试技能\n---\n正文\n");

const plugin = await import("../lib/index.js");

const prefix = "/api/vlln/dsh-loadout";
const routes = new Map();
const effects = [];
const ctx = {
  connection: {
    fetch: {
      register(route) {
        if (routes.has(route.path)) throw new Error(`duplicate route: ${route.path}`);
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
  },
  skills: { registerProvider() { return () => {}; } },
  tools: { register() { return () => {}; } },
  sessions: {},
  effect(fn) { const cleanup = fn(); if (typeof cleanup === "function") effects.push(cleanup); return cleanup; },
  get() {},
  on() { return () => {}; },
  emit() {},
};

plugin.apply(ctx);

const sessionId = "session-12345678-1234-4123-8123-123456789abc";
const otherSession = "session-87654321-4321-4321-8321-cba987654321";
const mutationHeaders = { "content-type": "application/json", "x-dsh-loadout": "1" };

async function call(path, options) {
  const route = routes.get(prefix + path.split("?")[0]);
  assert.ok(route, `route exists: ${path}`);
  const response = await route.fetch(new Request("http://localhost" + prefix + path, options));
  return { status: response.status, body: await response.json() };
}
const post = (path, body, headers = mutationHeaders) => call(path, { method: "POST", headers, body: JSON.stringify(body) });

try {
  // ── GET 形状：未选会话回落到 scope（这里还没有 activeLoadout → none）─────────
  const empty = await call(`/session-loadout?sessionId=${encodeURIComponent(sessionId)}`);
  assert.equal(empty.status, 200);
  assert.equal(empty.body.ok, true);
  const data = empty.body.data;
  assert.deepEqual(
    Object.keys(data).sort(),
    ["effective", "gatekeeper", "loadoutId", "scope", "sessionId"],
    "GET 返回契约字段（含 scope/gatekeeper 两个附加字段）",
  );
  assert.equal(data.sessionId, sessionId, "回显会话 id");
  assert.equal(data.loadoutId, null, "未选会话没有覆盖值");
  assert.equal(data.effective.source, "none");
  assert.equal(data.effective.loadout, null);
  assert.deepEqual(data.effective.skills, []);
  assert.equal(data.scope, "user");
  assert.equal(data.gatekeeper, true, "守门人默认开");

  // ── POST 变更头校验：缺少 x-dsh-loadout 标记头 → 403 ─────────────────────────
  const forbidden = await post("/session-loadout", { sessionId, loadoutId: "" }, { "content-type": "application/json" });
  assert.equal(forbidden.status, 403, "缺变更头的 POST 被拒绝");
  assert.equal(forbidden.body.code, "error.proto.forbidden");

  // ── 参数负控：非法会话 id / 不存在的编组 ─────────────────────────────────────
  const badSession = await post("/session-loadout", { sessionId: "bad session!", loadoutId: "" });
  assert.equal(badSession.status, 400);
  assert.equal(badSession.body.code, "error.session.invalid");
  const missingSession = await post("/session-loadout", { loadoutId: "" });
  assert.equal(missingSession.status, 400, "没有 sessionId 也没有请求头会话 → 拒绝");
  assert.equal(missingSession.body.code, "error.session.invalid");
  const wrongType = await post("/session-loadout", { sessionId, loadoutId: 42 });
  assert.equal(wrongType.status, 400);
  assert.equal(wrongType.body.code, "error.proto.invalidParams", "loadoutId 类型错误按参数错误拒绝");
  const unknownLoadout = await post("/session-loadout", { sessionId, loadoutId: "missing00" });
  assert.equal(unknownLoadout.status, 400);
  assert.equal(unknownLoadout.body.code, "error.loadout.notFound");

  // ── 写覆盖 → GET 生效；显式空 → 不加载；null → 清除覆盖回落 scope ────────────
  const created = await post("/loadout-create", { name: "会话组", members: [{ root: "dsh", name: "alpha" }] });
  assert.equal(created.status, 200);
  const loadoutId = created.body.data.loadout.id;

  const selected = await post("/session-loadout", { sessionId, loadoutId });
  assert.equal(selected.status, 200);
  assert.deepEqual(selected.body.data, { sessionId, loadoutId, cleared: false });
  const afterSelect = (await call(`/session-loadout?sessionId=${encodeURIComponent(sessionId)}`)).body.data;
  assert.equal(afterSelect.loadoutId, loadoutId);
  assert.equal(afterSelect.effective.source, "session");
  assert.equal(afterSelect.effective.loadout.id, loadoutId);
  assert.deepEqual(afterSelect.effective.skills, ["alpha"], "生效技能清单按会话编组解析");

  // 只影响本会话：另一个会话仍然回落到 scope。
  const other = (await call(`/session-loadout?sessionId=${encodeURIComponent(otherSession)}`)).body.data;
  assert.equal(other.loadoutId, null);
  assert.equal(other.effective.source, "none");

  const explicitNone = await post("/session-loadout", { sessionId, loadoutId: "" });
  assert.equal(explicitNone.status, 200);
  assert.equal(explicitNone.body.data.loadoutId, "", "显式空串表示不加载");
  const afterNone = (await call(`/session-loadout?sessionId=${encodeURIComponent(sessionId)}`)).body.data;
  assert.equal(afterNone.loadoutId, "");
  assert.equal(afterNone.effective.source, "none");
  assert.deepEqual(afterNone.effective.skills, []);

  // scope 设为它之后清除会话覆盖 → 回落到 scope 的 activeLoadout。
  const applied = await post("/loadout-apply", { id: loadoutId, exclusive: false });
  assert.equal(applied.status, 200);
  const cleared = await post("/session-loadout", { sessionId, loadoutId: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.data.loadoutId, null);
  assert.equal(cleared.body.data.cleared, true);
  const afterClear = (await call(`/session-loadout?sessionId=${encodeURIComponent(sessionId)}`)).body.data;
  assert.equal(afterClear.loadoutId, null);
  assert.equal(afterClear.effective.source, "scope", "清除覆盖后回落到 scope");
  assert.deepEqual(afterClear.effective.skills, ["alpha"]);

  // ── 请求头会话来源：GET 不带 ?sessionId= 时用 x-dsh-skills-session ───────────
  await post("/session-loadout", { sessionId, loadoutId: "" });
  const byHeader = (await call("/session-loadout", { method: "GET", headers: { "x-dsh-skills-session": sessionId } })).body.data;
  assert.equal(byHeader.sessionId, sessionId, "缺省查询参数时回落到请求头会话");
  assert.equal(byHeader.loadoutId, "");
  const postByHeader = await post("/session-loadout", { loadoutId: loadoutId }, {
    "content-type": "application/json",
    "x-dsh-loadout": "1",
    "x-dsh-skills-session": sessionId,
  });
  assert.equal(postByHeader.status, 200, "请求体缺 sessionId 时回落到请求头");
  assert.equal(postByHeader.body.data.loadoutId, loadoutId);

  // ── 非法会话 id 的 GET 视为未选，不报错 ─────────────────────────────────────
  const invalidGet = await call("/session-loadout?sessionId=" + encodeURIComponent("bad session!"));
  assert.equal(invalidGet.status, 200);
  assert.equal(invalidGet.body.data.sessionId, null);
  assert.equal(invalidGet.body.data.loadoutId, null);
  assert.equal(invalidGet.body.data.effective.source, "scope", "非法会话 id 视为未选，回落到 scope");
  assert.equal(invalidGet.body.data.loadoutId, null);

  console.log("session-loadout routes ok");
} finally {
  for (const cleanup of effects) cleanup();
  await rm(temporary, { recursive: true, force: true });
}
