// The herdr window as terminal text, rebuilt from the shown layout and the app's
// data rather than from pixels: block rectangles come from layouts/<name>.json
// (px, weight, padding, gap, hidden, a stack's active child) scaled to the
// window, borders are box drawing in theme colours, the bar/sidebar/tabs are
// redrawn from spaces()/agents(), and the terminal area is each pane's real
// text (`hc read`), split by the cell sizes `hc get` reports.
//
// Herdr exposes no block or pane geometry, so this is a reconstruction: a size
// dragged by hand, floating mods and nested splits are approximated.
import { exec, appHome, readTextFile, settings, theme, spaces, agents, panes, focused, layout } from "herdr";

// ---- grid -----------------------------------------------------------------

function rgb(color) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(color ?? ""));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

class Grid {
  constructor(cols, rows) {
    this.cols = cols; this.rows = rows;
    this.ch = new Array(cols * rows).fill(" ");
    this.fg = new Array(cols * rows).fill(null);
    this.bold = new Array(cols * rows).fill(false);
  }
  put(x, y, ch, fg, bold = false) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = y * this.cols + x;
    this.ch[i] = ch; this.fg[i] = fg; this.bold[i] = bold;
  }
  // Writes text from (x, y), clipped to `width` cells.
  text(x, y, str, fg, width = Infinity, bold = false) {
    let i = 0;
    for (const c of String(str ?? "")) {
      if (i >= width) break;
      this.put(x + i++, y, c, fg, bold);
    }
    return i;
  }
  box(r, fg) {
    if (r.w < 2 || r.h < 2) return;
    const x1 = r.x + r.w - 1, y1 = r.y + r.h - 1;
    for (let x = r.x + 1; x < x1; x++) { this.put(x, r.y, "─", fg); this.put(x, y1, "─", fg); }
    for (let y = r.y + 1; y < y1; y++) { this.put(r.x, y, "│", fg); this.put(x1, y, "│", fg); }
    this.put(r.x, r.y, "╭", fg); this.put(x1, r.y, "╮", fg);
    this.put(r.x, y1, "╰", fg); this.put(x1, y1, "╯", fg);
  }
  ansi() {
    const lines = [];
    for (let y = 0; y < this.rows; y++) {
      let line = "", cur = null;
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x, c = this.ch[i];
        const key = c === " " ? null : `${this.fg[i]}|${this.bold[i]}`;
        if (key !== cur && key !== null) {
          const col = rgb(this.fg[i]);
          line += "\x1b[0m" + (this.bold[i] ? "\x1b[1m" : "") + (col ? `\x1b[38;2;${col[0]};${col[1]};${col[2]}m` : "");
          cur = key;
        }
        line += c;
      }
      lines.push(line.replace(/\s+$/, "") + "\x1b[0m");
    }
    return lines.join("\n");
  }
}

// ---- layout ---------------------------------------------------------------

const num = (v) => (Array.isArray(v) ? v[0] : v) ?? 0;

// Lays the tree out in window px; returns [{ node, rect }] in paint order.
function place(node, rect, z, out) {
  if (!node || node.hidden === true) return out;
  out.push({ node, rect });
  const kids = (node.children ?? []).filter((k) => k.hidden !== true);
  const pad = num(node.padding) * z;
  const inner = { x: rect.x + pad, y: rect.y + pad, w: rect.w - 2 * pad, h: rect.h - 2 * pad };
  if (node.type === "stack") {
    return place(kids.find((k) => k.id === node.active) ?? kids[0], inner, z, out);
  }
  if (node.type !== "row" && node.type !== "column") return out;
  const across = node.type === "row", total = across ? inner.w : inner.h, gap = num(node.gap) * z;
  let fixed = gap * Math.max(0, kids.length - 1), weights = 0;
  for (const k of kids) k.size?.px != null ? (fixed += k.size.px * z) : (weights += k.size?.weight ?? 1);
  const free = Math.max(0, total - fixed);
  let pos = across ? inner.x : inner.y;
  for (const k of kids) {
    const len = k.size?.px != null ? k.size.px * z : free * ((k.size?.weight ?? 1) / (weights || 1));
    place(k, across ? { x: pos, y: inner.y, w: len, h: inner.h } : { x: inner.x, y: pos, w: inner.w, h: len }, z, out);
    pos += len + gap;
  }
  return out;
}

// ---- contents -------------------------------------------------------------

const STATUS_DOT = { working: "●", blocked: "◆", done: "✓", idle: "○" };

function drawMod(g, a, mod, props, t) {
  const fg = t.foreground, muted = t.muted, accent = t.accent;
  const line = (y, s, c = fg, b = false) => y < a.y + a.h && g.text(a.x, y, s, c, a.w, b);
  switch (mod) {
    case "omarchy-bar": {
      const y = a.y + Math.floor(a.h / 2);
      if (props?.part === "right") {
        const now = new Date(), clock = now.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
        g.text(a.x + a.w - clock.length - 1, y, clock, fg, a.w);
      } else {
        let x = a.x + 1;
        for (const s of spaces()) x += g.text(x, y, String(s.index), s.active ? accent : muted, a.x + a.w - x, s.active) + 2;
      }
      return;
    }
    case "omarchy-ai-usage":
      return;
    case "omarchy-spaces": {
      const list = spaces();
      let y = a.y;
      line(y++, `spaces ${list.length}`, muted); y++;
      for (const s of list) {
        if (y >= a.y + a.h) break;
        line(y, ` ${s.name}`, s.active ? accent : fg, s.active);
        if (s.branch) g.text(a.x + a.w - s.branch.length - 1, y, s.branch, muted);
        y++;
        if (s.active) for (const tab of s.tabs) if (y < a.y + a.h) line(y++, `   ${tab.name}`, tab.active ? fg : muted);
      }
      return;
    }
    case "omarchy-agents": {
      const list = agents();
      let y = a.y;
      line(y++, `agents ${list.length}`, muted); y++;
      for (const ag of list) {
        if (y >= a.y + a.h) break;
        g.text(a.x + 1, y, STATUS_DOT[ag.status] ?? "·", t[ag.status] ?? muted);
        g.text(a.x + 3, y, ag.tab_name || ag.space_name, ag.focused ? accent : fg, a.w - 4);
        y++;
        if (y < a.y + a.h) line(y++, `   ${ag.status}`, muted);
      }
      return;
    }
    case "omarchy-chrome": {
      ["⚙  Settings", "⌨  Keybindings", "▦  Mods", "+  Add machine"].forEach((s, i) => line(a.y + i, s, muted));
      return;
    }
    case "omarchy-tabs": {
      const space = spaces().find((s) => s.active);
      let x = a.x + 1;
      const y = a.y + Math.floor((a.h - 1) / 2);
      (space?.tabs ?? []).forEach((tab, i) => {
        if (x >= a.x + a.w) return;
        if (i) x += g.text(x, y, "  │  ", t.border, a.x + a.w - x);
        x += g.text(x, y, tab.name, tab.active ? accent : muted, a.x + a.w - x, tab.active);
      });
      return;
    }
    default: {
      const label = String(mod ?? "").replace(/^omarchy-/, "");
      line(a.y, label, muted);
    }
  }
}

async function hcJSON(args) {
  const r = await exec("hc", args, { timeout: 5000 }).catch(() => null);
  try { return r && r.code === 0 ? JSON.parse(r.stdout) : null; } catch { return null; }
}

// Lays out the focused tab's panes in `a`, by the cell sizes the core reports.
async function drawTerminals(g, a, t, snap) {
  let list = panes().filter((p) => p.tab === snap.tab && p.terminal).map((p) => ({ ...p, focused: p.pane === snap.pane }));
  const zoomed = list.find((p) => p.zoomed);
  if (zoomed) list = [zoomed];
  if (!list.length) return;
  const info = await Promise.all(list.map(async (p) => {
    const [get, read] = await Promise.all([
      hcJSON(["get", p.terminal, "--json"]),
      exec("hc", ["read", p.terminal], { timeout: 5000 }).catch(() => null),
    ]);
    return { p, cols: get?.cols ?? 0, rows: get?.rows ?? 0, text: read?.code === 0 ? read.stdout : "" };
  }));
  const near = (vals) => Math.max(...vals) - Math.min(...vals) <= 2;
  let rects;
  if (info.length === 1) rects = [a];
  else if (near(info.map((i) => i.rows))) {               // side by side
    const sum = info.reduce((s, i) => s + i.cols, 0) || 1;
    let x = a.x;
    rects = info.map((i, n) => {
      const w = n === info.length - 1 ? a.x + a.w - x : Math.round(a.w * i.cols / sum);
      const r = { x, y: a.y, w: w - (n < info.length - 1 ? 1 : 0), h: a.h };
      if (n < info.length - 1) for (let y = a.y; y < a.y + a.h; y++) g.put(x + w - 1, y, "│", t.border);
      x += w;
      return r;
    });
  } else if (near(info.map((i) => i.cols))) {             // stacked
    const sum = info.reduce((s, i) => s + i.rows, 0) || 1;
    let y = a.y;
    rects = info.map((i, n) => {
      const h = n === info.length - 1 ? a.y + a.h - y : Math.round(a.h * i.rows / sum);
      const r = { x: a.x, y, w: a.w, h: h - (n < info.length - 1 ? 1 : 0) };
      if (n < info.length - 1) for (let x = a.x; x < a.x + a.w; x++) g.put(x, y + h - 1, "─", t.border);
      y += h;
      return r;
    });
  } else {                                                 // nested split: just the focused pane
    const one = info.find((i) => i.p.focused) ?? info[0];
    info.splice(0, info.length, one);
    rects = [a];
  }
  info.forEach((i, n) => {
    const r = rects[n], color = i.p.focused || info.length === 1 ? t.foreground : t.muted;
    i.text.split("\n").slice(0, r.h).forEach((s, dy) => g.text(r.x, r.y + dy, s.replace(/\t/g, "    "), color, r.w));
  });
}

// ---- entry ----------------------------------------------------------------

// What is focused now: take it before the overlay's terminal takes the keyboard.
export function snapshot() {
  return { tab: focused()?.tab ?? null, pane: panes().find((p) => p.focused)?.pane ?? null };
}

// Returns the window as SGR text on a cols x rows grid.
export async function skeleton(cols, rows, snap) {
  const t = theme();
  const win = JSON.parse(await readTextFile(`${appHome()}/window.json`).catch(() => null) ?? "{}");
  const [, , W = 1280, H = 800] = win.bounds ?? [];
  const z = Number(settings().zoom) || 1;
  const cw = W / cols, ch = H / rows;
  const g = new Grid(cols, rows);
  const toCells = (r) => {
    const x = Math.round(r.x / cw), y = Math.round(r.y / ch);
    return { x, y, w: Math.round((r.x + r.w) / cw) - x, h: Math.round((r.y + r.h) / ch) - y };
  };
  const tp = settings().terminal_padding ?? layout()?.terminal_padding ?? [12, 12];
  for (const { node, rect } of place(layout(), { x: 0, y: 0, w: W, h: H }, z, [])) {
    if (node.type !== "block") continue;
    let a = toCells(rect);
    if (a.w < 1 || a.h < 1) continue;
    if (node.border) {
      g.box(a, t[node.border.color] ?? t.border);
      a = { x: a.x + 1, y: a.y + 1, w: a.w - 2, h: a.h - 2 };
    }
    const c = node.content ?? {};
    if (c.mod) drawMod(g, { x: a.x + 1, y: a.y, w: a.w - 2, h: a.h }, c.mod, c.props, t);
    else if (c.tab || c.terminal) {
      const px = Math.round(num(tp) * z / cw), py = Math.round((Array.isArray(tp) ? tp[1] : tp) * z / ch);
      await drawTerminals(g, { x: a.x + px, y: a.y + py, w: a.w - 2 * px, h: a.h - 2 * py }, t, snap);
    }
  }
  return g.ansi();
}
