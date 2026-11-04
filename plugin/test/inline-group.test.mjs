// Source-only inline group editor regressions. Never rebuild integration-owned lib.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const source=await readFile(new URL('../src/client.ts',import.meta.url),'utf8');
const bundle=await build({stdin:{contents:source+'\nmodule.exports.testComponents={GroupEditor,SkillManagerSection,SkillManagerView};',resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),loader:'ts'},write:false,bundle:true,format:'cjs',platform:'browser',external:['react','react-dom','react-dom/client','react/jsx-runtime','@deepseek-ai/dsh-client-ui-primitives']});
let active;
const react={
 createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!=null&&typeof x!=='boolean')}),
 useState(initial){const owner=active,index=owner.cursor++;if(!(index in owner.state))owner.state[index]=typeof initial==='function'?initial():initial;return[owner.state[index],next=>{owner.state[index]=typeof next==='function'?next(owner.state[index]):next;}];},
 useRef(initial){const owner=active,index=owner.cursor++;return owner.state[index]||(owner.state[index]={current:initial});},
 useEffect(fn,deps){const owner=active,index=owner.cursor++,previous=owner.deps[index];if(!previous||!deps||deps.some((d,i)=>d!==previous[i])){owner.deps[index]=deps;owner.pending.push(()=>{owner.cleanup[index]?.();owner.cleanup[index]=fn();});}},
 useLayoutEffect(){active.cursor++;},useMemo:fn=>fn(),useCallback:fn=>fn,forwardRef:fn=>fn,memo:fn=>fn,Fragment:'fragment',createContext:()=>({}),useContext:()=>({}),useId:()=> 'id',isValidElement:v=>!!v&&typeof v==='object'&&'type'in v,
};
const primitives=Object.fromEntries(['Button','Checkbox','Switch','Menu','Modal','SegmentedTabs','Tag','Input','IconChevronDownOutlineRegular'].map(key=>[key,key]));
const events=new EventTarget(),windowMock={addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events)};
const module={exports:{}};
new Function('require','module','exports','window',bundle.outputFiles[0].text)(id=>id==='react'?react:id==='@deepseek-ai/dsh-client-ui-primitives'?primitives:id.startsWith('react-dom')?{createPortal:x=>x}:{},module,module.exports,windowMock);
const {GroupEditor,SkillManagerSection,SkillManagerView}=module.exports.testComponents;
const t=(key,params={})=>(module.exports.DICT.en[key]||key).replace(/\{(\w+)\}/g,(_,key)=>String(params[key]??`{${key}}`));
function mount(component,props){const owner={state:[],deps:[],cleanup:[],pending:[],cursor:0,tree:null,props};owner.render=(next=owner.props)=>{owner.props=next;owner.cursor=0;active=owner;owner.tree=component(next);return owner.tree;};owner.flush=()=>owner.pending.splice(0).forEach(fn=>fn());owner.unmount=()=>owner.cleanup.forEach(fn=>fn?.());owner.render();return owner;}
function nodes(tree){return !tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...tree.children.flatMap(nodes)];}
function text(tree){return !tree?'':typeof tree==='string'?tree:typeof tree!=='object'?'':Array.isArray(tree)?tree.map(text).join(' '):tree.children.map(text).join(' ');}
const button=(owner,label)=>nodes(owner.tree).find(n=>n.type==='Button'&&text(n)===label);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=data=>({ok:true,json:async()=>({ok:true,data})});
const originalFetch=globalThis.fetch,calls=[];
const group={id:'review',name:'Review',note:'Review changes',members:[{root:'dsh',name:'alpha'}]};
const secondGroup={id:'write',name:'Write',note:'Write reports',members:[{root:'dsh',name:'beta'}]};
const inventory=[{key:'dsh',label:'DSH',skills:[{name:'alpha',description:'Review code',loadable:true},{name:'beta',description:'Write reports',loadable:true}]}];
let defaults=[],failSave=false;
globalThis.fetch=async(url,init={})=>{const path=String(url).replace('/api/vlln/dsh-loadout',''),body=init.body?JSON.parse(init.body):undefined;calls.push({path,body,headers:init.headers});if(path==='/state')return response({roots:inventory,trash:[],warnings:[],writeDestinations:[],projects:[]});if(path==='/default-loadouts'){if(body)defaults=body.loadoutIds;return response({loadoutIds:defaults});}if(path==='/loadouts')return response({loadouts:[group,secondGroup],activeIds:['unrelated-session-choice'],active:null});if(path==='/loadout-update'||path==='/loadout-create'){if(failSave)throw new Error('atomic save failed');return response({loadout:{...group,...body}});}return response({});};
try{
 const section=mount(SkillManagerSection,{t,useSessions:()=>{throw new Error('settings must not borrow current chat');}});assert.equal(section.tree.props.sessionId,undefined);
 const props={t,scope:'loadouts',setScope(){},savedFilters:{},setSavedFilters(){},expanded:{},setExpanded(){}};
 const manager=mount(SkillManagerView,props);manager.flush();await tick();manager.render();
 const rowName=()=>nodes(manager.tree).find(n=>n.type==='button'&&n.props.className?.includes('dssm-group-expand')&&text(n).includes('Review'));
 assert.ok(rowName(),'row name itself is an accessible button');assert.equal(rowName().props['aria-expanded'],false);
 assert.equal(button(manager,t('loadout.edit')),undefined,'no separate edit button');
 const check=nodes(manager.tree).find(n=>n.type==='Checkbox'&&n.props['aria-label']===group.name+' · '+t('loadout.defaultEnabled'));assert.ok(check);assert.equal(check.props.checked,false,'defaults do not borrow session activeIds');
 assert.equal(check.props.label.props.className,'dssm-sr-only','unique checkbox label is visually clipped, not repeated row copy');assert.equal(text(check.props.label),group.name+' · '+t('loadout.defaultEnabled'));
 assert.equal(nodes(manager.tree).filter(n=>n.props.className==='dssm-group-columns').length,1,'one shared column heading describes defaults');
 assert.equal(text(manager.tree).includes(t('loadout.defaultEnabled')),false,'default-enabled wording is not repeated beside every row');
 assert.equal(text(manager.tree).includes(t('loadout.hint')),false,'compact list omits long explanatory paragraph');
 assert.equal(text(manager.tree).includes(t('loadout.defaultsHint')),false,'default semantics stay in contextual help rather than a repeated paragraph');
 const columnHeader=()=>nodes(manager.tree).find(n=>n.props.className==='dssm-group-columns');
 const toolbar=()=>nodes(manager.tree).find(n=>n.props.className==='dssm-loadout-toolbar');
 const clearAction=()=>nodes(columnHeader()).find(n=>n.props.action===true&&n.props.label===t('loadout.clearDefaults'));
 assert.equal(clearAction(),undefined,'no clear-default action for an empty default selection');
 assert.equal(nodes(toolbar()).some(n=>n.props.action===true&&n.props.options?.some(option=>option.value==='clear')),false,'new-group toolbar never owns default-selection clearing');
 const beforeDefault=calls.length;check.props.onChange(true);await tick();manager.render();assert.deepEqual(calls.slice(beforeDefault).filter(c=>c.body).map(c=>[c.path,c.body]),[['/default-loadouts',{loadoutIds:['review']}]]);assert.equal(nodes(manager.tree).some(n=>n.type===GroupEditor),false,'default checkbox does not expand editor');
 assert.equal(clearAction(),undefined,'clear-default action remains absent with selected defaults');
 assert.equal(nodes(toolbar()).some(n=>n.props.label===t('loadout.clearDefaults')),false,'clear action does not leak to page-level creation toolbar');
 const beforeClear=calls.length;nodes(manager.tree).find(n=>n.type==='Checkbox'&&n.props['aria-label']===group.name+' · '+t('loadout.defaultEnabled')).props.onChange(false);await tick();manager.render();
 assert.deepEqual(calls.slice(beforeClear).filter(c=>c.body).map(c=>[c.path,c.body]),[['/default-loadouts',{loadoutIds:[]}]],'header clear only replaces default selections, never deletes groups or writes a session');
 assert.equal(clearAction(),undefined,'clearing defaults removes the now-inapplicable header action');
 assert.equal(nodes(manager.tree).filter(n=>n.props.className==='dssm-group-row').length,2,'clearing defaults preserves all group definitions');
 assert.equal(nodes(manager.tree).find(n=>n.type==='Checkbox'&&n.props['aria-label']===group.name+' · '+t('loadout.defaultEnabled')).props.checked,false);
 assert.equal(nodes(manager.tree).some(n=>n.type===GroupEditor),false,'clearing defaults does not expand an editor');
 rowName().props.onClick();manager.render();assert.equal(rowName().props['aria-expanded'],true);let editorNode=nodes(manager.tree).find(n=>n.type===GroupEditor);assert.equal(editorNode.props.inline,true);assert.equal(editorNode.props.sessionId,undefined);assert.equal(nodes(manager.tree).some(n=>n.type==='Modal'||n.props.className==='dssm-modal-manager'),false,'settings expansion creates no Modal');
 let editor=mount(GroupEditor,editorNode.props);assert.equal(editor.tree.type,'div');assert.equal(editor.tree.props.role,'region');assert.equal(nodes(editor.tree).some(n=>n.type==='Modal'),false);assert.doesNotMatch(text(editor.tree),/No active session/,'inline settings editor omits irrelevant session warning');
 const beforeCancel=calls.length;nodes(editor.tree).find(n=>n.type==='Checkbox'&&n.props.label==='beta').props.onChange(true);editor.render();button(editor,t('btn.cancel')).props.onClick();manager.render();assert.equal(calls.length,beforeCancel,'cancelled draft writes nothing');assert.equal(rowName().props['aria-expanded'],false);assert.equal(nodes(manager.tree).some(n=>n.type===GroupEditor),false);
 rowName().props.onClick();manager.render();editorNode=nodes(manager.tree).find(n=>n.type===GroupEditor);editor=mount(GroupEditor,editorNode.props);
 nodes(editor.tree).find(n=>n.props['aria-label']===t('loadout.name')).props.onChange({target:{value:'Reviewed'}});editor.render();nodes(editor.tree).find(n=>n.props['aria-label']===t('loadout.note')).props.onChange({target:{value:'Atomic draft'}});editor.render();nodes(editor.tree).find(n=>n.type==='Checkbox'&&n.props.label==='beta').props.onChange(true);editor.render();
 const beforeSave=calls.length;failSave=true;button(editor,t('loadout.save')).props.onClick();await tick();editor.render();assert.match(text(editor.tree),/atomic save failed/);assert.equal(nodes(editor.tree).find(n=>n.props['aria-label']===t('loadout.name')).props.value,'Reviewed');assert.equal(nodes(editor.tree).find(n=>n.type==='Checkbox'&&n.props.label==='beta').props.checked,true);assert.equal(calls.slice(beforeSave).filter(c=>c.body).length,1);assert.deepEqual(calls.at(-1).body,{id:'review',name:'Reviewed',note:'Atomic draft',members:[{root:'dsh',name:'alpha'},{root:'dsh',name:'beta'}]});
 failSave=false;button(editor,t('loadout.save')).props.onClick();await tick();manager.render();assert.equal(nodes(manager.tree).some(n=>n.type===GroupEditor),false,'successful atomic save collapses inline editor');assert.equal(calls.slice(beforeSave).filter(c=>c.path==='/session-loadout').length,0,'settings save does not select a session');
 // Same row toggles shut without invoking any mutation.
 rowName().props.onClick();manager.render();const beforeToggle=calls.length;rowName().props.onClick();manager.render();assert.equal(rowName().props['aria-expanded'],false);assert.equal(calls.length,beforeToggle);
 // Switching rows replaces the editor identity; unsaved edits cannot leak into another group.
 rowName().props.onClick();manager.render();const firstDraftNode=nodes(manager.tree).find(n=>n.type===GroupEditor),firstDraft=mount(GroupEditor,firstDraftNode.props);nodes(firstDraft.tree).find(n=>n.props['aria-label']===t('loadout.name')).props.onChange({target:{value:'Unsaved local name'}});firstDraft.render();const beforeSwitch=calls.length;
 const otherName=()=>nodes(manager.tree).find(n=>n.type==='button'&&n.props.className?.includes('dssm-group-expand')&&text(n).includes('Write'));otherName().props.onClick();manager.render();let switched=nodes(manager.tree).filter(n=>n.type===GroupEditor);assert.equal(switched.length,1);assert.equal(switched[0].props.draft.loadout.id,'write');assert.notEqual(switched[0].props.key,firstDraftNode.props.key,'row editor key forces fresh draft state');assert.equal(rowName().props['aria-expanded'],false);assert.equal(otherName().props['aria-expanded'],true);const otherDraft=mount(GroupEditor,switched[0].props);assert.equal(nodes(otherDraft.tree).find(n=>n.props['aria-label']===t('loadout.name')).props.value,'Write');rowName().props.onClick();manager.render();const returnedDraft=mount(GroupEditor,nodes(manager.tree).find(n=>n.type===GroupEditor).props);assert.equal(nodes(returnedDraft.tree).find(n=>n.props['aria-label']===t('loadout.name')).props.value,'Review','returning does not resurrect discarded edits');assert.equal(calls.length,beforeSwitch,'row switching does not save drafts');button(returnedDraft,t('btn.cancel')).props.onClick();manager.render();
 // New and duplicate use the same in-page editor, not additional portals.
 button(manager,t('loadout.create')).props.onClick();manager.render();editorNode=nodes(manager.tree).find(n=>n.type===GroupEditor);assert.equal(editorNode.props.inline,true);assert.equal(editorNode.props.draft.mode,'create');assert.equal(nodes(manager.tree).some(n=>n.type==='Modal'),false);editorNode.props.onClose();manager.render();
 const more=nodes(manager.tree).find(n=>n.props.action===true&&n.props.options?.some(option=>option.value==='duplicate'));assert.ok(more);more.props.onChange('duplicate');manager.render();editorNode=nodes(manager.tree).find(n=>n.type===GroupEditor);assert.equal(editorNode.props.inline,true);assert.equal(editorNode.props.draft.mode,'duplicate');assert.equal(editorNode.props.draft.loadout.id,'review');assert.equal(nodes(manager.tree).some(n=>n.type==='Modal'),false);
 const copy=mount(GroupEditor,editorNode.props);nodes(copy.tree).find(n=>n.props['aria-label']===t('loadout.name')).props.onChange({target:{value:'Review copy'}});copy.render();const beforeCopy=calls.length;button(copy,t('loadout.save')).props.onClick();await tick();assert.deepEqual(calls.slice(beforeCopy).filter(c=>c.body).map(c=>[c.path,c.body.copyFrom]),[['/loadout-create','review']]);
 manager.unmount();console.log('Inline group editor: row expansion, cancel/no write, atomic save/retry, independent defaults, new/copy and no Modal passed');
}finally{globalThis.fetch=originalFetch;}
