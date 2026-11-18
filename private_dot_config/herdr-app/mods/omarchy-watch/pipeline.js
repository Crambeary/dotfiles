// Pipeline observations for Waiting: what the observer (omarchy-watch) asks GitLab for a Watch's `waiting.ref`, how it
// picks the pipeline, keeps to the per-host budget and retries, and how readers (omarchy-inbox) tell fresh from outdated
// (tickets 07, 08, 12, 13). Pure: no herdr calls, so tests load it as is. A copy lives in each mod that uses it
// (omarchy-watch, omarchy-inbox); tests/herdr/waiting.mjs checks they stay the same.

// Cadence and limits (ticket 07).
export const REFRESH_MS = 30000;
export const OUTDATED_MS = 90000;
export const BACKOFF_MAX_MS = 300000;
export const HOST_INFLIGHT = 3;
export const HOST_PER_MIN = 60;
export const TIMEOUT_MS = 20000;
// Where the shared cache lives: { [refKey]: entry }. See applyReply for an entry.
export const OBS_KEY = "omarchy-waiting.obs";
// Candidates on the MR head, cut by sha server-side: a handful per head at most (research 12). Each carries the heavy
// fields: the MR query measured 137 of git.tecplot.com's complexity limit of 300, a pipeline query 56.
const CANDIDATES = 5;

// One target per distinct MR or pipeline: ten Watches on one MR share it.
export const refKey = (p) => `${p.host}/${p.project}/${p.kind}/${p.iid}`;

// GraphQL's string escapes are JSON's.
const lit = (s) => JSON.stringify(String(s));

// The selected pipeline's own jobs as exact counts (no paging: retried:false counts are exact whatever the page size),
// its stages, and one level of downstream with status and stages only (research 12 §2-3).
const PIPELINE = `id iid status sha mergeRequestEventType totalJobs
all: jobs(retried:false) { count }
ok: jobs(retried:false, statuses:[SUCCESS,SKIPPED]) { count }
bad: jobs(retried:false, statuses:[FAILED]) { count }
done: jobs(retried:false, statuses:[SUCCESS,FAILED,CANCELED,SKIPPED]) { count }
run: jobs(retried:false, statuses:[RUNNING,PREPARING]) { count }
wait: jobs(retried:false, statuses:[PENDING,WAITING_FOR_RESOURCE]) { count }
manual: jobs(retried:false, statuses:[MANUAL]) { count }
stages(first:100) { nodes { name status } }
downstream(first:20) { nodes { id iid status child project { fullPath } stages(first:100) { nodes { name status } } } pageInfo { hasNextPage } }`;

// One request per refresh. A pipeline asks for that run. An MR asks for its head and the candidates on `head`, the head
// it last had: GitLab lists merge-request-event pipelines first, so on a busy MR the head's own run can sit past any first
// page unless the list is cut by sha (research 12 §1). The head pipeline comes whole too: a merged-result pipeline's sha is
// its merge commit, not the head. When the head moved (or isn't known yet), the reply says so and the observer asks again.
export function queryOf(p, head) {
  const inner = p.kind === "mr"
    ? `mergeRequest(iid:${lit(p.iid)}) { iid diffHeadSha headPipeline { ${PIPELINE} } pipelines(first:${CANDIDATES}${head ? `, sha:${lit(head)}` : ""}) { nodes { ${PIPELINE} } } }`
    : `pipeline(iid:${lit(p.iid)}) { ${PIPELINE} }`;
  return `query { queryComplexity { score limit } project(fullPath:${lit(p.project)}) { ${inner} } }`;
}

export const glabArgs = (p, head) => ["api", "-i", "--hostname", p.host, "graphql", "-f", `query=${queryOf(p, head)}`];

const num = (gid) => Number(String(gid ?? "").split("/").pop()) || 0;

// The MR's current head's newest eligible pipeline, or null (awaiting): sha on the head, or a merged-result pipeline that
// is the MR's head pipeline (GraphQL has no sourceSha); never an empty skipped one. Newest by id, as the list's order
// can't be trusted (research 12 §1).
export function selectPipeline(mr) {
  const head = mr?.diffHeadSha, hp = mr?.headPipeline?.id;
  const all = [...(mr?.pipelines?.nodes ?? []), mr?.headPipeline].filter((x, i, xs) => x && xs.findIndex((y) => y?.id === x.id) === i);
  const ok = all.filter((x) => x && (x.sha === head || (x.mergeRequestEventType === "MERGED_RESULT" && hp && x.id === hp))
    && !(x.status === "SKIPPED" && !x.totalJobs));
  return ok.sort((a, b) => num(b.id) - num(a.id))[0] ?? null;
}

const stagesOf = (s) => (s?.nodes ?? []).filter(Boolean).map((x) => ({ name: String(x.name ?? ""), status: String(x.status ?? "").toLowerCase() }));
const count = (x) => Number(x?.count) || 0;

// A pipeline node, as the cache keeps it.
export function summarize(x, p) {
  return {
    kind: "pipeline", id: num(x.id), iid: Number(x.iid) || null, status: String(x.status ?? "").toUpperCase(), sha: x.sha ?? null,
    project: p.project, ref: { kind: p.kind, iid: p.iid },
    counts: { all: count(x.all), ok: count(x.ok), bad: count(x.bad), done: count(x.done), run: count(x.run), wait: count(x.wait), manual: count(x.manual) },
    stages: stagesOf(x.stages),
    downstream: (x.downstream?.nodes ?? []).filter(Boolean).map((d) => ({ id: num(d.id), iid: Number(d.iid) || null,
      status: String(d.status ?? "").toUpperCase(), child: Boolean(d.child), project: d.project?.fullPath ?? null, stages: stagesOf(d.stages) })),
    more: Boolean(x.downstream?.pageInfo?.hasNextPage),
  };
}

// `glab api -i` output: the status line and headers, a blank line, the body. Without them (an older glab, a test), body only.
function split(stdout) {
  const s = String(stdout ?? "");
  if (!s.startsWith("HTTP/")) return { status: null, headers: {}, body: s };
  const cut = s.search(/\r?\n\r?\n/);
  const head = cut < 0 ? s : s.slice(0, cut), body = cut < 0 ? "" : s.slice(cut).replace(/^\r?\n\r?\n/, "");
  const [line, ...rest] = head.split(/\r?\n/);
  const headers = {};
  for (const h of rest) { const i = h.indexOf(":"); if (i > 0) headers[h.slice(0, i).trim().toLowerCase()] = h.slice(i + 1).trim(); }
  return { status: Number(/^HTTP\/\S+\s+(\d+)/.exec(line)?.[1]) || null, headers, body };
}

// Retry-After as ms: seconds, or an HTTP date.
function retryAfter(v, now) {
  if (!v) return 0;
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - now) : 0;
}

const short = (s) => String(s ?? "").split("\n").map((l) => l.trim()).filter(Boolean)[0]?.slice(0, 140) ?? "";

// What one refresh came to: `{ ok: true, result }` with result a pipeline or `{ kind: "awaiting", head }`;
// `{ ok: true, again: true, head }` when an MR's head isn't the one asked about (ask again with it, store nothing); or
// `{ ok: false, problem, retryAfter }`. `out` is exec's `{ code, stdout, stderr }`; `head` the head the query asked about.
export function parseReply(p, out, now = Date.now(), head = null) {
  const { status, headers, body } = split(out?.stdout);
  const wait = retryAfter(headers["retry-after"], now);
  if (out?.code !== 0 || (status && status >= 400)) {
    const why = short(out?.stderr) || (status ? `HTTP ${status}` : "no reply");
    return { ok: false, problem: `glab exited ${out?.code ?? "?"}: ${why}`, retryAfter: wait };
  }
  let json;
  try { json = JSON.parse(body); } catch { return { ok: false, problem: "unreadable reply from GitLab", retryAfter: wait }; }
  const project = json?.data?.project, err = short(json?.errors?.[0]?.message);
  if (p.kind === "mr") {
    const mr = project?.mergeRequest;
    if (!mr) return { ok: false, problem: err || (project ? "merge request not found or not readable" : "project not found or not readable"), retryAfter: wait };
    if (mr.diffHeadSha && mr.diffHeadSha !== head) return { ok: true, again: true, head: mr.diffHeadSha };
    const pick = selectPipeline(mr);
    return { ok: true, result: pick ? summarize(pick, p) : { kind: "awaiting", head: String(mr.diffHeadSha ?? "").slice(0, 8) || null } };
  }
  const x = project?.pipeline;
  if (!x) return { ok: false, problem: err || (project ? "pipeline not found or not readable" : "project not found or not readable"), retryAfter: wait };
  return { ok: true, result: summarize(x, p) };
}

// A cache entry after a reply: `{ result, at, problem }`. `at` is the last success; a failure keeps the last result and
// says what went wrong, so readers show it outdated at once (ticket 07).
export function applyReply(entry, reply, now) {
  if (reply.ok) return { result: reply.result, at: now, problem: null };
  return { result: entry?.result ?? null, at: entry?.at ?? null, problem: reply.problem };
}

// Whether a new entry is worth a publish: every publish redraws every mod. A changed result or problem is; a fresh `at` on
// the same result only when the published one is getting old, so a reader never sees a working target as outdated.
export function worthPublishing(prev, next, now) {
  if (!prev) return true;
  if (JSON.stringify(prev.result) !== JSON.stringify(next.result) || prev.problem !== next.problem) return true;
  return next.at !== prev.at && now - (prev.at ?? 0) >= OUTDATED_MS / 2;
}

// What a reader shows for a Watch's target. `live`: the Watch is live, so its target is kept fresh; an ended one's last
// observation is kept as it was, never outdated (ticket 13).
// `{ state: "unavailable" | "awaiting" | "pipeline", outdated, result, at, problem }`.
export function reading(entry, now, live = true) {
  if (!entry?.result) return { state: "unavailable", outdated: false, result: null, at: null, problem: entry?.problem ?? null };
  const outdated = live && (Boolean(entry.problem) || now - entry.at > OUTDATED_MS);
  return { state: entry.result.kind === "awaiting" ? "awaiting" : "pipeline", outdated, result: entry.result, at: entry.at, problem: entry.problem };
}

const FINISHED = new Set(["success", "failed", "canceled", "skipped"]);
const ACTIVE = new Set(["running", "preparing", "canceling"]);

// The phase the mark and card show: "running", "queued" (waiting for a runner), "passed", "failed", "manual".
// A downstream running keeps it running; one failed under a passed parent shows failed (research 12 §3: shown, not counted).
export function phaseOf(r) {
  const c = r.counts, ds = r.downstream ?? [];
  if (r.status === "RUNNING" || c.run > 0 || ds.some((d) => d.status === "RUNNING")) return "running";
  if (["FAILED", "CANCELED", "CANCELING"].includes(r.status)) return "failed";
  if (c.wait > 0 || ["PENDING", "WAITING_FOR_RESOURCE", "PREPARING", "CREATED", "SCHEDULED", "WAITING_FOR_CALLBACK"].includes(r.status)) return "queued";
  if (r.status === "MANUAL") return "manual";
  if (ds.some((d) => ["FAILED", "CANCELED"].includes(d.status))) return "failed";
  return "passed";
}

// Finished stages over all, and the stage in progress (the last one once finished), 1-based.
export function stagesDone(r) {
  const s = r.stages ?? [];
  const done = s.filter((x) => FINISHED.has(x.status)).length, at = s.findIndex((x) => !FINISHED.has(x.status));
  return { done, total: s.length, at: s.length ? (at < 0 ? s.length : at + 1) : 0 };
}

// The bar's split by job count, manual jobs left out, skipped counted as passed (ticket 08). Each a share of 1.
export function barOf(r) {
  const c = r.counts, total = Math.max(0, c.all - c.manual);
  if (!total) return { total: 0, pass: 0, fail: 0, run: 0, wait: 0 };
  const f = (n) => Math.max(0, Math.min(1, n / total));
  return { total, pass: f(c.ok), fail: f(c.bad), run: f(c.run), wait: f(c.wait) };
}

export function stageWord(status) {
  return ({ success: "passed", failed: "failed", running: "running", preparing: "running", pending: "no runner",
    waiting_for_resource: "no runner", created: "not started", skipped: "skipped", manual: "manual", canceled: "canceled",
    canceling: "canceling", scheduled: "scheduled" })[status] ?? status;
}
export const stageActive = (status) => ACTIVE.has(status);

// --- The observer's scheduler: which targets to refresh now, inside the host budget. All state is plain data.
export const newSchedule = () => ({ refs: new Map(), hosts: new Map() });

// The targets live Watches need, from terminals(): `Map<refKey, ref>`. `watchOf` is waiting.js's, passed in so this file
// imports nothing.
export function demandOf(terms, watchOf, parseRef) {
  const need = new Map();
  for (const k of terms) {
    const w = watchOf(k);
    const p = w?.ref && parseRef(w.ref);
    if (p) need.set(refKey(p), p);
  }
  return need;
}

// The refs to start now, `[{ key, seq, p }]`, marking them in flight. A new target is due at once; at most three in flight
// and sixty starts a minute per host, never two at once for one target, the longest-due first so demand above the budget
// slows every target alike. Targets no live Watch needs any more are dropped (one in flight is dropped on its reply).
export function plan(s, need, now) {
  for (const [key, p] of need) if (!s.refs.has(key)) s.refs.set(key, { p, head: null, nextAt: now, fails: 0, inflight: false, seq: 0, gone: false });
  for (const [key, r] of s.refs) {
    r.gone = !need.has(key);
    if (r.gone && !r.inflight) s.refs.delete(key);
  }
  const due = [...s.refs.entries()].filter(([, r]) => !r.inflight && r.nextAt <= now)
    .sort(([ka, a], [kb, b]) => a.nextAt - b.nextAt || ka.localeCompare(kb));
  const picks = [];
  for (const [key, r] of due) {
    const h = hostOf(s, r.p.host, now);
    if (h.inflight >= HOST_INFLIGHT || h.starts.length >= HOST_PER_MIN || now < h.until) continue;
    h.starts.push(now); h.inflight++;
    r.inflight = true; r.seq++;
    picks.push({ key, seq: r.seq, p: r.p, head: r.head });
  }
  return picks;
}

function hostOf(s, host, now) {
  let h = s.hosts.get(host);
  if (!h) s.hosts.set(host, (h = { starts: [], inflight: 0, until: 0 }));
  while (h.starts.length && now - h.starts[0] >= 60000) h.starts.shift();
  return h;
}

// Increasing delays after failures, capped at five minutes, never sooner than GitLab's Retry-After.
export const backoff = (fails, after = 0) => Math.max(after, Math.min(BACKOFF_MAX_MS, REFRESH_MS * 2 ** Math.max(0, fails - 1)));

// A reply came to a pick from plan: frees its host slot and schedules the next refresh. False when the reply must be
// dropped: its target is gone or a newer request for it was started (a late reply never overwrites a newer observation).
export function finish(s, { key, seq, p }, reply, now) {
  const h = hostOf(s, p.host, now), r = s.refs.get(key);
  h.inflight = Math.max(0, h.inflight - 1);
  if (!r || r.seq !== seq) return false;
  r.inflight = false;
  // A moved head: ask again at once about the new one, inside the budget; nothing to store.
  if (reply.again) { r.head = reply.head; r.nextAt = now; if (r.gone) s.refs.delete(key); return false; }
  if (reply.ok) { r.fails = 0; r.nextAt = now + REFRESH_MS; }
  else {
    r.fails++;
    r.nextAt = now + backoff(r.fails, reply.retryAfter);
    if (reply.retryAfter) h.until = Math.max(h.until, now + reply.retryAfter);
  }
  if (r.gone) { s.refs.delete(key); return false; }
  return true;
}
