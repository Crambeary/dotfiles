// The herdr window as terminal text, rebuilt from the shown layout and the app's
// data rather than from pixels: block rectangles come from layout() (px, weight,
// padding, gap, divider, hidden, a stack's active child) scaled to the window,
// borders are box drawing in theme colours, and each mod is redrawn with the text
// it shows by its family's drawer (draw-omarchy.js, draw-herdr.js for Herdr's
// shipped mods, draw-t3.js). A mod with no drawer leaves its block blank but for
// its border, so any layout renders. The terminal area is each pane's real text
// (`hc read`) in its pane frame, split by the cell sizes `hc get` reports, under
// the header its layout's pane mod draws. Icons are Nerd Font glyphs.
//
// Herdr exposes no block or pane geometry, so this is a reconstruction: a size
// dragged by hand, floating mods and nested splits are approximated.
import { exec, appHome, readTextFile, settings, theme, panes, focused, layout, agents } from "herdr";
import { gather, glyph, tilde } from "./draw-common.js";
import * as omarchy from "./draw-omarchy.js";
import * as herdr from "./draw-herdr.js";
import * as t3 from "./draw-t3.js";

const MODS = { ...herdr.mods, ...t3.mods, ...omarchy.mods };
const HEADERS = { ...herdr.headers, ...t3.headers, ...omarchy.headers };

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
  // Writes text from (x, y), clipped to `width` cells; returns the cells written.
  text(x, y, str, fg, width = Infinity, bold = false) {
    let i = 0;
    for (const c of String(str ?? "")) {
      if (i >= width) break;
      this.put(x + i++, y, c, fg, bold);
    }
    return i;
  }
  // Right-aligned so the text ends at x + width.
  rtext(x, y, str, fg, width, bold = false) {
    const s = [...String(str ?? "")].slice(-width);
    return this.text(x + width - s.length, y, s.join(""), fg, width, bold);
  }
  hline(x, y, w, fg, c = "─") { for (let i = 0; i < w; i++) this.put(x + i, y, c, fg); }
  vline(x, y, h, fg, c = "│") { for (let i = 0; i < h; i++) this.put(x, y + i, c, fg); }
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
// padding: 16, or [vertical, horizontal].
const pads = (v) => (Array.isArray(v) ? [v[0] ?? 0, v[1] ?? v[0] ?? 0] : [v ?? 0, v ?? 0]);

// Lays the tree out in window px; returns [{ node, rect }] in paint order, and a
// { divider, rect } line between the children of a row or column that has one.
function place(node, rect, z, out) {
  if (!node || node.hidden === true) return out;
  out.push({ node, rect });
  const kids = (node.children ?? []).filter((k) => k.hidden !== true);
  const [pv, ph] = pads(node.padding).map((p) => p * z);
  const inner = { x: rect.x + ph, y: rect.y + pv, w: rect.w - 2 * ph, h: rect.h - 2 * pv };
  if (node.type === "stack") {
    return place(kids.find((k) => k.id === node.active) ?? kids[0], inner, z, out);
  }
  if (node.type !== "row" && node.type !== "column") return out;
  const across = node.type === "row", total = across ? inner.w : inner.h, gap = num(node.gap) * z;
  let fixed = gap * Math.max(0, kids.length - 1), weights = 0;
  for (const k of kids) k.size?.px != null ? (fixed += k.size.px * z) : (weights += k.size?.weight ?? 1);
  const free = Math.max(0, total - fixed);
  let pos = across ? inner.x : inner.y;
  kids.forEach((k, i) => {
    const len = k.size?.px != null ? k.size.px * z : free * ((k.size?.weight ?? 1) / (weights || 1));
    place(k, across ? { x: pos, y: inner.y, w: len, h: inner.h } : { x: inner.x, y: pos, w: inner.w, h: len }, z, out);
    pos += len + gap;
    if (node.divider && i < kids.length - 1) {
      const at = pos - gap / 2;
      out.push({ divider: node.divider, rect: across ? { x: at, y: inner.y, w: 0, h: inner.h } : { x: inner.x, y: at, w: inner.w, h: 0 } });
    }
  });
  return out;
}

// ---- terminals --------------------------------------------------------------

async function hcJSON(args) {
  const r = await exec("hc", args, { timeout: 5000 }).catch(() => null);
  try { return r && r.code === 0 ? JSON.parse(r.stdout) : null; } catch { return null; }
}

// A header for a pane mod with no drawer: program, folder, status.
function plainHeader(g, x, y, w, p, t) {
  const n = g.text(x, y, glyph(p.program), t.muted) + 1;
  g.text(x + n, y, tilde(p.cwd) || p.program?.name || "shell", p.focused ? t.foreground : t.muted, w - n - 2);
}

// Lays out terminals in `a`, framed as the tab block's `pane` says. `list` is the
// focused tab's panes, or one terminal a block shows on its own.
async function drawTerminals(g, a, t, list, frame, ctx) {
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
  const gx = frame ? Math.max(1, Math.round(num(frame.gap) * ctx.z / ctx.cw)) : 1;
  const gy = frame ? Math.max(1, Math.round(num(frame.gap) * ctx.z / ctx.ch)) : 1;
  let rects;
  if (info.length === 1) rects = [a];
  else if (near(info.map((i) => i.rows))) {               // side by side
    const sum = info.reduce((s, i) => s + i.cols, 0) || 1;
    let x = a.x;
    rects = info.map((i, n) => {
      const last = n === info.length - 1;
      const w = last ? a.x + a.w - x : Math.round(a.w * i.cols / sum);
      const r = { x, y: a.y, w: w - (last ? 0 : gx), h: a.h };
      x += w;
      return r;
    });
  } else if (near(info.map((i) => i.cols))) {             // stacked
    const sum = info.reduce((s, i) => s + i.rows, 0) || 1;
    let y = a.y;
    rects = info.map((i, n) => {
      const last = n === info.length - 1;
      const h = last ? a.y + a.h - y : Math.round(a.h * i.rows / sum);
      const r = { x: a.x, y, w: a.w, h: h - (last ? 0 : gy) };
      y += h;
      return r;
    });
  } else {                                                 // nested split: just the focused pane
    const one = info.find((i) => i.p.focused) ?? info[0];
    info.splice(0, info.length, one);
    rects = [a];
  }
  const framed = frame?.border && (frame.lone || info.length > 1);
  const head = HEADERS[frame?.header?.content?.mod] ?? plainHeader;
  const tp = ctx.root?.terminal_padding ?? settings().terminal_padding ?? [12, 12];
  const [tpx, tpy] = pads(tp); // read as [x, y], as the omarchy-only version did
  const px = Math.round(tpx * ctx.z / ctx.cw);
  // Vertically everything goes by window px, so a 2px border or a 1px rule
  // doesn't take a whole row: each piece lands on the row holding it, as the
  // window shows it under a see-through saver.
  const bw = framed ? num(frame.border.width ?? 1) * ctx.z : 0;
  const headPx = frame?.header && frame.header.reveal !== "hover" ? num(frame.header.height ?? 30) * ctx.z : 0;
  const padPx = tpy * ctx.z;
  info.forEach((i, n) => {
    const r = rects[n];
    if (framed) g.box(r, i.p.focused ? t[frame.focus?.color] ?? t.accent : t[frame.border.color] ?? t.border);
    const topPx = ctx.pxOf(r.y), botPx = ctx.pxOf(r.y + r.h);
    const x = r.x + (framed ? 1 : 0), w = r.w - (framed ? 2 : 0);
    let textTop = topPx + bw + padPx, textBot = botPx - bw - padPx;
    if (headPx) {
      const top = frame.header.position !== "bottom";
      const edge = top ? topPx + bw : botPx - bw - headPx;
      const hy = ctx.rowOf(edge + headPx / 2), rule = ctx.rowOf(top ? edge + headPx : edge);
      // Text wins over thin lines: the header clears a border it sits on, and the
      // rule under it is left out where it shares a row with the header or text.
      if (hy === r.y || hy === r.y + r.h - 1) g.text(x, hy, " ".repeat(Math.max(0, w)), null);
      head(g, x + 1, hy, w - 2, i.p, t);
      if (top) textTop += headPx + 1; else textBot -= headPx + 1;
      const y0 = ctx.lineOf(textTop), y1 = ctx.lineOf(textBot);
      if (rule !== hy && (top ? rule < y0 : rule >= y1)) g.hline(x, rule, w, t.border);
    }
    const y0 = ctx.lineOf(textTop), y1 = ctx.lineOf(textBot);
    const color = i.p.focused || info.length === 1 ? t.foreground : t.muted;
    // The pane often has more rows than fit here: keep its bottom (the prompt, an
    // agent's status line), dropping the oldest lines, as the screen scrolls.
    const lines = i.text.replace(/\s+$/, "").split("\n");
    lines.slice(Math.max(0, lines.length - (y1 - y0))).forEach((s, dy) => g.text(x + px, y0 + dy, s.replace(/\t/g, "    "), color, w - 2 * px));
  });
}

// What a block with terminal content shows: the focused tab's panes, a named
// terminal, or the focused agent's.
function terminalsOf(c, snap) {
  if (c.tab) return panes().filter((p) => p.tab === snap.tab && p.terminal).map((p) => ({ ...p, focused: p.pane === snap.pane }));
  if (c.terminal) return [{ terminal: c.terminal, focused: false }];
  if (c.agent) {
    const ag = agents().find((x) => x.focused) ?? agents()[0];
    return ag ? [{ terminal: ag.address, focused: true }] : [];
  }
  return [];
}

// ---- entry ----------------------------------------------------------------

// What is focused now: take it before the overlay's terminal takes the keyboard.
export function snapshot() {
  const f = focused();
  return { tab: f?.tab ?? null, pane: panes().find((p) => p.focused)?.pane ?? null, cwd: f?.cwd ?? null };
}

// Returns the window as SGR text on a cols x rows grid; `root` is the layout
// tree to draw (the shown one unless a test passes another).
export async function skeleton(cols, rows, snap, root = layout()) {
  const t = theme();
  const win = JSON.parse(await readTextFile(`${appHome()}/window.json`).catch(() => null) ?? "{}");
  const [, , W = 1280, H = 800] = win.bounds ?? [];
  const z = Number(settings().zoom) || 1;
  // The saver's terminal is padded like every terminal in the layout: its grid
  // starts that far in, and its cells share what's left.
  const [tpx, tpy] = pads(root?.terminal_padding ?? settings().terminal_padding ?? [12, 12]);
  const ox = tpx * z, oy = tpy * z;
  const cw = (W - 2 * ox) / cols, ch = (H - 2 * oy) / rows;
  const g = new Grid(cols, rows);
  const toCells = (r) => {
    const x = Math.round((r.x - ox) / cw), y = Math.round((r.y - oy) / ch);
    return { x, y, w: Math.round((r.x + r.w - ox) / cw) - x, h: Math.round((r.y + r.h - oy) / ch) - y };
  };
  const ctx = {
    t, cw, ch, z, snap, root, data: await gather(snap),
    pxOf: (row) => oy + row * ch,                       // a row's top edge, window px
    rowOf: (px) => Math.floor((px - oy) / ch),          // the row holding a point
    lineOf: (px) => Math.round((px - oy) / ch),         // the row edge nearest a point
  };
  for (const { node, divider, rect } of place(root, { x: 0, y: 0, w: W, h: H }, z, [])) {
    let a = toCells(rect);
    if (divider) {
      const col = t[divider.color] ?? t.border;
      if (rect.w === 0) g.vline(a.x, a.y, a.h, col); else g.hline(a.x, a.y, a.w, col);
      continue;
    }
    if (a.w < 1 || a.h < 1) continue;
    if (node.type !== "block") {
      if (node.border && node.id !== "root") g.box(a, t[node.border.color] ?? t.border);
      continue;
    }
    const bw = node.border ? num(node.border.width ?? 1) * z : 0;
    if (node.border) {
      g.box(a, t[node.border.color] ?? t.border);
      a = { x: a.x + 1, y: a.y + 1, w: a.w - 2, h: a.h - 2 };
    }
    const c = node.content ?? {};
    const draw = c.mod && MODS[c.mod];
    // py / ph: the block's content edge and height in window px, for drawers that
    // place their rows by the mod's own row heights (rowAt in draw-common.js).
    if (draw) draw(g, { x: a.x + 1, y: a.y, w: a.w - 2, h: a.h, py: rect.y + bw, ph: rect.h - 2 * bw }, { ...ctx, props: c.props });
    else if (c.tab || c.terminal || c.agent) await drawTerminals(g, a, t, terminalsOf(c, snap), c.pane, ctx);
  }
  return g.ansi();
}
