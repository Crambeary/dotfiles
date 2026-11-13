// The herdr-t3 layout's mods, redrawn as text: t3-chrome, t3-spaces, t3-agents,
// t3-inbox, t3-tabs (strip and end), t3-actions and the t3-pane header.
// Drawers get (g, a, cx) as in draw-omarchy.js.
import { spaces, agents, panes, terminals, shared, machines, window, updates } from "herdr";
import { G, glyph, clean, tilde, baseOf, duration, statusMark, spaceOrder, gitTail, agentLabel, rowAt, midRow } from "./draw-common.js";
import { agentGroups } from "./draw-herdr.js";

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
const lightsRoom = (px) => {
  const w = window();
  return w.platform === "macos" && !w.fullscreen ? px : 0;
};

// T3's project colors (Tailwind 400 on dark themes, 600 on light), hashed by name.
const PALETTE = [
  ["#9ca3af", "#4b5563"], ["#f87171", "#dc2626"], ["#fb923c", "#ea580c"], ["#fbbf24", "#d97706"],
  ["#facc15", "#ca8a04"], ["#a3e635", "#65a30d"], ["#4ade80", "#16a34a"], ["#34d399", "#059669"],
  ["#2dd4bf", "#0d9488"], ["#22d3ee", "#0891b2"], ["#38bdf8", "#0284c7"], ["#60a5fa", "#2563eb"],
  ["#818cf8", "#4f46e5"], ["#a78bfa", "#7c3aed"], ["#c084fc", "#9333ea"], ["#e879f9", "#c026d3"],
  ["#f472b6", "#db2777"], ["#fb7185", "#e11d48"],
];
function dark(t) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(t.background ?? ""));
  if (!m) return true;
  const n = parseInt(m[1], 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 < 128;
}
// The space mark: the name's first letter or digit in the name's color.
function projectMark(g, x, y, name, t) {
  const first = String(name ?? "").normalize("NFKC").match(/[\p{L}\p{N}]/u)?.[0];
  if (!first) return g.text(x, y, G.folder, t.dim);
  const seed = String(name).normalize("NFKC").trim().toLocaleLowerCase("en-US") || "project";
  let i = 0;
  for (const c of seed) i = (i * 31 + c.codePointAt(0)) % PALETTE.length;
  return g.text(x, y, [...first.toUpperCase()][0], PALETTE[i][dark(t) ? 0 : 1], 1, true);
}

const home = () => shared("t3-home.space");

// ---- sidebar ----------------------------------------------------------------

// ---- sidebar ----------------------------------------------------------------
// Rows go by T3's own px (rowAt): a 32px header, 33px space rows, 36px agent
// rows, 78px inbox cards, so the text sits where the window shows it.

function t3Chrome(g, a, cx) {
  const { t, props } = cx;
  const y = midRow(a, cx);
  if (props?.footer) {
    g.text(a.x + 1, y, `${G.settings}  ${G.server}`, t.dim);
    const notice = shared("t3-inbox.notice");
    if (notice && Date.now() - (notice.at ?? 0) < 6000) {
      const n = notice.count > 1 ? `Settled ${notice.count}, ` : "Settled, ";
      g.rtext(a.x, y, n + "Undo", t.dim, a.w - 1);
    } else if (updates()?.app?.ready) g.rtext(a.x, y, "Update", t.accent, a.w - 1);
    return;
  }
  const x = a.x + cells(lightsRoom(76), cx);
  const atHome = spaces().find((s) => s.active)?.id === home();
  g.text(x, y, G.logo, atHome ? t.accent : t.muted);
  g.text(x + 2, y, "Herdr", atHome ? t.foreground : t.muted, a.x + a.w - x - 8);
  const inbox = find(cx.root, "sidebar-lists")?.active === "inbox";
  g.rtext(a.x, y, `${inbox ? "≡" : G.inbox}  ${G.sidebar}`, t.dim, a.w - 1);
}

function t3Spaces(g, a, cx) {
  const { t, data } = cx;
  const sp = spaces().filter((s) => s.id !== home()), bottom = a.y + a.h;
  const hy = rowAt(a, cx, 16);
  g.text(a.x + 1, hy, "Spaces", t.muted, a.w - 8);
  g.rtext(a.x, hy, `${G.folder}+ ${G.comment}`, t.dim, a.w - 1);
  const remote = [...new Set([...sp.map((s) => s.machine).filter(Boolean), ...machines().map((m) => m.name).filter(Boolean)])].sort();
  const groups = remote.length ? [null, ...remote] : [undefined];
  const order = spaceOrder(data).filter((o) => o.s.id !== home());
  let p = 36; // below the header and the list's 4px top padding
  const next = () => { const y = rowAt(a, cx, p + 16); p += 33; return y; };
  for (const m of groups) {
    if (rowAt(a, cx, p) >= bottom) break;
    if (m !== undefined) {
      const y = next();
      const up = !m || machines().find((k) => k.name === m)?.layout === "ready";
      g.text(a.x + 1, y, m ? G.server : G.monitor, t.dim);
      const n = g.text(a.x + 3, y, m ?? "This computer", t.dim, a.w - 10);
      g.text(a.x + 4 + n, y, "●", up ? t.ansi2 : t.dim);
      g.rtext(a.x, y, `${up ? "+ " : ""}${G.down}`, t.dim, a.w - 1);
    }
    const mine = order.filter((o) => (o.s.machine ?? null) === (m ?? null));
    for (const [i, { s, tree }] of mine.entries()) {
      const y = next();
      if (y >= bottom) break;
      let x = a.x + 1;
      if (tree) {
        g.text(x, y, mine[i + 1]?.tree ? "├─" : "└─", t.input ?? t.border);
        g.text(x + 3, y, G.branch, t.dim);
        x += 5;
      } else x += projectMark(g, x, y, s.name, t) + 1;
      if (s.active) g.put(a.x - 1, y, "▌", t.accent);
      x += g.text(x, y, s.name, t.foreground, Math.min(a.x + a.w - 1 - x, 19), s.active);
      gitTail(g, y, x, a.x + a.w - 1, s.name, data.git.get(s.id), tree, t);
    }
  }
}

function t3Agents(g, a, cx) {
  const { t } = cx;
  const bottom = a.y + a.h;
  const { byPriority, groups } = agentGroups();
  const hy = rowAt(a, cx, 16);
  if (rowAt(a, cx, 0) !== hy) g.hline(a.x - 1, rowAt(a, cx, 0), a.w + 2, t.border);
  g.text(a.x + 1, hy, "Agents", t.muted, a.w - 4);
  g.rtext(a.x, hy, byPriority ? G.clock : G.layers, t.dim, a.w - 1);
  if (!agents().length) {
    g.text(a.x + 1, rowAt(a, cx, 56), "No agent status yet.", t.dim, a.w - 2);
    return;
  }
  const ps = panes();
  const tabs = new Map(spaces().flatMap((s) => s.tabs.map((c) => [c.id, c])));
  const cwdOf = new Map(ps.map((p) => [p.pane, p.cwd]));
  const now = Date.now();
  let p = 32;
  for (const [gi, grp] of groups.entries()) {
    if (!byPriority && grp.id !== "pinned" && gi) p += 8;
    const y = rowAt(a, cx, p + 16);
    p += 32;
    if (y >= bottom) break;
    const folded = byPriority && grp.status === "idle";
    if (byPriority || grp.id === "pinned") {
      g.text(a.x + 1, y, grp.label, t.dim, a.w - 8);
      g.rtext(a.x, y, `${grp.members.length} ${folded ? G.right : G.down}`, t.dim, a.w - 1);
    } else {
      const n = projectMark(g, a.x + 1, y, grp.label, t);
      g.text(a.x + 2 + n, y, grp.label, t.foreground, a.w - 8);
      g.rtext(a.x, y, G.down, t.dim, a.w - 1);
    }
    for (const ag of grp.members) {
      if (folded && !ag.focused) continue;
      const y = rowAt(a, cx, p + 18);
      p += 36;
      if (y >= bottom) break;
      const { where, more, tab } = agentLabel(ag, tabs, cwdOf);
      const lit = ag.focused || ag.status === "blocked" || ag.status === "done";
      const name = more ?? ag.program?.name ?? where;
      g.text(a.x + 1, y, glyph(ag.program), t.muted);
      const since = tab?.changed_at ? duration(now - tab.changed_at) : "";
      const end = a.x + a.w - 3 - (since ? since.length + 1 : 0);
      let x = a.x + 3;
      x += g.text(x, y, name, lit ? t.foreground : t.muted, end - x, lit);
      const space = ag.space_name;
      if ((byPriority || ag.pinned) && space && space !== name && x + 2 < end) g.text(x + 1, y, space, t.dim, end - x - 1);
      if (since) g.rtext(a.x, y, since, t.dim, a.w - 3);
      statusMark(g, a.x + a.w - 2, y, ag.status, t, "dot");
    }
  }
}

// The inbox: pinned and active cards at the top, Working / Snoozed / Settled
// shelves at the bottom. Settled and snoozed come from the terminals' labels.
function t3Inbox(g, a, cx) {
  const { t } = cx;
  const now = Date.now();
  const hy = rowAt(a, cx, 16);
  g.text(a.x + 1, hy, `${G.search} Search`, t.dim, a.w - 10);
  g.rtext(a.x, hy, `${G.bolt}  ${G.folder}+ ${G.comment}`, t.dim, a.w - 1);
  const term = new Map((terminals() ?? []).map((k) => [k.address, k]));
  const label = (ag, k) => term.get(ag.address)?.labels?.[k];
  const settled = (ag) => Boolean(label(ag, "settled"));
  const napUntil = (ag) => Number(label(ag, "snoozed")) || 0;
  const hidden = (ag) => !settled(ag) && napUntil(ag) > now && ag.status !== "blocked";
  const pins = shared("agents.pins") ?? [];
  const all = agents();
  if (!all.length) {
    g.text(a.x + 1, rowAt(a, cx, 64), "Nothing here yet.", t.dim, a.w - 2);
    return;
  }
  const pinned = pins.map((p) => all.find((x) => x.address === p)).filter((x) => x && !hidden(x));
  const rest = all.filter((x) => !pins.includes(x.address));
  const tabs = new Map(spaces().flatMap((s) => s.tabs.map((c) => [c.id, c])));
  const since = (ag) => tabs.get(ag.tab)?.changed_at ?? 0;
  const active = rest.filter((x) => !settled(x) && !hidden(x) && x.status !== "working").sort((p, q) => since(q) - since(p));
  const work = rest.filter((x) => !settled(x) && !hidden(x) && x.status === "working");
  const nap = all.filter(hidden), put = rest.filter(settled);
  const ps = panes();
  // The shelves sit at the bottom, 32px each, above the list's 8px padding.
  const shelves = [["Working", work], ["Snoozed", nap], ["Settled", put]].filter(([, l]) => l.length);
  const h = a.ph / cx.z;
  const shelfTop = rowAt(a, cx, h - 8 - shelves.length * 32);
  shelves.forEach(([name, list], i) => {
    const y = rowAt(a, cx, h - 8 - (shelves.length - i) * 32 + 16);
    g.text(a.x + 1, y, name, t.dim, a.w - 8);
    g.rtext(a.x, y, `${list.length} ${name === "Settled" ? G.down : G.right}`, t.dim, a.w - 1);
  });
  let p = 40; // below the search row and the list's 8px top padding
  for (const ag of [...pinned, ...active]) {
    const branch = ps.find((q) => q.pane === ag.pane)?.branch;
    const height = branch ? 78 : 59;
    if (rowAt(a, cx, p + height) > shelfTop) break;
    const [y1, y2, y3] = [18, 41, 64].map((d) => rowAt(a, cx, p + d));
    const n = projectMark(g, a.x + 1, y1, ag.space_name, t);
    g.text(a.x + 2 + n, y1, `${pins.includes(ag.address) ? G.pin + " " : ""}${ag.space_name ?? ""}`, t.dim, a.w - 14);
    const corner = ag.status === "blocked" ? ["! Needs you", t.blocked] : ag.status === "done" ? ["✓ Done", t.ansi2]
      : [since(ag) ? duration(now - since(ag)) : "just now", t.dim];
    g.rtext(a.x, y1, corner[0], corner[1], a.w - 1);
    const lit = ag.focused || ag.status === "blocked" || ag.status === "done";
    g.text(a.x + 1, y2, clean(ag.title) || ag.program?.name || ag.address, lit ? t.foreground : t.muted, a.w - 4, lit);
    if (branch) g.text(a.x + 1, y3, branch, t.dim, a.w - 4);
    g.rtext(a.x, branch ? y3 : y2, glyph(ag.program), t.dim, a.w - 1);
    if (ag.focused) for (let y = y1; y <= (branch ? y3 : y2); y++) g.put(a.x - 1, y, "▌", t.accent);
    p += height + 5;
  }
}


// ---- tab bar ----------------------------------------------------------------

function t3Tabs(g, a, cx) {
  const { t, props } = cx;
  const y = midRow(a, cx);
  const space = spaces().find((s) => s.active);
  const root = cx.root;
  if (props?.part === "measure") return;
  if (props?.part === "end") {
    const panel = find(root, "panel"), body = find(root, "panel-body");
    let s = space?.id === home() ? "" : "+";
    if (panel && body) {
      const ids = ["files", "changes", "graph"].filter((id) => find(body, id) && (id === "files" || space?.branch != null));
      const icon = { files: G.file, changes: G.changes, graph: G.branch };
      s += (s ? " " : "") + ids.map((id) => icon[id]).join("│");
    }
    if (window().buttons) s += ` ─ □ ${G.close}`;
    g.rtext(a.x, y, s, t.dim, a.w - 1);
    return;
  }
  const side = find(root, "sidebar");
  let x = a.x;
  if (side?.hidden) {
    x += g.text(x, y, G.sidebar, t.dim) + 1;
    for (const st of ["blocked", "working", "done"]) {
      const n = agents().filter((ag) => ag.status === st).length;
      if (n) { x += statusMark(g, x, y, st, t, "dot"); x += g.text(x, y, String(n), t.muted) + 2; }
    }
  } else {
    const tl = root?.traffic_lights?.[0] ?? 0;
    x += Math.max(1, cells(Math.max(8, tl + 64 - (side?.size?.px ?? 0)), cx));
  }
  if (space?.id === home()) return;
  const ps = panes();
  const minW = cells(96, cx), cap = cells(144, cx), capActive = cells(240, cx);
  for (const c of space?.tabs ?? []) {
    if (x >= a.x + a.w - 2) break;
    const own = ps.filter((p) => p.tab === c.id);
    const lead = own.find((p) => p.program?.agent && p.status === c.status) ?? own.find((p) => p.program?.agent) ?? own[0];
    const title = clean(lead?.title);
    const name = c.named ? c.name : title && title !== lead?.program?.name ? title : lead?.program?.name ?? "Terminal";
    const label = c.zoomed ? `${name} Z` : name;
    const w = Math.min(c.active ? capActive : cap, Math.max(minW, [...label].length + 6), a.x + a.w - x);
    if (c.active) { g.put(x, y, "▕", t.border); g.put(x + w - 1, y, "▏", t.border); }
    g.text(x + 1, y, glyph(lead?.program), t.muted);
    g.text(x + 3, y, label, c.active ? t.foreground : t.muted, w - 6, c.active);
    const urgent = ["blocked", "done", "working"].find((s) => own.some((p) => p.status === s));
    if (urgent) statusMark(g, x + w - 3, y, urgent, t, "dot");
    x += w + 1;
  }
}

function t3Actions(g, a, cx) {
  const { t } = cx;
  if (spaces().find((s) => s.active)?.id === home()) return;
  const y = midRow(a, cx);
  const cfg = shared("t3-actions") ?? {};
  const list = cfg.list ?? [];
  const main = list.find((x) => x.id === cfg.last) ?? list[0];
  // The longest label that fits, as the button shrinks to its icon.
  const options = !main ? ["[+ Add action]", "[+ Add]", "[+]"]
    : [...(shared("bar.compact") ? [] : [`[▶ ${main.name}│${G.down}]`]), `[▶│${G.down}]`, "[▶]"];
  const s = options.find((o) => [...o].length <= a.w - 1) ?? "";
  g.rtext(a.x, y, s, t.dim, a.w - 1);
}

// The t3 pane header: program, name, folder, status.
function t3Pane(g, x, y, w, p, t) {
  let cx = x;
  cx += g.text(cx, y, glyph(p.program), t.muted) + 1;
  const own = clean(p.title);
  const name = own && own !== p.program?.name && !/^[~/]/.test(own) && !own.includes("@") && own !== baseOf(p.cwd) ? own : p.program?.name;
  if (name && name !== p.program?.name) cx += g.text(cx, y, name, p.focused ? t.foreground : t.muted, Math.min(x + w - cx - 4, 40), p.focused) + 1;
  g.text(cx, y, tilde(p.cwd), t.dim, x + w - cx - 3);
  if (p.status && p.status !== "idle") statusMark(g, x + w - 1, y, p.status, t, "dot");
}

export const mods = {
  "t3-chrome": t3Chrome,
  "t3-spaces": t3Spaces,
  "t3-agents": t3Agents,
  "t3-inbox": t3Inbox,
  "t3-tabs": t3Tabs,
  "t3-actions": t3Actions,
};
export const headers = { "t3-pane": t3Pane };
