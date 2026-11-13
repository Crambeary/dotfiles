// The herdr window as terminal text, rebuilt from the shown layout and the app's
// data rather than from pixels: block rectangles come from layouts/<name>.json
// (px, weight, padding, gap, hidden, a stack's active child) scaled to the
// window, borders are box drawing in theme colours, and each omarchy mod is
// redrawn with the text it shows (drawMod mirrors omarchy-bar, -ai-usage,
// -spaces, -agents, -chrome, -tabs, -pane and the right panel's mods). The
// terminal area is each pane's real text (`hc read`) in its pane frame, split by
// the cell sizes `hc get` reports. Icons are Nerd Font glyphs: the omarchy
// layout's terminal font is CaskaydiaMono Nerd Font.
//
// Herdr exposes no block or pane geometry, so this is a reconstruction: a size
// dragged by hand, floating mods and nested splits are approximated.
import { exec, appHome, home, readTextFile, settings, theme, spaces, agents, panes, focused, layout, shared, machines, window } from "herdr";

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

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

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

// ---- data the mods show ---------------------------------------------------

// Nerd Font (Font Awesome 4 range) glyphs for the mods' SVG icons.
const G = {
  logo: "", sidebar: "", search: "", plus: "+", monitor: "", server: "",
  branch: "", down: "", right: "", clock: "", settings: "", keyboard: "",
  mods: "", close: "", file: "", folder: "", spinner: "", comment: "",
  map: "", changes: "", pin: "",
};
const PROGRAM = { claude: "✻", codex: "◎", pi: "π", shell: "", opencode: "◇", gemini: "✦" };
const glyph = (p) => PROGRAM[p?.key] ?? (p?.agent ? "◆" : p?.shell ? PROGRAM.shell : "›");

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const tilde = (cwd) => {
  const h = home();
  return !cwd ? "" : cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
};
const baseOf = (cwd) => (!cwd ? "" : cwd === home() ? "~" : cwd.split("/").filter(Boolean).pop() ?? "");
function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

async function run(cmd, args, opts = {}) {
  const r = await exec(cmd, args, { timeout: 3000, ...opts }).catch(() => null);
  return r && r.code === 0 ? r.stdout : null;
}

// What omarchy-spaces shows after a name: repo, branch, ahead/behind, and whether
// the checkout is a linked worktree (it nests under its main checkout's space).
async function gitOf(cwd, on) {
  if (!cwd) return null;
  const opts = { cwd, on: on ?? undefined };
  const [st, rp] = await Promise.all([
    run("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch", "--untracked-files=no"], opts),
    run("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], opts),
  ]);
  if (st == null || rp == null) return null;
  const [top, repo] = rp.trim().split("\n");
  const name = repo.endsWith("/.git") ? baseOf(repo.slice(0, -5)) : baseOf(repo).replace(/\.git$/, "");
  const info = { name, branch: null, ahead: 0, behind: 0, repo: `${on ?? ""}:${repo}`, linked: repo !== `${top}/.git` };
  for (const line of st.split("\n")) {
    if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
    else if (line.startsWith("# branch.ab ")) {
      const [a, b] = line.slice(12).split(" ");
      info.ahead = Math.abs(parseInt(a, 10)) || 0;
      info.behind = Math.abs(parseInt(b, 10)) || 0;
    }
  }
  return info;
}

// Everything slow, asked once per frame before drawing.
async function gather(snap) {
  const sp = spaces(), ps = panes();
  const ready = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name ?? null));
  const placeOf = (s) => {
    const tabs = new Set(s.tabs.map((c) => c.id));
    return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
  };
  const git = await Promise.all(sp.map((s) => (ready.has(s.machine ?? null) ? gitOf(placeOf(s), s.machine) : null)));
  const cwd = snap.cwd;
  const [files, changes, graph] = cwd ? await Promise.all([
    run("ls", ["-1Ap"], { cwd }),
    run("git", ["--no-optional-locks", "status", "--porcelain"], { cwd }),
    run("git", ["log", "--graph", "--oneline", "--decorate", "-n", "80"], { cwd }),
  ]) : [null, null, null];
  return { git: new Map(sp.map((s, i) => [s.id, git[i]])), files, changes, graph };
}

// ---- contents -------------------------------------------------------------

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const SECTION = { 4: "needs you", 3: "done", 2: "working", 1: "idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

// The status marks omarchy-agents and -spaces draw as squares.
function mark(g, x, y, status, t, compact = true) {
  if (status === "blocked") return compact ? g.text(x, y, "!", t.blocked, 1, true) : g.text(x - 8, y, "Needs you", t.blocked, 9, true);
  if (status === "idle") return g.text(x, y, "□", t.idle ?? t.dim);
  return g.text(x, y, "■", t[status] ?? t.dim);
}

function drawSpaces(g, a, t, data) {
  const sp = spaces();
  const bottom = a.y + a.h;
  g.text(a.x + 1, a.y + 1, `spaces ${sp.length}`, t.dim);
  g.rtext(a.x, a.y + 1, G.plus, t.dim, a.w - 1);
  // Worktrees under their main checkout's space, as omarchy-spaces orders them.
  const mains = new Set(sp.map((s) => data.git.get(s.id)).filter((x) => x && !x.linked).map((x) => x.repo));
  const nested = (s) => { const x = data.git.get(s.id); return Boolean(x?.linked && mains.has(x.repo)); };
  const remote = [...new Set([...sp.map((s) => s.machine).filter(Boolean), ...machines().map((m) => m.name).filter(Boolean)])].sort();
  const groups = remote.length ? [null, ...remote] : [undefined];
  let y = a.y + 3;
  for (const m of groups) {
    if (y >= bottom) break;
    if (m !== undefined) {
      const up = !m || machines().find((k) => k.name === m)?.layout === "ready";
      g.text(a.x + 1, y, m ? G.server : G.monitor, t.dim);
      g.text(a.x + 4, y, m ?? "This computer", t.dim, a.w - 13);
      g.rtext(a.x, y, `${G.plus} `, t.dim, a.w - 6);
      g.text(a.x + a.w - 5, y, "■", up ? t.ansi2 : t.dim);
      g.text(a.x + a.w - 3, y, G.down, t.dim);
      y++;
    }
    for (const [i, s] of sp.entries()) {
      if ((s.machine ?? null) !== (m ?? null) || y >= bottom) continue;
      const x0 = a.x + 1, info = data.git.get(s.id), tree = nested(s);
      if (s.active) g.put(a.x - 1, y, "▌", t.accent);
      let x = x0;
      if (tree) { g.text(x + 3, y, G.branch, t.dim); x += 5; }
      else { x += g.text(x, y, String(i + 1).padStart(2), s.active ? t.accent : t.dim, 2, true) + 1; }
      const status = !tree && ["working", "blocked", "done"].includes(s.status);
      const end = a.x + a.w - (status ? 3 : 1);
      const name = s.name;
      x += g.text(x, y, name, t.foreground, end - x);
      if (info && x < end - 2) {
        const same = (v) => v.toLowerCase() === name.toLowerCase();
        const branch = info.branch ?? "detached";
        const repo = tree || same(info.name) ? "" : info.name;
        const room = end - x - 1 - (info.ahead ? String(info.ahead).length + 2 : 0) - (info.behind ? String(info.behind).length + 2 : 0);
        const join = (b) => [repo, b].filter(Boolean).join(" · ");
        const usual = branch === "master" || branch === "main";
        const where = [join(same(branch) ? "" : branch), join(same(branch) || usual ? "" : branch), join("")]
          .find((w) => room >= Math.min(w.length, 12)) ?? "";
        let tail = [];
        if (where) tail.push([where.length > room ? where.slice(0, room - 1) + "…" : where, t.dim]);
        if (info.ahead) tail.push([`↑${info.ahead}`, t.ansi2]);
        if (info.behind) tail.push([`↓${info.behind}`, t.ansi1]);
        let rx = end;
        for (const [txt, col] of tail.reverse()) { rx -= [...txt].length; g.text(rx, y, txt, col); rx -= 1; }
      }
      if (status) g.text(a.x + a.w - 2, y, "■", t[s.status] ?? t.dim);
      y++;
    }
  }
}

function drawAgents(g, a, t) {
  const bottom = a.y + a.h;
  const byPriority = (shared("agents.sort") ?? "priority") === "priority";
  g.text(a.x + 1, a.y + 1, `agents ${agents().length}`, t.dim);
  g.rtext(a.x, a.y + 1, byPriority ? G.clock : "≡", t.dim, a.w - 1);
  const ps = panes();
  const tabs = new Map(spaces().flatMap((s) => s.tabs.map((c) => [c.id, c])));
  const cwdOf = new Map(ps.map((p) => [p.pane, p.cwd]));
  let list = agents();
  if (!list.length) {
    g.text(a.x + 1, a.y + 3, "No agent status yet.", t.dim, a.w - 2);
    return;
  }
  if (byPriority) list = [...list].sort((x, y) => (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0) || y.seq - x.seq);
  const pinned = list.filter((x) => x.pinned), rest = list.filter((x) => !x.pinned);
  const groups = pinned.length ? [{ id: "pinned", label: "pinned", status: null, members: pinned }] : [];
  for (const ag of rest) {
    const r = RANK[ag.status] ?? 1;
    const id = byPriority ? `sec-${r}` : `sp-${ag.space}`;
    if (groups.at(-1)?.id === id) groups.at(-1).members.push(ag);
    else groups.push({ id, label: byPriority ? SECTION[r] : ag.space_name, status: byPriority ? SECTION_STATUS[r] : null, members: [ag] });
  }
  const now = Date.now();
  let y = a.y + 3;
  for (const grp of groups) {
    if (y >= bottom) break;
    const n = g.text(a.x + 1, y, grp.label.toLowerCase(), t[grp.status] ?? t.dim);
    if (byPriority) g.text(a.x + 2 + n, y, String(grp.members.length), t.dim);
    y++;
    for (const ag of grp.members) {
      if (y >= bottom) break;
      const tab = tabs.get(ag.tab);
      const where = baseOf(cwdOf.get(ag.pane)) || ag.space_name;
      const own = clean(ag.title);
      const isProgram = (l) => !l || /^\d+$/.test(l) || l === ag.program?.name || l === "Claude Code";
      const more = tab?.named && !isProgram(tab.name) ? tab.name : isProgram(own) ? null : own;
      const full = byPriority || ag.pinned;
      const name = full ? where : more ?? where;
      const also = full ? more : more ? where : null;
      if (ag.focused) g.put(a.x - 1, y, "▌", t.accent);
      g.text(a.x + 1, y, glyph(ag.program), t.foreground);
      const since = tab?.changed_at ? duration(now - tab.changed_at) : "";
      const end = a.x + a.w - 3 - (since ? since.length + 1 : 0) - (ag.address.includes("/") ? ag.address.split("/")[0].length + 1 : 0);
      let x = a.x + 3;
      x += g.text(x, y, name, ag.status === "idle" && !ag.focused ? t.muted : t.foreground, end - x);
      if (also && also !== name && x + 3 + also.length <= end) g.text(x + 1, y, `· ${also}`, t.dim);
      if (ag.address.includes("/")) g.text(end + 1, y, ag.address.split("/")[0], t.dim);
      if (since) g.rtext(a.x, y, since, t.dim, a.w - 3);
      mark(g, a.x + a.w - 2, y, ag.status, t, byPriority && !ag.pinned);
      y++;
    }
  }
}

function drawChrome(g, a, t) {
  const rows = [[G.settings, "Settings", t.muted], [G.keyboard, "Keybindings", t.muted], [G.mods, "Mods", t.muted], [G.plus, "Add machine", t.dim]];
  const y0 = a.y + Math.max(0, Math.floor((a.h - rows.length) / 2));
  rows.forEach(([icon, label, col], i) => {
    if (y0 + i >= a.y + a.h) return;
    g.text(a.x + 1, y0 + i, icon, col);
    g.text(a.x + 4, y0 + i, label, col, a.w - 5);
  });
}

function drawBar(g, a, props, t, cw, z) {
  const y = a.y + Math.floor((a.h - 1) / 2);
  const w = window();
  if (props?.part === "right") {
    if (w.buttons) g.rtext(a.x, y, `─  ${w.maximized ? "❐" : "□"}  ${G.close}`, t.dim, a.w - 1);
    return;
  }
  const list = spaces();
  const blocked = new Set(agents().filter((x) => x.status === "blocked").map((x) => x.space));
  const end = a.x + a.w;
  let x = a.x + (w.platform === "macos" && !w.fullscreen ? Math.round(76 * z / cw) - 1 : 0);
  x += g.text(x, y, G.logo, t.accent) + 2;
  x += g.text(x, y, G.sidebar, t.dim) + 2;
  for (const [i, s] of list.entries()) {
    if (x >= end) return;
    x += g.text(x, y, String(i + 1), blocked.has(s.id) ? t.blocked : s.active ? t.foreground : t.dim, end - x, s.active) + 2;
  }
  x += g.text(x, y, G.search, t.dim, end - x) + 1;
  const space = list.find((s) => s.active);
  if (!space || x >= end) return;
  x += g.text(x, y, " │ ", t.border, end - x);
  x += g.text(x, y, space.name, t.foreground, end - x) + 1;
  const here = baseOf(focused()?.cwd);
  if (here && here !== space.name) x += g.text(x, y, here, t.muted, end - x) + 1;
  if (space.branch) x += g.text(x, y, space.branch, t.dim, end - x) + 1;
  if (space.machine) g.text(x, y, `@${space.machine}`, t.dim, end - x);
}

// omarchy-ai-usage, compact: each provider's label and its windows' use, centered.
function drawUsage(g, a, t) {
  const y = a.y + Math.floor((a.h - 1) / 2);
  const shown = shared("omarchy-ai-usage.shown") ?? {};
  const segs = (shown.list ?? []).map((s) => {
    const u = shared(`omarchy-ai-usage.${s.id}`);
    const stale = shown.idle || !u?.fetched || Boolean(u?.error);
    const parts = [[s.provider === "claude" ? "✻" : "◆", t.muted]];
    if (s.provider === "claude") parts.push([s.label, stale ? t.dim : t.foreground]);
    const ws = u?.windows ?? [];
    if (s.note || !ws.length) parts.push([s.note ?? (u?.error ? "no data" : u?.fetched ? "no limits" : "…"), t.dim]);
    for (const win of ws.slice(0, 2)) {
      const used = Math.max(0, Math.min(100, win.used ?? 0)), filled = Math.round(used / 20);
      const col = stale ? t.dim : used >= 95 ? "#ff5d6c" : used >= 80 ? "#ffb347" : t.accent;
      parts.push([win.short, t.dim], ["▰".repeat(filled) + "▱".repeat(5 - filled), col], [`${win.used}%`, stale || used >= 80 ? col : t.muted]);
    }
    return parts;
  });
  if (!segs.length) return;
  const width = segs.reduce((n, p) => n + p.reduce((m, [s]) => m + [...s].length + 1, 0), 0) + (segs.length - 1) * 3;
  let x = a.x + Math.max(0, Math.floor((a.w - width) / 2));
  segs.forEach((parts, i) => {
    if (i) x += g.text(x, y, " │ ", t.border, a.x + a.w - x) - 1;
    for (const [s, col] of parts) x += g.text(x, y, s, col, a.x + a.w - x) + 1;
  });
}

function drawTabs(g, a, t, cw, z) {
  const space = spaces().find((s) => s.active);
  const ps = panes();
  const y = a.y + Math.floor((a.h - 1) / 2);
  const cell = Math.max(8, Math.round(240 * z / cw));
  let x = a.x - 1;
  for (const c of space?.tabs ?? []) {
    if (x >= a.x + a.w) break;
    const tabPanes = ps.filter((p) => p.tab === c.id);
    const lead = tabPanes.find((p) => p.program?.agent && p.status === c.status) ?? tabPanes.find((p) => p.program?.agent) ?? tabPanes[0];
    const isProgram = (n) => !n || tabPanes.some((p) => p.program?.name === n || p.terminal === n) || n === "Claude Code";
    const title = clean(lead?.title);
    const name = c.named && !isProgram(c.name) ? c.name : [title, baseOf(lead?.cwd), lead?.branch].find((n) => !isProgram(n)) ?? c.name;
    const status = { working: "Working", blocked: "Needs input", done: "Done", idle: "Idle" }[c.status];
    const col = c.active ? t.foreground : t.muted;
    if (c.active) g.box({ x, y: a.y, w: cell + 1, h: a.h }, t.accent);
    const inner = x + 2, right = x + cell - 1;
    let tx = inner;
    if (lead?.program) tx += g.text(tx, y, glyph(lead.program), t.muted) + 1;
    const tail = (status ? status.length + 1 : 0) + (c.status && c.status !== "idle" ? 2 : 0) + (c.active ? 2 : 0);
    g.text(tx, y, c.zoomed ? `${name} Z` : name, col, right - tail - tx, c.active);
    let rx = right;
    if (c.active) { rx -= 1; g.text(rx, y, G.close, t.dim); rx -= 1; }
    if (c.status === "working") { rx -= 1; g.text(rx, y, G.spinner, t.working); rx -= 1; }
    else if (c.status === "blocked" || c.status === "done") { rx -= 1; g.text(rx, y, "■", t[c.status]); rx -= 1; }
    if (status) { rx -= status.length; g.text(rx, y, status, t[c.status] ?? t.muted); }
    if (!c.active) for (let yy = a.y; yy < a.y + a.h; yy++) g.put(x + cell, yy, "│", t.border);
    x += cell + 1;
  }
  // The + menu, then the panel buttons on the right.
  const plusW = Math.max(3, Math.round(36 * z / cw));
  g.text(x + Math.floor(plusW / 2), y, "+", t.dim);
  for (let yy = a.y; yy < a.y + a.h; yy++) g.put(x + plusW, yy, "│", t.border);
  const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
  if (!panel || !body) return;
  const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "graph", "agenttrail", "reviewer"]
    .filter((id) => Boolean(find(body, id))).filter((id) => (id !== "changes" && id !== "reviewer") || space?.branch != null);
  const buttons = [["files", G.file, "Files"], ["changes", G.changes, "Changes"], ["graph", G.branch, "Graph"], ["reviewer", G.comment, "Review"], ["agenttrail", G.map, "Map"]]
    .filter(([id]) => enabled.includes(id));
  let rx = a.x + a.w + 1;
  for (const [id, icon, label] of buttons.reverse()) {
    const on = !panel.hidden && body.active === id;
    const w = label.length + 6;
    rx -= w;
    if (rx <= x + plusW) break;
    for (let yy = a.y; yy < a.y + a.h; yy++) g.put(rx, yy, "│", t.border);
    g.text(rx + 2, y, `${icon} ${label}`, on ? t.foreground : t.muted, w - 2, on);
  }
}

// The right panel's views, from the focused folder.
function drawPanel(g, a, mod, props, t, data, snap) {
  const bottom = a.y + a.h;
  let y = a.y + 1;
  const head = (s, n) => {
    const w = g.text(a.x + 1, y, s, t.dim);
    if (n != null) g.text(a.x + 2 + w, y, String(n), t.dim);
    y += 2;
  };
  if (mod === "omarchy-files") {
    const entries = (data.files ?? "").split("\n").filter((e) => e && e !== ".git/")
      .sort((p, q) => (q.endsWith("/") - p.endsWith("/")) || p.localeCompare(q));
    g.rtext(a.x, y, baseOf(snap.cwd), t.dim, a.w - 1);
    head("FILES");
    for (const e of entries) {
      if (y >= bottom) break;
      const dir = e.endsWith("/");
      g.text(a.x + 1, y, dir ? G.right : " ", t.dim);
      g.text(a.x + 3, y, dir ? G.folder : G.file, dir ? t.accent : t.dim);
      g.text(a.x + 5, y++, dir ? e.slice(0, -1) : e, dir ? t.foreground : t.muted, a.w - 6);
    }
    return;
  }
  const graphView = mod === "git-graph" || props?.view === "graph";
  if (mod === "omarchy-changes" && !graphView) {
    const lines = (data.changes ?? "").split("\n").filter(Boolean);
    head("changes", lines.length);
    const col = { M: t.ansi3, A: t.ansi2, D: t.ansi1, R: t.ansi4, "?": t.dim };
    for (const l of lines) {
      if (y >= bottom) break;
      const code = l.slice(0, 2).trim() || "M", path = l.slice(3);
      g.text(a.x + 1, y, code.padEnd(2), col[code[0]] ?? t.muted);
      g.text(a.x + 4, y++, path, t.foreground, a.w - 5);
    }
    if (!lines.length) g.text(a.x + 1, y, data.changes == null ? "Not a git repository" : "No changes", t.dim, a.w - 2);
    return;
  }
  if (graphView) {
    head("graph");
    for (const l of (data.graph ?? "").split("\n")) {
      if (y >= bottom) break;
      const m = /^([\s*|\\/_.-]*)([0-9a-f]{7,})?(\s*\([^)]*\))?(.*)$/.exec(l) ?? [l, l, "", "", ""];
      let x = a.x + 1;
      x += g.text(x, y, m[1], t.accent, a.x + a.w - x);
      if (m[2]) x += g.text(x, y, m[2], t.dim, a.x + a.w - x);
      if (m[3]) x += g.text(x, y, m[3], t.ansi3, a.x + a.w - x);
      g.text(x, y++, m[4], t.foreground, a.x + a.w - x);
    }
    return;
  }
  head({ agenttrail: "map", reviewer: "review", "omarchy-notes": "notes" }[mod] ?? String(mod ?? "").replace(/^omarchy-/, ""));
}

function drawMod(g, a, mod, props, t, ctx) {
  switch (mod) {
    case "omarchy-bar": return drawBar(g, a, props, t, ctx.cw, ctx.z);
    case "omarchy-ai-usage": return drawUsage(g, a, t);
    case "omarchy-spaces": return drawSpaces(g, a, t, ctx.data);
    case "omarchy-agents": return drawAgents(g, a, t);
    case "omarchy-chrome": return props?.footer ? drawChrome(g, a, t) : g.text(a.x + 1, a.y, "herdr", t.foreground, a.w);
    case "omarchy-tabs": return drawTabs(g, a, t, ctx.cw, ctx.z);
    default: return drawPanel(g, a, mod, props, t, ctx.data, ctx.snap);
  }
}

async function hcJSON(args) {
  const r = await exec("hc", args, { timeout: 5000 }).catch(() => null);
  try { return r && r.code === 0 ? JSON.parse(r.stdout) : null; } catch { return null; }
}

// omarchy-pane's header: the program, what it works on, the folder, the status.
function paneHeader(g, x, y, w, p, t) {
  const own = clean(p.title);
  const isProgram = !own || own === p.program?.name || /^t[0-9a-z]+$/.test(own);
  const name = (!isProgram && own) || baseOf(p.cwd) || p.program?.name || "shell";
  const end = x + w - 9; // the split/close buttons
  let cx = x;
  cx += g.text(cx, y, glyph(p.program), t.muted) + 1;
  cx += g.text(cx, y, name, t.foreground, Math.min(end - cx, 40), true) + 1;
  if (tilde(p.cwd) !== name) cx += g.text(cx, y, tilde(p.cwd), t.dim, end - cx - 3) + 1;
  if (p.status === "working") g.text(end - 2, y, G.spinner, t.working);
  if (p.status === "done") g.text(end - 2, y, "■", t.done);
  if (p.status === "blocked") g.text(end - 10, y, "Needs you", t.blocked, 9, true);
  g.text(x + w - 7, y, "◫ ⬓ " + G.close, t.dim);
}

// Lays out the focused tab's panes in `a`, framed as the tab block's `pane` says.
async function drawTerminals(g, a, t, snap, frame, ctx) {
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
  const headRows = frame?.header ? Math.max(1, Math.round(num(frame.header.height ?? 30) * ctx.z / ctx.ch)) : 0;
  const tp = settings().terminal_padding ?? layout()?.terminal_padding ?? [12, 12];
  const py = Math.round((Array.isArray(tp) ? tp[1] ?? tp[0] : tp) * ctx.z / ctx.ch), px = Math.round(num(tp) * ctx.z / ctx.cw);
  info.forEach((i, n) => {
    let r = rects[n];
    if (framed) {
      g.box(r, i.p.focused ? t[frame.focus?.color] ?? t.accent : t[frame.border.color] ?? t.border);
      r = { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 };
    }
    if (headRows) {
      const top = frame.header.position !== "bottom";
      const hy = top ? r.y + Math.floor((headRows - 1) / 2) : r.y + r.h - headRows + Math.floor((headRows - 1) / 2);
      paneHeader(g, r.x + 1, hy, r.w - 2, i.p, t);
      g.hline(r.x, top ? r.y + headRows : r.y + r.h - headRows - 1, r.w, t.border);
      r = top ? { ...r, y: r.y + headRows + 1, h: r.h - headRows - 1 } : { ...r, h: r.h - headRows - 1 };
    }
    r = { x: r.x + px, y: r.y + py, w: r.w - 2 * px, h: r.h - 2 * py };
    const color = i.p.focused || info.length === 1 ? t.foreground : t.muted;
    // The pane often has more rows than fit here: keep its bottom (the prompt, an
    // agent's status line), dropping the oldest lines, as the screen scrolls.
    const lines = i.text.replace(/\s+$/, "").split("\n");
    lines.slice(Math.max(0, lines.length - r.h)).forEach((s, dy) => g.text(r.x, r.y + dy, s.replace(/\t/g, "    "), color, r.w));
  });
}

// ---- entry ----------------------------------------------------------------

// What is focused now: take it before the overlay's terminal takes the keyboard.
export function snapshot() {
  const f = focused();
  return { tab: f?.tab ?? null, pane: panes().find((p) => p.focused)?.pane ?? null, cwd: f?.cwd ?? null };
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
  const ctx = { cw, ch, z, snap, data: await gather(snap) };
  for (const { node, rect } of place(layout(), { x: 0, y: 0, w: W, h: H }, z, [])) {
    let a = toCells(rect);
    if (a.w < 1 || a.h < 1) continue;
    if (node.type !== "block") {
      if (node.border && node.id !== "root") g.box(a, t[node.border.color] ?? t.border);
      continue;
    }
    if (node.border) {
      g.box(a, t[node.border.color] ?? t.border);
      a = { x: a.x + 1, y: a.y + 1, w: a.w - 2, h: a.h - 2 };
    }
    const c = node.content ?? {};
    if (c.mod) drawMod(g, { x: a.x + 1, y: a.y, w: a.w - 2, h: a.h }, c.mod, c.props, t, ctx);
    else if (c.tab || c.terminal) await drawTerminals(g, a, t, snap, c.pane, ctx);
  }
  return g.ansi();
}
