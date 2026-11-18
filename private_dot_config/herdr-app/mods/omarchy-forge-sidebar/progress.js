// WATCH reference: omarchy-inbox/pipeline.js and pipeline-view.js. Forge's jobs
// endpoint supplies jobs rather than GraphQL counts. Never infer work from the
// pipeline status alone, or claim complete counts at the endpoint's 100-job cap.
export const LIVE = new Set(['created', 'pending', 'waiting_for_resource', 'preparing', 'running', 'scheduled', 'canceling']);
const FINISHED = new Set(['success', 'failed', 'canceled', 'skipped']);
const KNOWN = new Set([...FINISHED, ...LIVE, 'manual', 'waiting_for_callback']);
export const word = status => ({ success: 'passed', pending: 'no runner', waiting_for_resource: 'no runner', created: 'not started' })[status] ?? status;
export const glyph = phase => ({ running: '●', queued: '○', passed: '✓', failed: '✗', manual: '○', unknown: '?' })[phase];
export const tint = (t, phase) => ({ running: t.working, queued: t.working, passed: t.done, failed: t.blocked })[phase] ?? t.dim;

export function summarize(jobs) {
  if (!Array.isArray(jobs) || !jobs.length || jobs.length >= 100 || jobs.some(j => !j || !KNOWN.has(j.status))) return null;
  const count = statuses => jobs.filter(j => statuses.includes(j.status)).length;
  const counts = { all: jobs.length, manual: count(['manual']), ok: count(['success', 'skipped']), bad: count(['failed']),
    done: count([...FINISHED]), run: count(['running', 'preparing']), wait: count(['pending', 'waiting_for_resource']) };
  const groups = new Map();
  for (const j of jobs) {
    const name = j.group || 'Jobs';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(j.status);
  }
  const stages = [...groups].map(([name, statuses]) => {
    const status = ['running', 'preparing', 'canceling', 'failed', 'pending', 'waiting_for_resource', 'created', 'scheduled', 'manual', 'canceled']
      .find(s => statuses.includes(s)) ?? (statuses.every(s => FINISHED.has(s)) ? 'success' : statuses[0]);
    return { name, status };
  });
  return { counts, stages };
}

export function progressOf(row, entry, now = Date.now()) {
  const data = summarize(entry?.jobs);
  const outdated = Boolean(entry?.error) || !entry?.at || now - entry.at > (entry?.maxAge ?? 90000)
    || (Number.isFinite(row.updated_ms) && entry.at + 1000 < row.updated_ms)
    || entry.status !== row.status || entry.updated_ms !== row.updated_ms;
  if (!data) return { phase: 'unknown', outdated, data: null, parts: [], problem: entry?.error
    ?? (entry?.jobs?.length >= 100 ? 'Job list may be incomplete (100-job limit).' : 'Job progress has not been loaded yet.') };
  const c = data.counts, status = row.status;
  // WATCH phase ordering and bar semantics: skipped is passed, manual excluded,
  // canceled is finished but never painted as passed or failed.
  const phase = status === 'running' || c.run ? 'running'
    : ['failed', 'canceled', 'canceling'].includes(status) ? 'failed'
    : c.wait || ['pending', 'waiting_for_resource', 'preparing', 'created', 'scheduled', 'waiting_for_callback'].includes(status) ? 'queued'
    : status === 'manual' ? 'manual' : 'passed';
  const total = Math.max(0, c.all - c.manual);
  const parts = [c.ok, c.bad, c.run, c.wait].map(n => total ? Math.max(0, Math.min(1, n / total)) : 0);
  return { phase, outdated, data, total, parts, done: data.stages.filter(s => FINISHED.has(s.status)).length, problem: entry?.error };
}
