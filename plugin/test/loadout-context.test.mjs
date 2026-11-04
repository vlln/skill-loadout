// Loadout no longer publishes its own context. Exercise the public native skill catalog.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const qa=await mkdtemp(join(tmpdir(),'loadout-native-catalog-'));
process.env.HOME=process.env.USERPROFILE=join(qa,'user');
process.env.DSH_HOME=join(qa,'dsh');process.env.DSH_AGENTS_HOME=join(qa,'agents');
const plugin=await import('../lib/index.js');
const core=await import('../lib/core.js');
const nativeRequire=createRequire(process.env.DSH_LOADOUT_RUNTIME_ROOT?resolve(process.env.DSH_LOADOUT_RUNTIME_ROOT,'package.json'):resolve(dirname(process.execPath),'../lib/node_modules/@deepseek-ai/dsh/package.json'));
const load=name=>import(pathToFileURL(nativeRequire.resolve('@deepseek-ai/'+name)).href);
const [{Context},{SkillRegistry},{createScope},toolmod]=await Promise.all(['cordis','dsh-skill','dsh-scope','dsh-tool-skill'].map(load));

try {
await test('host wiring has no custom prompt dependency or registration',async()=>{
 const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
 assert.ok(!plugin.inject.includes('systemPrompt'));
 assert.ok(plugin.inject.includes('workingDirectory'),'current session cwd still needs native workingDirectory');
 assert.doesNotMatch(source,/installLoadoutContext|systemPrompt\.context|loadout:configuration/);
});
await test('real registry invalidation drives native catalog on next pre-step, not plugin runtime context',async()=>{
 await mkdir(join(process.env.DSH_HOME,'skills','alpha'),{recursive:true});
 await writeFile(join(process.env.DSH_HOME,'skills','alpha','SKILL.md'),'---\nname: alpha\ndescription: Original description\n---\nAlpha body\n');
 const made=await core.createLoadout('Research',null,[{root:'dsh',name:'alpha'}]);assert.ok(made.loadout);
 const root=new Context(),registry=root.plugin(SkillRegistry);await registry.await();
 let run;
 const harness=root.plugin({name:'native-catalog-regression',inject:['skills'],apply(host){
  const agent={id:'catalog-session',session:{seq:0,surface:{nodes:[]},eventAt(){throw new Error('no retained events');}}};
  const scope=createScope(host,agent),scopedAgents=[agent],routes=new Map(),effects=[],listeners=new Map();
  const eventLog=[];let promptRegistrations=0,tool,providerDisposals=0;
  const ctx={skills:host.skills,sessions:{list:()=>[]},get(name){if(name==='agents')return {list:()=>scopedAgents};if(name==='sessions')return this.sessions;if(name==='workingDirectory')return {get:()=>qa};},
   agents:{list:()=>scopedAgents},workingDirectory:{get:()=>qa,ensure:async()=>qa},systemPrompt:{context(){promptRegistrations++;assert.fail('loadout must not register prompt context');}},
   connection:{fetch:{register(route){routes.set(route.path,route);return()=>routes.delete(route.path);}}},
   effect(fn){const stop=fn();if(typeof stop==='function')effects.push(stop);},on(name,fn){const list=listeners.get(name)||[];list.push(fn);listeners.set(name,list);return()=>listeners.set(name,list.filter(x=>x!==fn));},emit:(...args)=>eventLog.push(args),logger:{warn(){}}};
  agent.ctx=scope.ctx;
  plugin.apply(ctx);
  const nativeHooks=[];
  const nativeSnapshots=[];
  toolmod.apply({skills:{snapshot:async options=>{const value=await host.skills.snapshot(options);nativeSnapshots.push(value);return value;},list:options=>host.skills.list(options),get:(name,options)=>host.skills.get(name,options)},tools:{register(value){tool=value;},get:()=>tool},workingDirectory:{ensure:async()=>qa},on(event,fn){assert.equal(event,'agent/pre-step');nativeHooks.push(fn);}});
  const nativeStep=async(messages=[])=>{
   const signal=new AbortController().signal,payload={agent,messages,signal};assert.equal(nativeHooks.length,2);
   const dispatch=async i=>i===nativeHooks.length?{kind:'accept',messages}:nativeHooks[i](payload,()=>dispatch(i+1));
   return dispatch(0);
  };

  const post=async(path,body)=>{
   const route=routes.get('/api/vlln/dsh-loadout'+path);assert.ok(route,path);
   const response=await route.fetch(new Request('http://localhost/api/vlln/dsh-loadout'+path,{method:'POST',headers:{'content-type':'application/json','x-dsh-loadout':'1'},body:JSON.stringify(body)}));
   const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;
  };
  const catalogs=decision=>decision.messages.filter(m=>m.source?.kind==='skill-catalog');
  run=async()=>{
   try{
    assert.equal(promptRegistrations,0);
    await post('/session-loadout',{sessionId:agent.id,loadoutIds:[made.loadout.id]});
    const initial=await nativeStep();const catalog=catalogs(initial)[0];assert.ok(catalog,JSON.stringify({initial,skills:await host.skills.snapshot({cwd:qa,scope:agent}),view:await core.sessionLoadoutView(agent.id,{cwd:qa})}));
    assert.deepEqual(catalog.source.entries.map(x=>x.name),['alpha']);assert.match(catalog.content[0].text,/Original description/);
    assert.equal(catalogs(await nativeStep(initial.messages)).length,1,'same pending catalog is not duplicated');
    const events=[{seq:0,type:'user/message',data:catalog}];agent.session.seq=1;agent.session.surface.nodes=[0];agent.session.eventAt=i=>events[i];
    assert.equal(catalogs(await nativeStep()).length,0,'same visible durable catalog is not republished');
    await post('/session-loadout',{sessionId:agent.id,loadoutIds:[]});
    assert.equal(catalog.source.entries.length,1,'already-admitted catalog message is not retroactively mutated');
    const clearedDecision=await nativeStep();const cleared=catalogs(clearedDecision)[0];assert.ok(cleared,JSON.stringify({nativeSnapshots,clearedDecision,snapshot:await host.skills.snapshot({cwd:qa,scope:agent}),view:await core.sessionLoadoutView(agent.id,{cwd:qa})}));assert.ok(cleared.source.update);assert.deepEqual(cleared.source.entries,[]);
    await assert.rejects(()=>tool.execute({name:'alpha'},{agent,signal:new AbortController().signal}),/not available|unknown/);
    await post('/session-loadout',{sessionId:agent.id,loadoutIds:[made.loadout.id]});
    await writeFile(join(process.env.DSH_HOME,'skills','alpha','SKILL.md'),'---\nname: alpha\ndescription: Updated description\n---\nAlpha body\n');
    // Same public invalidation mechanism used by successful writes, no prompt mutation.
    plugin.notifyChatCatalog(ctx,()=>{for(const invalidate of invalidators)invalidate();});
    const updated=catalogs(await nativeStep())[0];assert.match(updated.content[0].text,/Updated description/);
    const loaded=await tool.execute({name:'alpha'},{agent,signal:new AbortController().signal});assert.equal(loaded.name,'alpha');
    agent.session.surface.nodes=[];
    const restored=catalogs(await nativeStep())[0];assert.ok(restored.source.update,'native catalog rebuilt when compacted surface has no visible catalog');
    assert.match(restored.content[0].text,/Updated description/);
    assert.ok(nativeSnapshots.every(value=>value.complete),'all valid native discovery observations are complete');
    assert.equal(promptRegistrations,0);assert.ok(eventLog.some(e=>e[0]==='commands/change'));
    assert.ok(!listeners.has('agent/pre-step')&&!listeners.has('agent/request'),'plugin adds no prompt refresh request hooks');
   }finally{for(const stop of effects.reverse())stop();}
  };
  // Capture actual registerProvider control.invalidate without replacing its behavior.
  const invalidators=[];
  const tracking=scope.ctx.skills.registerProvider(control=>{invalidators.push(control.invalidate);return{name:'native-regression-tracker',list:async()=>[],get:async()=>undefined};});
  effects.push(tracking);
 }});await harness.await();try{await run();}finally{await harness.dispose();await registry.dispose();await root.fiber.dispose();}
});
} finally {await rm(qa,{recursive:true,force:true});}
