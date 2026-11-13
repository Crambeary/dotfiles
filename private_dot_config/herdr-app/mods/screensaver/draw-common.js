// What every family of drawers shares: icons, names, the git facts the sidebars
// show, and the slow data asked once per frame before drawing.
import { exec, home, spaces, panes, machines } from "herdr";

// Nerd Font (Font Awesome 4 range) glyphs for the mods' SVG icons.
export const G = {
  logo: "", sidebar: "", search: "", plus: "+", monitor: "", server: "",
  branch: "", down: "", right: "", clock: "", settings: "", keyboard: "",
  mods: "", close: "", file: "", folder: "", spinner: "", comment: "",
  map: "", changes: "", pin: "", layers: "", command: "⌘", inbox: "",
  home: "", bolt: "",
};
const PROGRAM = { claude: "✻", codex: "◎", pi: "π", shell: "", opencode: "◇", gemini: "✦" };
export const glyph = (p) => PROGRAM[p?.key] ?? (p?.agent ? "◆" : p?.shell ? PROGRAM.shell : "›");

export const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
export const tilde = (cwd) => {
  const h = home();
  return !cwd ? "" : cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
};
export const baseOf = (cwd) => (!cwd ? "" : cwd === home() ? "~" : cwd.split("/").filter(Boolean).pop() ?? "");
export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

// Where a mod's own rows land. A list whose rows are 33px apart is about 1.5
// terminal rows per item, so items go by px, each on the row holding its middle:
// rowAt(a, cx, px) is the row at `px` (the mod's px, before zoom) from the
// block's top; midRow is the row through the block's middle.
export const rowAt = (a, cx, px) => cx.rowOf(a.py + px * cx.z);
export const midRow = (a, cx) => cx.rowOf(a.py + a.ph / 2);

// A status as one cell: the squares omarchy draws, the dots and rings Herdr's do.
export function statusMark(g, x, y, status, t, style = "square") {
  if (!status) return 0;
  if (status === "working") return g.text(x, y, G.spinner, t.working);
  if (status === "blocked") return g.text(x, y, "!", t.blocked, 1, true);
  if (style === "dot") return g.text(x, y, status === "idle" ? "○" : "●", t[status] ?? t.dim);
  return g.text(x, y, status === "idle" ? "□" : "■", t[status] ?? t.idle ?? t.dim);
}

async function run(cmd, args, opts = {}) {
  const r = await exec(cmd, args, { timeout: 3000, ...opts }).catch(() => null);
  return r && r.code === 0 ? r.stdout : null;
}

// A space's repo, branch, ahead/behind, and whether the checkout is a linked
// worktree (the sidebars nest those under their main checkout's space).
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
export async function gather(snap) {
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

// Spaces in sidebar order: each linked worktree right under its main checkout.
export function spaceOrder(data) {
  const sp = spaces();
  const mains = new Set(sp.map((s) => data.git.get(s.id)).filter((x) => x && !x.linked).map((x) => x.repo));
  const nested = (s) => { const x = data.git.get(s.id); return Boolean(x?.linked && mains.has(x.repo)); };
  const out = [], seen = new Set();
  const add = (s, tree) => { if (!seen.has(s.id)) { seen.add(s.id); out.push({ s, tree }); } };
  for (const s of sp) {
    if (nested(s)) continue;
    add(s, false);
    const repo = data.git.get(s.id)?.repo;
    if (repo) for (const k of sp) if (nested(k) && data.git.get(k.id)?.repo === repo) add(k, true);
  }
  for (const s of sp) if (nested(s)) add(s, true);
  return out;
}

// "repo · branch ↑1 ↓2", right-aligned to end at `end`; the parts that repeat the
// name (or a usual main/master) are dropped first when room is short.
export function gitTail(g, y, x, end, name, info, tree, t) {
  if (!info || x >= end - 2) return;
  const same = (v) => v.toLowerCase() === name.toLowerCase();
  const branch = info.branch ?? "detached";
  const repo = tree || same(info.name) ? "" : info.name;
  const room = end - x - 1 - (info.ahead ? String(info.ahead).length + 2 : 0) - (info.behind ? String(info.behind).length + 2 : 0);
  const join = (b) => [repo, b].filter(Boolean).join(" · ");
  const usual = branch === "master" || branch === "main";
  const where = [join(same(branch) ? "" : branch), join(same(branch) || usual ? "" : branch), join("")]
    .find((w) => room >= Math.min(w.length, 12)) ?? "";
  const tail = [];
  if (where) tail.push([where.length > room ? where.slice(0, room - 1) + "…" : where, t.dim]);
  if (info.ahead) tail.push([`↑${info.ahead}`, t.ansi2]);
  if (info.behind) tail.push([`↓${info.behind}`, t.ansi1]);
  let rx = end;
  for (const [txt, col] of tail.reverse()) { rx -= [...txt].length; g.text(rx, y, txt, col); rx -= 1; }
}

// The label agents lists put on a row: where it works and what it's doing.
export function agentLabel(ag, tabs, cwdOf) {
  const tab = tabs.get(ag.tab);
  const where = baseOf(cwdOf.get(ag.pane)) || ag.space_name;
  const own = clean(ag.title);
  const isProgram = (l) => !l || /^\d+$/.test(l) || l === ag.program?.name || l === "Claude Code";
  const more = tab?.named && !isProgram(tab.name) ? tab.name : isProgram(own) ? null : own;
  return { where, more, tab };
}

// The name a tab pill shows: its own if named, else what its lead pane is doing.
export function tabName(c, ps) {
  const tabPanes = ps.filter((p) => p.tab === c.id);
  const lead = tabPanes.find((p) => p.program?.agent && p.status === c.status)
    ?? tabPanes.find((p) => p.program?.agent) ?? tabPanes[0];
  const isProgram = (n) => !n || tabPanes.some((p) => p.program?.name === n || p.terminal === n) || n === "Claude Code";
  const title = clean(lead?.title);
  const name = c.named && !isProgram(c.name) ? c.name : [title, baseOf(lead?.cwd), lead?.branch].find((n) => !isProgram(n)) ?? c.name;
  return { lead, name };
}
