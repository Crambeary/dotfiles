import { pinKey, readPins } from "./pins.js";

export const ACTIVE_MS = 60000, FINISHED_MS = 300000, OUTDATED_MS = 90000;
const FINISHED = new Set(["success", "failed", "canceled", "skipped"]);
export const cadence = row => FINISHED.has(row?.status) ? FINISHED_MS : ACTIVE_MS;
export const originOf = e => ({ on: e.project[0], host: e.project[1], repo: e.project[2],
  provider: /(^|[.-])github([.-]|$)/.test(e.project[1]) ? "github" : "gitlab" });

// Shared by copies and hot reloads. Existing local enrichment and pin pairs
// use this same rolling budget/mutex. A pair reserves both potential API reads.
export function readPool() {
  return globalThis.__omarchyForgeReadPool ??= { starts: [], busy: false };
}
export function reserve(pool, now, cost) {
  pool.starts = pool.starts.filter(at => now - at < 60000);
  if ((pool.busy && now < pool.busy.until) || pool.starts.length + cost > 4) return null;
  pool.starts.push(...Array(cost).fill(now));
  const token = { until: now + 70000 }; // two guarded exec phases, <=30s each
  pool.busy = token;
  return token;
}

export function release(pool, token) { if (pool.busy === token) pool.busy = null; }

// Pin membership and its generation own a reply, independent of space/tab.
// Hiding invalidates all generations; re-pinning an ID creates a new one too.
export class PinSchedule {
  constructor() { this.refs = new Map(); this.epoch = 0; }
  sync(raw) {
    const pins = readPins(raw), keys = new Set();
    for (const e of pins) {
      const project = originOf(e), key = pinKey(project, e.id);
      keys.add(key);
      if (!this.refs.has(key) || this.refs.get(key).pinnedAt !== e.pinnedAt) this.refs.set(key, { key, project, id: e.id,
        pinnedAt: e.pinnedAt, seenAt: e.seenAt, row: e.row, nextAt: 0, fails: 0 });
    }
    for (const key of this.refs.keys()) if (!keys.has(key)) this.refs.delete(key);
  }
  hide() {
    this.epoch++;
    for (const r of this.refs.values()) { r.inflight = false; r.nextAt = 0; }
  }
  pick(now) {
    const r = [...this.refs.values()].filter(r => !r.inflight && r.nextAt <= now)
      .sort((a, b) => a.nextAt - b.nextAt || a.key.localeCompare(b.key))[0];
    if (!r) return null;
    r.inflight = true;
    return { ref: r, epoch: this.epoch, age: cadence(r.row) / 1000 };
  }
  accepts(pick) { return pick.epoch === this.epoch && this.refs.get(pick.ref.key) === pick.ref; }
  finish(pick, result, now) {
    if (!this.accepts(pick)) return false;
    const r = pick.ref, error = result.error || result.jobsError;
    r.inflight = false;
    if (result.row) r.row = result.row;
    r.fails = error ? r.fails + 1 : 0;
    r.nextAt = now + (error ? Math.min(900000, ACTIVE_MS * 2 ** Math.min(r.fails - 1, 4)) : cadence(r.row));
    return true;
  }
}

export function statusFresh(observation, now) {
  return Boolean(observation?.at && !observation.error && now - observation.at <= Math.max(OUTDATED_MS, cadence(observation.row) + 30000));
}
