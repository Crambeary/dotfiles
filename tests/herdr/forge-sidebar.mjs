// node --experimental-vm-modules tests/herdr/forge-sidebar.mjs
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, stat, utimes } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { SourceTextModule, SyntheticModule } from 'node:vm';

const root = 'private_dot_config/herdr-app/';
const helper = await readFile(`${root}mods/omarchy-forge-sidebar/context.js`, 'utf8');
const context = await import(`data:text/javascript,${encodeURIComponent(helper)}`);
const { contextOf, visible, projectOf, parseReply, readArgs, BACKEND_VERSION, validateBackend } = context;
const versionReply = { code: 0, stdout: JSON.stringify({ version: BACKEND_VERSION, shapes: 2 }) };
// Run the actual launcher against an inert backend fixture, with an old mtime:
// ongoing sidebar use must prevent Forge's two-week cleanup deleting the pin.
const runFile = promisify(execFile);
await runFile('/usr/bin/git', ['check-ignore', '-q', '.scratch/']);
const fixtureDir = resolve('.scratch/forge-sidebar-launch fixture');
await mkdir(fixtureDir, { recursive: true });
const fixturePath = `${fixtureDir}/forge-${BACKEND_VERSION}.py`;
await writeFile(fixturePath, 'import json,sys\nprint(json.dumps({"argv":sys.argv,"file":__file__,"main":__name__}))\n');
const oldTime = new Date(Date.now() - 21 * 86400000);
await utimes(fixturePath, oldTime, oldTime);
const launchedAt = Date.now();
const launched = await runFile('/bin/sh', readArgs({ provider: 'gitlab', host: 'host', repo: 'org/repo with spaces' }, 'requests'),
  { env: { PATH: '/usr/bin:/bin', HERDR_FORGE_HOME: fixtureDir } });
const bootOut = JSON.parse(launched.stdout);
assert.ok((await stat(fixturePath)).mtimeMs >= launchedAt - 1000, 'launcher refreshes last-used mtime');
assert.equal(bootOut.file, fixturePath);
assert.equal(bootOut.main, '__main__');
assert.deepEqual(bootOut.argv, [fixturePath, 'requests', 'gitlab', 'host', 'org/repo with spaces', '60', '0']);
await assert.rejects(runFile('/bin/sh', context.versionArgs(), { env: { PATH: '/usr/bin:/bin', HERDR_FORGE_HOME: `${fixtureDir}/absent` } }),
  e => e.code === 2, 'missing backend is not created');
let space = { id: 'a', active: true, folder: '/fallback', machine: null, tabs: [{ id: 'tab', active: true }] };
let ps = [{ terminal: 't1', tab: 'tab', cwd: '/repo', focused: false }, { terminal: 't2', tab: 'other', cwd: '/wrong' }];
let focus = { space: 'a', terminal: null, cwd: '/mod' };
assert.equal(contextOf([space], ps, focus).cwd, '/repo', 'mod focus preserves active-space terminal context');
assert.equal(contextOf([space], ps, { space: 'elsewhere', terminal: 't2', cwd: '/wrong' }).cwd, '/repo');
assert.equal(contextOf([space], [], focus).cwd, '/fallback');
assert.equal(projectOf('git@git.tecplot.com:group/repo.git', { on: 'remote' }).repo, 'group/repo');
assert.equal(projectOf('https://github.com/org/repo.git', {}).provider, 'github');
assert.equal(projectOf('ssh://git@git.example.com:22/team/repo.git', {}).host, 'git.example.com');
assert.throws(() => projectOf('file:///repo', {}));
assert.throws(() => parseReply({ code: 0, stdout: '{"error":"offline"}' }, 'requests'), /offline/);
assert.throws(() => parseReply({ code: 0, stdout: '{}' }, 'requests'), /no list/);
assert.deepEqual(parseReply({ code: 0, stdout: '{"requests":[]}' }, 'requests').rows, []);
const cached = parseReply({ code: 0, stdout: '{"requests":[{"iid":7}],"at":123,"error":"offline"}' }, 'requests');
assert.equal(cached.rows[0].iid, 7);
assert.equal(cached.at, 123000, 'cached timestamp is retained');
assert.equal(cached.error, 'offline');
assert.equal(parseReply({ code: 0, stdout: '{"requests":[],"error":"offline"}' }, 'requests').at, null, 'failed fetch never invents a fresh timestamp');
validateBackend(versionReply);
assert.throws(() => validateBackend({ code: 2, stdout: '' }), /missing.*Open the installed Forge/);
assert.throws(() => validateBackend({ code: 0, stdout: '{"version":"999","shapes":2}' }), /Incompatible/);
assert.throws(() => validateBackend({ code: 0, stdout: JSON.stringify({ version: BACKEND_VERSION, shapes: 3 }) }), /Incompatible/);
assert.deepEqual(readArgs({ provider: 'gitlab', host: 'host', repo: 'org/repo' }, 'requests').slice(3),
  ['requests', 'gitlab', 'host', 'org/repo', '60', '0']);

class Element {
  constructor() { this.nodes = []; const proxy = new Proxy(this, { get: (o, k) => k in o ? o[k] : () => proxy }); return proxy; }
  id(key) { this.key = key; return this; }
  child(node) { this.nodes.push(node); return this; }
  children(nodes) { nodes.forEach(n => this.child(n)); return this; }
  when(on, fn) { return on ? fn(this) : this; }
  on_click(fn) { this.click = fn; return this; }
  trigger(n) { this.nodes.push(n); return this; }
  content(n) { this.nodes.push(n); return this; }
  on_hover(fn) { this.hover = fn; return this; }
}
const el = () => new Element();
const colors = new Proxy({}, { get: () => '#112233' });
let tree = { id: 'root', children: [{ id: 'forge-sidebar', hidden: true }] };
assert.equal(visible(tree, 'forge-sidebar'), false);
assert.equal(visible({ hidden: true, children: [{ id: 'forge-sidebar' }] }, 'forge-sidebar'), false);
assert.equal(visible({ type: 'stack', active: 'other', children: [{ id: 'forge-sidebar' }] }, 'forge-sidebar'), false);
const state = new Map(), calls = [], runs = [], tasks = [];
let checking = false;
const api = {
  checking: () => checking, spaces: () => [space], panes: () => ps, focused: () => focus,
  layout: () => tree, theme: () => colors, shared: key => state.get(key), setShared: (key, value) => state.set(key, value),
  run: (name, args) => runs.push([name, args]), nextCommand: () => new Promise(() => {}),
  exec: (...args) => new Promise(resolve => calls.push({ args, resolve })),
};
async function load(name) {
  const cache = new Map();
  async function build(path) {
    if (cache.has(path)) return cache.get(path);
    const source = await readFile(path, 'utf8');
    const module = new SourceTextModule(source);
    cache.set(path, module);
    await module.link(async specifier => {
      if (name === 'omarchy-forge-sidebar' && specifier.startsWith('./')) return build(resolve(dirname(path), specifier));
      const names = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)]
        .filter(m => m[2] === specifier).flatMap(m => m[1].split(',').map(n => n.trim()));
      return new SyntheticModule(names, function () {
        for (const key of names) this.setExport(key, key === 'View' ? class {} : key === 'Popup' ? { new: (_id, trigger) => el().child(trigger) } :
          ['div', 'svg', 'h_flex', 'v_flex'].includes(key) ? el : api[key] ?? (() => {}));
      });
    });
    return module;
  }
  const module = await build(resolve(`${root}mods/${name}/main.js`));
  await module.evaluate();
  return module.namespace.default;
}
const Sidebar = await load('omarchy-forge-sidebar');
let timer;
const cx = { notify() {}, timer: { every(_ms, fn) { timer = fn; } }, spawn(fn) { tasks.push(fn(cx)); } };
const sidebar = new Sidebar();
sidebar.init({}, cx);
timer(cx);
assert.equal(calls.length, 0, 'hidden startup never fetches');
tree.children[0].hidden = false;
timer(cx);
assert.equal(calls[0].args[0], 'git');
calls.shift().resolve({ code: 0, stdout: 'git@gitlab.com:org/repo.git' });
await new Promise(resolve => setImmediate(resolve));
assert.equal(calls[0].args[0], 'sh');
assert.equal(calls[0].args[1][3], 'version');
calls.shift().resolve(versionReply);
await new Promise(resolve => setImmediate(resolve));
const old = calls.shift();
// Switch space while a backend request is outstanding; old data must never land.
space = { ...space, id: 'b', folder: '/second', tabs: [{ id: 'second', active: true }] };
timer(cx);
old.resolve({ code: 0, stdout: '{"requests":[{"iid":99}]}' });
await new Promise(resolve => setImmediate(resolve));
assert.equal(sidebar.rows.length, 0, 'stale project reply rejected');
calls.shift().resolve({ code: 0, stdout: 'git@gitlab.com:org/second.git' });
await new Promise(resolve => setImmediate(resolve));
calls.shift().resolve(versionReply);
await new Promise(resolve => setImmediate(resolve));
calls.shift().resolve({ code: 0, stdout: '{"requests":[{"iid":1,"title":"Example","url":"https://gitlab.com/org/second/-/merge_requests/1"}],"at":100,"error":"offline"}' });
await new Promise(resolve => setImmediate(resolve));
assert.equal(sidebar.rows[0].iid, 1);
assert.equal(sidebar.at, 100000);
assert.match(sidebar.error, /showing cached results.*offline/);
sidebar.render();
sidebar.select('pipelines', cx);
assert.equal(state.get('omarchy-forge-sidebar.view'), 'pipelines');
calls.shift().resolve({ code: 0, stdout: 'git@gitlab.com:org/second.git' });
await new Promise(resolve => setImmediate(resolve));
calls.shift().resolve(versionReply);
await new Promise(resolve => setImmediate(resolve));
assert.equal(calls[0].args[1][3], 'pipelines');
tree.children[0].hidden = true;
timer(cx);
calls.shift().resolve({ code: 0, stdout: '{"pipelines":[{"id":2}]}' });
await new Promise(resolve => setImmediate(resolve));
assert.equal(sidebar.rows.length, 0, 'reply after hide discarded');
timer(cx);
sidebar.refresh(cx, true);
assert.equal(calls.length, 0, 'hidden refresh never fetches');
// An incompatible backend must stop before any internal list command runs.
tree.children[0].hidden = false;
timer(cx);
calls.shift().resolve({ code: 0, stdout: 'git@gitlab.com:org/second.git' });
await new Promise(resolve => setImmediate(resolve));
calls.shift().resolve({ code: 0, stdout: '{"version":"999","shapes":2}' });
await new Promise(resolve => setImmediate(resolve));
assert.equal(calls.length, 0);
assert.match(sidebar.error, /Incompatible Forge backend/);
assert.equal(sidebar.rows.length, 0);
checking = true;
const checked = new Sidebar(); checked.init({}, cx); checked.render();
assert.equal(calls.length, 0, 'check has no process side effects');
checking = false;

// Exact WATCH count semantics over Forge jobs; status alone supplies no percent.
const progressSource = await readFile(`${root}mods/omarchy-forge-sidebar/progress.js`, 'utf8');
const { progressOf, summarize } = await import(`data:text/javascript,${encodeURIComponent(progressSource)}`);
const row = { id: 42, iid: 7, status: 'running', updated_ms: 10, ref: 'main' };
const jobs = [
  { status: 'success', group: 'build' }, { status: 'skipped', group: 'build' },
  { status: 'failed', group: 'test', allow_failure: true }, { status: 'running', group: 'test' },
  { status: 'pending', group: 'deploy' }, { status: 'manual', group: 'release' },
];
const entry = { jobs, at: Date.now(), status: row.status, updated_ms: row.updated_ms };
const progress = progressOf(row, entry);
assert.deepEqual(progress.parts, [2/5, 1/5, 1/5, 1/5]);
assert.equal(progress.data.counts.done, 3);
assert.equal(progress.data.counts.bad, 1, 'allowed failure remains a failed job');
assert.equal(progress.done, 1);
assert.equal(progress.phase, 'running');
assert.equal(progress.outdated, false);
assert.equal(progressOf(row).data, null);
assert.equal(progressOf(row, { ...entry, jobs: Array(100).fill(jobs[0]) }).data, null);
assert.equal(summarize([{ status: 'new-unknown-status' }]), null);
assert.equal(progressOf(row, { ...entry, at: Date.now() - 100000 }).outdated, true);
assert.equal(progressOf(row, { ...entry, error: 'offline' }).outdated, true);
assert.equal(progressOf({ ...row, updated_ms: 11 }, entry).outdated, true);
const finishedNow = { ...row, status: 'success', updated_ms: Date.now() };
assert.equal(progressOf(finishedNow, { ...entry, at: Date.now() - 2000, status: 'success', updated_ms: finishedNow.updated_ms }).outdated, true,
  'recent cached running jobs predating a newly terminal pipeline remain outdated');
assert.deepEqual(progressOf({ ...row, status: 'manual' }, { ...entry, jobs: [{status:'manual'}] }).parts, [0,0,0,0]);
assert.deepEqual(progressOf(row, { ...entry, jobs: [{status:'canceled'}] }).parts, [0,0,0,0]);
const soft = progressOf({ ...row, status: 'success' }, { ...entry, status: 'success', jobs: [{status:'failed', allow_failure:true}] });
assert.equal(soft.phase, 'passed');
assert.equal(soft.parts[1], 1, 'passed parent never hides failed jobs');
function words(n) { return typeof n === 'string' ? n : (n?.nodes ?? []).map(words).join(' '); }
sidebar.jobs.set(row.id, entry);
const cardWords = words(sidebar.progressCard(row, colors, 'gitlab'));
assert.match(cardWords, /jobs done/);
assert.match(cardWords, /inferred/);
assert.match(cardWords, /Parent jobs only; downstream/);
assert.match(words(sidebar.progressCard(row, colors, 'github')), /not pipeline stages/);
const oldEntry = sidebar.jobs.get(row.id);
sidebar.progressCard(row, colors, 'gitlab');
assert.equal(sidebar.jobs.get(row.id), oldEntry, 'hover render never mutates or fetches data');
assert.equal(calls.length, 0);

// Bounded enrichment: active runs first, four serial calls, cached timestamps,
// no duplicate on refresh, and late replies after hide/context changes dropped.
const enriched = new Sidebar(); enriched.init({}, cx);
enriched.rows = Array.from({length: 8}, (_,i) => ({id:i+1,status:i === 7 ? 'running' : 'success'}));
let currentJobs = true;
enriched.enrich(cx, { provider:'gitlab',host:'host',repo:'org/repo' }, () => currentJobs);
assert.equal(calls.length, 1, 'serial job reads');
assert.equal(calls[0].args[1][7], '8', 'active run first');
for (let i=0; i<4; i++) {
  assert.equal(calls.length, 1);
  calls.shift().resolve({code:0,stdout:JSON.stringify({jobs:[{status:'success',group:'build'}],at:123,error:'offline'})});
  await new Promise(resolve => setImmediate(resolve));
}
assert.equal(calls.length, 0);
assert.equal(enriched.jobs.size, 4);
assert.equal(enriched.jobs.get(8).at, 123000);
assert.equal(enriched.jobs.get(8).error, 'offline');
enriched.enrich(cx, {}, () => true);
assert.equal(calls.length, 0, 'refresh cannot exceed four/minute');
enriched.jobBudget.starts = [];
enriched.enrich(cx, {provider:'gitlab',host:'host',repo:'org/repo'}, () => currentJobs);
assert.equal(calls.length, 1);
currentJobs = false;
calls.shift().resolve({code:0,stdout:'{"jobs":[{"status":"failed"}],"at":456}'});
await new Promise(resolve => setImmediate(resolve));
assert.equal(calls.length, 0, 'no further jobs after hide/context invalidation');
assert.equal(enriched.jobs.get(8).at, 123000, 'late detail reply discarded');
assert.throws(() => context.jobsArgs({}, '1; echo bad'), /Invalid/);
assert.deepEqual(context.jobsArgs({provider:'gitlab',host:'host',repo:'org/repo'},42).slice(3), ['jobs','gitlab','host','org/repo','42','60','0']);

function node(n, id) { return n?.key === id ? n : (n?.nodes ?? []).map(c => node(c, id)).find(Boolean); }
sidebar.rows = [row];
sidebar.key = sidebar.currentKey();
sidebar.details = row.id;
const pipelineTree = sidebar.render();
assert.ok(node(pipelineTree, 'forge-sidebar-row-42'), 'actual pipeline row rendered through native hover trigger');
assert.ok(node(pipelineTree, 'forge-progress-card-42'), 'actual hover content constructed');
let hoverDelay, hoverWatch, hoverCancelled = 0;
const hoverCx = { notify() {}, timer: {
  after(_ms, fn) { hoverDelay = fn; return { cancel() { hoverCancelled++; } }; },
  every(_ms, fn) { hoverWatch = fn; return { cancel() { hoverCancelled++; } }; },
} };
node(pipelineTree, 'forge-sidebar-row-42').hover(true, hoverCx);
assert.equal(sidebar.hovered, 42);
assert.equal(sidebar.details, null, 'popup delayed until anchor has been measured');
hoverDelay(hoverCx);
assert.equal(sidebar.details, 42);
assert.ok(node(sidebar.render(), 'forge-progress-card-42'));
node(pipelineTree, 'forge-sidebar-row-42').hover(false, hoverCx);
assert.equal(sidebar.hovered, null);
assert.equal(sidebar.details, null);
assert.ok(hoverCancelled >= 2, 'leave cancels hover delay and watcher');
node(pipelineTree, 'forge-sidebar-row-42').hover(true, hoverCx);
tree.children[0].hidden = true;
hoverDelay(hoverCx);
hoverWatch(hoverCx);
assert.equal(sidebar.details, null, 'hidden sidebar cannot open a delayed popup');
assert.equal(sidebar.hovered, null);
tree.children[0].hidden = false;
assert.equal(calls.length, 0, 'hover never starts network reads');
api.window = () => ({});
api.props = () => ({ part: 'right' });
const Bar = await load('omarchy-bar');
const bar = new Bar();
tree = { id: 'root', children: [{ id: 'forge-sidebar', hidden: true }, { id: 'panel', children: [{ id: 'panel-body', active: 'changes', children: [{ id: 'files' }, { id: 'changes' }, { id: 'graph' }, { id: 'agenttrail' }] }] }] };
space.branch = 'main';
const toolbar = bar.right(el(), colors);
for (const id of ['panel-files', 'panel-changes', 'panel-graph', 'panel-agenttrail', 'forge-sidebar-toggle']) assert.ok(node(toolbar, id), `${id} preserved`);
node(toolbar, 'forge-sidebar-toggle').click();
assert.equal(runs.at(-1)[0], 'layout.toggle');
assert.equal(runs.at(-1)[1].id, 'forge-sidebar');
node(toolbar, 'panel-graph').click();
assert.deepEqual(runs.slice(-2).map(r => r[0]), ['layout.select', 'layout.show'], 'existing panel routing preserved');
assert.ok(node(bar.center(el(), colors), 'open-forge-window'), 'old Forge launcher preserved');

// Confirm the added block belongs to desk, never topbar/work/panel-body. Strip
// only the template directives used here so structure validation is repeatable.
let layoutSource = await readFile(`${root}layouts/omarchy.json.tmpl`, 'utf8');
layoutSource = layoutSource.replace(/\{\{[\s\S]*?\}\}/g, '');
// Conditional branches coexist after stripping; use source position and depth
// for the independent final desk child, without claiming a template render.
assert.match(layoutSource, /"id": "forge-sidebar"[\s\S]*"mod": "omarchy-forge-sidebar"/);
assert.equal((layoutSource.match(/"id": "forge-sidebar"/g) ?? []).length, 1);
assert.ok(layoutSource.indexOf('"id": "forge-sidebar"') > layoutSource.indexOf('"id": "panel-body"'));
// ---- Pipeline pins -------------------------------------------------------
const pinsSource = await readFile(`${root}mods/omarchy-forge-sidebar/pins.js`, 'utf8');
const { arrange, togglePin, readPins, pinKey, pinnedIn, snapshot, PINS, MAX_PINS } = await import(`data:text/javascript,${encodeURIComponent(pinsSource)}`);
const pa = { on: null, host: 'git.example.com', repo: 'team/app' };
const mk = (id, status = 'success') => ({ id, iid: id, ref: 'main', status, sha: 'abcdef012345', url: `https://x/${id}` });
const list = [mk(30), mk(20), mk(10), mk(5)];
assert.deepEqual(arrange(list, undefined, pa).map(i => i.row.id), [30, 20, 10, 5], 'no pins keeps backend order');
let raw = togglePin(undefined, pa, list[3], new Map(), 1000);
raw = togglePin(raw, pa, list[1], new Map(), 2000);
assert.deepEqual(arrange(list, raw, pa).map(i => [i.row.id, i.pinned]), [[20, true], [5, true], [30, false], [10, false]],
  'pinned first by ID desc, unpinned keep list order');
assert.deepEqual(arrange([...list].reverse(), raw, pa).slice(0, 2).map(i => i.row.id), [20, 5], 'pinned order independent of list order');
// toggle: second click unpins; invalid IDs are never pinned
raw = togglePin(raw, pa, list[1]);
assert.deepEqual(arrange(list, raw, pa).filter(i => i.pinned).map(i => i.row.id), [5]);
assert.equal(togglePin(raw, pa, { id: '1; x' }), raw);
assert.equal(togglePin(raw, pa, { id: -3 }), raw);
// persistence: survives a JSON round trip and discards malformed entries
const reloaded = JSON.parse(JSON.stringify(raw));
assert.deepEqual([...pinnedIn(reloaded, pa)], [5]);
assert.deepEqual(readPins({ v: 1, pins: [{ id: 'x', project: [null, 'h', 'r'] }, { id: 4, project: ['a'] }, null, { id: 4, project: [null, 'h', 'r'] }, { id: 4, project: [null, 'h', 'r'] }] }).map(e => e.id), [4],
  'malformed and duplicate entries dropped');
assert.deepEqual(readPins('garbage'), []);
assert.equal(Object.hasOwn(readPins(togglePin(undefined, pa, { ...mk(7), nested: { a: 1 } }))[0].row, 'nested'), false, 'snapshot keeps plain fields only');
// identity collision: same numeric ID on another machine, host or repo is never pinned
const others = [{ ...pa, on: 'remote' }, { ...pa, host: 'other.example.com' }, { ...pa, repo: 'team/app2' }, { on: null, host: 'git.example.com', repo: 'team/app' }];
let collide = togglePin(undefined, pa, mk(5));
for (const o of others.slice(0, 3)) {
  assert.notEqual(pinKey(o, 5), pinKey(pa, 5));
  assert.deepEqual(arrange([mk(5)], collide, o).map(i => [i.pinned, i.foreign ?? false]), [[true, true], [false, false]], `foreign pin and local numeric-ID twin both survive: ${JSON.stringify(o)}`);
}
assert.equal(arrange([mk(5)], collide, others[3])[0].pinned, true, 'same scope matches');
assert.notEqual(pinKey({ on: null, host: 'a', repo: 'b/c' }, 1), pinKey({ on: null, host: 'a/b', repo: 'c' }, 1), 'joined-string aliasing impossible');
collide = togglePin(collide, others[0], mk(5));
assert.equal(readPins(collide).length, 2, 'unpinning one scope leaves the other');
assert.equal(readPins(togglePin(collide, others[0], mk(5))).length, 1);
// cap
let many; for (let i = 1; i <= MAX_PINS + 5; i++) many = togglePin(many, pa, mk(i), new Map(), i);
assert.equal(readPins(many).length, MAX_PINS);
// older pinned row dropped from the recent list: cached row kept, flagged stale, with age
const seenMap = new Map([[pinKey(pa, 5), { row: mk(5, 'running'), at: 777000 }]]);
const droppedRaw = togglePin(undefined, pa, mk(5, 'running'), new Map(), 500);
const dropped = arrange([mk(30), mk(20)], droppedRaw, pa, seenMap, true);
assert.deepEqual(dropped.map(i => [i.row.id, i.pinned, i.stale]), [[5, true, true], [30, false, false], [20, false, false]]);
assert.equal(dropped[0].seenAt, 777000, 'newest in-memory observation wins');
assert.equal(dropped[0].unconfirmed, false);
const persistedOnly = arrange([mk(30)], droppedRaw, pa, new Map(), true)[0];
assert.equal(persistedOnly.seenAt, 500, 'falls back to persisted observation time');
// loading / failed refresh: cached pins stay visible, marked unconfirmed
const pending = arrange([], droppedRaw, pa, new Map(), false);
assert.deepEqual(pending.map(i => [i.row.id, i.stale, i.unconfirmed]), [[5, true, true]]);
assert.deepEqual(arrange([], droppedRaw, null, new Map(), false).map(i => [i.row.id, i.stale, i.foreign]), [[5, true, true]], 'no-origin/pending project retains global cached pins');
// unpin/pin writes carry the newest observations along
const refreshed = togglePin(droppedRaw, pa, mk(99), seenMap, 900);
assert.equal(readPins(refreshed).find(e => e.id === 5).row.status, 'running');
assert.equal(readPins(refreshed).find(e => e.id === 5).seenAt, 777000);

// Component behaviour: one write per click, none on render/refresh, stale rows never live.
const pinState = new Sidebar(); pinState.init({}, cx);
state.set('omarchy-forge-sidebar.view', 'pipelines');
state.delete(PINS);
let writes = 0; const realSet = state.set.bind(state);
state.set = (k, v) => { if (k === PINS) writes++; return realSet(k, v); };
pinState.project = { host: 'git.example.com', repo: 'team/app', provider: 'gitlab', on: null };
pinState.rows = [mk(30), mk(20, 'running')];
pinState.key = pinState.currentKey();
pinState.listedKey = pinState.key;
const view1 = pinState.render(); pinState.render(); pinState.render();
assert.equal(writes, 0, 'render never writes shared state');
assert.ok(node(view1, 'forge-sidebar-pin-30'), 'discoverable pin control on every row');
node(view1, 'forge-sidebar-pin-20').click({}, cx);
assert.equal(writes, 1, 'pin writes once');
assert.equal(pinState.pinAt > 0, true);
assert.equal(Boolean(state.get(PINS)), true);
const afterPin = pinState.render();
assert.ok(node(afterPin, 'forge-sidebar-row-20'));
// order in the rendered list: pinned #20 first
const listNode = node(afterPin, 'forge-sidebar-pipelines-list');
const order = (listNode?.nodes ?? []).map(n => n?.key).filter(k => k?.startsWith('forge-sidebar-row-'));
assert.deepEqual(order, ['forge-sidebar-row-20', 'forge-sidebar-row-30'], 'pinned row rendered first');
pinState.refresh(cx, true);
assert.equal(writes, 1, 'refresh never writes pins');
node(pinState.render(), 'forge-sidebar-pin-20').click({}, cx);
assert.equal(writes, 2, 'unpin writes once');
assert.equal(readPins(state.get(PINS)).length, 0);
// a pinned running row dropped from the list is cached, labelled, and not live
node(pinState.render(), 'forge-sidebar-pin-20').click({}, cx);
pinState.rows = [mk(30)];
pinState.jobs.set(20, { jobs: [{ status: 'running', group: 'build' }], at: Date.now(), status: 'running' });
const staleView = pinState.render();
assert.ok(node(staleView, 'forge-sidebar-row-20'), 'dropped pin still rendered');
const staleWords = words(node(staleView, 'forge-sidebar-row-20'));
assert.match(staleWords, /last seen running/);
assert.match(staleWords, /Not in Forge's recent list/);
assert.match(staleWords, /Status may have changed/);
assert.match(staleWords, /\?/, 'unknown glyph, not a live running mark');
assert.doesNotMatch(staleWords, /●/);
pinState.listedKey = null; // failed refresh before any list: cached pin is unconfirmed
assert.match(words(node(pinState.render(), 'forge-sidebar-row-20')), /Cached pin, list not confirmed/);
// stale rows are not job-read; pins take priority inside the unchanged 4/minute budget
const budget = new Sidebar(); budget.init({}, cx); budget.jobBudget.starts = [];
budget.rows = [mk(9, 'running'), mk(8, 'running'), mk(7, 'running'), mk(6, 'running'), mk(3), mk(2)];
state.set(PINS, togglePin(togglePin(undefined, pa, mk(3)), pa, mk(2)));
budget.enrich(cx, pa, () => true);
const read = [];
for (let i = 0; i < 4; i++) {
  read.push(calls[0].args[1][7]);
  calls.shift().resolve({ code: 0, stdout: '{"jobs":[],"at":1}' });
  await new Promise(resolve => setImmediate(resolve));
}
assert.deepEqual(read.sort(), ['6', '7', '8', '9'], 'pins use their own exact-ID status/jobs path; local enrichment reads only unpinned rows');
assert.equal(calls.length, 0, 'no fifth read in the same minute');
budget.enrich(cx, pa, () => true);
assert.equal(calls.length, 0, 'budget still enforced with pins');

// Global pin shelf: same numeric ID in multiple projects and in the MR list.
// No live shared.json or sockets are involved: fixtures use the module mock.
tree.children[0].hidden = false;
const foreign = { ...pa, on: 'remote', host: 'github.com', repo: 'other/app', provider: 'github' };
const originRow = { ...mk(20, 'running'), url: 'https://github.com/other/app/actions/runs/20' };
state.set(PINS, togglePin(togglePin(undefined, pa, mk(20)), foreign, originRow));
pinState.project = { ...pa, provider: 'gitlab' };
pinState.rows = [mk(20), mk(30)];
pinState.key = pinState.currentKey(); pinState.listedKey = pinState.key;
const foreignKey = pinKey(foreign, 20);
let globalView = pinState.render();
assert.ok(node(globalView, 'forge-sidebar-row-20'), 'current project pin uses fresh row once');
const foreignNode = node(globalView, `forge-sidebar-row-${foreignKey}`);
assert.ok(foreignNode, 'foreign pin with same numeric ID has separate native identity');
assert.match(words(foreignNode), /github.com\/other\/app · remote/);
assert.match(words(foreignNode), /last seen running/);
assert.match(words(foreignNode), /Cached pin from another project/);
assert.doesNotMatch(words(foreignNode), /jobs done|●/, 'foreign cached pin cannot borrow local running jobs');
const callCount = calls.length;
pinState.pinAt = 0; foreignNode.click({}, cx);
assert.equal(calls.length, callCount + 1);
assert.deepEqual(calls.pop().args, ['open', [originRow.url]], 'open uses pinned origin URL');
foreignNode.hover(true, hoverCx); hoverDelay(hoverCx);
let foreignCard = node(pinState.render(), `forge-progress-card-${foreignKey}`);
assert.ok(foreignCard);
assert.match(words(foreignCard), /Workflow jobs only/);
assert.doesNotMatch(words(foreignCard), /jobs done/, 'foreign popup cannot borrow local jobs');
assert.equal(calls.length, callCount, 'foreign hover starts no reads');
node(globalView, `forge-sidebar-pin-${foreignKey}`).click({}, cx);
assert.equal(pinnedIn(state.get(PINS), foreign).has(20), false, 'foreign unpin targets its origin');
assert.equal(pinnedIn(state.get(PINS), pa).has(20), true, 'same-ID current project pin survives');
// Re-add in memory, switch list tabs. Pipeline pins stay above ordinary local MRs.
state.set(PINS, togglePin(state.get(PINS), foreign, originRow));
state.set('omarchy-forge-sidebar.view', 'requests');
pinState.key = pinState.currentKey();
pinState.rows = [{ id: 20, iid: 20, title: 'Local MR', url: 'https://git.example.com/team/app/merge_requests/20' }];
globalView = pinState.render();
assert.ok(node(globalView, 'forge-sidebar-row-20'), 'local MR still rendered');
assert.ok(node(globalView, `forge-sidebar-row-${pinKey(pa, 20)}`), 'same-project pipeline pin stays distinct from same-ID MR');
assert.ok(node(globalView, `forge-sidebar-row-${foreignKey}`), 'foreign pin stays on MR view');
assert.match(words(node(globalView, 'forge-sidebar-row-20')), /Local MR/);
assert.match(words(node(globalView, `forge-sidebar-row-${pinKey(pa, 20)}`)), /Cached pin, list not confirmed/);
node(globalView, `forge-sidebar-pin-${foreignKey}`).click({}, cx);
assert.equal(pinnedIn(state.get(PINS), foreign).has(20), false, 'foreign unpin on MR view uses origin');
assert.equal(pinnedIn(state.get(PINS), pa).has(20), true);
// Both tabs retain cached pins during context transitions and no-origin errors.
for (const view of ['requests', 'pipelines']) {
  state.set('omarchy-forge-sidebar.view', view);
  pinState.key = 'previous-context';
  assert.ok(node(pinState.render(), `forge-sidebar-row-${pinKey(pa, 20)}`), 'pin survives transition before origin resolution');
  pinState.key = pinState.currentKey(); pinState.project = null; pinState.rows = []; pinState.error = 'No origin remote here';
  assert.ok(node(pinState.render(), `forge-sidebar-row-${pinKey(pa, 20)}`), 'pin survives no-origin failure');
}
assert.equal(calls.length, callCount, 'global shelf adds no background reads');
const roundTrip = JSON.parse(JSON.stringify(state.get(PINS)));
assert.equal(pinnedIn(roundTrip, pa).has(20), true, 'origin identity and cached pin persist unchanged');
// Returning to the origin restores live data and deduplicates only that project.
state.set('omarchy-forge-sidebar.view', 'pipelines');
pinState.project = { ...pa, provider: 'gitlab' }; pinState.rows = [mk(20, 'failed'), mk(30)];
pinState.key = pinState.currentKey(); pinState.listedKey = pinState.key;
const restored = node(pinState.render(), 'forge-sidebar-row-20');
assert.match(words(restored), /failed/); assert.doesNotMatch(words(restored), /last seen/);
assert.equal(arrange(pinState.rows, roundTrip, pa).filter(i => i.row.id === 20).length, 1);


// Exact-ID refresh is independent of list view, project context, and recent-20.
const flushPin = () => new Promise(resolve => setImmediate(resolve));
const reply = value => ({code: 0, stdout: JSON.stringify(value)});
const originKey = pinKey(foreign, 20);
function setupPoll() {
  assert.equal(calls.length, 0);
  tree.children[0].hidden = false;
  state.set('omarchy-forge-sidebar.view', 'requests');
  state.set(PINS, togglePin(undefined, foreign, originRow, new Map(), 100));
  const v = new Sidebar(); v.init({}, cx);
  v.jobBudget.starts = []; v.jobBudget.busy = null;
  v.project = { ...pa, provider: 'gitlab' }; v.rows = [{id:20,iid:20,title:'Local MR'}]; v.key = v.currentKey();
  return v;
}
let poll = setupPoll();
const nowSec = Math.floor(Date.now()/1000);
poll.refreshPins(cx);
assert.equal(calls.length, 1);
assert.equal(calls[0].args[0], 'python3');
assert.equal(calls[0].args[1][4], 'status');
assert.deepEqual(calls[0].args[1].slice(5), ['github','github.com','other/app','20','60']);
assert.equal(calls[0].args[2].on, 'remote', 'pin read dispatched to origin machine');
assert.equal(Object.hasOwn(calls[0].args[2], 'cwd'), false, 'foreign read never borrows active local cwd');
// No pipelines list exists in this MR view; direct detail supplies failed status.
calls.shift().resolve(reply({row:{...originRow,status:'failed',updated_ms:nowSec*1000},at:nowSec}));
await flushPin();
assert.equal(calls.length, 1); assert.equal(calls[0].args[1][4], 'jobs');
assert.equal(poll.seen.get(originKey).row.status, 'failed');
// Jobs cached before the transition must not be blessed with its new metadata.
calls.shift().resolve(reply({jobs:[{status:'running',group:'old'}],at:nowSec-10}));
await flushPin();
assert.equal(poll.seen.get(originKey).at, nowSec*1000);
assert.equal(poll.seen.get(originKey).jobsEntry.at, (nowSec-10)*1000);
assert.match(poll.seen.get(originKey).jobsEntry.error, /predates/);
let polledTree = poll.render();
assert.match(words(node(polledTree, 'forge-sidebar-row-'+originKey)), /failed/);
assert.match(words(node(polledTree, 'forge-sidebar-row-20')), /Local MR/);
poll.details = originKey;
assert.match(words(node(poll.render(), 'forge-progress-card-'+originKey)), /predates|Outdated/);
assert.equal(readPins(state.get(PINS))[0].row.status, 'running', 'refresh never mutates durable pin membership/snapshot');
// Context changes, including no origin, do not cancel this origin-specific pin.
poll.pinSchedule.refs.get(originKey).nextAt = 0; poll.jobBudget.starts = [];
poll.refreshPins(cx); poll.project = null; poll.rows = []; poll.key = 'changed';
calls.shift().resolve(reply({row:{...originRow,status:'success'},at:nowSec+1})); await flushPin();
calls.shift().resolve(reply({jobs:[{status:'success',group:'build'}],at:nowSec+1})); await flushPin();
assert.equal(poll.seen.get(originKey).row.status, 'success');
assert.match(words(node(poll.render(), 'forge-sidebar-row-'+originKey)), /Status observed/);
assert.equal(poll.pinSchedule.refs.get(originKey).nextAt > Date.now()+290000, true, 'finished cadence slows');
// A failed status read retains exact last-good row and timestamp; no jobs starts.
poll.pinSchedule.refs.get(originKey).nextAt = 0; poll.jobBudget.starts = [];
poll.refreshPins(cx); calls.shift().resolve(reply({error:'remote offline'})); await flushPin();
assert.equal(calls.length, 0);
assert.equal(poll.seen.get(originKey).row.status, 'success');
assert.equal(poll.seen.get(originKey).at, (nowSec+1)*1000);
assert.match(words(poll.render()), /remote offline/);
assert.match(words(poll.render()), /last seen success/);
poll.refreshPins(cx); assert.equal(calls.length, 0, 'failure backs off before another attempt');
// Deterministic hide/unpin between status and jobs (notify observes accepted status).
for (const action of ['hide', 'unpin']) {
  poll = setupPoll();
  let afterStatus = false;
  const phaseCx = {...cx, notify() { if (afterStatus && poll.seen.get(originKey)?.at) {
    if (action === 'hide') tree.children[0].hidden = true;
    else state.set(PINS, togglePin(state.get(PINS), foreign, originRow));
  } }, spawn(fn) { tasks.push(fn(phaseCx)); }};
  poll.refreshPins(phaseCx); afterStatus = true;
  calls.shift().resolve(reply({row:{...originRow,status:'failed'},at:nowSec})); await flushPin();
  assert.equal(calls.length, 0, action+' after status prevents subsequent jobs call');
  assert.equal(poll.jobBudget.busy, null);
}
// Already-running status/jobs replies are discarded after hide, unpin or re-pin.
for (const action of ['hide','unpin','repin','close']) {
  poll = setupPoll(); poll.refreshPins(cx);
  if (action === 'hide') tree.children[0].hidden = true;
  else if (action === 'close') poll.close();
  else {
    state.set(PINS, togglePin(state.get(PINS), foreign, originRow));
    poll.pinSchedule.sync(state.get(PINS));
    if (action === 'repin') state.set(PINS, togglePin(state.get(PINS), foreign, originRow, new Map(), 101));
  }
  calls.shift().resolve(reply({row:{...originRow,status:'failed'},at:nowSec})); await flushPin();
  assert.equal(poll.seen.has(originKey), false, action+' rejects old status reply');
  assert.equal(calls.length, 0);
}
poll = setupPoll(); poll.refreshPins(cx);
calls.shift().resolve(reply({row:{...originRow,status:'failed'},at:nowSec})); await flushPin();
state.set(PINS, togglePin(state.get(PINS), foreign, originRow));
calls.shift().resolve(reply({jobs:[{status:'success'}],at:nowSec})); await flushPin();
assert.equal(poll.seen.get(originKey).jobsEntry, undefined, 'unpin rejects already-running jobs reply');
// Failure before first observation cannot damage a saved row during another toggle.
poll = setupPoll(); poll.refreshPins(cx);
calls.shift().resolve(reply({error:'remote backend missing'})); await flushPin();
const beforeFailureToggle = readPins(state.get(PINS))[0];
poll.togglePin(mk(99), cx, foreign);
assert.deepEqual(readPins(state.get(PINS)).find(e=>e.id===20), beforeFailureToggle);
assert.equal(calls.length, 0, 'missing remote backend never falls back to local auth');
// Cached responses keep their original age, and jobs failure keeps its own error.
poll = setupPoll(); poll.refreshPins(cx);
calls.shift().resolve(reply({row:{...originRow,status:'running'},at:nowSec-600})); await flushPin();
calls.shift().resolve(reply({jobs:[],at:nowSec-650,error:'jobs offline'})); await flushPin();
assert.equal(poll.seen.get(originKey).at, (nowSec-600)*1000);
assert.equal(poll.seen.get(originKey).jobsEntry.at, (nowSec-650)*1000);
assert.match(poll.seen.get(originKey).jobsEntry.error, /jobs offline/);
assert.match(words(poll.render()), /last seen running/, 'old cached success is never relabelled fresh now');
// Same numeric ID in a second origin gets a separate status and progress entry.
state.set(PINS, togglePin(state.get(PINS), pa, mk(20), new Map(), (nowSec-1)*1000));
poll.jobBudget.starts = []; poll.refreshPins(cx);
assert.equal(calls[0].args[2].on, null);
calls.shift().resolve(reply({row:mk(20,'success'),at:nowSec})); await flushPin();
calls.shift().resolve(reply({jobs:[{status:'success',group:'local'}],at:nowSec})); await flushPin();
assert.equal(poll.seen.get(pinKey(pa,20)).row.status, 'success');
assert.equal(poll.seen.get(originKey).row.status, 'running');
assert.equal(poll.seen.get(pinKey(pa,20)).jobsEntry.jobs[0].group, 'local');
assert.equal(calls.length, 0);

// An accepted list update advances the transition watermark too.
poll = setupPoll();
state.set(PINS,togglePin(undefined,pa,mk(20,'running'),new Map(),(nowSec-20)*1000));
const localKey=pinKey(pa,20);
poll.seen.set(localKey,{row:mk(20,'running'),at:(nowSec-10)*1000,observed:true,statusSince:(nowSec-10)*1000});
state.set('omarchy-forge-sidebar.view','pipelines');
poll.refresh(cx);
calls.shift().resolve({code:0,stdout:'git@git.example.com:team/app.git'});await flushPin();
calls.shift().resolve(versionReply);await flushPin();
calls.shift().resolve(reply({pipelines:[mk(20,'failed')],at:nowSec}));await flushPin();
assert.equal(poll.seen.get(localKey).statusSince,nowSec*1000,'list status transition advances watermark');
poll.refreshPins(cx);
calls.shift().resolve(reply({row:mk(20,'failed'),at:nowSec}));await flushPin();
calls.shift().resolve(reply({jobs:[{status:'running',group:'old'}],at:nowSec-5}));await flushPin();
assert.match(poll.seen.get(localKey).jobsEntry.error,/predates/,'list transition cannot bless older jobs');
// A newer persisted snapshot wins over an older first direct backend cache hit.
poll=setupPoll();
state.set(PINS,togglePin(undefined,foreign,{...originRow,status:'success'},new Map(),nowSec*1000));
poll.refreshPins(cx);
calls.shift().resolve(reply({row:originRow,at:nowSec-60}));await flushPin();
assert.equal(calls.length,0,'older detail cannot start jobs under regressed status');
assert.equal(poll.seen.get(originKey).row.status,'success');
assert.equal(poll.seen.get(originKey).at,nowSec*1000);
assert.match(poll.seen.get(originKey).error,/predates saved/);
assert.match(words(poll.render()),/last seen success/);
console.log('PASS sidebar context, global pins, exact-ID origin status/jobs, timestamps, collisions, lifecycle guards, errors, persistence and existing controls');
