// Source-only regressions: compile in memory, never replace the integration-owned lib.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const source = await readFile(new URL('../src/client.ts', import.meta.url), 'utf8');
const bundle = await build({stdin:{contents:source+'\nmodule.exports.testComponents={GroupEditor,LoadoutChip,SkillManagerSection,SkillManagerView};',resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),loader:'ts'},write:false,bundle:true,format:'cjs',platform:'browser',external:['react','react-dom','react-dom/client','react/jsx-runtime','@deepseek-ai/dsh-client-ui-primitives']});
let active;
const react = {
  createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!=null&&typeof x!=='boolean')}),
  useState(initial){const owner=active,index=owner.cursor++;if(!(index in owner.state))owner.state[index]=typeof initial==='function'?initial():initial;return [owner.state[index],next=>{owner.state[index]=typeof next==='function'?next(owner.state[index]):next;}];},
  useRef(initial){const owner=active,index=owner.cursor++;return owner.state[index]||(owner.state[index]={current:initial});},
  useEffect(fn,deps){const owner=active,index=owner.cursor++,prev=owner.deps[index];if(!prev||!deps||deps.some((d,i)=>d!==prev[i])){owner.deps[index]=deps;owner.pending.push(()=>{owner.cleanup[index]?.();owner.cleanup[index]=fn();});}},
  useLayoutEffect(){active.cursor++;},useMemo:fn=>fn(),useCallback:fn=>fn,forwardRef:fn=>fn,memo:fn=>fn,
  Fragment:'fragment',createContext:()=>({}),useContext:()=>({}),useId:()=> 'id',isValidElement:value=>!!value&&typeof value==='object'&&'type' in value,
};
const primitives = Object.fromEntries(['Button','Checkbox','Switch','Menu','MenuGroup','MenuItemButton','Modal','SegmentedTabs','Tag','Input','IconChevronDownOutlineRegular'].map(key=>[key,key]));
const events = new EventTarget();
const windowMock = {addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events)};
const module = {exports:{}};
new Function('require','module','exports','window',bundle.outputFiles[0].text)(id=>id==='react'?react:id==='@deepseek-ai/dsh-client-ui-primitives'?primitives:id.startsWith('react-dom')?{createPortal:x=>x}:{},module,module.exports,windowMock);
const {GroupEditor,LoadoutChip,SkillManagerSection,SkillManagerView}=module.exports.testComponents;
const t=(key,params={})=>(module.exports.DICT.en[key]||key).replace(/\{(\w+)\}/g,(_,key)=>String(params[key]??`{${key}}`));
function mount(component,props){
 const owner={state:[],deps:[],cleanup:[],pending:[],cursor:0,tree:null,props};
 owner.render=(next=owner.props)=>{owner.props=next;owner.cursor=0;active=owner;owner.tree=component(next);return owner.tree;};
 owner.flush=()=>{owner.pending.splice(0).forEach(fn=>fn());};
 owner.unmount=()=>owner.cleanup.forEach(fn=>fn?.());
 owner.render();return owner;
}
function nodes(tree){return !tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...tree.children.flatMap(nodes)];}
function text(tree){return !tree?'':typeof tree==='string'?tree:typeof tree!=='object'?'':Array.isArray(tree)?tree.map(text).join(' '):tree.children.map(text).join(' ');}
const button=(owner,label)=>nodes(owner.tree).find(n=>n.type==='Button'&&text(n)===label);
const menu=owner=>nodes(owner.tree).find(n=>n.type==='Menu');
const menuItems=owner=>menu(owner).props.items.flatMap(item=>[item,...(item.submenu||[])]);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=data=>({ok:true,json:async()=>({ok:true,data})});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const calls=[];let handler;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init={})=>{const path=String(url).replace('/api/vlln/dsh-loadout',''),body=init.body?JSON.parse(init.body):undefined;calls.push({path,body,init});return handler(path,body,init);};
const loadout={id:'one',name:'Review',note:'Shared task',members:[{root:'dsh',name:'alpha'},{root:'gone',name:'missing'}]};
const view=(sessionId,id='one',skills=['alpha'])=>({sessionId,loadoutId:id,loadoutIds:id?[id]:[],scope:'user',effective:{source:id?'session':'none',loadout:id?loadout:null,loadouts:id?[loadout]:[],skills,members:id?[{root:'dsh',name:'alpha',displayName:'Alpha',status:'available',loadoutIds:['one']},{root:'gone',name:'missing',displayName:'Missing member',status:'missing',reason:'File missing'}]:[]}});
const inventory=[{key:'dsh',label:'DSH',skills:[{name:'alpha',description:'Review code',enabled:false,loadable:true},{name:'beta',description:'Write reports',enabled:false,loadable:true},{name:'broken',description:'Broken',loadable:false}]}];
try {
  // The top-level manager starts with groups; library entry is explicit.
  const section=mount(SkillManagerSection,{t});assert.equal(section.tree.props.scope,'loadouts');
  assert.equal(mount(SkillManagerSection,{t,entry:{mode:'library'}}).tree.props.scope,'user');

  // Direct creation renders only the editor portal, never an overlapping manager modal.
  let managerClosed=0;
  const manager=mount(SkillManagerView,{t,scope:'loadouts',setScope(){},savedFilters:{},setSavedFilters(){},expanded:{},setExpanded(){},entry:{mode:'create'},onClose(){managerClosed++;}});
  assert.equal(nodes(manager.tree).filter(n=>n.type===GroupEditor).length,1);
  assert.equal(nodes(manager.tree).filter(n=>n.props.className==='dssm-modal-manager').length,0);
  nodes(manager.tree).find(n=>n.type===GroupEditor).props.onClose();
  assert.equal(managerClosed,1,'direct editor close returns to chat');

  // All installed candidates, selected-first, missing refs retained, cancel writes nothing.
  let closed=0,saved=0;
  const editor=mount(GroupEditor,{t,draft:{mode:'edit',loadout},roots:inventory,loading:false,onClose:()=>closed++,onSaved:()=>saved++});
  assert.equal(nodes(editor.tree).some(n=>n.props.className==='dssm-batch-desc'),false,'candidate rows omit inline description');
  assert.ok(nodes(editor.tree).some(n=>n.props.portal===true&&n.props.label==='Review code'),'description uses portal hover/focus tooltip');
  const checks=nodes(editor.tree).filter(n=>n.type==='Checkbox');
  assert.deepEqual(checks.map(n=>n.props.label),['alpha','missing','beta','broken']);
  assert.match(text(editor.tree),/every session/);
  assert.match(text(editor.tree),/Missing/);
  checks.find(n=>n.props.label==='beta').props.onChange(true);editor.render();
  assert.deepEqual(nodes(editor.tree).filter(n=>n.type==='Checkbox').map(n=>n.props.label),['alpha','missing','beta','broken'],'checking preserves opening order');
  nodes(editor.tree).find(n=>n.type==='Checkbox'&&n.props.label==='missing').props.onChange(false);editor.render();
  assert.deepEqual(nodes(editor.tree).filter(n=>n.type==='Checkbox').map(n=>n.props.label),['alpha','missing','beta','broken'],'unchecking missing or selected members does not remove/move rows');
  nodes(editor.tree).find(n=>n.type==='Checkbox'&&n.props.label==='missing').props.onChange(true);editor.render();
  const searchField=nodes(editor.tree).find(n=>n.props['aria-label']===t('search'));
  searchField.props.onChange({target:{value:'beta'}});editor.render();
  assert.deepEqual(nodes(editor.tree).filter(n=>n.type==='Checkbox').map(n=>n.props.label),['beta']);
  nodes(editor.tree).find(n=>n.props['aria-label']===t('search')).props.onChange({target:{value:''}});editor.render();
  assert.deepEqual(nodes(editor.tree).filter(n=>n.type==='Checkbox').map(n=>n.props.label),['alpha','missing','beta','broken'],'clearing search restores stable order');
  const reopened=mount(GroupEditor,{t,draft:{mode:'edit',loadout:{...loadout,members:[{root:'dsh',name:'beta'}]}},roots:inventory,loading:false,onClose(){},onSaved(){}});
  assert.deepEqual(nodes(reopened.tree).filter(n=>n.type==='Checkbox').map(n=>n.props.label),['beta','alpha','broken'],'newly opened editor sorts its saved selection first');
  assert.equal(calls.length,0,'draft membership changes do not write');
  button(editor,t('btn.cancel')).props.onClick();assert.equal(calls.length,0);assert.equal(closed,1);

  // Failed atomic update preserves local text and selected members for retry.
  let fail=true;
  handler=async(path,body)=>{if(fail)throw new Error('save failed');if(path.startsWith('/session-loadout?'))return response({loadoutIds:['existing']});return response({loadout:{...loadout,...body}});};
  nodes(editor.tree).find(n=>n.props['aria-label']===t('loadout.name')).props.onChange({target:{value:'New name'}});editor.render();
  button(editor,t('loadout.save')).props.onClick();await tick();editor.render();
  assert.equal(calls.at(-1).path,'/loadout-update');
  assert.equal(calls.at(-1).body.members.length,3);
  assert.match(text(editor.tree),/save failed/);assert.equal(saved,0);
  fail=false;button(editor,t('loadout.save')).props.onClick();await tick();editor.render();
  assert.equal(calls.at(-1).body.name,'New name');assert.equal(saved,1);

  // Inventory retry is explicit and preserves the draft on a read failure.
  let retried=0;
  editor.render({...editor.props,readError:'inventory unavailable',onRetry:()=>retried++});
  assert.equal(button(editor,t('loadout.save')).props.disabled,true);
  button(editor,t('btn.refresh')).props.onClick();assert.equal(retried,1);
  editor.render({...editor.props,readError:null});
  assert.equal(nodes(editor.tree).find(n=>n.props['aria-label']===t('loadout.name')).props.value,'New name');
  assert.equal(nodes(editor.tree).find(n=>n.type==='Checkbox'&&n.props.label==='beta').props.checked,true);
  const invalidInventory=mount(GroupEditor,{t,draft:{mode:'create'},roots:[{key:'dsh',label:'DSH',skills:[{name:'bad-policy',loadable:true,invocationPolicyValid:false},{name:'no-channel',loadable:true,modelInvocable:false,userInvocable:false}]}],loading:false,onClose(){},onSaved(){}});
  assert.equal(nodes(invalidInventory.tree).filter(n=>n.props.className==='dssm-group-source'&&text(n).includes('Invalid')).length,2);

  // Duplicate copies definition under a new id, retaining dangling refs via copyFrom.
  const duplicate=mount(GroupEditor,{t,draft:{mode:'duplicate',loadout},roots:inventory,loading:false,onClose(){},onSaved(){}});
  nodes(duplicate.tree).find(n=>n.props['aria-label']===t('loadout.name')).props.onChange({target:{value:'Copy'}});duplicate.render();
  button(duplicate,t('loadout.save')).props.onClick();await tick();
  assert.equal(calls.at(-1).path,'/loadout-create');assert.equal(calls.at(-1).body.copyFrom,'one');assert.equal(calls.at(-1).body.members.length,2);

  // Create-and-use is two deliberate mutations, never a global apply.
  const create=mount(GroupEditor,{t,sessionId:'A',draft:{mode:'create'},roots:inventory,loading:false,onClose(){},onSaved(){}});
  nodes(create.tree).find(n=>n.props['aria-label']===t('loadout.name')).props.onChange({target:{value:'New'}});create.render();
  const before=calls.length;button(create,t('loadout.createUse')).props.onClick();await tick();
  assert.deepEqual(calls.slice(before).map(c=>c.path),['/loadout-create','/session-loadout?sessionId=A','/session-loadout']);
  assert.deepEqual(calls.at(-1).body.loadoutIds,['existing','one']);
  assert.equal(calls.at(-1).body.sessionId,'A');
  assert.equal(button(mount(GroupEditor,{t,draft:{mode:'create'},roots:inventory,loading:false,onClose(){},onSaved(){}}),t('loadout.createUse')),undefined);

  // A selection failure after successful creation retries by updating the saved id.
  const partial=mount(GroupEditor,{t,sessionId:'A',draft:{mode:'create'},roots:inventory,loading:false,onClose(){},onSaved(){}});
  nodes(partial.tree).find(n=>n.props['aria-label']===t('loadout.name')).props.onChange({target:{value:'Partial'}});partial.render();
  let selectFail=true;
  handler=async(path,body)=>{if(path.startsWith('/session-loadout?'))return response({loadoutIds:['existing']});if(path==='/session-loadout'&&selectFail)throw new Error('use failed');return response({loadout:{...loadout,...body,id:'created-id'}});};
  const partialStart=calls.length;button(partial,t('loadout.createUse')).props.onClick();await tick();partial.render();
  assert.match(text(partial.tree),/use failed/);selectFail=false;
  button(partial,t('loadout.createUse')).props.onClick();await tick();
  assert.deepEqual(calls.slice(partialStart).map(c=>c.path),['/loadout-create','/session-loadout?sessionId=A','/session-loadout','/loadout-update','/session-loadout?sessionId=A','/session-loadout']);
  assert.equal(calls.at(-3).body.id,'created-id');

  // Explicit migration is explained, confirmed, and does not select a session.
  const legacy=mount(GroupEditor,{t,sessionId:'A',draft:{mode:'legacy'},roots:inventory,loading:false,onClose(){},onSaved(){}});
  assert.match(text(legacy.tree),/without selecting/);
  nodes(legacy.tree).find(n=>n.props['aria-label']===t('loadout.name')).props.onChange({target:{value:'Imported'}});legacy.render();
  const migrationStart=calls.length;button(legacy,t('loadout.save')).props.onClick();await tick();
  assert.deepEqual(calls.slice(migrationStart).map(c=>c.path),['/loadout-import-legacy']);

  // Chip count is actual skills, not members. Actual list and reasons appear.
  handler=async(path,body,init)=>response(path==='/loadouts'?{loadouts:[loadout],active:'one'}:view(init.headers['x-dsh-skills-session']));
  const chip=mount(LoadoutChip,{t,sessionId:'A'});chip.flush();await tick();chip.render();
  assert.match(text(menu(chip).props.anchor),/Review · 1/);
  assert.equal(menu(chip).props.items.find(i=>i.id==='__effective__').submenu,undefined);
  assert.ok(!menu(chip).props.items.some(i=>i.label==='alpha'));
  assert.match(text(menu(chip).props.items.find(i=>i.id==='__effective__').label),/Effective Skills \(1\)/);
  menu(chip).props.onSelect('__effective__');chip.render();
  assert.ok(nodes(chip.tree).some(n=>n.type==='MenuGroup'&&n.props.label==='Review'));
  assert.ok(nodes(chip.tree).some(n=>n.type==='MenuItemButton'&&text(n)==='alpha'));
  assert.ok(menuItems(chip).some(i=>text(i.label).includes('File missing')));
  assert.ok(!menu(chip).props.items.some(i=>i.id==='__back__'));
  menu(chip).props.anchor.props.onClick();chip.render();menu(chip).props.anchor.props.onClick();await tick();chip.render();
  for(const id of ['__none__','__edit__:one','__create__','__library__','__manage__','__refresh__','history-note']) assert.ok(!menu(chip).props.items.some(i=>i.id===id));

  // Duplicate submits blocked synchronously; failures keep selection and show error.
  const pending=deferred();handler=(path,body,init)=>body?pending.promise:Promise.resolve(response(path==='/loadouts'?{loadouts:[loadout]}:view(init.headers['x-dsh-skills-session'])));
  const mutationStart=calls.length;menu(chip).props.onSelect('one');menu(chip).props.onSelect('one');
  assert.equal(calls.slice(mutationStart).filter(c=>c.body).length,1);
  pending.reject(new Error('selection failed'));await tick();chip.render();
  assert.match(text(menu(chip).props.anchor),/Review/);assert.match(text(chip.tree),/selection failed/);

  // Multiple groups toggle independently, retain an open menu, and show the actual union.
  const second={...loadout,id:'two',name:'Write'};let selected=['one'];
  handler=async(path,body)=>{
    if(body){selected=body.loadoutIds;return response({loadoutIds:selected});}
    if(path==='/loadouts')return response({loadouts:[loadout,second],activeIds:selected});
    return response({...view('A'),loadoutIds:selected,effective:{source:'session',loadout:null,loadouts:[loadout,second].filter(l=>selected.includes(l.id)),skills:selected.length===2?['alpha','beta','gamma']:['beta','gamma'],members:[]}});
  };
  menu(chip).props.onSelect('__retry_read__');await tick();chip.render();
  menu(chip).props.anchor.props.onClick();await tick();chip.render();
  menu(chip).props.onSelect('two');await tick();chip.render();
  assert.deepEqual(calls.filter(c=>c.body).at(-1).body,{sessionId:'A',loadoutIds:['one','two']});
  assert.deepEqual(menu(chip).props.selectedIds,['one','two']);assert.equal(menu(chip).props.open,true);
  assert.match(text(menu(chip).props.anchor),/2 groups · 3 skills/);
  menu(chip).props.onSelect('one');await tick();chip.render();
  assert.deepEqual(calls.filter(c=>c.body).at(-1).body.loadoutIds,['two']);
  assert.deepEqual(menu(chip).props.selectedIds,['two']);
  menu(chip).props.onSelect('two');await tick();chip.render();
  assert.deepEqual(calls.filter(c=>c.body).at(-1).body.loadoutIds,[]);

  // A late response from an old refresh cannot overwrite the newer one.
  const old=deferred();let reads=0;
  handler=(path,body,init)=>path==='/loadouts'?Promise.resolve(response({loadouts:[loadout]})):++reads===1?old.promise:Promise.resolve(response(view('A','',[])));
  menu(chip).props.onSelect('__retry_read__');menu(chip).props.onSelect('__retry_read__');await tick();
  old.resolve(response(view('A')));await tick();chip.render();
  assert.match(text(menu(chip).props.anchor),/Choose skill group/);

  // Session isolation including a stale in-flight A response after switching to B.
  const staleA=deferred();
  handler=(path,body,init)=>path==='/loadouts'?Promise.resolve(response({loadouts:[loadout]})):init.headers['x-dsh-skills-session']==='A'?staleA.promise:Promise.resolve(response(view('B','',[])));
  menu(chip).props.onSelect('__retry_read__');chip.render({t,sessionId:'B'});chip.flush();await tick();
  staleA.resolve(response(view('A')));await tick();chip.render();
  assert.match(text(menu(chip).props.anchor),/Choose skill group/);

  // Changed event refresh, read errors visible rather than pretending zero skills.
  handler=async()=>{throw new Error('offline');};events.dispatchEvent(new Event('dsh-loadout:changed'));await tick();chip.render();
  assert.match(text(menu(chip).props.anchor),/Could not read group/);
  menu(chip).props.onSelect('__effective__');chip.render();
  assert.ok(menuItems(chip).some(i=>text(i.label).includes('offline')));
  assert.ok(!menu(chip).props.items.some(i=>i.id==='empty'));
  chip.unmount();

  // Project defaults work without groups; exclusions preserve off-scope records and aliases.
  const offscope={root:'other-project',name:'later'},alias={root:'alias-root',name:'project-skill'};
  let exclusions=[offscope],projectFailure=false;
  const projectMember={root:'project-root',name:'project-skill',displayName:'Project skill',projectDefault:true,loadoutIds:['one']};
  handler=async(path,body)=>{
    if(path==='/session-skill-exclusions'){if(projectFailure)throw new Error('exclude failed');exclusions=body.excludedSkills;return response({excludedSkills:exclusions});}
    if(path==='/loadouts')return response({loadouts:[loadout],activeIds:[]});
    if(path==='/session-loadout')return response({loadoutIds:[]});
    const blocked=exclusions.filter(ref=>ref.root===projectMember.root||ref.root===alias.root);
    return response({...view('P','',[]),excludedSkills:exclusions,effective:{source:'none',loadouts:[],skills:blocked.length?[]:['project-skill'],members:[{...projectMember,status:blocked.length?'excluded':'available',excludedBy:blocked}]}});
  };
  const projectChip=mount(LoadoutChip,{t,sessionId:'P'});projectChip.flush();await tick();projectChip.render();
  assert.match(text(menu(projectChip).props.anchor),/Project skills · 1/);
  menu(projectChip).props.onSelect('__effective__');projectChip.render();
  assert.ok(nodes(projectChip.tree).some(n=>n.type==='MenuGroup'&&n.props.label.startsWith('Project skills')));
  assert.ok(!menu(projectChip).props.items.some(i=>i.id==='__back__'));
  menu(projectChip).props.anchor.props.onClick();projectChip.render();menu(projectChip).props.anchor.props.onClick();await tick();projectChip.render();
  const projectOption=menu(projectChip).props.items.find(item=>item.id==='__projects__').submenu.find(item=>item.id.startsWith('__project__:'));
  assert.ok(!menu(projectChip).props.items.some(item=>item.id.startsWith('__project__:')));
  assert.ok(menu(projectChip).props.selectedIds.includes(projectOption.id));
  projectFailure=true;menu(projectChip).props.onSelect(projectOption.id);await tick();projectChip.render();
  assert.match(text(projectChip.tree),/exclude failed/);assert.ok(menu(projectChip).props.selectedIds.includes(projectOption.id));
  projectFailure=false;menu(projectChip).props.onSelect(projectOption.id);await tick();projectChip.render();
  assert.deepEqual(exclusions,[offscope,{root:projectMember.root,name:projectMember.name}]);
  assert.ok(!menu(projectChip).props.selectedIds.includes(projectOption.id));
  exclusions=[offscope,alias];menu(projectChip).props.onSelect('__retry_read__');await tick();projectChip.render();
  menu(projectChip).props.onSelect(projectOption.id);await tick();projectChip.render();
  assert.deepEqual(exclusions,[offscope],'restore removes alias exclusion but preserves unrelated directory');
  const beforeRemovedClear=calls.length;menu(projectChip).props.onSelect('__none__');await tick();projectChip.render();
  assert.equal(calls.length,beforeRemovedClear,'removed clear-all action cannot mutate session');
  assert.match(text(menu(projectChip).props.anchor),/Project skills · 1/,'project defaults remain independent');
  projectChip.unmount();

  // Effective previews use available canonical refs; errors retry without losing identity.
  let previewFail=true,previewDeferred=null;
  const previewView={...view('V'),effective:{...view('V').effective,loadouts:[loadout,{...loadout,id:'shared',name:'Shared review'}],skills:['camel-review','project-lint','unassigned'],members:[
    {root:'shadow',name:'wrong',displayName:'CamelReview',status:'shadowed'},
    {root:'claude',name:'folder-name',displayName:'CamelReview',status:'available',loadoutIds:['one','shared','shared']},
    {root:'codex',name:'unassigned',displayName:'unassigned',status:'available',loadoutIds:[]},
    {root:'project-codex:identity',name:'project-lint',displayName:'project-lint',status:'available',projectDefault:true}]}};
  handler=async(path,body)=>{
    if(path==='/loadouts')return response({loadouts:[loadout]});
    if(path==='/detail'){if(previewDeferred)return previewDeferred.promise;if(previewFail)throw new Error('preview failed');return response({name:'folder-name',description:'Correct instructions',path:'/actual/SKILL.md',body:'READ ONLY BODY',diagnostics:[]});}
    return response(previewView);
  };
  const previewChip=mount(LoadoutChip,{t,sessionId:'V'});previewChip.flush();await tick();previewChip.render();
  menu(previewChip).props.onSelect('__effective__');previewChip.render();
  const previewOption=()=>nodes(previewChip.tree).find(n=>n.type==='MenuItemButton'&&text(n)==='camel-review');
  assert.deepEqual(nodes(previewChip.tree).filter(n=>n.type==='MenuGroup').map(n=>n.props.label),['Review','Shared review','Project skills','Other skills']);
  assert.equal(text(previewOption()),'camel-review','source appears once in heading, not each row');
  const searchEffective=()=>nodes(previewChip.tree).find(n=>n.props['aria-label']===t('loadout.dock.searchEffective'));
  assert.equal(nodes(previewChip.tree).filter(n=>n.type==='MenuItemButton'&&text(n)==='camel-review').length,2,'shared skill appears once in each contributing group');
  assert.equal(searchEffective().type,'Input','uses native official Input');assert.equal(searchEffective().props.role,'searchbox');assert.equal(searchEffective().props.className,'dssm-effective-search');
  assert.ok(!menu(previewChip).props.items.some(i=>i.id==='__back__'));
  searchEffective().props.onChange({target:{value:'Shared review'}});previewChip.render();
  assert.deepEqual(nodes(previewChip.tree).filter(n=>n.type==='MenuGroup').map(n=>n.props.label),['Shared review']);
  searchEffective().props.onChange({target:{value:'Project skills'}});previewChip.render();
  assert.equal(previewOption(),undefined);assert.ok(nodes(previewChip.tree).some(n=>n.type==='MenuItemButton'&&text(n)==='project-lint'));
  searchEffective().props.onChange({target:{value:'nothing-matches'}});previewChip.render();assert.ok(menuItems(previewChip).some(i=>i.id==='no-match'));
  searchEffective().props.onChange({target:{value:''}});previewChip.render();
  previewOption().props.onSelect();await tick();previewChip.render();
  assert.deepEqual(calls.at(-1).body,{root:'claude',name:'folder-name'});
  assert.equal(calls.at(-1).init.headers['x-dsh-skills-session'],'V');assert.match(text(previewChip.tree),/preview failed/);
  assert.equal(menu(previewChip).props.open,false,'preview closes menu, not a nested focus trap');
  previewFail=false;button(previewChip,t('btn.refresh')).props.onClick();await tick();previewChip.render();
  const bodyField=nodes(previewChip.tree).find(n=>n.props['aria-label']===t('detail.body'));
  assert.equal(bodyField.props.readOnly,true);assert.equal(bodyField.props.value,'READ ONLY BODY');
  nodes(previewChip.tree).find(n=>n.props.title?.startsWith('Skill preview')).props.onClose();previewChip.render();
  previewDeferred=deferred();previewOption().props.onSelect();previewChip.render();
  nodes(previewChip.tree).find(n=>n.props.title?.startsWith('Skill preview')).props.onClose();previewChip.render();
  previewDeferred.resolve(response({body:'LATE CLOSED'}));await tick();previewChip.render();assert.doesNotMatch(text(previewChip.tree),/LATE CLOSED/);
  previewDeferred=deferred();previewOption().props.onSelect();previewChip.render();
  previewChip.render({t,sessionId:'W'});previewChip.flush();await tick();previewDeferred.resolve(response({body:'LATE OLD SESSION'}));await tick();previewChip.render();
  assert.doesNotMatch(text(previewChip.tree),/LATE OLD SESSION/);assert.equal(nodes(previewChip.tree).some(n=>n.props.title?.startsWith('Skill preview')),false);
  previewChip.unmount();

  // Settings never borrow an open chat; only composer-owned modals subscribe to it.
  let subscriptions=0;
  const useSessions=selector=>{subscriptions++;return selector({ids:['A'],byId:{A:{retainedBy:{mainView:1}}}});};
  const settingsSection=mount(SkillManagerSection,{t,useSessions});
  assert.equal(subscriptions,0);assert.equal(settingsSection.tree.props.sessionId,undefined);
  const composerSection=mount(SkillManagerSection,{t,useSessions,onClose(){}});
  assert.equal(subscriptions,1);assert.equal(composerSection.tree.props.sessionId,'A');

  // Default checkboxes persist independently of session selection, without rescans/banners.
  let defaults=['one'],managerSelected=['two'];let nextScope, rejectAdd=true, scanResponse=null;
  const projectRoot={key:'project-dsh:current',scope:'project',projectRoot:'/current',label:'Project DSH',skills:[{name:'project-check',loadable:true}]};
  handler=async(path,body)=>{
    if(path==='/state')return scanResponse ? scanResponse.promise : response({roots:[...inventory,projectRoot],trash:[],warnings:[],writeDestinations:[],projects:[]});
    if(path==='/loadouts')return response({loadouts:[loadout,second],activeIds:managerSelected,active:null});
    if(path==='/default-loadouts'){if(body)defaults=body.loadoutIds;return response({loadoutIds:defaults});}
    if(path==='/repositories/add'){if(rejectAdd)throw new Error('repository rejected');return response({id:'added'});}
    if(path==='/repositories/refresh')return response({error:null});
    if(path==='/repositories')return response({repositories:[],installRoots:[]});
    if(path==='/workspaces')return response({items:[]});
    return response({});
  };
  const manageProps={t,scope:'loadouts',setScope:value=>{nextScope=value;},savedFilters:{},setSavedFilters(){},expanded:{},setExpanded(){}};
  const startDefaults=calls.length;
  const multiManager=mount(SkillManagerView,manageProps);multiManager.flush();await tick();multiManager.render();
  assert.ok(calls.slice(startDefaults).some(call=>call.path==='/default-loadouts'&&!call.body));
  const defaultCheck=()=>nodes(multiManager.tree).find(n=>n.type==='Checkbox'&&n.props['aria-label']===loadout.name+' · '+t('loadout.defaultEnabled'));
  assert.equal(nodes(multiManager.tree).filter(n=>n.props.className==='dssm-group-columns').length,1);
  assert.equal(defaultCheck().props.label.props.className,'dssm-sr-only','default label remains accessible via clipped host Checkbox label');assert.equal(text(defaultCheck().props.label),loadout.name+' · '+t('loadout.defaultEnabled'));
  assert.equal(nodes(multiManager.tree).find(n=>n.type==='Checkbox'&&typeof n.props.label==='string'&&n.props.label===t('loadout.defaultEnabled')),undefined,'default wording is not repeated visibly per row');
  assert.equal(text(multiManager.tree).includes(t('loadout.defaultsHint')),false,'long default explanation is not visible list boilerplate');
  assert.equal(defaultCheck().props.checked,true,'default checkbox ignores active session group list');
  const stateReads=calls.filter(call=>call.path==='/state').length;
  const mutationStartDefaults=calls.length;
  defaultCheck().props.onChange(false);await tick();multiManager.render();
  assert.deepEqual(defaults,[]);assert.deepEqual(managerSelected,['two']);
  assert.deepEqual(calls.slice(mutationStartDefaults).map(call=>call.path),['/default-loadouts']);
  assert.equal(calls.at(-1).init.headers['x-dsh-skills-session'],undefined);
  assert.equal(calls.filter(call=>call.path==='/state').length,stateReads);
  assert.equal(nodes(multiManager.tree).some(n=>n.props.className==='dssm-feedback'),false,'default changes do not add a success banner');
  defaultCheck().props.onChange(true);await tick();multiManager.render();assert.deepEqual(defaults,['one']);
  button(multiManager,t('loadout.create')).props.onClick();multiManager.render();
  const groupEditor=nodes(multiManager.tree).find(n=>n.type===GroupEditor);
  assert.ok(groupEditor);assert.deepEqual(groupEditor.props.roots.map(root=>root.key),['dsh'],'project skills are excluded from group candidates');
  groupEditor.props.onClose();multiManager.render({...manageProps,scope:'user'});
  for(const key of ['library.add','library.sources','library.searchRemote'])assert.ok(button(multiManager,t(key)));
  for(const key of ['library.local','library.install','library.create'])assert.equal(button(multiManager,t(key)),undefined);
  assert.equal(nodes(multiManager.tree).some(n=>n.props['data-inventory-scope']==='project'),false,'settings inventory is global-only');
  assert.equal(nodes(multiManager.tree).some(n=>n.props.label===t('filter.workspace')),false);
  assert.equal(nodes(multiManager.tree).some(n=>n.props['aria-label']===t('trash.title')||n.props['aria-label']===t('btn.create')),false,'no trash or create icons');
  assert.equal(nodes(multiManager.tree).some(n=>['h3','h4'].includes(n.type)&&[t('scope.user'),t('scope.project')].includes(text(n))),false,'no redundant scope headings');
  // Manual scan has immediate feedback, prevents duplicates, and counts global inventory only.
  const scanButton=()=>nodes(multiManager.tree).find(n=>n.props['aria-label']===t('btn.refresh')&&n.props.onClick);
  const scanStatus=()=>nodes(multiManager.tree).find(n=>n.props.role==='status');
  scanResponse=deferred();const beforeScan=calls.filter(c=>c.path==='/state').length;
  const scanAction=scanButton();scanAction.props.onClick();scanAction.props.onClick();multiManager.render();
  assert.equal(text(scanStatus()),t('library.scanning'),'refresh reacts before the response');assert.equal(scanButton().props.disabled,true);
  assert.equal(calls.filter(c=>c.path==='/state').length,beforeScan+1,'in-flight scan is not duplicated');
  assert.ok(nodes(multiManager.tree).some(n=>n.props.className==='dssm-source'),'silent scan keeps the inventory visible');
  scanResponse.resolve(response({roots:[...inventory,projectRoot],trash:[],warnings:[],writeDestinations:[],projects:[]}));await tick();multiManager.render();
  assert.equal(text(scanStatus()),t('library.scanned',{count:inventory[0].skills.length}),'completed count excludes project skills');assert.equal(scanButton().props.disabled,false);
  scanResponse=deferred();scanButton().props.onClick();multiManager.render();assert.equal(text(scanStatus()),t('library.scanning'));
  scanResponse.reject(new Error('scan unavailable'));await tick();multiManager.render();
  assert.match(text(multiManager.tree),/scan unavailable/,'scan failure is visible');assert.equal(scanStatus(),undefined,'failure does not pretend completion');assert.equal(scanButton().props.disabled,false,'scan can be retried');
  scanResponse=deferred();scanButton().props.onClick();multiManager.render();assert.equal(text(scanStatus()),t('library.scanning'));
  scanResponse.resolve(response({roots:inventory,trash:[],warnings:[],writeDestinations:[],projects:[]}));await tick();multiManager.render();
  assert.doesNotMatch(text(multiManager.tree),/scan unavailable/);assert.equal(text(scanStatus()),t('library.scanned',{count:inventory[0].skills.length}));scanResponse=null;
  button(multiManager,t('library.add')).props.onClick();multiManager.render();
  const addSelect=nodes(multiManager.tree).find(n=>n.props.options?.some(option=>option.value==='local')&&n.props.options?.some(option=>option.value==='git'));
  assert.ok(addSelect);assert.deepEqual(addSelect.props.options.map(option=>option.value),['git','local']);
  const address=nodes(multiManager.tree).find(n=>n.props['aria-label']===t('library.input'));assert.ok(address);
  assert.equal(button(multiManager,t('btn.confirm')).props.disabled,true);
  address.props.onChange({target:{value:'example/skills'}});multiManager.render();
  assert.equal(button(multiManager,t('btn.confirm')).props.disabled,false);
  const addStart=calls.filter(call=>call.path==='/repositories/add').length;
  const confirm=button(multiManager,t('btn.confirm'));
  confirm.props.onClick();confirm.props.onClick();await tick();multiManager.render();
  assert.equal(calls.filter(call=>call.path==='/repositories/add').length,addStart+1,'compact Add synchronously suppresses duplicate submit');
  assert.ok(nodes(multiManager.tree).find(n=>n.props.title===t('library.choose')),'genuine failure leaves compact Add open');
  assert.match(text(multiManager.tree),/repository rejected/);
  assert.equal(nodes(multiManager.tree).find(n=>n.props['aria-label']===t('library.input')).props.value,'example/skills','failure preserves URL for retry');
  rejectAdd=false;
  button(multiManager,t('btn.confirm')).props.onClick();await tick();await tick();multiManager.render();
  assert.equal(nextScope,'repositories');
  assert.equal(nodes(multiManager.tree).some(n=>n.props.title===t('library.choose')||n.props.title===t('repo.add')),false,'successful add closes compact dialog without a second add dialog');
  assert.equal(calls.filter(call=>call.path==='/repositories/add').length,addStart+2,'explicit retry submits once');
  button(multiManager,t('library.searchRemote')).props.onClick();assert.equal(nextScope,'repositories');
  multiManager.render({...manageProps,scope:'repositories'});
  assert.equal(nodes(multiManager.tree).some(n=>n.props.className==='dssm-subsources'),false);
  assert.equal(nodes(multiManager.tree).filter(n=>n.props.className==='dssm-search').length,1,'remote search has one input');
  const searchSource=nodes(multiManager.tree).find(n=>n.props.label===t('repo.searchSource'));
  assert.deepEqual(searchSource.props.options.map(option=>option.value),['github','clawhub','skillsh']);
  button(multiManager,t('library.back')).props.onClick();assert.equal(nextScope,'user');
  multiManager.unmount();

  // The manager emits no old loading-policy controls or gatekeeper endpoints.
  assert.doesNotMatch(source,/post\(['"]\/(?:loadout-toggle|loadout-apply|skill-reference|source-enable|source-disable|category-enable|category-disable)/);
  const sidebar=await readFile(new URL('../src/sidebar-entry.ts',import.meta.url),'utf8');assert.doesNotMatch(sidebar,/gatekeeper/i);
  console.log('session-first client regressions passed');
} finally {globalThis.fetch=originalFetch;}
