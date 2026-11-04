// Creation-only defaults: source-aware awaited hook, atomic API, and historical-session isolation.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const temporary=await mkdtemp(join(tmpdir(),'loadout-defaults-'));
process.env.HOME=process.env.USERPROFILE=join(temporary,'home');process.env.DSH_HOME=join(temporary,'dsh');
const moduleUrl=name=>process.env.DSH_LOADOUT_TEST_LIB?pathToFileURL(join(process.env.DSH_LOADOUT_TEST_LIB,name+'.js')):new URL('../lib/'+name+'.js',import.meta.url);
const core=await import(moduleUrl('core')),plugin=await import(moduleUrl('index'));
const routes=new Map(),listeners=new Map(),effects=[];
const ctx={connection:{fetch:{register(route){routes.set(route.path,route);return()=>routes.delete(route.path);}}},skills:{registerProvider(){return()=>{};}},tools:{register(){return()=>{};}},sessions:{},get(){},emit(){},effect(fn){const stop=fn();if(typeof stop==='function')effects.push(stop);},on(event,fn){const list=listeners.get(event)||[];list.push(fn);listeners.set(event,list);return()=>list.splice(list.indexOf(fn),1);}};
plugin.apply(ctx);
const announce=async(id,source)=>{for(const handler of listeners.get('agent/created')||[])await handler({agent:{id,ctx:{}},source});};
const call=async(body,marker=true,method=body===undefined?'GET':'POST')=>{const response=await routes.get('/api/vlln/dsh-loadout/default-loadouts').fetch(new Request('http://localhost/api/vlln/dsh-loadout/default-loadouts',{method,headers:{'content-type':'application/json',...(marker?{'x-dsh-loadout':'1'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}));return{status:response.status,body:method==='HEAD'?null:await response.json()};};
try{
 const a=(await core.createLoadout('First',null,[])).loadout,b=(await core.createLoadout('Second',null,[])).loadout;
 assert.deepEqual((await call()).body.data,{loadoutIds:[]});
 assert.equal((await call({loadoutIds:[a.id,b.id,a.id]})).status,200);
 assert.deepEqual((await call()).body.data.loadoutIds,[a.id,b.id]);
 const before=await readFile(core.managerStatePath(),'utf8');
 for(const ids of [null,{},a.id,[''],[a.id,42],[a.id,'missing00']]){assert.equal((await call({loadoutIds:ids})).status,400);assert.equal(await readFile(core.managerStatePath(),'utf8'),before);}
 assert.equal((await call({loadoutIds:[]},false)).status,403);
 assert.equal((await call(undefined,true,'HEAD')).status,200);
 for(const source of ['resume','clear','compact',undefined]){await announce('historical-'+String(source),source);assert.deepEqual((await core.sessionLoadoutView('historical-'+String(source))).loadoutIds,[]);}
 assert.equal(await readFile(core.managerStatePath(),'utf8'),before,'historical reads and lifecycle announcements never initialize');
 await announce('fresh-one','startup');assert.deepEqual((await core.sessionLoadoutView('fresh-one')).loadoutIds,[a.id,b.id]);
 await call({loadoutIds:[b.id]});assert.deepEqual((await core.sessionLoadoutView('fresh-one')).loadoutIds,[a.id,b.id],'existing snapshot does not follow defaults');
 await announce('fresh-two','startup');assert.deepEqual((await core.sessionLoadoutView('fresh-two')).loadoutIds,[b.id]);
 await core.setSessionLoadouts('fresh-two',[]);await call({loadoutIds:[a.id]});await announce('fresh-two','startup');assert.deepEqual((await core.sessionLoadoutView('fresh-two')).loadoutIds,[],'explicit [] never reinitialized');
 await call({loadoutIds:[]});await announce('fresh-empty','startup');await call({loadoutIds:[a.id,b.id]});assert.deepEqual((await core.sessionLoadoutView('fresh-empty')).loadoutIds,[]);
 assert.ok(Object.hasOwn((await core.readManagerState()).state.sessionLoadouts,'fresh-empty'),'empty creation persists snapshot');
 const legacy=JSON.parse(await readFile(core.managerStatePath(),'utf8'));legacy.activeLoadout={user:b.id};await writeFile(core.managerStatePath(),JSON.stringify(legacy));
 assert.deepEqual((await core.sessionLoadoutView('old-no-key')).loadoutIds,[]);await announce('old-no-key','resume');assert.deepEqual((await core.sessionLoadoutView('old-no-key')).loadoutIds,[]);
 await core.deleteLoadout(a.id);assert.deepEqual((await call()).body.data.loadoutIds,[b.id]);assert.deepEqual((await core.sessionLoadoutView('fresh-one')).loadoutIds,[b.id]);
 assert.deepEqual((await core.readManagerState()).state.activeLoadout,{user:b.id},'legacy scope default remains inert and preserved');
 // Verify the installed public factory actually emits awaited startup (not resume).
 const runtimeRequire=createRequire(process.env.DSH_LOADOUT_RUNTIME_ROOT?resolve(process.env.DSH_LOADOUT_RUNTIME_ROOT,'package.json'):resolve(dirname(process.execPath),'../lib/node_modules/@deepseek-ai/dsh/package.json'));
 const load=name=>import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/'+name)).href);
 const [{Context},{AgentRegistry},{SessionStore},{SessionProjectionRegistry},{ToolRuntime},{LlmRuntime},{SystemPrompt},{AgentLoop}]=await Promise.all(['cordis','dsh-agent','dsh-session','dsh-session-projection','dsh-tools','dsh-llm','dsh-system-prompt','dsh-agent-loop'].map(load));
 const root=new Context(),fibers=[];let owner;const observed=[];
 try{
  for(const component of [AgentRegistry,SessionStore,SessionProjectionRegistry,LlmRuntime]){const fiber=root.plugin(component);fibers.push(fiber);await fiber.await();}
  for(const [component,config] of [[SystemPrompt,{includeHarnessIdentity:false,includeRuntimeContext:false}],[ToolRuntime,{}],[AgentLoop,{agents:[],maxParallelToolCalls:10}]]){const fiber=root.plugin(component,config);fibers.push(fiber);await fiber.await();}
  root.on('agent/created',async payload=>{observed.push(payload.source);await announce(payload.agent.id,payload.source);});
  owner=await root.agents.create({sessionId:'real-factory-new',agentOptions:{provider:'local-test',model:'local-test'}});
  assert.deepEqual(observed,['startup']);assert.deepEqual((await core.sessionLoadoutView('real-factory-new')).loadoutIds,[b.id],'factory waits for default snapshot before returning');
 }finally{await owner?.dispose();for(const fiber of fibers.reverse())await fiber.dispose();}
 console.log('Creation-only default groups: atomic API, snapshots, historical empty/explicit clears, deletion, real awaited factory startup passed');
}finally{for(const stop of effects.reverse())stop();assert.ok(temporary.startsWith(tmpdir()));await rm(temporary,{recursive:true,force:true});}
