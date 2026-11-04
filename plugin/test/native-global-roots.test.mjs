// Native Agent home overrides and Codex bundled discovery; synthetic HOME only.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const temp = await mkdtemp(join(tmpdir(), 'loadout-native-roots-'));
const keys = ['HOME','USERPROFILE','DSH_HOME','DSH_AGENTS_HOME','DSH_CODEX_HOME','DSH_CLAUDE_HOME','CODEX_HOME','CLAUDE_CONFIG_DIR'];
const previous = Object.fromEntries(keys.map(key=>[key,process.env[key]]));
try {
  for (const key of keys) delete process.env[key];
  process.env.HOME=join(temp,'home'); process.env.USERPROFILE=process.env.HOME;
  process.env.DSH_HOME=join(temp,'dsh');
  const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/core.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false});
  const module={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const {userRoots,scanEntries,setRootPath,state}=module.exports;
  const root=key=>userRoots().find(item=>item.key===key);
  assert.equal(root('codex').path,join(temp,'home/.codex/skills'));
  assert.equal(root('claude').path,join(temp,'home/.claude/skills'));
  assert.equal(root('agents').path,join(temp,'home/.agents/skills'));
  process.env.CODEX_HOME=join(temp,'native codex');process.env.CLAUDE_CONFIG_DIR=join(temp,'native claude');
  assert.equal(root('codex').path,join(process.env.CODEX_HOME,'skills'));
  assert.equal(root('claude').path,join(process.env.CLAUDE_CONFIG_DIR,'skills'));
  assert.equal(root('agents').path,join(temp,'home/.agents/skills'),'CODEX_HOME does not relocate shared user skills');
  process.env.DSH_CODEX_HOME=join(temp,'compat-codex');process.env.DSH_CLAUDE_HOME=join(temp,'compat-claude');
  assert.equal(root('codex').path,join(process.env.DSH_CODEX_HOME,'skills'));
  assert.equal(root('claude').path,join(process.env.DSH_CLAUDE_HOME,'skills'));
  process.env.DSH_CODEX_HOME='';process.env.DSH_CLAUDE_HOME='';
  assert.equal(root('codex').path,join(process.env.CODEX_HOME,'skills'));
  assert.equal(root('claude').path,join(process.env.CLAUDE_CONFIG_DIR,'skills'));
  const skill=async(directory,name)=>{await mkdir(join(directory,name),{recursive:true});await writeFile(join(directory,name,'SKILL.md'),`---\nname: ${name}\ndescription: Fixture ${name}\n---\nBody`);};
  const selected=join(temp,'selected skills');await skill(selected,'user-skill');
  await skill(join(selected,'.system'),'bundled-skill');
  await skill(join(selected,'.system','.hidden'),'secret-skill');
  await skill(join(selected,'.trash'),'trashed-skill');
  assert.equal((await setRootPath('codex',selected)).ok,true);
  assert.equal(root('codex').path,selected,'saved override wins native and compatibility env');
  assert.equal(root('codexSystem').path,join(selected,'.system'),'bundled root follows final selected skills directory');
  assert.equal(root('codexSystem').mutable,false);
  assert.equal(root('codexSystem').native,false);
  assert.deepEqual((await scanEntries(root('codex'))).entries.map(e=>e.name),['user-skill']);
  assert.deepEqual((await scanEntries(root('codexSystem'))).entries.map(e=>e.name),['bundled-skill'],'only designated root bypasses hidden ancestor, not hidden descendants');
  assert.equal((await setRootPath('codexSystem',selected)).ok,false,'derived system root has no independent persisted override');
  await mkdir(join(temp,'home/.agents/skills'),{recursive:true});
  await symlink(join(selected,'.system/bundled-skill'),join(temp,'home/.agents/skills/shared-bundled'),'dir');
  const snapshot=await state();
  const aliases=snapshot.roots.flatMap(r=>r.skills).filter(s=>s.declaredName==='bundled-skill');
  assert.equal(aliases.length,1,'shared and bundled aliases retain physical deduplication');
  await setRootPath('codex',null);
  assert.equal(root('codexSystem').path,join(process.env.CODEX_HOME,'skills/.system'));
  console.log('native global roots: env precedence, derived readonly bundled roots, hidden filtering and alias dedup passed');
} finally {
  for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
  // The absolute temporary path was created above for this test only.
  assert.ok(temp.startsWith(join(tmpdir(),'loadout-native-roots-')));
  await rm(temp,{recursive:true,force:true});
}
