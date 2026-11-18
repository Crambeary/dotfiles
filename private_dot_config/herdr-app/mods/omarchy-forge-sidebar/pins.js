// Pure pin helpers. A pin is scoped to project.on + host + repo + pipeline ID,
// so the same numeric ID on another machine, host or repository never collides.
// Keys are JSON arrays, never joined strings, so "a/b" + "c" cannot alias "a" + "b/c".
export const PINS = "omarchy-forge-sidebar.pins";
export const MAX_PINS = 100;
const FIELDS = ["id", "iid", "ref", "status", "sha", "url", "updated_ms"];

export const validId = id => Number.isSafeInteger(id) && id > 0;
export const scopeOf = p => [p?.on ?? null, p?.host, p?.repo];
export const pinKey = (p, id) => JSON.stringify([...scopeOf(p), id]);
const sameScope = (a, p) => JSON.stringify(a) === JSON.stringify(scopeOf(p));

// Keep only plain display fields from a row: no nested data, nothing guessed.
export const snapshot = row => Object.fromEntries(FIELDS
  .filter(k => row?.[k] != null && typeof row[k] !== "object").map(k => [k, row[k]]));

// Shared state is persisted JSON that other code could have written: validate it.
export function readPins(raw) {
  if (raw?.v !== 1 || !Array.isArray(raw.pins)) return [];
  const seen = new Set();
  return raw.pins.filter(e => {
    if (!Array.isArray(e?.project) || e.project.length !== 3 || !validId(e.id) || !e.project.slice(1).every(s => typeof s === "string" && s)
      || !(e.project[0] === null || typeof e.project[0] === "string")) return false;
    const key = pinKey({ on: e.project[0], host: e.project[1], repo: e.project[2] }, e.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(e => ({ project: e.project, id: e.id, pinnedAt: Number(e.pinnedAt) || 0, seenAt: Number(e.seenAt) || null,
    row: { ...snapshot(e.row), id: e.id } }));
}

export const pinnedIn = (raw, project) => new Set(readPins(raw).filter(e => sameScope(e.project, project)).map(e => e.id));

// Returns the next shared value. `seen` maps pinKey -> {row, at}: the newest
// observations, written back with this pin/unpin so no extra writes are needed.
export function togglePin(raw, project, row, seen = new Map(), now = Date.now()) {
  if (!validId(row?.id)) return raw;
  const observation = id => {
    const s = seen.get(pinKey(project, id));
    return s?.row?.id === id && typeof s.row.status === "string" && s.at > 0 ? s : null;
  };
  let pins = readPins(raw).map(e => {
    const s = sameScope(e.project, project) ? observation(e.id) : null;
    return s && s.at >= (e.seenAt ?? 0) ? { ...e, row: { ...snapshot(s.row), id: e.id }, seenAt: s.at } : e;
  });
  const had = pins.some(e => sameScope(e.project, project) && e.id === row.id);
  if (had) pins = pins.filter(e => !(sameScope(e.project, project) && e.id === row.id));
  else {
    const s = observation(row.id);
    pins.push({ project: scopeOf(project), id: row.id, pinnedAt: now, seenAt: s?.at ?? now, row: snapshot(s?.row ?? row) });
    pins = pins.sort((a, b) => b.pinnedAt - a.pinnedAt).slice(0, MAX_PINS);
  }
  return { v: 1, pins };
}

// Pins are global display entries; their identity and actions retain the origin
// project. Only the current project's confirmed pipeline list can refresh one.
export function arrange(rows, raw, project, seen = new Map(), listed = true, listAt = Infinity, now = Date.now()) {
  const pins = readPins(raw);
  const local = new Map(rows.map(r => [r.id, r]));
  const top = pins.map(e => {
    const origin = { on: e.project[0], host: e.project[1], repo: e.project[2],
      provider: /(^|[.-])github([.-]|$)/.test(e.project[1]) ? "github" : "gitlab" };
    const current = Boolean(project && sameScope(e.project, project));
    const localRow = current && listed ? local.get(e.id) : null;
    const s = seen.get(pinKey(origin, e.id));
    const observed = s?.observed && s.at && (!localRow || s.at >= listAt);
    const row = observed ? s.row : localRow ?? s?.row ?? e.row;
    const maxAge = ["success", "failed", "canceled", "skipped"].includes(row?.status) ? 330000 : 90000;
    return { row, project: origin, key: pinKey(origin, e.id), observation: s,
      pinned: true, stale: observed ? Boolean(s.error) || now - s.at > maxAge : !localRow,
      foreign: !current, unconfirmed: !observed && (!current || !listed), seenAt: s?.at ?? e.seenAt };
  }).sort((a, b) => b.row.id - a.row.id || a.key.localeCompare(b.key));
  const mine = pinnedIn(raw, project);
  return [...top, ...rows.filter(r => !mine.has(r.id)).map(row => ({ row, project, pinned: false, stale: false }))];
}
