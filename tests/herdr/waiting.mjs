// Run: node --experimental-vm-modules tests/herdr/waiting.mjs
// Waiting (waiting.js) against controlled snapshots: the label contract, liveness, new work, staleness, tree rollup, the
// shelf, and the inbox's sections and tombstone writes. No app or core is touched.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { SourceTextModule, SyntheticModule } from 'node:vm';

const mods = resolve('private_dot_config/herdr-app/mods');
const W = await import(resolve(mods, 'omarchy-inbox/waiting.js'));
const { readWatch, parseRef, newWorkSince, watchOf, endsNow, stopWrites, isStale, overWord, waitingTreeStatus, rollup, shelfSummary, age, STALE_MS } = W;

// Every copy is the same file.
const inboxCopy = await readFile(resolve(mods, 'omarchy-inbox/waiting.js'), 'utf8');
for (const m of ['omarchy-agents', 'omarchy-watch']) assert.equal(await readFile(resolve(mods, m, 'waiting.js'), 'utf8'), inboxCopy, `${m}/waiting.js differs from omarchy-inbox's`);

const NOW = 1_800_000_000_000;
const rec = (o = {}) => ({ waiting: '1', 'waiting.id': 'w1', 'waiting.subject': 'MR !42 pipeline', 'waiting.since': String(NOW - 60000), 'waiting.stamp': '3:1', ...o });

// --- Label parsing: complete v1 records only.
let w = readWatch(rec());
assert.deepEqual(w, { id: 'w1', subject: 'MR !42 pipeline', since: NOW - 60000, then: 3, was: true, ref: null, ended: false });
assert.equal(readWatch(rec({ waiting: '2' })), null, 'unknown version');
assert.equal(readWatch({ ...rec(), waiting: undefined }), null, 'no version');
for (const k of ['waiting.id', 'waiting.subject', 'waiting.since', 'waiting.stamp']) {
  const r = rec(); delete r[k]; assert.equal(readWatch(r), null, `missing ${k}`);
}
assert.equal(readWatch(rec({ 'waiting.subject': '   ' })), null, 'blank subject');
assert.equal(readWatch(rec({ 'waiting.since': '12.5' })), null, 'non-integer since');
assert.equal(readWatch(rec({ 'waiting.since': '-1' })), null, 'negative since');
assert.equal(readWatch(rec({ 'waiting.stamp': '3' })), null, 'stamp without bit');
assert.equal(readWatch(rec({ 'waiting.stamp': '3:2' })), null, 'stamp bit not 0/1');
assert.equal(readWatch(rec({ 'waiting.stamp': '-1:0' })), null, 'negative turn');
assert.equal(readWatch(null), null);
assert.equal(readWatch(rec({ 'waiting.ended': 'w1' })).ended, true, 'tombstone names this declaration');
assert.equal(readWatch(rec({ 'waiting.ended': 'w0' })).ended, false, 'an older tombstone is not this one');
// References: https GitLab MR or pipeline URLs, no credentials.
assert.deepEqual(parseRef('https://git.example.com/group/sub/proj/-/merge_requests/42'), { host: 'git.example.com', project: 'group/sub/proj', kind: 'mr', iid: 42 });
assert.deepEqual(parseRef('https://gitlab.com/a/b/-/pipelines/991?x=1'), { host: 'gitlab.com', project: 'a/b', kind: 'pipeline', iid: 991 });
assert.equal(parseRef('http://gitlab.com/a/b/-/pipelines/1'), null, 'not https');
assert.equal(parseRef('https://user:pw@gitlab.com/a/b/-/pipelines/1'), null, 'credentials');
assert.equal(parseRef('https://gitlab.com/a/b/-/issues/1'), null, 'not an MR or pipeline');
assert.equal(readWatch(rec({ 'waiting.ref': 'https://gitlab.com/a/b/-/merge_requests/7' })).ref, 'https://gitlab.com/a/b/-/merge_requests/7');
assert.equal(readWatch(rec({ 'waiting.ref': 'https://u:p@gitlab.com/a/b/-/merge_requests/7' })), null, 'a bad ref leaves the record malformed');

// --- New work: the snoozed-turn rule, not turn equality.
const was = readWatch(rec({ 'waiting.stamp': '3:1' })), idle = readWatch(rec({ 'waiting.stamp': '3:0' }));
assert.equal(newWorkSince(was, 'working', 3), false, 'still in the declaring turn');
assert.equal(newWorkSince(was, 'idle', 4), false, 'finishing the declaring turn keeps it');
assert.equal(newWorkSince(was, 'done', 4), false);
assert.equal(newWorkSince(was, 'working', 4), true, 'working on a turn begun since');
assert.equal(newWorkSince(was, 'idle', 5), true, 'a turn ended past the declaring one');
assert.equal(newWorkSince(idle, 'idle', 3), false);
assert.equal(newWorkSince(idle, 'working', 3), true, 'declared idle: any work is new');
assert.equal(newWorkSince(idle, 'idle', 4), true);
assert.equal(newWorkSince(idle, 'blocked', 3), false);

// --- Liveness.
const term = (address, o = {}) => ({ address, parent: null, status: 'idle', state: 'live', turn: 3, labels: {}, ...o });
assert.ok(watchOf(term('a', { labels: rec(), status: 'working' })));
assert.equal(watchOf(term('a', { labels: rec({ 'waiting.ended': 'w1' }) })), null, 'ended');
assert.equal(watchOf(term('a', { labels: rec(), state: 'finished' })), null, 'terminal ended');
assert.equal(watchOf(term('a', { labels: rec(), turn: 5 })), null, 'new work, tombstone not yet written');
assert.equal(endsNow(term('a', { labels: rec(), turn: 5 })), 'w1');
assert.equal(endsNow(term('a', { labels: rec(), turn: 5 }), 'idle', 'w1'), null, 'already on its way');
assert.equal(endsNow(term('a', { labels: rec(), turn: 3 })), null, 'no new work');
assert.equal(endsNow(term('a', { labels: rec({ 'waiting.ended': 'w1' }), turn: 9 })), null, 'already ended');
assert.equal(endsNow(term('a', { labels: rec({ waiting: '7' }), turn: 9 })), null, 'not ours to end');

// --- Stale after two hours from declaration.
assert.equal(isStale({ since: NOW - STALE_MS + 1 }, NOW), false);
assert.equal(isStale({ since: NOW - STALE_MS }, NOW), true);
assert.equal(age(NOW - 30000, NOW), 'now');
assert.equal(age(NOW - 47 * 60000, NOW), '47m');
assert.equal(age(NOW - 3 * 3600000, NOW), '3h');

// --- Tree rollup: blocked anywhere > root's own done > working > waiting > root's own word.
const W1 = { since: 1 };
assert.equal(overWord('working', W1), 'waiting', 'a long foreground command on a Watch is waiting');
assert.equal(overWord('idle', W1), 'waiting');
assert.equal(overWord('blocked', W1), 'blocked');
assert.equal(overWord('done', W1), 'done');
assert.equal(overWord('working', null), 'working');
assert.equal(waitingTreeStatus('idle', null, ['waiting']), 'waiting', 'root idle, sub-agent waiting');
assert.equal(waitingTreeStatus('idle', W1, ['working']), 'working', 'one member working on its own');
assert.equal(waitingTreeStatus('working', W1, []), 'waiting');
assert.equal(waitingTreeStatus('working', null, ['waiting']), 'working', 'root working on its own');
assert.equal(waitingTreeStatus('done', null, ['waiting']), 'done', 'the reply is the news');
assert.equal(waitingTreeStatus('done', W1, []), 'done');
assert.equal(waitingTreeStatus('idle', W1, ['blocked']), 'blocked');
assert.equal(waitingTreeStatus('blocked', W1, []), 'blocked');
assert.equal(waitingTreeStatus('idle', null, ['idle']), 'idle');
assert.equal(waitingTreeStatus(null, W1, ['waiting']), null, 'no word of its own');
// Matches tree.js's treeStatus when nobody waits.
const T = await import(resolve(mods, 'omarchy-inbox/tree.js'));
for (const own of ['idle', 'working', 'done', 'blocked'])
  for (const kids of [[], ['idle'], ['working'], ['blocked'], ['working', 'idle']])
    assert.equal(waitingTreeStatus(own, null, kids), T.treeStatus(own, kids), `${own} ${kids}`);

const m = (address, since) => ({ k: { address }, w: since == null ? null : { since, subject: address } });
let r = rollup([m('root', null), m('a', NOW - 1000), m('b', NOW - 5000), m('c', null)], NOW);
assert.equal(r.count, 2); assert.equal(r.more, 1); assert.equal(r.oldest.k.address, 'b');
assert.deepEqual(r.members.map((x) => x.k.address), ['a', 'b', 'c'], 'members keep tree order, root left out');
assert.equal(r.stale, false);
assert.equal(rollup([m('root', null), m('a', null)], NOW), null);
r = rollup([m('root', NOW - 3 * 3600000), m('a', NOW - 60000)], NOW);
assert.equal(r.stale, false, 'stale only when every Watch is');
assert.equal(rollup([m('root', NOW - 3 * 3600000), m('a', NOW - 4 * 3600000)], NOW).stale, true);

// --- Stop waiting by hand: a tombstone for each live Watch in the tree, none for ended, malformed or new-work-ended ones.
{
  const t = (address, labels, o = {}) => ({ address, status: 'idle', state: 'live', turn: 3, labels, ...o });
  const tree = [t('r', rec({ 'waiting.id': 'r1', 'waiting.stamp': '3:0' })), t('k1', rec({ 'waiting.id': 'k1', 'waiting.stamp': '3:0', 'waiting.ended': 'old' })),
    t('k2', rec({ 'waiting.id': 'k2', 'waiting.ended': 'k2' })), t('k3', {}), t('k4', rec({ 'waiting.id': 'k4', 'waiting.stamp': '3:0' }), { status: 'working' }),
    t('k5', rec({ 'waiting.id': 'k5', 'waiting.stamp': '3:0' }), { state: 'finished' })];
  assert.deepEqual(stopWrites(tree), [{ address: 'r', id: 'r1', was: '' }, { address: 'k1', id: 'k1', was: 'old' }]);
  assert.deepEqual(stopWrites(tree, { r: 'r1' }), [{ address: 'k1', id: 'k1', was: 'old' }], 'one on its way already');
  assert.deepEqual(stopWrites([t('x', {})]), []);
}

// --- Shelf: counts Watches, oldest first, oldest age.
const s = shelfSummary([
  { key: 'x', roll: rollup([m('x', NOW - 1000)], NOW) },
  { key: 'y', roll: rollup([m('y', NOW - 9000), m('y1', NOW - 2000)], NOW) },
  { key: 'z', roll: null },
]);
assert.deepEqual(s.cards.map((c) => c.key), ['y', 'x']);
assert.equal(s.count, 3); assert.equal(s.oldest, NOW - 9000);
assert.deepEqual(shelfSummary([]), { cards: [], count: 0, oldest: null });

// --- The inbox: sections, precedence and the tombstone it writes on new work.
let calls = [], all = [], runs = [], sp = [], focus = {}, writes = [], storage = new Map(), shared = new Map();
const theme = new Proxy({}, { get: (_, k) => `#${String(k)}` });
class Element {
  constructor() {
    this.nodes = []; this.handlers = {}; this.attrs = {};
    const proxy = new Proxy(this, { get: (o, k) => k in o ? o[k] : (...args) => { o.attrs[k] = args; return proxy; } });
    return proxy;
  }
  child(x) { assert.ok(x != null && x !== false, 'native child() cannot accept null/false'); this.nodes.push(x); return this; }
  children(xs) { xs.forEach((x) => this.child(x)); return this; }
  when(on, fn) { return on ? fn(this) : this; }
  id(id) { this.key = id; return this; }
  on_click(fn) { this.handlers.click = fn; return this; }
}
const el = () => new Element();
const kit = { View: class {}, div: el, svg: el, image: el };
const base = { v_flex: el, h_flex: el, Popup: { new: (id, trigger) => { const e = el(); e.key = id; return trigger ? e.child(trigger) : e; } }, Popover: { new: (id) => { const e = el(); e.key = id; return e; } }, Input: { new: el }, NumberInput: { new: el }, Select: { new: el }, InputState: { new: () => ({ on() {}, text: () => '' }) } };
const herdr = {
  terminals: () => all, agents: () => runs, panes: () => runs, spaces: () => sp, focused: () => focus,
  shared: (k) => shared.get(k), setShared: (k, v) => shared.set(k, v), run: (name, args) => calls.push({ name, args }), props: () => ({}), theme: () => theme,
  keys: () => ({}), machines: () => [], closeOverlay() {}, exec: async () => ({}), readTextFile: async () => null, appHome: () => '',
  settings: () => ({ zoom: 1 }), layout: () => null, window: () => ({}), setAgentOrder() {}, notify() {}, openOverlay() {},
  nextCommand: () => new Promise(() => {}),
  hc: async ([cmd, address, label]) => {
    assert.equal(cmd, 'label'); const i = label.indexOf('=');
    writes.push([address, label]);
    const k = all.find((k) => k.address === address);
    k.labels = { ...k.labels, [label.slice(0, i)]: label.slice(i + 1) };
    return { code: 0 };
  },
};
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
const cache = new Map();
async function load(path) {
  if (cache.has(path)) return cache.get(path);
  const module = new SourceTextModule(await readFile(path, 'utf8'), { identifier: path });
  cache.set(path, module);
  await module.link(async (specifier, ref) => {
    const exports = specifier.startsWith('.') ? null : ({ 'gpui-kit': kit, 'gpui-base': base, herdr })[specifier] ?? await import(specifier);
    if (exports) return new SyntheticModule(Object.keys(exports), function () { for (const [k, v] of Object.entries(exports)) this.setExport(k, v); });
    return load(resolve(dirname(ref.identifier), specifier));
  });
  return module;
}
const root = resolve(mods, 'omarchy-inbox');
const main = await load(resolve(root, 'main.js')); await main.evaluate();
const Inbox = main.namespace.default;
const { inboxRowView } = cache.get(resolve(root, 'row-view.js')).namespace;
const { inboxActions } = cache.get(resolve(root, 'actions.js')).namespace;
const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({ is_focused: () => false }),
  timer: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) }, spawn: (fn) => { fn(cx); } };
const flush = () => new Promise((r) => setImmediate(r));
const now = Date.now();
const live = (address, o = {}) => ({ address, parent: null, status: 'idle', state: 'live', turn: 3, labels: {}, ...o });
const watching = (since, o = {}) => rec({ 'waiting.since': String(since), 'waiting.id': `id-${since}`, ...o });
const agentOf = (k) => ({ ...k, pane: `p-${k.address}`, tab: 'tab', space: 'sp', space_name: 'Space', program: { name: 'Claude' }, title: k.address });
function setup(terms) {
  all = terms; runs = terms.filter((k) => !k.parent).map(agentOf); sp = [{ id: 'sp', name: 'Space', tabs: [{ id: 'tab' }] }];
  focus = {}; writes = []; storage = new Map(); shared = new Map();
  const v = new Inbox(); v.init({}, cx); return v;
}
const ids = (xs) => xs.map((a) => a.address);
const find = (node, id) => node?.key === id ? node : node?.nodes?.map((n) => find(n, id)).find(Boolean);

// One waiting, one idle (Active), one working: Waiting gets its own section, off Working and Active.
let v = setup([
  live('wait', { status: 'working', labels: watching(now - 47 * 60000) }),
  live('quiet'),
  live('busy', { status: 'working' }),
  live('old', { labels: watching(now - 3 * 3600000, { 'waiting.stamp': '3:0' }) }),
]);
let model = v.compute(cx, false);
assert.equal(model.state(model.every.find((a) => a.address === 'wait')), 'waiting');
assert.deepEqual(ids(model.wait), ['old', 'wait'], 'oldest Watch first');
assert.deepEqual(ids(model.out), ['quiet']);
assert.deepEqual(ids(model.work), ['busy']);
assert.deepEqual(ids(model.waitRows), [], 'folded by default');
assert.equal(model.waitOf(model.every.find((a) => a.address === 'old')).stale, true);
// Rows: subject first, age in the waiting colour; a stale one dims.
let rowed = [];
const draw = (m) => inboxRowView(v, theme, m, inboxActions(v, m), { row: (x, a, d) => (rowed.push(a.address), x.child(d(a))), open: () => () => {}, swept: () => false, justDropped: () => false });
let row = draw(model).waitRow(model.every.find((a) => a.address === 'wait'));
assert.ok(find(row, 'wait-wait'));
assert.ok(JSON.stringify(row).includes('MR !42 pipeline'));
assert.ok(JSON.stringify(row).includes('47m'));

// Snoozed and settled win over Waiting; a pin keeps its slot.
v = setup([live('nap', { labels: { ...watching(now - 60000), snoozed: String(now + 3600000) } }),
  live('put', { labels: { ...watching(now - 60000), settled: `${now}:3` } }), live('pin', { labels: { ...watching(now - 60000), 'herdr.pinned': '1' } })]);
model = v.compute(cx, false);
assert.deepEqual(ids(model.wait), [], 'snoozed and settled win; the pin keeps its slot');
assert.deepEqual(ids(model.pinned), ['pin']);
assert.ok(ids(model.put).includes('put'));
// A pinned card still shows that it waits: the corner pill.
const pinCard = JSON.stringify(inboxRowView(v, theme, model, inboxActions(v, model), { row: (x) => x, open: () => () => {}, swept: () => false, justDropped: () => false }).card(model.pinned[0]));
assert.ok(pinCard.includes('Waiting'), 'pinned card pill');

// Blocked isn't waiting: it goes to Active, top of the inbox.
v = setup([live('stuck', { status: 'blocked', labels: watching(now - 60000) })]);
model = v.compute(cx, false);
assert.deepEqual(ids(model.out), ['stuck']); assert.deepEqual(ids(model.wait), []);

// A tree: root idle, sub-agent waiting -> the card waits on the sub-agent's Watch, +N counts the others.
v = setup([live('r'), live('k1', { parent: 'r', labels: watching(now - 5 * 60000) }), live('k2', { parent: 'r', labels: watching(now - 60000) }), live('k3', { parent: 'r' })]);
runs.push(...['k1', 'k2', 'k3'].map((a) => agentOf(all.find((k) => k.address === a))));
model = v.compute(cx, false);
assert.deepEqual(ids(model.every), ['r']);
const rr = model.waitOf(model.every[0]);
assert.equal(model.state(model.every[0]), 'waiting'); assert.equal(rr.count, 2); assert.equal(rr.more, 1); assert.equal(rr.oldest.k.address, 'k1');
row = draw(model).waitRow(model.every[0]);
assert.ok(JSON.stringify(row).includes('+1'));
find(row, 'wait-tree-r').handlers.click({}, cx);
row = draw(model).waitRow(model.every[0]);
assert.ok(find(row, 'wait-r-k3'), 'a member without a Watch gets a line');
assert.ok(JSON.stringify(find(row, 'wait-r-k3')).includes('· idle'));
assert.ok(JSON.stringify(find(row, 'wait-r-k3')).includes('└'));
// Clicking a member views it, as a card's sub-agent rows do.
calls.length = 0;
find(row, 'wait-r-k1').handlers.click({}, cx);
assert.deepEqual(calls.at(-1), { name: 'terminal.peek', args: { terminal: 'k1' } });
// A sub-agent working on its own makes the tree Working.
all.find((k) => k.address === 'k3').status = 'working';
model = v.compute(cx, false);
assert.equal(model.state(model.every[0]), 'working'); assert.deepEqual(ids(model.wait), []);

// New work since the stamp: the inbox writes only the tombstone, naming that declaration.
v = setup([live('a', { labels: watching(now - 60000, { 'waiting.stamp': '3:1' }), turn: 4, status: 'working' })]);
model = v.compute(cx, false);
await flush();
assert.deepEqual(writes, [['a', `waiting.ended=id-${now - 60000}`]]);
assert.equal(all[0].labels['waiting.subject'], 'MR !42 pipeline', 'the rest stays');
assert.deepEqual(ids(v.compute(cx, false).wait), []);
writes = []; v.compute(cx, false); await flush();
assert.deepEqual(writes, [], 'once');

// Finishing the declaring turn keeps it; no writes.
v = setup([live('a', { labels: watching(now - 60000, { 'waiting.stamp': '3:1' }), turn: 4, status: 'idle' })]);
model = v.compute(cx, false); await flush();
assert.deepEqual(writes, []); assert.deepEqual(ids(model.wait), ['a']);

// A pipeline Watch on the shelf (ticket 08): the mark by the age, the hairline, and on hover the pipeline's card.
const REF = 'https://git.example.com/products/fv/-/merge_requests/161', KEY = 'git.example.com/products/fv/mr/161';
const result = { kind: 'pipeline', id: 117719, iid: 8866, status: 'RUNNING', sha: 'abc', project: 'products/fv', ref: { kind: 'mr', iid: 161 },
  counts: { all: 10, ok: 4, bad: 1, done: 5, run: 2, wait: 1, manual: 2 }, downstream: [], more: false,
  stages: [{ name: 'build', status: 'success' }, { name: 'test', status: 'running' }, { name: 'deploy', status: 'created' }] };
v = setup([live('ci', { labels: watching(now - 47 * 60000, { 'waiting.ref': REF }) }), live('plain', { labels: watching(now - 60000) })]);
shared.set('omarchy-waiting.obs', { [KEY]: { result, at: now - 5000, problem: null } });
model = v.compute(cx, false);
const ci = model.every.find((a) => a.address === 'ci'), plain = model.every.find((a) => a.address === 'plain');
let text = JSON.stringify(draw(model).waitRow(ci));
assert.ok(text.includes('"●"') && text.includes('"1/3"'), 'running, one stage of three done');
assert.ok(text.includes('"50%"') && text.includes('"12.5%"') && text.includes('"25%"'), 'the hairline split by job count, manual left out');
assert.ok(!text.includes('"!"'), 'fresh');
assert.ok(!JSON.stringify(draw(model).waitRow(plain)).includes('"●"'), 'a plain Watch has no mark');
v.details = 'ci'; v.detailsIn = true;
text = JSON.stringify(draw(model).waitRow(ci));
for (const s of ['Running', 'stage 2 of 3', 'Pipeline #8866 · products/fv !161', 'since', 'jobs done', 'waiting for a runner', 'build', 'Observed 5s ago'])
  assert.ok(text.includes(s), `card: ${s}`);
v.details = 'plain';
assert.ok(JSON.stringify(draw(model).waitRow(plain)).includes('no MR or pipeline link'), "a plain Watch's card says so");
// Outdated: the kept data, dimmed, with a yellow "!" and the problem.
shared.set('omarchy-waiting.obs', { [KEY]: { result, at: now - 4 * 60000, problem: 'glab exited 1: HTTP 502' } });
v.details = 'ci';
text = JSON.stringify(draw(v.compute(cx, false)).waitRow(ci));
assert.ok(text.includes('"!"') && text.includes('Outdated · observed 4m ago') && text.includes('HTTP 502'));
// Unavailable and awaiting.
shared.set('omarchy-waiting.obs', {});
text = JSON.stringify(draw(v.compute(cx, false)).waitRow(ci));
assert.ok(text.includes('"?"') && text.includes('No observation yet'));
shared.set('omarchy-waiting.obs', { [KEY]: { result: { kind: 'awaiting', head: 'a1b2c3d4' }, at: now - 10000, problem: null } });
text = JSON.stringify(draw(v.compute(cx, false)).waitRow(ci));
assert.ok(text.includes('○ –') && text.includes('new head a1b2c3d4 has no pipeline yet'));
// Ended (ticket 13): the card keeps the last observation, frozen, never outdated.
v = setup([live('done', { labels: watching(now - 47 * 60000, { 'waiting.ref': REF, 'waiting.ended': `id-${now - 47 * 60000}` }) })]);
shared.set('omarchy-waiting.obs', { [KEY]: { result: { ...result, status: 'SUCCESS', counts: { ...result.counts, ok: 8, bad: 0, done: 8, run: 0, wait: 0 },
  stages: result.stages.map((x) => ({ ...x, status: 'success' })) }, at: now - 3600000, problem: null } });
model = v.compute(cx, false);
v.details = 'done'; v.detailsIn = true;
const ended = model.every[0];
assert.deepEqual(ids(model.wait), []);
text = JSON.stringify(inboxRowView(v, theme, model, inboxActions(v, model), { row: (x, a, d) => x.child(d(a)), open: () => () => {}, swept: () => false, justDropped: () => false }).card(ended));
assert.ok(text.includes('"✓"') && text.includes('"3/3"') && !text.includes('"!"'), 'frozen, not outdated');
assert.ok(text.includes('Watch ended') && text.includes('no longer refreshed'));

// --- The Waiting row is a row like the others: drag.js's row() (pointer box for the hover card, drag), and on hover the
// controls the other rows have, plus Stop waiting.
const { inboxDrag } = cache.get(resolve(root, 'drag.js')).namespace;
v = setup([live('w', { labels: watching(now - 60000, { 'waiting.stamp': '3:0' }) })]);
model = v.compute(cx, false);
const wa = model.every[0];
rowed = []; row = draw(model).waitRow(wa);
assert.deepEqual(rowed, ['w'], 'the Waiting row goes through row(), which carries the hover card and its pointer box');
assert.ok(!find(row, 'unwait-w'), 'no controls until hovered');
assert.ok(JSON.stringify(row).includes('"1m"'), 'the age shows');
v.hovered = 'w';
row = draw(model).waitRow(wa);
for (const id of ['unwait-w', 'snooze-menu-w', 'settle-w']) assert.ok(find(row, id), `hovered: ${id}`);
// Stop waiting: the tombstone, the card back in Active, and Undo puts it back.
writes = [];
find(row, 'unwait-w').handlers.click({}, cx); await flush();
assert.deepEqual(writes, [['w', `waiting.ended=id-${now - 60000}`]]);
model = v.compute(cx, false);
assert.deepEqual(ids(model.wait), []); assert.deepEqual(ids(model.out), ['w'], 'out of Waiting, into Active');
assert.equal(v.notice.action, 'Stopped waiting for');
writes = []; v.undo(cx); await flush();
assert.deepEqual(writes, [['w', 'waiting.ended=']]);
assert.deepEqual(ids(v.compute(cx, false).wait), ['w'], 'Undo: waiting again');
// Settle from the Waiting row: settled wins, the card leaves the shelf.
model = v.compute(cx, false); v.hovered = 'w';
writes = []; find(draw(model).waitRow(model.every[0]), 'settle-w').handlers.click({}, cx); await flush();
assert.ok(writes.some(([k, l]) => k === 'w' && l.startsWith('settled=')));
model = v.compute(cx, false);
assert.deepEqual(ids(model.wait), []); assert.deepEqual(ids(model.put), ['w']);
// A busy tree gets no Settle (it couldn't stay settled), but Snooze and Stop waiting.
v = setup([live('b', { status: 'working', labels: watching(now - 60000) })]);
model = v.compute(cx, false); v.hovered = 'b';
row = draw(model).waitRow(model.every[0]);
assert.ok(find(row, 'unwait-b') && find(row, 'snooze-menu-b') && !find(row, 'settle-b'));
// Drag: a Waiting row lifts; dropped on Active it stops waiting, on Settled it settles.
const lift = (addr, section) => {
  model = v.compute(cx, false);
  v.drag = { from: addr, at: { x: 0, y: 0 }, grab: 0, height: 36, moved: true, target: { section }, y: 200 };
  return inboxDrag(v, theme, model, inboxActions(v, model));
};
v = setup([live('d', { labels: watching(now - 60000, { 'waiting.stamp': '3:0' }) })]);
let dr = lift('d', 'active');
assert.equal(dr.verb, 'unwait');
const rootEl = dr.root(el());
writes = []; rootEl.attrs.on_mouse_up[1]({}, cx); await flush();
assert.deepEqual(writes, [['d', `waiting.ended=id-${now - 60000}`]], 'dropped on Active: Stop waiting');
v = setup([live('d', { labels: watching(now - 60000, { 'waiting.stamp': '3:0' }) })]);
dr = lift('d', 'settled');
assert.equal(dr.verb, 'settle');
writes = []; dr.root(el()).attrs.on_mouse_up[1]({}, cx); await flush();
assert.ok(writes.some(([k, l]) => k === 'd' && l.startsWith('settled=')), 'dropped on Settled: settled');
// The row's press starts a drag (it used to be refused for Waiting).
v = setup([live('d', { labels: watching(now - 60000, { 'waiting.stamp': '3:0' }) })]);
model = v.compute(cx, false);
dr = inboxDrag(v, theme, model, inboxActions(v, model));
const pressed = dr.row(el(), model.every[0], () => el());
pressed.attrs.on_mouse_down[1]({ position: { x: 1, y: 1 }, bounds: { height: 36 } });
assert.equal(v.drag?.from, 'd');

console.log('waiting: ok');
