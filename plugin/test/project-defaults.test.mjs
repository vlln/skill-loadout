import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const temp = await mkdtemp(join(tmpdir(), 'loadout-project-defaults-'));
process.env.HOME = process.env.USERPROFILE = join(temp, 'home');
process.env.DSH_HOME = join(temp, 'dsh');
process.env.DSH_AGENTS_HOME = join(temp, 'agents');
process.env.DSH_CODEX_HOME = join(temp, 'codex');
const moduleUrl = name => process.env.DSH_LOADOUT_TEST_LIB ? pathToFileURL(join(process.env.DSH_LOADOUT_TEST_LIB, name + '.js')) : new URL('../lib/' + name + '.js', import.meta.url);
const core = await import(moduleUrl('core'));
const plugin = await import(moduleUrl('index'));
const ref = (root, name) => ({ root, name });
async function skill(root, folder, name = folder, valid = true) {
  const path = join(root, folder);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'SKILL.md'), valid ? `---\nname: ${name}\ndescription: Test\n---\nBody\n` : 'Broken');
  return path;
}
const a = join(temp, 'project-a'), b = join(temp, 'project-b');
const sessionId = 'project-session';
const options = { sessionId, projectCwds: [a] };
const stops = [];
try {
  for (const project of [a, b]) await mkdir(join(project, '.git'), { recursive: true });
  const globalPath = await skill(join(process.env.DSH_HOME, 'skills'), 'global-only');
  await skill(join(a, '.dsh', 'skills'), 'project-alpha');
  await skill(join(a, '.codex', 'skills'), 'project-beta');
  await skill(join(a, '.dsh', 'skills'), 'broken', 'broken', false);
  await skill(join(b, '.dsh', 'skills'), 'other-project');
  const roots = await core.projectRoots([a]);
  const dshRoot = roots.find(root => root.kind === 'project-dsh');
  const codexRoot = roots.find(root => root.kind === 'project-codex');
  let view = await core.sessionLoadoutView(sessionId, options);
  assert.deepEqual(view.loadoutIds, []);
  assert.equal(view.effective.source, 'none', 'source describes group selections, not project defaults');
  assert.deepEqual([...view.effective.skills].sort(), ['project-alpha', 'project-beta']);
  assert.ok(view.effective.members.every(member => member.projectDefault && member.loadoutIds.length === 0));
  assert.equal(view.effective.members.find(member => member.name === 'broken').status, 'invalid');
  assert.deepEqual((await core.sessionLoadoutView(null, options)).effective.skills, [], 'no session identity has no project defaults');
  assert.equal((await core.state(options)).summary.enabled, 2);
  const alpha = ref(dshRoot.key, 'project-alpha');
  assert.equal((await core.createLoadout('Rejected project', null, [alpha], undefined, options)).code, 'error.loadout.globalOnly');
  const selected = (await core.createLoadout('Global', null, [ref('dsh', 'global-only')], undefined, options)).loadout;
  const beforeProjectMutation = await readFile(core.managerStatePath(), 'utf8');
  assert.equal((await core.updateLoadout(selected.id, selected.name, null, [alpha], undefined, options)).code, 'error.loadout.globalOnly');
  assert.equal((await core.addToLoadout(selected.id, alpha.root, alpha.name, undefined, options)).code, 'error.loadout.globalOnly');
  assert.equal(await readFile(core.managerStatePath(), 'utf8'), beforeProjectMutation, 'project member rejection is atomic');
  // Preserve historical references on disk, but they contribute no group membership.
  const oldState = JSON.parse(beforeProjectMutation);oldState.loadouts.find(group => group.id === selected.id).members.push(alpha);
  await writeFile(core.managerStatePath(), JSON.stringify(oldState));
  assert.equal((await core.createLoadout('Rejected copy', null, [alpha], undefined, options, selected.id)).code, 'error.loadout.globalOnly');
  await core.setSessionLoadouts(sessionId, [selected.id]);
  await core.setSessionSkillExclusions(sessionId, [alpha, alpha], undefined, options);
  view = await core.sessionLoadoutView(sessionId, options);
  assert.deepEqual(view.excludedSkills, [alpha]);
  assert.equal(view.effective.members.find(member => member.name === 'project-alpha').status, 'excluded');
  assert.deepEqual(view.effective.members.find(member => member.name === 'project-alpha').loadoutIds, [], 'old project references never contribute group membership');
  assert.deepEqual([...view.effective.skills].sort(), ['global-only', 'project-beta']);
  assert.ok((await core.sessionLoadoutView('other-session', options)).effective.skills.includes('project-alpha'), 'session isolation');
  const stored = await readFile(core.managerStatePath(), 'utf8');
  for (const bad of [null, {}, ['alpha'], [ref('remote:search', 'not-installed')], [ref('dsh', '../escape')]]) {
    assert.equal((await core.setSessionSkillExclusions(sessionId, bad, undefined, options)).ok, false);
    assert.equal(await readFile(core.managerStatePath(), 'utf8'), stored, 'invalid replacement is atomic');
  }
  await core.setSessionSkillExclusions(sessionId, [alpha], undefined, { projectCwds: [b] });
  assert.ok((await core.sessionLoadoutView(sessionId, { projectCwds: [b] })).effective.skills.includes('other-project'));
  assert.equal((await core.sessionLoadoutView(sessionId, options)).effective.members.find(member => member.name === 'project-alpha').status, 'excluded', 'exclusion survives cwd changes');
  await core.setSessionSkillExclusions(sessionId, [], undefined, options);
  assert.ok((await core.sessionLoadoutView(sessionId, options)).effective.skills.includes('project-alpha'));

  // Aliases of one real file cannot bypass a source-specific exclusion.
  await symlink(globalPath, join(codexRoot.path, 'global-alias'), 'dir');
  const alias = ref(codexRoot.key, 'global-alias');
  await core.setSessionSkillExclusions(sessionId, [alias], undefined, options);
  view = await core.sessionLoadoutView(sessionId, options);
  assert.equal(view.effective.skills.includes('global-only'), false);
  assert.deepEqual(view.effective.members.find(member => member.name === 'global-only').excludedBy, [alias]);
  assert.ok(view.effective.members.filter(member => ['global-only', 'global-alias'].includes(member.name)).every(member => member.status === 'excluded'));
  const candidates = await core.listProviderCandidates({ sessionId, cwd: a });
  assert.equal(candidates.find(item => item.name === 'global-only').invocation.modelInvocable, false);
  assert.deepEqual(candidates.filter(item => item.invocation.modelInvocable || item.invocation.userInvocable).map(item => item.name).sort(), [...view.effective.skills].sort());
  await core.setSessionLoadouts(sessionId, []);
  assert.ok((await core.sessionLoadoutView(sessionId, options)).effective.skills.includes('project-alpha'), 'clear groups keeps project defaults');

  // Host route uses committed cwd, not immutable original session header.
  let cwd = a, invalidations = 0;
  const session = { id: sessionId, header: { id: sessionId, cwd: a } };
  const routes = new Map();
  const ctx = {
    sessions: { get: id => id === sessionId ? session : undefined, list: () => [session] },
    get: key => key === 'workingDirectory' ? { get: () => cwd } : undefined,
    connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } },
    skills: { registerProvider(factory) { factory({ invalidate() { invalidations++; }, signal: new AbortController().signal }); return () => {}; } },
    tools: { register() { return () => {}; } }, on() { return () => {}; }, emit() {}, effect(fn) { const stop = fn(); if (typeof stop === 'function') stops.push(stop); },
  };
  plugin.apply(ctx);
  async function request(path, body, marker = true) {
    const response = await routes.get('/api/vlln/dsh-loadout' + path).fetch(new Request('http://localhost/api/vlln/dsh-loadout' + path, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-dsh-skills-session': sessionId, ...(marker ? { 'x-dsh-loadout': '1' } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    return { status: response.status, data: await response.json() };
  }
  cwd = b;
  assert.deepEqual(plugin.activeSessionCwds(ctx, sessionId), [b]);
  assert.deepEqual((await request('/session-loadout')).data.data.effective.skills, ['other-project']);
  const bRoot = (await core.projectRoots([b])).find(root => root.kind === 'project-dsh');
  const exclusions = [alias, ref(bRoot.key, 'other-project')];
  assert.equal((await request('/session-skill-exclusions', { excludedSkills: exclusions }, false)).status, 403);
  const before = invalidations;
  const updated = await request('/session-skill-exclusions', { excludedSkills: exclusions });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.data.data, { sessionId, excludedSkills: exclusions });
  assert.ok(invalidations > before);
  assert.deepEqual((await request('/session-loadout')).data.data.effective.skills, []);
  console.log('project defaults, exclusions, aliases and committed cwd routes ok');
} finally {
  for (const stop of stops) stop();
  assert.ok(temp.startsWith(join(tmpdir(), 'loadout-project-defaults-')));
  await rm(temp, { recursive: true, force: true });
}
