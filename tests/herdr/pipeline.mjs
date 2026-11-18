// Run: node --experimental-vm-modules tests/herdr/pipeline.mjs
// Pipeline Watches (omarchy-watch/pipeline.js and the observer, main.js) against controlled replies: selection, reply
// parsing, observation states, the bar and mark readings, the scheduler's budget and backoff, publishing, and the lease.
// No app, core or GitLab is touched: `exec` is a stub.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { SourceTextModule, SyntheticModule } from 'node:vm';

const mods = resolve('private_dot_config/herdr-app/mods');
const P = await import(resolve(mods, 'omarchy-watch/pipeline.js'));
const { parseRef } = await import(resolve(mods, 'omarchy-watch/waiting.js'));
const { refKey, queryOf, glabArgs, selectPipeline, summarize, parseReply, applyReply, worthPublishing, reading, phaseOf, stagesDone,
  barOf, newSchedule, demandOf, plan, finish, backoff, REFRESH_MS, OUTDATED_MS, BACKOFF_MAX_MS, HOST_INFLIGHT, HOST_PER_MIN } = P;

// Every copy is the same file.
const watchCopy = await readFile(resolve(mods, 'omarchy-watch/pipeline.js'), 'utf8');
assert.equal(await readFile(resolve(mods, 'omarchy-inbox/pipeline.js'), 'utf8'), watchCopy, "omarchy-inbox/pipeline.js differs from omarchy-watch's");

const NOW = 1_800_000_000_000;
const MR = parseRef('https://git.example.com/products/fv/-/merge_requests/161');
const PL = parseRef('https://git.example.com/products/fv/-/pipelines/8866');
const HEAD = 'eb2ada3e9e097f2f0dd203f03d89a4a2376f4c48';

// --- Query and arguments: one GraphQL request through glab, the host from the ref, the head when known.
assert.equal(refKey(MR), 'git.example.com/products/fv/mr/161');
assert.deepEqual(glabArgs(MR).slice(0, 5), ['api', '-i', '--hostname', 'git.example.com', 'graphql']);
assert.ok(queryOf(MR).includes('mergeRequest(iid:"161")') && !queryOf(MR).includes('sha:'), 'no head yet: no sha filter');
assert.ok(queryOf(MR, HEAD).includes(`sha:"${HEAD}"`), 'the known head cuts the candidates');
assert.ok(queryOf(PL).includes('pipeline(iid:"8866")'));
assert.ok(queryOf(MR).includes('project(fullPath:"products/fv")'));

// --- Selection: the head's newest eligible pipeline.
const node = (id, o = {}) => ({ id: `gid://gitlab/Ci::Pipeline/${id}`, iid: String(id - 100000), status: 'SUCCESS', sha: HEAD, mergeRequestEventType: null, totalJobs: 3,
  all: { count: 3 }, ok: { count: 3 }, bad: { count: 0 }, done: { count: 3 }, run: { count: 0 }, wait: { count: 0 }, manual: { count: 0 },
  stages: { nodes: [{ name: 'build', status: 'success' }] }, downstream: { nodes: [], pageInfo: { hasNextPage: false } }, ...o });
const mr = (nodes, o = {}) => ({ iid: '161', diffHeadSha: HEAD, headPipeline: null, pipelines: { nodes }, ...o });
assert.equal(selectPipeline(mr([node(117700), node(117719), node(117710)])).id, node(117719).id, 'newest by id, whatever the order');
assert.equal(selectPipeline(mr([node(117800, { sha: 'old' }), node(117719)])).id, node(117719).id, 'another sha is not the head');
assert.equal(selectPipeline(mr([node(117800, { status: 'SKIPPED', totalJobs: 0 }), node(117719)])).id, node(117719).id, 'an empty skipped one is never picked');
assert.equal(selectPipeline(mr([node(117800, { status: 'SKIPPED', totalJobs: 2 })])).id, node(117800).id, 'a skipped one with jobs is');
const merged = node(117900, { sha: 'mergecommit', mergeRequestEventType: 'MERGED_RESULT' });
assert.equal(selectPipeline(mr([node(117719)], { headPipeline: merged })).id, merged.id, "the MR's merged-result head pipeline counts");
assert.equal(selectPipeline(mr([merged, node(117719)])).id, node(117719).id, 'a merged-result one that is not the head pipeline does not');
assert.equal(selectPipeline(mr([])), null);
assert.equal(selectPipeline(mr([node(117719, { sha: 'old' })])), null);

// --- Replies: `glab api -i` output.
const http = (status, body, headers = []) => `HTTP/2.0 ${status} X\r\n${headers.join('\r\n')}${headers.length ? '\r\n' : ''}Content-Type: application/json\r\n\r\n${body}`;
const ok = (data) => ({ code: 0, stdout: http(200, JSON.stringify({ data })), stderr: '' });
let r = parseReply(MR, ok({ project: { mergeRequest: mr([node(117719, { status: 'FAILED', bad: { count: 2 } })]) } }), NOW, HEAD);
assert.equal(r.ok, true); assert.equal(r.result.kind, 'pipeline'); assert.equal(r.result.id, 117719); assert.equal(r.result.iid, 17719);
assert.equal(r.result.status, 'FAILED'); assert.equal(r.result.counts.bad, 2); assert.deepEqual(r.result.stages, [{ name: 'build', status: 'success' }]);
r = parseReply(MR, ok({ project: { mergeRequest: mr([node(117719)]) } }), NOW, null);
assert.deepEqual(r, { ok: true, again: true, head: HEAD }, 'head not known yet: ask again with it');
r = parseReply(MR, ok({ project: { mergeRequest: mr([node(117719)], { diffHeadSha: 'f00dfeed1234' }) } }), NOW, HEAD);
assert.deepEqual(r, { ok: true, again: true, head: 'f00dfeed1234' }, 'head moved: ask again with the new one');
r = parseReply(MR, ok({ project: { mergeRequest: mr([]) } }), NOW, HEAD);
assert.deepEqual(r.result, { kind: 'awaiting', head: HEAD.slice(0, 8) }, "the head's pipeline isn't there yet");
r = parseReply(PL, ok({ project: { pipeline: node(117719) } }), NOW);
assert.equal(r.ok, true); assert.equal(r.result.id, 117719);
// Failures: a problem to show, and Retry-After when GitLab gave one.
r = parseReply(MR, ok({ project: { mergeRequest: null } }), NOW, HEAD);
assert.equal(r.ok, false); assert.match(r.problem, /merge request not found or not readable/);
r = parseReply(PL, ok({ project: null }), NOW);
assert.match(r.problem, /project not found or not readable/);
r = parseReply(MR, { code: 0, stdout: http(200, JSON.stringify({ data: { project: null }, errors: [{ message: 'Query has complexity of 400' }] })), stderr: '' }, NOW, HEAD);
assert.equal(r.ok, false); assert.match(r.problem, /complexity/, "GraphQL's own error is the problem");
r = parseReply(MR, { code: 1, stdout: http(429, '{}', ['Retry-After: 120']), stderr: 'glab: HTTP 429 Too Many Requests' }, NOW, HEAD);
assert.equal(r.ok, false); assert.equal(r.retryAfter, 120000); assert.match(r.problem, /^glab exited 1: glab: HTTP 429/);
r = parseReply(MR, { code: 1, stdout: http(503, '', [`Retry-After: ${new Date(NOW + 30000).toUTCString()}`]), stderr: '' }, NOW, HEAD);
assert.ok(Math.abs(r.retryAfter - 30000) < 1000, 'Retry-After as an HTTP date'); assert.match(r.problem, /HTTP 503/);
r = parseReply(MR, { code: 0, stdout: http(200, 'not json'), stderr: '' }, NOW, HEAD);
assert.equal(r.problem, 'unreadable reply from GitLab');
r = parseReply(MR, { code: -1, stdout: '', stderr: 'timed out' }, NOW, HEAD);
assert.equal(r.problem, 'glab exited -1: timed out');
// Body without headers (an older glab) still reads.
r = parseReply(PL, { code: 0, stdout: JSON.stringify({ data: { project: { pipeline: node(117719) } } }), stderr: '' }, NOW);
assert.equal(r.ok, true);

// --- Observation states (ticket 07).
const pipe = summarize(node(117719, { status: 'RUNNING', all: { count: 10 }, ok: { count: 4 }, bad: { count: 1 }, done: { count: 5 }, run: { count: 2 }, wait: { count: 1 }, manual: { count: 2 },
  stages: { nodes: [{ name: 'build', status: 'success' }, { name: 'test', status: 'running' }, { name: 'deploy', status: 'created' }] } }), MR);
let e = applyReply(null, { ok: true, result: pipe }, NOW);
assert.deepEqual(e, { result: pipe, at: NOW, problem: null });
assert.equal(reading(e, NOW + 1000).state, 'pipeline'); assert.equal(reading(e, NOW + 1000).outdated, false);
assert.equal(reading(e, NOW + OUTDATED_MS + 1).outdated, true, '90 s without a success');
const failed = applyReply(e, { ok: false, problem: 'glab exited 1: HTTP 502' }, NOW + 30000);
assert.deepEqual(failed, { result: pipe, at: NOW, problem: 'glab exited 1: HTTP 502' }, 'a failed refresh keeps the last result');
assert.equal(reading(failed, NOW + 30000).outdated, true, 'outdated at once on a failed refresh');
assert.equal(reading(failed, NOW + 10 * OUTDATED_MS, false).outdated, false, "an ended Watch's observation is never outdated");
assert.equal(reading(applyReply(failed, { ok: true, result: pipe }, NOW + 60000), NOW + 60000).outdated, false, 'a success clears it');
const none = applyReply(null, { ok: false, problem: 'glab: not logged in' }, NOW);
assert.deepEqual(reading(none, NOW), { state: 'unavailable', outdated: false, result: null, at: null, problem: 'glab: not logged in' });
assert.equal(reading(undefined, NOW).state, 'unavailable', 'nothing observed yet');
assert.equal(reading(applyReply(null, { ok: true, result: { kind: 'awaiting', head: 'a1b2c3d4' } }, NOW), NOW).state, 'awaiting');

// --- Publishing: on change, and refreshing `at` only once it's getting old.
assert.equal(worthPublishing(undefined, e, NOW), true);
assert.equal(worthPublishing(e, applyReply(e, { ok: true, result: pipe }, NOW + 30000), NOW + 30000), false, 'same result, recent: no redraw');
assert.equal(worthPublishing(e, applyReply(e, { ok: true, result: pipe }, NOW + 45000), NOW + 45000), true, 'same result, getting old');
assert.equal(worthPublishing(e, applyReply(e, { ok: true, result: { ...pipe, status: 'SUCCESS' } }, NOW + 1000), NOW + 1000), true, 'changed result');
assert.equal(worthPublishing(e, failed, NOW + 1000), true, 'a new problem');

// --- Readings for the mark and bar (ticket 08).
assert.equal(phaseOf(pipe), 'running');
assert.deepEqual(stagesDone(pipe), { done: 1, total: 3, at: 2 });
assert.deepEqual(barOf(pipe), { total: 8, pass: 0.5, fail: 0.125, run: 0.25, wait: 0.125 }, 'manual jobs left out');
const c0 = { all: 3, ok: 3, bad: 0, done: 3, run: 0, wait: 0, manual: 0 };
const ph = (status, counts = {}, downstream = []) => phaseOf({ status, counts: { ...c0, ...counts }, downstream });
assert.equal(ph('SUCCESS'), 'passed');
assert.equal(ph('FAILED'), 'failed');
assert.equal(ph('CANCELED'), 'failed');
assert.equal(ph('PENDING', { wait: 3, ok: 0, done: 0 }), 'queued', 'waiting for a runner');
assert.equal(ph('RUNNING', { bad: 1 }), 'running', 'a failed job while it still runs stays running');
assert.equal(ph('MANUAL'), 'manual');
assert.equal(ph('SUCCESS', {}, [{ status: 'RUNNING' }]), 'running', 'a downstream still running');
assert.equal(ph('SUCCESS', {}, [{ status: 'FAILED' }]), 'failed', 'a downstream failed');
assert.deepEqual(stagesDone({ stages: [{ status: 'success' }, { status: 'failed' }] }), { done: 2, total: 2, at: 2 }, 'finished: the last stage');
assert.deepEqual(barOf({ counts: { ...c0, all: 0 } }), { total: 0, pass: 0, fail: 0, run: 0, wait: 0 });

// --- Demand: live Watches with a ref, one target each.
const rec = (ref, o = {}) => ({ waiting: '1', 'waiting.id': 'w', 'waiting.subject': 's', 'waiting.since': '1', 'waiting.stamp': '3:0', ...(ref ? { 'waiting.ref': ref } : {}), ...o });
const term = (address, labels, o = {}) => ({ address, state: 'live', status: 'idle', turn: 3, labels, ...o });
const { watchOf } = await import(resolve(mods, 'omarchy-watch/waiting.js'));
const need = demandOf([
  term('a', rec('https://git.example.com/products/fv/-/merge_requests/161')),
  term('b', rec('https://git.example.com/products/fv/-/merge_requests/161')),
  term('c', rec(null)),
  term('d', rec('https://git.example.com/products/fv/-/pipelines/8866', { 'waiting.ended': 'w' })),
  term('e', rec('https://git.example.com/products/fv/-/pipelines/1'), { state: 'finished' }),
  term('f', rec('https://git.example.com/products/fv/-/pipelines/2'), { turn: 5 }),
], watchOf, parseRef);
assert.deepEqual([...need.keys()], ['git.example.com/products/fv/mr/161'], 'one per target; plain, ended, finished and new-work Watches need nothing');

// --- The scheduler.
const many = (n, host = 'h') => new Map(Array.from({ length: n }, (_, i) => [`${host}/p/pipeline/${i}`, { host, project: 'p', kind: 'pipeline', iid: i }]));
let s = newSchedule();
let picks = plan(s, many(5), NOW);
assert.equal(picks.length, HOST_INFLIGHT, 'three in flight per host');
assert.equal(plan(s, many(5), NOW).length, 0, 'none while three are out');
assert.equal(plan(newSchedule(), new Map([...many(5), ...many(5, 'other')]), NOW).length, 2 * HOST_INFLIGHT, 'each host has its own budget');
assert.equal(finish(s, picks[0], { ok: true, result: pipe }, NOW + 100), true);
assert.equal(s.refs.get(picks[0].key).nextAt, NOW + 100 + REFRESH_MS, 'next refresh in 30 s');
picks = [...picks.slice(1), ...plan(s, many(5), NOW + 100)];
assert.equal(picks.length, 3); assert.ok(!picks.some((p) => p.key === 'h/p/pipeline/0'), 'not due again yet');
// Sixty starts a minute per host.
s = newSchedule();
let started = 0;
for (let i = 0; i < 100; i++) for (const pk of plan(s, many(100), NOW + i)) { started++; finish(s, pk, { ok: true, result: pipe }, NOW + i); }
assert.equal(started, HOST_PER_MIN, 'sixty a minute');
assert.equal(plan(s, many(100), NOW + 60001).length > 0, true, 'more once the minute has passed');
// Backoff: doubling from 30 s, capped at 5 min, never sooner than Retry-After; the host waits out a Retry-After.
assert.deepEqual([1, 2, 3, 4, 5, 9].map((n) => backoff(n)), [30000, 60000, 120000, 240000, BACKOFF_MAX_MS, BACKOFF_MAX_MS]);
assert.equal(backoff(1, 600000), 600000);
s = newSchedule();
const one = many(2);
let [p1, p2] = plan(s, one, NOW);
finish(s, p1, { ok: false, problem: 'x', retryAfter: 0 }, NOW);
assert.equal(s.refs.get(p1.key).nextAt, NOW + 30000);
finish(s, p2, { ok: false, problem: 'x', retryAfter: 120000 }, NOW);
assert.equal(s.refs.get(p2.key).nextAt, NOW + 120000);
assert.equal(plan(s, one, NOW + 60000).length, 0, 'the host waits out Retry-After');
[p1] = plan(s, one, NOW + 120000);
finish(s, p1, { ok: false, problem: 'x' }, NOW + 120000);
assert.equal(s.refs.get(p1.key).fails, 2); assert.equal(s.refs.get(p1.key).nextAt, NOW + 120000 + 60000);
// A target no live Watch needs is dropped; its late reply too, and its host slot is freed.
s = newSchedule();
[p1] = plan(s, many(1), NOW);
plan(s, new Map(), NOW + 1);
assert.equal(finish(s, p1, { ok: true, result: pipe }, NOW + 2), false, 'gone: dropped');
assert.equal(s.refs.size, 0); assert.equal(s.hosts.get('h').inflight, 0);
// A moved head: asked again at once with it, nothing stored.
s = newSchedule();
const mrs = new Map([[refKey(MR), MR]]);
[p1] = plan(s, mrs, NOW);
assert.equal(finish(s, p1, { ok: true, again: true, head: HEAD }, NOW + 5), false);
[p1] = plan(s, mrs, NOW + 5);
assert.equal(p1.head, HEAD, 'the next request asks about the new head');
// A stale pick (seq) can't overwrite a newer one.
assert.equal(finish(s, { ...p1, seq: p1.seq - 1 }, { ok: true, result: pipe }, NOW + 6), false);

// --- The observer (main.js): one poller under a lease, publishing to shared.
let checkingNow = false, all = [], shared = new Map(), calls = [], reply = () => ok({ project: { pipeline: node(117719) } }), publishes = 0;
const el = () => new Proxy({}, { get: (o, k) => () => o });
const herdr = {
  terminals: () => all, checking: () => checkingNow,
  shared: (k) => shared.get(k), setShared: (k, v) => { publishes++; shared.set(k, v); },
  exec: async (cmd, args, opts) => { calls.push({ cmd, args, opts }); return reply(args); },
};
const cache = new Map();
async function load(path) {
  if (cache.has(path)) return cache.get(path);
  const module = new SourceTextModule(await readFile(path, 'utf8'), { identifier: path });
  cache.set(path, module);
  await module.link(async (specifier, ref) => {
    const exports = specifier.startsWith('.') ? null : ({ 'gpui-kit': { View: class {}, div: el }, herdr })[specifier];
    if (exports) return new SyntheticModule(Object.keys(exports), function () { for (const [k, v] of Object.entries(exports)) this.setExport(k, v); });
    return load(resolve(dirname(ref.identifier), specifier));
  });
  return module;
}
const main = await load(resolve(mods, 'omarchy-watch/main.js')); await main.evaluate();
const Observer = main.namespace.default, { TTL_MS } = main.namespace;
const flush = () => new Promise((r) => setImmediate(r));
let ticks = [];
const cx = { timer: { every: (_ms, fn) => { ticks.push(fn); return { cancel() { ticks = ticks.filter((f) => f !== fn); } }; } } };
const KEY = refKey(PL);
// Left over from the last app run: dropped for a live Watch at the first claim (unavailable until this run sees it).
shared.set('omarchy-waiting.obs', { [KEY]: { result: pipe, at: 1, problem: null }, 'h/x/pipeline/9': { result: pipe, at: 1, problem: null } });
all = [term('a', rec('https://git.example.com/products/fv/-/pipelines/8866')), term('z', rec('https://h/x/-/pipelines/9', { 'waiting.ended': 'w' }))];
delete globalThis.__omarchyWaitingObserver;
const one1 = new Observer(); one1.init({}, cx);
const two = new Observer(); two.init({}, cx);
assert.equal(calls.length, 1, 'two copies, one request');
assert.deepEqual(calls[0].args.slice(0, 5), ['api', '-i', '--hostname', 'git.example.com', 'graphql']);
assert.equal(calls[0].cmd, 'glab'); assert.ok(calls[0].opts.timeout > 0);
await flush();
let obs = shared.get('omarchy-waiting.obs');
assert.equal(obs[KEY].result.id, 117719); assert.ok(obs[KEY].at > 1, "this run's observation");
assert.ok(obs['h/x/pipeline/9'], "an ended Watch's observation stays");
// Unchanged replies don't republish.
publishes = 0;
for (const f of [...ticks]) f();
assert.equal(calls.length, 1, 'not due for 30 s');
// The ended Watch's terminal goes: its observation is pruned.
all = all.slice(0, 1);
for (const f of [...ticks]) f();
assert.equal(shared.get('omarchy-waiting.obs')['h/x/pipeline/9'], undefined);
assert.ok(shared.get('omarchy-waiting.obs')[KEY]);
// The owner closes: the other copy takes over at once, keeping the cache.
const owner = globalThis.__omarchyWaitingObserver.owner === one1.me ? one1 : two, other = owner === one1 ? two : one1;
owner.close();
for (const f of [...ticks]) f();
assert.equal(globalThis.__omarchyWaitingObserver.owner, other.me);
assert.equal(calls.length, 2, 'the new owner refreshes at once');
await flush();
assert.ok(shared.get('omarchy-waiting.obs')[KEY]);
// A lost owner (a reload skips close) is taken over after the TTL, not before.
const third = new Observer(); third.init({}, cx);
assert.equal(globalThis.__omarchyWaitingObserver.owner, other.me);
other.timer.cancel();
const beat = globalThis.__omarchyWaitingObserver.beat;
third.tick(beat + TTL_MS);
assert.equal(globalThis.__omarchyWaitingObserver.owner, other.me, 'within the TTL');
third.tick(beat + TTL_MS + 1);
assert.equal(globalThis.__omarchyWaitingObserver.owner, third.me, 'past it');
await flush();
// A reply that comes back after its copy lost the lease is dropped.
reply = () => ok({ project: { pipeline: node(117720) } });
calls = [];
third.tick(Date.now() + 10 * REFRESH_MS);
assert.equal(calls.length, 1);
globalThis.__omarchyWaitingObserver = { owner: 'someone-else', beat: Date.now() + 10 * REFRESH_MS };
await flush();
assert.equal(shared.get('omarchy-waiting.obs')[KEY].result.id, 117719, 'dropped');
// A failure keeps the result and says why.
globalThis.__omarchyWaitingObserver = { owner: third.me, beat: Date.now() + 10 * REFRESH_MS };
reply = () => ({ code: 1, stdout: '', stderr: 'glab: HTTP 502 Bad Gateway' });
third.sched = newSchedule();
third.tick(Date.now() + 11 * REFRESH_MS);
await flush();
obs = shared.get('omarchy-waiting.obs')[KEY];
assert.equal(obs.result.id, 117719); assert.match(obs.problem, /502/);
// In `herdr-app check` it does nothing.
checkingNow = true; calls = []; ticks = [];
delete globalThis.__omarchyWaitingObserver;
new Observer().init({}, cx);
assert.equal(calls.length, 0); assert.equal(ticks.length, 0); assert.equal(globalThis.__omarchyWaitingObserver, undefined);

console.log('pipeline: ok');
