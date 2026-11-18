// What the footer shows at each density, as plain data. Pure (no `herdr`/gpui imports) so tests can load it.
import { resetsShort } from "./time.js";

export const DENSITIES = ["compact", "normal", "expanded"];
export const HEIGHT = { compact: 22, normal: 30, expanded: 56 };
const BAR = { compact: 36, normal: 60, expanded: 90 };
const SPARK = "▁▂▃▄▅▆▇█";

export const densityOf = d => (DENSITIES.includes(d) ? d : "normal");
export const nextDensity = d => DENSITIES[(DENSITIES.indexOf(densityOf(d)) + 1) % DENSITIES.length];

const clamp = v => Math.min(100, Math.max(0, Math.round(v ?? 0)));
const tightest = ws => ws.reduce((a, w) => (!a || w.used > a.used ? w : a), null);
const gib = bytes => `${Math.round(bytes / 2 ** 30)}G`;

export function spark(history) {
  return (history ?? []).map(v => SPARK[Math.min(SPARK.length - 1, Math.floor(clamp(v) / 100 * SPARK.length))]).join("");
}

// Compact: the tightest window only. Normal and expanded: 5h and 7d.
export function windowsFor(density, windows) {
  const ws = (windows ?? []).slice(0, 2);
  return density === "compact" ? [tightest(ws)].filter(Boolean) : ws;
}

export function sysItems(density, stats) {
  if (!stats) return [];
  const items = [];
  if (stats.cpu != null) items.push({ key: "cpu", label: "CPU", pct: stats.cpu, text: `${stats.cpu}%`, spark: density === "expanded" ? spark(stats.history?.cpu) : "" });
  if (stats.mem) items.push({ key: "mem", label: "MEM", pct: stats.mem.pct, text: `${stats.mem.pct}%`, detail: density === "expanded" ? `${gib(stats.mem.used)}/${gib(stats.mem.total)}` : "" });
  if (stats.gpu != null) items.push({ key: "gpu", label: "GPU", pct: stats.gpu, text: `${stats.gpu}%`, spark: density === "expanded" ? spark(stats.history?.gpu) : "" });
  if (stats.batt) items.push({ key: "batt", label: stats.batt.charging ? "⚡" : "BAT", pct: stats.batt.pct, text: `${stats.batt.pct}%`, battery: true });
  return items;
}

// rows: [{ s, u, stale }] for each shown provider (s: source, u: its shared usage).
export function footerModel({ density, narrow, rows, stats }) {
  const d = densityOf(density);
  const providers = rows.map(({ s, u, stale }) => {
    const ws = windowsFor(d, u?.windows);
    return {
      id: s.id, label: s.label, stale: Boolean(stale),
      note: s.note ?? (ws.length ? null : u?.error ? "no data" : u?.fetched ? "no limits" : "…"),
      windows: ws.map(w => ({
        short: w.short, used: clamp(w.used), w,
        reset: narrow && d !== "expanded" ? "" : resetsShort(w),
        bar: narrow && d === "compact" ? 0 : BAR[d],
      })),
    };
  });
  return { density: d, height: HEIGHT[d], providers, sys: sysItems(d, stats) };
}
