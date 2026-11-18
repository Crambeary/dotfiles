// Run: node --experimental-vm-modules tests/herdr/inbox-subagents.mjs
// Exercise the shipped modules against controlled Herdr snapshots. No app or core is touched.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { SourceTextModule, SyntheticModule } from 'node:vm';

const root = resolve('private_dot_config/herdr-app/mods/omarchy-inbox');
let all = [], runs = [], ps = [], sp = [], focus = {}, calls = [], shared = new Map(), storage = new Map(), modProps = {};
const theme = new Proxy({}, { get: (_, k) => `#${String(k)}` });
class Element {
  constructor() {
    this.nodes = []; this.handlers = {}; this.attrs = {};
    const proxy = new Proxy(this, { get: (o, k) => k in o ? o[k] : (...args) => { o.attrs[k] = args; return proxy; } });
    return proxy;
  }
  child(x) { assert.ok(x != null && x !== false, 'native child() cannot accept null/false'); this.nodes.push(x); return this; }
  children(xs) { xs.forEach(x => this.child(x)); return this; }
  when(on, fn) { return on ? fn(this) : this; }
  id(id) { this.key = id; return this; }
  on_click(fn) { this.handlers.click = fn; return this; }
  on_mouse_down(_button, fn) { this.handlers.down = fn; return this; }
}
const el = () => new Element();
const kit = { View: class {}, div: el, svg: el, image: el };
const base = { v_flex: el, h_flex: el, Popup: { new: el }, Popover: { new: el },
  ScrollHandle: { new: () => ({ scroll_to_item: i => calls.push({scroll:i}), release() {} }) }, Input: {new:el}, NumberInput:{new:el}, Select:{new:el}, InputState: { new: () => ({ on() {}, text: () => '' }) } };
const herdr = {
  terminals: () => all, agents: () => runs, panes: () => ps, spaces: () => sp, focused: () => focus,
  shared: k => shared.get(k), setShared: (k,v) => shared.set(k,v),
  run: (name,args) => { calls.push({name,args}); if (name==='terminal.pin') { const k=all.find(k=>k.address===args.terminal); if (k) k.labels={...k.labels,'herdr.pinned':args.pinned?'1':''}; } }, props: () => modProps, theme: () => theme,
  keys: () => ({}), machines: () => [], closeOverlay: id => calls.push({close:id}), exec: async () => ({}), readTextFile: async () => null, appHome: () => "", settings: () => ({zoom:1}), layout: () => null, window: () => ({}), setAgentOrder() {},
  notify() {}, openOverlay: spec => calls.push({overlay:spec}), nextCommand: () => new Promise(() => {}),
  hc: async ([cmd, address, label]) => {
    assert.equal(cmd, 'label'); const i = label.indexOf('=');
    const k = all.find(k => k.address === address);
    k.labels = {...k.labels, [label.slice(0,i)]: label.slice(i+1)};
    return {code:0};
  },
};
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) };
const cache = new Map();
async function load(path) {
  if (cache.has(path)) return cache.get(path);
  const module = new SourceTextModule(await readFile(path,'utf8'), {identifier:path});
  cache.set(path,module);
  await module.link(async (specifier, ref) => {
    const exports = specifier.startsWith('.') ? null : ({'gpui-kit':kit,'gpui-base':base,herdr})[specifier] ?? await import(specifier);
    if (exports) return new SyntheticModule(Object.keys(exports), function() {
      for (const [k,v] of Object.entries(exports)) this.setExport(k,v);
    });
    return load(resolve(dirname(ref.identifier),specifier));
  });
  return module;
}
const main = await load(resolve(root,'main.js')); await main.evaluate();
const Inbox = main.namespace.default;
const { inboxActions } = cache.get(resolve(root,'actions.js')).namespace;
const { inboxDrag } = cache.get(resolve(root,'drag.js')).namespace;
const { inboxRowView } = cache.get(resolve(root,'row-view.js')).namespace;
const { inboxRoots, childActivity } = cache.get(resolve(root,'subagents.js')).namespace;
const cx = {notify(){}, stop_propagation(){}, focus_handle:()=>({is_focused:()=>false,focus(){}}),
  timer:{every:()=>({cancel(){}}),after:()=>({cancel(){}})}, spawn: fn => {fn(cx);} };
const term = (address,parent,status='idle',extra={}) => ({address,parent,status,state:'live',turn:2,labels:{},...extra});
const agent = address => ({...all.find(k=>k.address===address),pane:`p-${address}`,tab:'test-tab',space:'test-space',space_name:'Test',program:{name:'Test'},title:address});
function setup() {
  all = [term('root',null), term('shell','root',null), term('child','shell'), term('deep','child')];
  runs = ['root','child','deep'].map(agent); ps = runs; sp = [{id:'test-space',tabs:[{id:'test-tab'}]}]; focus = {};
  calls=[]; shared=new Map(); storage=new Map();
  const v=new Inbox(); v.init({},cx); return v;
}
const ids = xs => xs.map(k=>k.address);
const flush = () => new Promise(resolve => setImmediate(resolve));
const find = (node, id) => node?.key===id ? node : node?.nodes?.map(n=>find(n,id)).find(Boolean);
function draw(view,model) {
  const actions=inboxActions(view,model);
  const drag={row:x=>x,open:()=>()=>{},swept:()=>false,justDropped:()=>false,sweepFrom:()=>()=>{},kidLift:()=>()=>{}};
  return inboxRowView(view,theme,model,actions,drag);
}

let v=setup(), m=v.compute(cx,false);
assert.deepEqual(ids(m.every),['root']);
inboxActions(v,m).go(m.every[0]);
assert.deepEqual(calls.at(-1),{name:'agent.focus',args:{terminal:'root'}});
inboxActions(v,m).go({mod:'test-mod',pane:'mod-pane'});
assert.deepEqual(calls.at(-1),{name:'pane.focus',args:{pane:'mod-pane'}});
assert.deepEqual(ids(m.children.get('root')),['child','deep']);
assert.equal(m.state(m.every[0]),'idle');
let card=draw(v,m).card(m.every[0]);
assert.ok(find(card,'children-root')); assert.equal(find(card,'subagents-root'),undefined);
// Use the actual chevron handler, including persistence and event propagation.
find(card,'children-root').handlers.click({},cx);
card=draw(v,m).card(m.every[0]);
assert.ok(find(card,'child-root-child')); assert.ok(find(card,'child-root-deep'));
assert.equal(find(card,'subagents-root').nodes.length,2);
find(card,'child-root-deep').handlers.click({},cx);
assert.deepEqual(calls.at(-1),{name:'terminal.peek',args:{terminal:'deep'}});
// Omarchy replaces only the frame; a machine-qualified address survives both paths.
const { peekTerminal } = cache.get(resolve(root,'peek.js')).namespace;
assert.equal(await readFile(resolve(root,'peek.js'),'utf8'),
  await readFile(resolve(root,'../omarchy-agents/peek.js'),'utf8'));
shared.set('layout','omarchy');
find(card,'child-root-deep').handlers.click({},cx);
let spec=calls.at(-1).overlay;
assert.equal(spec.frame,'none'); assert.equal(spec.kind,'dialog');
assert.equal(spec.layout.radius,0); assert.deepEqual(spec.layout.border,{width:2,color:'accent'});
assert.equal(spec.layout.children[0].content.mod,'omarchy-peek');
assert.equal(spec.layout.children[0].content.props.terminal,'deep');
assert.equal(spec.layout.children[1].content.terminal,'deep');
peekTerminal('remote/child');
assert.equal(calls.at(-1).overlay.layout.children[1].content.terminal,'remote/child');
shared.set('layout','main'); peekTerminal('remote/child');
assert.deepEqual(calls.at(-1),{name:'terminal.peek',args:{terminal:'remote/child'}});
assert.equal(find(card,'settle-child'),undefined);
find(card,'children-root').handlers.click({},cx);
assert.equal(find(draw(v,m).card(m.every[0]),'subagents-root'),undefined);
assert.equal(JSON.parse(storage.get('children-open')).root,false);

// Blocked/error descendants roll up, auto-open without an override, and manual closure wins.
all.find(k=>k.address==='deep').status='blocked'; delete v.childChoices.root;
m=v.compute(cx,false); assert.equal(m.state(m.every[0]),'blocked');
card=draw(v,m).card(m.every[0]); assert.ok(find(card,'subagents-root'));
find(card,'children-root').handlers.click({},cx);
assert.equal(find(draw(v,m).card(m.every[0]),'subagents-root'),undefined);
const restored=new Inbox(); restored.init({},cx); assert.equal(restored.childChoices.root,false);
all.find(k=>k.address==='deep').status='error'; m=v.compute(cx,false); assert.equal(m.state(m.every[0]),'blocked');
assert.equal(childActivity({status:'working',report:{msg:'Building\n two targets'}}),'Building two targets');

// Missing/ended links and live non-inbox parents promote children; shell links do not.
v=setup(); all[0].state='finished'; runs=runs.filter(a=>a.address!=='root');
assert.deepEqual(ids(v.compute(cx,false).every),['child']);
v=setup(); runs=runs.filter(a=>a.address==='root'); all[0].state='finished'; runs=[];
m=v.compute(cx,false); assert.deepEqual(ids(m.every),['child']);
assert.equal(m.every[0].pane,null); assert.equal(m.every[0].space_name,'Subagents');
inboxActions(v,m).go(m.every[0]);
assert.deepEqual(calls.at(-1),{name:'terminal.peek',args:{terminal:'child'}});
// A pane-less orphan remains actionable and Clear ends it and its descendants.
inboxActions(v,m).settle(m.every,cx); await flush(); m=v.compute(cx,false);
inboxActions(v,m); v.clearSettled();
assert.ok(calls.some(c=>c.name==='terminal.kill'&&c.args.terminal==='child'));
assert.ok(calls.some(c=>c.name==='terminal.kill'&&c.args.terminal==='deep'));
v=setup(); all=all.filter(k=>k.address!=='shell'); assert.deepEqual(ids(v.compute(cx,false).every),['root','child']);
v=setup(); runs=runs.filter(a=>a.address!=='root'); assert.deepEqual(ids(v.compute(cx,false).every),['child']);
assert.deepEqual(ids(inboxRoots([{address:'a'},{address:'b'}],[term('a','b'),term('b','a')])),['a']);

// Focusing a nested agent lights its top-level parent.
v=setup(); focus={terminal:'deep',agent:'deep'}; m=v.compute(cx,false); assert.equal(m.inView,'root');

// Settle/unsettle and Undo include every agent, with its own turn, old pin and snooze state.
v=setup(); const wake=Date.now()+3600000;
all[2].turn=7; all[2].labels={'herdr.pinned':'true',snoozed:String(wake),settled:'10:7'};
m=v.compute(cx,false); inboxActions(v,m).settle(m.every,cx); await flush();
for(const k of all.filter(k=>k.status)) assert.ok(k.labels.settled.endsWith(`:${k.turn}`));
assert.equal(all[2].labels.snoozed,''); assert.ok(calls.some(c=>c.name==='terminal.pin'&&c.args.terminal==='child'&&!c.args.pinned));
v.undo(cx); await flush();
assert.equal(all[0].labels.settled,''); assert.equal(all[2].labels.settled,'10:7'); assert.equal(all[2].labels.snoozed,String(wake));
assert.ok(calls.some(c=>c.name==='terminal.pin'&&c.args.terminal==='child'&&c.args.pinned));

// Settled and snoozed rows retain the same flat descendant view.
v=setup(); all[0].labels.settled=`${Date.now()}:2`; v.childChoices.root=true;
m=v.compute(cx,false); assert.ok(find(draw(v,m).slim(m.every[0]),'child-root-deep'));
find(draw(v,m).slim(m.every[0]),'child-root-deep').handlers.click({},cx);
assert.deepEqual(calls.at(-1),{name:'terminal.peek',args:{terminal:'deep'}});
v=setup(); all[0].labels.snoozed=String(wake); v.childChoices.root=true;
m=v.compute(cx,false); assert.ok(find(draw(v,m).slim(m.every[0]),'child-root-deep'));
find(draw(v,m).slim(m.every[0]),'child-root-deep').handlers.click({},cx);
assert.deepEqual(calls.at(-1),{name:'terminal.peek',args:{terminal:'deep'}});
// A failure automatically ends the snooze on every member, including hidden descendants.
v=setup(); for(const k of all.filter(k=>k.status)) k.labels.snoozed=String(wake);
all[3].status='error'; v.compute(cx,false); await flush();
assert.ok(all.filter(k=>k.status).every(k=>!k.labels.snoozed));

// Snooze and Undo restore each descendant's previous wake time; Wake affects the whole tree.
v=setup(); all[2].labels.snoozed=String(wake);
m=v.compute(cx,false); inboxActions(v,m).pick(m.every[0],{hours:2},cx); await flush();
assert.equal(all[0].labels.snoozed,all[2].labels.snoozed); assert.equal(all[2].labels.snoozed,all[3].labels.snoozed);
v.undo(cx); await flush(); assert.equal(all[0].labels.snoozed,''); assert.equal(all[2].labels.snoozed,String(wake));
m=v.compute(cx,false); m.wake(m.every[0],cx); await flush(); assert.equal(all[2].labels.snoozed,'');

// Clear rechecks after its confirmation and kills all descendants, even outliving ones.
v=setup(); all[0].labels.settled=`${Date.now()}:2`; m=v.compute(cx,false);
inboxActions(v,m); all[3].status='working'; v.clearSettled(); assert.equal(calls.filter(c=>c.name==='pane.close').length,0);
all[3].status='blocked'; v.clearSettled(); assert.equal(calls.filter(c=>c.name==='pane.close').length,0);
all[3].status='idle'; v.clearSettled();
assert.ok(calls.some(c=>c.name==='terminal.kill'&&c.args.terminal==='deep'));
assert.ok(calls.some(c=>c.name==='terminal.kill'&&c.args.terminal==='child'));
assert.ok(calls.some(c=>c.name==='pane.close'&&c.args.pane==='p-root'));
// Pinned sub-agents: a pinned child is promoted to a Pinned row and stays in its parent's card (decisions 1-3, 9).
const setStatus = (a,st) => { all.find(k=>k.address===a).status=st; const r=runs.find(k=>k.address===a); if (r) r.status=st; };
const pinCalls = () => calls.filter(c=>c.name==='terminal.pin');
v=setup(); all[2].labels['herdr.pinned']='1'; // as `hc run --label herdr.pinned=1` spawns it
m=v.compute(cx,false);
assert.deepEqual(ids(m.pinned),['child']); assert.deepEqual(ids(m.out),['root']);
assert.deepEqual(ids(m.children.get('root')),['child','deep']);
// Pinning the child alone leaves its parent in its own section; a working parent stays on the Working shelf.
setStatus('root','working'); m=v.compute(cx,false);
assert.deepEqual(ids(m.pinned),['child']); assert.deepEqual(ids(m.work),['root']); setStatus('root','idle');
// The child's own state shows on its top row, and still counts toward the parent's tree (decision 9).
setStatus('child','blocked'); m=v.compute(cx,false);
assert.equal(m.state(m.pinned[0]),'blocked'); assert.equal(m.state(m.every.find(a=>a.address==='root')),'blocked');
setStatus('child','idle');
// Its row names the parent, with an up arrow; the parent's own top row has neither.
m=v.compute(cx,false);
let top=draw(v,m).card(m.pinned[0]);
assert.ok(find(top,'parent-child')); assert.ok(find(top,'up-child'));
assert.equal(find(draw(v,m).card(m.out[0]),'parent-root'),undefined); assert.equal(find(draw(v,m).card(m.out[0]),'up-root'),undefined);
assert.equal(m.parentOf(m.pinned[0]).address,'root'); assert.equal(m.parentOf(m.out[0]),null);
// The pinned state is visible in both places: pin button on the top row and on the child's row inside the parent's card.
v.childChoices.root=true; card=draw(v,m).card(m.out[0]);
assert.ok(find(card,'pin-root')); assert.ok(find(card,'pin-child-root-child')); assert.ok(find(card,'pin-child-root-deep'));
assert.equal(find(card,'pin-child-root-child').attrs.opacity[0],1); assert.equal(find(card,'pin-child-root-deep').attrs.opacity[0],0);
// The up arrow expands the parent's children, and marks the child's row to highlight; the parent stays where it is.
v=setup(); all[2].labels['herdr.pinned']='1'; m=v.compute(cx,false); delete v.childChoices.root;
find(draw(v,m).card(m.pinned[0]),'up-child').handlers.click({},cx);
assert.equal(v.childChoices.root,true); assert.equal(JSON.parse(storage.get('children-open')).root,true);
assert.equal(v.flash.address,'child'); assert.ok(v.flash.until>Date.now()); assert.equal(v.reveal,'root');
// A parent in Settled opens that shelf.
v=setup(); all[2].labels['herdr.pinned']='1'; all[0].labels.settled=`${Date.now()}:2`; m=v.compute(cx,false);
assert.deepEqual(ids(m.put),['root']); assert.deepEqual(ids(m.pinned),['child']);
find(draw(v,m).card(m.pinned[0]),'up-child').handlers.click({},cx); assert.equal(v.open,true);
// Its terminal ends: the pin row goes.
v=setup(); all[2].labels['herdr.pinned']='1'; all[2].state='finished'; runs=runs.filter(a=>a.address!=='child');
assert.deepEqual(ids(v.compute(cx,false).pinned),[]);
// Settling the child clears its pin; settling the parent clears its descendants' pins; Undo restores them.
v=setup(); all[2].labels['herdr.pinned']='1'; m=v.compute(cx,false); calls=[];
inboxActions(v,m).settle([m.pinned[0]],cx); await flush();
assert.ok(pinCalls().some(c=>c.args.terminal==='child'&&!c.args.pinned));
v=setup(); all[3].labels['herdr.pinned']='1'; m=v.compute(cx,false); calls=[];
inboxActions(v,m).settle([m.out[0]],cx); await flush();
assert.ok(pinCalls().some(c=>c.args.terminal==='deep'&&!c.args.pinned));
calls=[]; v.undo(cx); await flush();
assert.ok(pinCalls().some(c=>c.args.terminal==='deep'&&c.args.pinned));
// Earlier pins were echoed to a snapshot setup() has since replaced; let pins.js's 10s patience for them run out.
const realNow=Date.now; Date.now=()=>realNow()+11000;
v=setup(); all[2].labels['herdr.pinned']='1'; m=v.compute(cx,false); v.childChoices.root=true; card=draw(v,m).card(m.out[0]);
// Click toggles: unpin the child, pin the other.
calls=[]; find(card,'pin-child-root-child').handlers.click({},cx);
assert.deepEqual(pinCalls().map(c=>c.args),[{terminal:'child',pinned:false}]);
// Hidden, the button is no button: a press or click there is the row's (peek, drag). Visible while the pointer is on the row.
assert.equal(find(card,'pin-child-root-deep').handlers.click,undefined); assert.equal(find(card,'pin-child-root-deep').handlers.down,undefined);
v.hoverKid='deep'; card=draw(v,m).card(m.out[0]);
assert.equal(find(card,'pin-child-root-deep').attrs.opacity[0],1);
// The row's hover alone shows it; the button's own hover only lights it, and leaving the button doesn't hide it.
globalThis.window={};
v.hoverKid=null; card=draw(v,m).card(m.out[0]); assert.equal(find(card,'pin-child-root-deep').attrs.opacity[0],0);
find(card,'child-root-deep').attrs.on_hover[0](true,cx); assert.equal(v.hoverKid,'deep'); assert.ok(!v.hot);
card=draw(v,m).card(m.out[0]); assert.equal(find(card,'pin-child-root-deep').attrs.opacity[0],1);
find(card,'pin-child-root-deep').attrs.on_hover[0](true,cx); assert.equal(v.hot,'pin-child-root-deep'); assert.equal(v.hoverKid,'deep');
find(card,'pin-child-root-deep').attrs.on_hover[0](false,cx); assert.equal(v.hot,null); assert.equal(v.hoverKid,'deep');
card=draw(v,m).card(m.out[0]); assert.equal(find(card,'pin-child-root-deep').attrs.opacity[0],1);
find(card,'child-root-deep').attrs.on_hover[0](false,cx); assert.equal(v.hoverKid,null);
v.hoverKid='deep'; card=draw(v,m).card(m.out[0]);
calls=[]; find(card,'pin-child-root-deep').handlers.click({},cx);
assert.deepEqual(pinCalls().map(c=>c.args),[{terminal:'deep',pinned:true}]);
// The row keeps its own click with the button there, and clicking the button doesn't reach it.
calls=[]; find(card,'child-root-deep').handlers.click({},cx); assert.deepEqual(calls.at(-1),{name:'terminal.peek',args:{terminal:'deep'}});
v.hoverKid=null; v.hot=null;
// The top row's button toggles its own agent.
// A top row's hidden button takes neither press (drag) nor click (open); the row's own handlers are untouched.
v.hovered=null; v.hot=null; top=draw(v,m).card(m.out[0]);
assert.equal(find(top,'pin-root').attrs.opacity[0],0); assert.equal(find(top,'pin-root').handlers.down,undefined); assert.equal(find(top,'pin-root').handlers.click,undefined);
assert.equal(typeof find(top,'card-root').handlers.click,'function');
v.hovered='root'; calls=[]; find(draw(v,m).card(m.out[0]),'pin-root').handlers.click({},cx);
assert.deepEqual(pinCalls().map(c=>c.args),[{terminal:'root',pinned:true}]);
assert.ok(find(draw(v,m).card(m.pinned[0]),'pin-child'));
Date.now=realNow;
// A working pinned child: the parent settles anyway, the child keeps its state and its pin is gone.
v=setup(); all[2].labels['herdr.pinned']='1'; setStatus('child','working'); m=v.compute(cx,false);
assert.ok(find(draw(v,m).card(m.pinned[0]),'state-child'));
// Dragging, through the real drag.js: a sub-agent's row in its parent's card lifts to Pinned, and a pinned one drags out.
{
  const later=Date.now; Date.now=()=>later()+30000; globalThis.window={};
  const down={position:{x:0,y:0},local_position:{y:5},bounds:{height:30}};
  const real=(view)=>{ const model=view.compute(cx,false); const actions=inboxActions(view,model); const dr=inboxDrag(view,theme,model,actions);
    return {model,actions,dr,views:inboxRowView(view,theme,model,actions,dr)}; };
  const moveBy=(view,dr,y)=>find(dr.root(el()),'x'),
    pointer=(dr,y)=>dr.root(el()).attrs.on_mouse_move[0]({position:{x:0,y},local_position:{x:1,y},bounds:{}},cx),
    release=(dr)=>dr.root(el()).attrs.on_mouse_up[1]({},cx);
  // A press on the child row alone lifts nothing: a click still peeks.
  v=setup(); v.childChoices.root=true; let r=real(v); card=r.views.card(r.model.out[0]);
  find(card,'child-root-deep').handlers.down(down,cx);
  assert.equal(v.drag.from,'deep'); assert.equal(v.drag.moved,false);
  calls=[]; find(card,'child-root-deep').handlers.click({},cx); assert.deepEqual(calls.at(-1),{name:'terminal.peek',args:{terminal:'deep'}});
  // Movement past 6px lifts it; over Pinned it says Pin, and letting go pins it.
  r=real(v); pointer(r.dr,3); assert.equal(v.drag.moved,false); pointer(r.dr,20); assert.equal(v.drag.moved,true);
  r=real(v); assert.equal(r.dr.lifted.address,'deep'); r.dr.aim(r.dr.pinTo(null),cx);
  r=real(v); assert.equal(r.dr.verb,'pin'); assert.equal(r.dr.plan.section,'pinned');
  calls=[]; release(r.dr);
  assert.deepEqual(pinCalls().map(c=>c.args),[{terminal:'deep',pinned:true}]);
  // The click that ends a drag doesn't also peek.
  calls=[]; find(card,'child-root-deep').handlers.click({},cx); assert.equal(calls.filter(c=>c.name==='terminal.peek').length,0);
  // Not into Active or Settled: no plan there.
  v=setup(); v.childChoices.root=true; r=real(v); find(r.views.card(r.model.out[0]),'child-root-deep').handlers.down(down,cx);
  r=real(v); pointer(r.dr,20); r=real(v); r.dr.aim({section:'settled'},cx); r=real(v); assert.equal(r.dr.plan,null);
  // A promoted pinned sub-agent's top row drags out to Unpin, like a root's.
  v=setup(); all[2].labels['herdr.pinned']='1'; r=real(v);
  find(r.dr.row(el(),r.model.pinned[0],()=>el()),'x'); 
  r.dr.row(el(),r.model.pinned[0],()=>el()).handlers.down(down,cx); assert.equal(v.drag.from,'child');
  r=real(v); pointer(r.dr,20); r=real(v); r.dr.aim({section:'active'},cx); r=real(v);
  assert.equal(r.dr.verb,'unpin'); calls=[]; release(r.dr);
  assert.ok(pinCalls().some(c=>c.args.terminal==='child'&&c.args.pinned===false));
  Date.now=later;
}
// The themed header closes only its overlay; keep/go-to retain the native actions.
const header = await load(resolve(root,'../omarchy-peek/main.js')); await header.evaluate();
const peek = new header.namespace.default();
modProps={terminal:'remote/child',overlay:'peek-overlay'};
ps=[]; calls=[];
find(peek.render(),'keep').handlers.click({},cx);
assert.deepEqual(calls,[{name:'terminal.keep',args:{terminal:'remote/child'}},{close:'peek-overlay'}]);
ps=[{terminal:'remote/child',pane:'remote/child-pane'}]; calls=[];
find(peek.render(),'keep').handlers.click({},cx);
assert.deepEqual(calls,[{name:'pane.focus',args:{pane:'remote/child-pane'}},{close:'peek-overlay'}]);
calls=[]; find(peek.render(),'close').handlers.click({},cx);
assert.deepEqual(calls,[{close:'peek-overlay'}]);
console.log('PASS inbox subagents: grouping, rows, persistence, orphans, focus, settle/snooze/undo, guarded clear, Omarchy peek frame and header controls');
