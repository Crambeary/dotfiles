// The omarchy layout's mods, redrawn as text: omarchy-bar, -ai-usage, -spaces,
// -agents, -chrome, -tabs, -pane (a pane header) and the right panel's views.
// Each drawer gets (g, a, cx): the grid, its block in cells, and
// cx = { t: theme, props, cw, ch, z, data, snap }.
import { spaces, agents, panes, focused, shared, machines, window } from "herdr";
import { G, glyph, clean, tilde, baseOf, duration, RANK, spaceOrder, gitTail, agentLabel, tabName } from "./draw-common.js";

const SECTION = { 4: "needs you", 3: "done", 2: "working", 1: "idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The status marks omarchy-agents and -spaces draw as squares.
function mark(g, x, y, status, t, compact = true) {
  if (status === "blocked") return compact ? g.text(x, y, "!", t.blocked, 1, true) : g.text(x - 8, y, "Needs you", t.blocked, 9, true);
  if (status === "idle") return g.text(x, y, "□", t.idle ?? t.dim);
  return g.text(x, y, "■", t[status] ?? t.dim);
}

function drawSpaces(g, a, { t, data }) {
  const sp = spaces();
  const bottom = a.y + a.h;
  g.text(a.x + 1, a.y + 1, `spaces ${sp.length}`, t.dim);
  g.rtext(a.x, a.y + 1, G.plus, t.dim, a.w - 1);
  const order = spaceOrder(data);
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
    for (const { s, tree } of order) {
      if ((s.machine ?? null) !== (m ?? null) || y >= bottom) continue;
      const i = sp.findIndex((x) => x.id === s.id);
      if (s.active) g.put(a.x - 1, y, "▌", t.accent);
      let x = a.x + 1;
      if (tree) { g.text(x + 3, y, G.branch, t.dim); x += 5; }
      else { x += g.text(x, y, String(i + 1).padStart(2), s.active ? t.accent : t.dim, 2, true) + 1; }
      const status = !tree && ["working", "blocked", "done"].includes(s.status);
      const end = a.x + a.w - (status ? 3 : 1);
      x += g.text(x, y, s.name, t.foreground, end - x);
      gitTail(g, y, x, end, s.name, data.git.get(s.id), tree, t);
      if (status) g.text(a.x + a.w - 2, y, "■", t[s.status] ?? t.dim);
      y++;
    }
  }
}

function drawAgents(g, a, { t }) {
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
      const { where, more, tab } = agentLabel(ag, tabs, cwdOf);
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

function drawChrome(g, a, { t, props }) {
  if (!props?.footer) return g.text(a.x + 1, a.y, "herdr", t.foreground, a.w);
  const rows = [[G.settings, "Settings", t.muted], [G.keyboard, "Keybindings", t.muted], [G.mods, "Mods", t.muted], [G.plus, "Add machine", t.dim]];
  const y0 = a.y + Math.max(0, Math.floor((a.h - rows.length) / 2));
  rows.forEach(([icon, label, col], i) => {
    if (y0 + i >= a.y + a.h) return;
    g.text(a.x + 1, y0 + i, icon, col);
    g.text(a.x + 4, y0 + i, label, col, a.w - 5);
  });
}

function drawBar(g, a, { t, props, cw, z }) {
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
function drawUsage(g, a, { t }) {
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

function drawTabs(g, a, { t, cw, z, root }) {
  const space = spaces().find((s) => s.active);
  const ps = panes();
  const y = a.y + Math.floor((a.h - 1) / 2);
  const cell = Math.max(8, Math.round(240 * z / cw));
  let x = a.x - 1;
  for (const c of space?.tabs ?? []) {
    if (x >= a.x + a.w) break;
    const { lead, name } = tabName(c, ps);
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
  const panel = find(root, "panel"), body = find(root, "panel-body");
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
function drawPanel(g, a, { t, props, data, snap }, mod) {
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

const panel = (mod) => (g, a, cx) => drawPanel(g, a, cx, mod);

export const mods = {
  "omarchy-bar": drawBar,
  "omarchy-ai-usage": drawUsage,
  "omarchy-spaces": drawSpaces,
  "omarchy-agents": drawAgents,
  "omarchy-chrome": drawChrome,
  "omarchy-tabs": drawTabs,
  "omarchy-files": panel("omarchy-files"),
  "omarchy-changes": panel("omarchy-changes"),
  "omarchy-notes": panel("omarchy-notes"),
  "git-graph": panel("git-graph"),
  agenttrail: panel("agenttrail"),
  reviewer: panel("reviewer"),
};
export const headers = { "omarchy-pane": paneHeader };
