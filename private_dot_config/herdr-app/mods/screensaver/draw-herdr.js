// Herdr's shipped mods, redrawn as text: the main layout's (workspace-chrome,
// workspace-status, spaces, agents, tabs, files, changes, the pane header) and
// the terminals layout's (terminals-bar, the terminals-pane header). Main-mine
// and any other clone of main use these too. Drawers get (g, a, cx) as in
// draw-omarchy.js.
import { spaces, agents, panes, shared, machines, window, keys, updates } from "herdr";
import { G, glyph, clean, tilde, baseOf, duration, RANK, statusMark, spaceOrder, gitTail, agentLabel, tabName, rowAt, midRow } from "./draw-common.js";

const cells = (px, { cw, z }) => Math.round(px * z / cw);
const mid = (a) => a.y + Math.floor((a.h - 1) / 2);

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// macOS keeps its window buttons over a layout without a title bar: what a mod at
// the left edge leaves free for them.
const lightsRoom = (px, root) => {
  const w = window();
  return w.platform === "macos" && !w.fullscreen && root?.titlebar === "none" ? px : 0;
};

// A one-line "header … right icons" row and a rule under it.
function header(g, a, y, label, right, t, col = t.dim) {
  g.text(a.x + 1, y, label, col, a.w - 2 - right.length);
  if (right) g.rtext(a.x, y, right, t.dim, a.w - 1);
}

// ---- main: sidebar ----------------------------------------------------------

function workspaceChrome(g, a, cx) {
  const { t, props } = cx;
  const collapsed = (find(cx.root, "sidebar")?.size?.px ?? 999) < 160;
  if (props?.footer) {
    g.hline(a.x - 1, a.y, a.w + 2, t.border);
    const rows = [[G.settings, "Settings", t.muted, updates()?.app?.ready], [G.plus, "Add machine", t.dim]];
    const y0 = a.y + Math.max(1, Math.floor((a.h - rows.length) / 2));
    rows.forEach(([icon, label, col, dot], i) => {
      if (y0 + i >= a.y + a.h) return;
      g.text(a.x + 1, y0 + i, icon, col);
      if (collapsed) return;
      const n = g.text(a.x + 4, y0 + i, label, col, a.w - 5);
      if (dot) g.text(a.x + 5 + n, y0 + i, "●", t.accent);
    });
    return;
  }
  const y = midRow(a, cx);
  if (collapsed) { g.text(a.x, y, G.sidebar, t.muted); return; }
  const x = a.x + cells(lightsRoom(76, cx.root), cx);
  g.text(x, y, G.logo, t.accent);
  g.text(x + 2, y, "Herdr", t.foreground, a.x + a.w - x - 8, true);
  g.rtext(a.x, y, `${G.search}  ${G.sidebar}`, t.muted, a.w - 1);
}

const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

function machineHeading(g, a, y, m, t) {
  const up = !m || machines().find((k) => k.name === m)?.layout === "ready";
  g.text(a.x + 1, y, m ? G.server : G.monitor, t.dim);
  g.text(a.x + 3, y, m ?? "This computer", t.dim, a.w - 10);
  const end = a.x + a.w - 2;
  g.text(end, y, G.down, t.dim);
  g.text(end - 2, y, "●", up ? t.ansi2 : t.dim);
  if (up) g.text(end - 4, y, "+", t.dim);
}

// Rows by the shipped mods' px: a 31px header, 30px space rows, 26px machine
// headings; agents a 41px header, 30px group and agent rows.
function drawSpaces(g, a, cx) {
  const { t, data } = cx;
  const sp = spaces(), bottom = a.y + a.h;
  header(g, a, rowAt(a, cx, 15), "Spaces", G.plus, t);
  const colors = shared("space.colors") ?? {};
  const remote = [...new Set([...sp.map((s) => s.machine).filter(Boolean), ...machines().map((m) => m.name).filter(Boolean)])].sort();
  const groups = remote.length ? [null, ...remote] : [undefined];
  const order = spaceOrder(data);
  let p = 31;
  for (const m of groups) {
    if (rowAt(a, cx, p) >= bottom) break;
    if (m !== undefined) { machineHeading(g, a, rowAt(a, cx, p + 13), m, t); p += 26; }
    for (const { s, tree } of order) {
      if ((s.machine ?? null) !== (m ?? null)) continue;
      const y = rowAt(a, cx, p + (tree ? 14 : 15));
      p += tree ? 28 : 30;
      if (y >= bottom) break;
      let x = a.x + 1;
      if (tree) { g.text(x + 2, y, G.branch, t.dim); x += 4; }
      else {
        const c = colors[s.id] ?? "ansi6";
        g.text(x, y, ([...(s.name.match(/[\p{L}\p{N}]/u)?.[0] ?? "~")][0]).toUpperCase(), c.startsWith("#") ? c : MARK[c] ?? t[c], 1, true);
        x += 2;
      }
      x += g.text(x, y, s.name, s.active ? t.foreground : t.muted, Math.min(a.x + a.w - 1 - x, 20), s.active);
      gitTail(g, y, x, a.x + a.w - 1, s.name, data.git.get(s.id), tree, t);
    }
  }
}

const SECTIONS = { 4: ["Needs you", "blocked"], 3: ["Done", "done"], 2: ["Working", "working"], 1: ["Idle", "idle"] };

// Agents by section (priority) or by space, as Herdr's and T3's lists group them.
export function agentGroups() {
  const byPriority = (shared("agents.sort") ?? "priority") === "priority";
  let list = agents();
  if (byPriority) list = [...list].sort((x, y) => (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0) || y.seq - x.seq);
  const pinned = list.filter((x) => x.pinned), rest = list.filter((x) => !x.pinned);
  const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
  for (const ag of rest) {
    const r = RANK[ag.status] ?? 1;
    const id = byPriority ? `sec-${r}` : `sp-${ag.space}`;
    if (groups.at(-1)?.id === id) groups.at(-1).members.push(ag);
    else groups.push({ id, label: byPriority ? SECTIONS[r][0] : ag.space_name, status: byPriority ? SECTIONS[r][1] : null, members: [ag] });
  }
  return { byPriority, groups };
}

function drawAgents(g, a, cx) {
  const { t } = cx;
  const bottom = a.y + a.h;
  const { byPriority, groups } = agentGroups();
  const hy = rowAt(a, cx, 25);
  if (rowAt(a, cx, 0) !== hy) g.hline(a.x - 1, rowAt(a, cx, 0), a.w + 2, t.border);
  header(g, a, hy, "Agents", byPriority ? G.clock : G.layers, t);
  if (!agents().length) {
    g.text(a.x + 1, rowAt(a, cx, 60), "No agent status yet.", t.dim, a.w - 2);
    return;
  }
  const ps = panes();
  const tabs = new Map(spaces().flatMap((s) => s.tabs.map((c) => [c.id, c])));
  const cwdOf = new Map(ps.map((p) => [p.pane, p.cwd]));
  const now = Date.now();
  let p = 41;
  for (const grp of groups) {
    const gy = rowAt(a, cx, p + 19); // 30px, its label low (8px top padding)
    p += 30;
    if (gy >= bottom) break;
    const n = g.text(a.x + 1, gy, grp.label, t[grp.status] ?? t.dim);
    if (byPriority) g.text(a.x + 2 + n, gy, String(grp.members.length), t.dim);
    for (const ag of grp.members) {
      const y = rowAt(a, cx, p + 15);
      p += 30;
      if (y >= bottom) break;
      const { where, more, tab } = agentLabel(ag, tabs, cwdOf);
      const full = byPriority || ag.pinned;
      const name = full ? ag.space_name || where : more ?? ag.program?.name ?? where;
      const also = full ? more : null;
      g.text(a.x + 1, y, glyph(ag.program), t.foreground);
      const since = tab?.changed_at ? duration(now - tab.changed_at) : "";
      const end = a.x + a.w - 3 - (since ? since.length + 1 : 0);
      let x = a.x + 3;
      x += g.text(x, y, name, ag.status === "idle" && !ag.focused ? t.muted : t.foreground, end - x, ag.focused);
      if (also && also !== name && x + 3 < end) g.text(x + 1, y, `· ${also}`, t.dim, end - x - 1);
      if (since) g.rtext(a.x, y, since, t.dim, a.w - 3);
      statusMark(g, a.x + a.w - 2, y, ag.status, t, "dot");
    }
  }
}

// ---- main: work area --------------------------------------------------------

function drawTabs(g, a, cx) {
  const { t, z } = cx;
  const space = spaces().find((s) => s.active), ps = panes();
  const y = midRow(a, cx), root = cx.root;
  const side = find(root, "sidebar");
  const sidePx = side && !side.hidden ? side.size?.px ?? 0 : 0;
  const tl = root?.traffic_lights?.[0] ?? 0;
  const lead = lightsRoom(Math.max(10, tl + 64) / z - sidePx, root);
  let x = a.x + Math.max(0, cells(lead, cx));
  // The panel toggles and + on the right, then the tabs in what's left.
  const panel = find(root, "panel"), body = find(root, "panel-body");
  const toggles = !panel || !body ? [] : (shared("workspace.panels") ?? ["files", "changes"])
    .filter((id) => find(body, id)).map((id) => [id, id === "files" ? G.file : G.changes, id[0].toUpperCase() + id.slice(1)]);
  let rx = a.x + a.w;
  for (const [id, icon, label] of toggles.reverse()) {
    const on = !panel.hidden && body.active === id;
    rx -= label.length + 3;
    g.text(rx, y, `${icon} ${label}`, on ? t.foreground : t.muted, label.length + 2, on);
  }
  rx -= 3;
  g.text(rx, y, "+", t.dim);
  const maxName = cells(170, cx);
  for (const c of space?.tabs ?? []) {
    if (x >= rx - 4) break;
    const { lead: p } = tabName(c, ps);
    const name = /^tb\d+$/.test(c.name) ? p?.program?.name ?? "Terminal" : c.name;
    const col = c.active ? t.foreground : t.muted;
    if (c.active) g.put(x, y, "[", t.border);
    let tx = x + 1;
    if (p?.program) tx += g.text(tx, y, glyph(p.program), t.muted) + 1;
    tx += g.text(tx, y, c.zoomed ? `${name} Z` : name, col, Math.min(maxName, rx - tx - 4), c.active);
    if (c.status && c.status !== "idle") tx += 1 + statusMark(g, tx + 1, y, c.status, t, "dot");
    if (c.active) { tx += 1 + g.text(tx + 1, y, G.close, t.dim); g.put(tx + 1, y, "]", t.border); }
    x = tx + 3;
  }
}

// The status bar: machine, branch, agent count; the palette key on the right.
function workspaceStatus(g, a, cx) {
  const { t } = cx;
  const y = midRow(a, cx), space = spaces().find((s) => s.active);
  const end = a.x + a.w;
  let x = a.x + 1;
  x += g.text(x, y, `${space?.machine ? G.server : G.monitor} ${space?.machine ?? "This computer"}`, t.muted, end - x) + 2;
  if (space?.branch) x += g.text(x, y, `${G.branch} ${space.branch}`, t.muted, end - x) + 2;
  const blocked = agents().filter((x) => x.status === "blocked").length;
  x += g.text(x, y, "● ", t.dim, end - x);
  x += g.text(x, y, `${agents().length} agents`, t.muted, end - x);
  if (blocked) g.text(x, y, ` · ${blocked} needs you`, t.blocked, end - x);
  const mac = window().platform === "macos";
  const bind = (keys?.() ?? []).find((k) => k.section === "global" && k.action === "app.palette")?.keys ?? "";
  const shown = mac ? bind.replace(/cmd-/g, "⌘").replace(/shift-/g, "⇧").replace(/alt-/g, "⌥").replace(/ctrl-/g, "⌃").toUpperCase() : bind;
  g.rtext(a.x, y, shown ? `${shown}  commands` : "commands", t.dim, a.w - 1);
}

// The Files and Changes panels, from the focused folder.
function gitMarks(data) {
  const marks = new Map();
  for (const l of (data.changes ?? "").split("\n").filter(Boolean)) {
    const code = l.slice(0, 2).trim()[0] ?? "M", top = l.slice(3).split("/")[0];
    if (!marks.has(top)) marks.set(top, code === "?" ? "U" : code);
  }
  return marks;
}
const markColor = (c, t) => (c === "A" ? t.ansi2 : c === "D" || c === "U" ? t.ansi1 : t.blocked);

function drawFiles(g, a, { t, data, snap }) {
  g.box({ x: a.x - 1, y: a.y, w: a.w + 2, h: a.h }, t.border);
  const bottom = a.y + a.h - 1;
  header(g, a, a.y + 1, "Files", baseOf(snap.cwd), t, t.foreground);
  g.hline(a.x, a.y + 2, a.w, t.border);
  const marks = gitMarks(data);
  const entries = (data.files ?? "").split("\n").filter((e) => e && e !== ".git/")
    .sort((p, q) => (q.endsWith("/") - p.endsWith("/")) || p.localeCompare(q));
  let y = a.y + 3;
  if (!entries.length) g.text(a.x + 1, y, snap.cwd ? "No files" : "No folder", t.dim, a.w - 2);
  for (const e of entries) {
    if (y >= bottom) break;
    const dir = e.endsWith("/"), name = dir ? e.slice(0, -1) : e;
    g.text(a.x + 1, y, dir ? G.right : " ", t.dim);
    g.text(a.x + 3, y, dir ? G.folder : G.file, t.muted);
    g.text(a.x + 5, y, name, t.foreground, a.w - 8);
    const m = marks.get(name);
    if (m) g.text(a.x + a.w - 2, y, m, markColor(m, t));
    y++;
  }
}

function drawChanges(g, a, { t, data }) {
  g.box({ x: a.x - 1, y: a.y, w: a.w + 2, h: a.h }, t.border);
  const bottom = a.y + a.h - 1;
  const lines = (data.changes ?? "").split("\n").filter(Boolean);
  const n = g.text(a.x + 1, a.y + 1, "Changes", t.foreground, a.w - 2, true);
  if (lines.length) g.text(a.x + 2 + n, a.y + 1, `${lines.length} files`, t.muted);
  g.hline(a.x, a.y + 2, a.w, t.border);
  let y = a.y + 3;
  if (!lines.length) g.text(a.x + 1, y, data.changes == null ? "Not a git repository" : "No uncommitted changes", t.dim, a.w - 2);
  for (const l of lines) {
    if (y >= bottom) break;
    const code = l.slice(0, 2).trim()[0] ?? "M", path = l.slice(3);
    const cut = path.lastIndexOf("/") + 1;
    g.text(a.x + 1, y, code === "?" ? "U" : code, markColor(code === "?" ? "U" : code, t));
    const w = g.text(a.x + 3, y, path.slice(0, cut), t.dim, a.w - 4);
    g.text(a.x + 3 + w, y++, path.slice(cut), t.foreground, a.w - 4 - w);
  }
}

// The shipped pane header: program, name, folder, status.
function paneHeader(g, x, y, w, p, t) {
  const name = p.program?.agent || p.shell ? p.program?.name ?? "shell" : clean(p.title) || p.program?.name || "shell";
  let cx = x;
  cx += g.text(cx, y, glyph(p.program), t.dim) + 1;
  cx += g.text(cx, y, name, t.foreground, Math.min(x + w - cx - 4, 32), true) + 1;
  g.text(cx, y, tilde(p.cwd), t.dim, x + w - cx - 11);
  if (p.status === "blocked") g.text(x + w - 9, y, "Needs you", t.blocked, 9, true);
  else statusMark(g, x + w - 1, y, p.status === "idle" ? null : p.status, t, "dot");
}

// ---- terminals layout -------------------------------------------------------

function terminalsBar(g, a, cx) {
  const { t } = cx;
  const y = midRow(a, cx), space = spaces().find((s) => s.active), ps = panes();
  const end = a.x + a.w - 5;
  let x = a.x + cells(lightsRoom(72, cx.root), cx);
  if (space) x += g.text(x, y, `${G.layers} ${space.name}`, t.foreground, Math.min(end - x, 22)) + 2;
  const tabW = cells(260, cx);
  for (const c of space?.tabs ?? []) {
    if (x >= end - 4) break;
    const own = ps.filter((p) => p.tab === c.id);
    const lead = own.find((p) => p.focused) ?? own.find((p) => p.program?.agent) ?? own[0];
    const right = Math.min(end, x + tabW);
    if (c.active) g.put(x, y, "▕", t.border);
    let tx = x + 1;
    tx += g.text(tx, y, glyph(lead?.program), t.muted);
    if (lead?.status && lead.status !== "idle") tx += statusMark(g, tx, y, lead.status, t, "dot");
    tx += 1;
    tx += g.text(tx, y, c.name, c.active ? t.foreground : t.muted, right - tx - 1, c.active) + 1;
    if (lead?.cwd) g.text(tx, y, tilde(lead.cwd), t.dim, right - tx - 1);
    x = right + 1;
  }
  g.rtext(a.x, y, `${G.command}  +`, t.dim, a.w - 1);
}

function terminalsPane(g, x, y, w, p, t) {
  let cx = x;
  if (p.program) cx += g.text(cx, y, glyph(p.program), t.muted) + 1;
  const title = p.title || "shell";
  cx += g.text(cx, y, title, p.focused ? t.foreground : t.muted, Math.min(x + w - cx - 8, 40), true) + 1;
  const where = tilde(p.cwd);
  if (where && !title.includes(where) && !/^[~/]/.test(title)) g.text(cx, y, where, t.dim, x + w - cx - 9);
  g.text(x + w - 7, y, `◫ ⬓ ⤢ ${G.close}`, t.dim);
}

export const mods = {
  "workspace-chrome": workspaceChrome,
  "workspace-status": workspaceStatus,
  spaces: drawSpaces,
  agents: drawAgents,
  tabs: drawTabs,
  files: drawFiles,
  changes: drawChanges,
  "terminals-bar": terminalsBar,
};
export const headers = { pane: paneHeader, "terminals-pane": terminalsPane };
