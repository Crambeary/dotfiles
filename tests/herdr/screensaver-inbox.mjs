// node --experimental-vm-modules tests/herdr/screensaver-inbox.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {SourceTextModule, SyntheticModule} from 'node:vm';

const root = resolve('private_dot_config/herdr-app/mods/screensaver');
const all = [{address:'root', state:'live', status:'blocked', labels:{}},
  {address:'child', parent:'root', state:'live', status:'working', labels:{}}];
let runs = [{...all[0], space_name:'Project', title:'Fix the renderer', program:{name:'Codex'}},
  {...all[1], space_name:'Project', title:'Nested worker', program:{name:'Codex'}}];
const values = new Map();
const api = {agents:()=>runs, terminals:()=>all, spaces:()=>[], panes:()=>[],
  focused:()=>null, shared:k=>values.get(k), setShared(){}, run(){}, machines:()=>[],
  window:()=>({}), keys:()=>({}), updates:()=>({}), home:()=>'/home/test', exec:async()=>({}),
  appHome:()=>'', readTextFile:async()=>''};
const cache = new Map();
async function load(path) {
  if(cache.has(path)) return cache.get(path);
  const m = new SourceTextModule(await readFile(path,'utf8'), {identifier:path});
  cache.set(path,m);
  await m.link((name,ref)=> name==='herdr'
    ? new SyntheticModule(Object.keys(api),function(){for(const [k,v] of Object.entries(api)) this.setExport(k,v);})
    : load(resolve(dirname(ref.identifier),name)));
  return m;
}
const m=await load(resolve(root,'draw-omarchy.js')); await m.evaluate();
const draw=m.namespace.mods['omarchy-inbox'];
assert.equal(typeof draw,'function','Omarchy inbox must have a screensaver drawer');
let text=[];
const g={text:(_x,_y,s)=>{text.push(s); return String(s).length;},
  rtext:(_x,_y,s)=>{text.push(s); return String(s).length;}, put(){}, hline(){}};
const cx={t:{}, z:1, ch:20, cw:10, rowOf:y=>Math.floor(y/20)};
draw(g,{x:0,y:0,w:40,h:50,py:0,ph:1000},cx);
assert.ok(text.includes('Fix the renderer'),'inbox card title must appear');
assert.ok(!text.includes('Nested worker'),'children must not become duplicate root cards');
text=[]; runs=[]; all.length=0;
draw(g,{x:0,y:0,w:40,h:50,py:0,ph:1000},cx);
assert.ok(text.includes('Nothing here yet.'),'empty inbox must have text');
console.log('PASS screensaver inbox: title, grouped children, empty state');
