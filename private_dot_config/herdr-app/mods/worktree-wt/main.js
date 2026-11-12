// Worktree dialog: { space, action: "new" | "open" | "remove" } or
// { folder, machine } for a repo without a space; optional { branch, tab, argv }.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import { run, props, closeOverlay, theme, spaces, panes, exec, home } from "herdr";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s, all = panes()) {
  if (!s) return null;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

// Clone of the shipped worktree dialog with worktrunk (`wt`) creating and
// removing checkouts, so they go where wt's worktree-path template says and
// wt's hooks run. Listing and opening are unchanged (plain git).
// Home as ~ (git says C:/Users/x where Windows says C:\Users\x).
const tilde = (path, userHome) => {
  const [p, h] = [path, userHome].map((s) => s.replace(/\\/g, "/"));
  return p.startsWith(h) ? `~${p.slice(h.length)}` : path;
};
const ago = (s) => {
  const d = Date.now() / 1000 - s;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : d < 86400 * 60 ? `${Math.round(d / 86400)}d` : `${Math.round(d / 86400 / 30)}mo`;
};

// Every checkout of a repo (`git worktree list`), the main one first, then
// the most recently committed: { path, branch, main, at }.
async function checkouts(repo, on) {
  const list = await git(repo.main, ["worktree", "list", "--porcelain"], on);
  if (!list.ok) return [];
  const refs = await git(repo.main, ["for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)", "refs/heads"], on);
  const when = new Map(refs.out.split("\n").map((l) => l.split("\t")).map(([b, at]) => [b, Number(at) || 0]));
  const out = [];
  for (const block of list.out.split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    out.push({ path, branch, main: out.length === 0, at: branch ? (when.get(branch) ?? 0) : 0 });
  }
  return out.sort((a, b) => b.main - a.main || b.at - a.at);
}

// The space showing a checkout: its first terminal is in it (the deepest checkout wins).
function spaceOf(path, all, on, spaceList, paneList) {
  const inside = (p, dir) => p === dir || p.startsWith(dir + "/");
  return spaceList.find((s) => (s.machine ?? null) === (on ?? null) && (() => {
    const at = place(s, paneList)?.replace(/\\/g, "/");
    if (!at || !inside(at, path)) return false;
    return !all.some((c) => c.path !== path && c.path.length > path.length && inside(at, c.path));
  })());
}

// wt without a terminal: no prompts are answered, so a hook still awaiting
// approval fails here with wt's message (approve it once with wt in a shell).
async function wt(cwd, args, on, timeout) {
  const r = await exec("wt", args, { cwd, on, ...(timeout === undefined ? {} : { timeout }) });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr || r.stdout || "").trim() };
}

// Where wt put a branch's checkout, from `wt list --format=json` (schema 2).
async function wtPath(repo, branch, on) {
  const r = await wt(repo.main, ["list", "--format=json"], on);
  if (!r.ok) return null;
  try { return JSON.parse(r.out).items.find((i) => i.branch === branch)?.worktree?.path ?? null; }
  catch (_) { return null; }
}

// wt's own default when no config sets worktree-path.
const WT_DEFAULT_PATH = "{{ repo_path }}/../{{ repo }}.{{ branch | sanitize }}";

// The worktree-path template wt will use here: the project's, else the user's.
async function wtTemplate(repo, on) {
  const r = await wt(repo.top, ["config", "show", "--format=json"], on);
  try {
    const j = JSON.parse(r.out);
    return j.project?.config?.["worktree-path"] ?? j.user?.config?.["worktree-path"] ?? WT_DEFAULT_PATH;
  } catch (_) { return WT_DEFAULT_PATH; }
}

// "a/b/../c" -> "a/c", so the preview shows where the folder really lands.
const normalize = (p) => {
  const out = [];
  for (const part of p.replace(/\\/g, "/").split("/")) {
    if (part === "..") { if (out.length > 1) out.pop(); }
    else if (part !== "." && (part !== "" || out.length === 0)) out.push(part);
  }
  return out.join("/") || "/";
};

// The folder wt would make for `branch`, rendered by wt's own template engine
// (so filters like sanitize match exactly) without creating anything.
async function wtPreviewPath(repo, template, branch, on) {
  const r = await wt(repo.top, ["step", "eval", `{% set branch = ${JSON.stringify(branch)} %}${template}`], on);
  if (!r.ok || !r.out) return null;
  const out = r.out.split("\n").pop().trim();
  return normalize(/^([A-Za-z]:)?\//.test(out) ? out : `${repo.main}/${out}`);
}

// A checkout inside the repo (e.g. <repo>/.worktrees/x) would show up as
// untracked: exclude its top folder locally, never in the committed .gitignore.
async function excludeInside(repo, path, on) {
  if (!path.startsWith(repo.main + "/")) return;
  const top = path.slice(repo.main.length + 1).split("/")[0];
  if ((await git(repo.main, ["check-ignore", "-q", top], on)).ok) return;
  const common = await git(repo.main, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on);
  if (!common.ok) return;
  await exec("sh", ["-c", 'mkdir -p "$(dirname "$1")" && printf "/%s/\\n" "$2" >> "$1"', "sh", `${common.out}/info/exclude`, top], { on });
}

async function git(cwd, args, on, timeout) {
  const r = await exec("git", args, { cwd, on, ...(timeout === undefined ? {} : { timeout }) });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? r.stdout ?? "").trim() };
}

// The submodule repos git keeps for a checkout (nested ones too, checked out
// or not): { name, dir, pinned }. `config` is the args that read its
// .gitmodules; `pinned` is the commit its parent records ("" if none).
async function modules(gitDir, config, on, out = [], parent = "") {
  const keys = await git(gitDir, ["--git-dir", gitDir, "config", ...config, "-z", "--get-regexp", "^submodule\\..*\\.path$"], on);
  if (!keys.ok) return out; // no .gitmodules, or no submodules in it
  // -z: "key\nvalue" records ended by NUL, so names and paths may hold spaces.
  for (const record of keys.out.split("\0").filter(Boolean)) {
    const at = record.indexOf("\n");
    const name = record.slice("submodule.".length, at - ".path".length);
    const dir = `${gitDir}/modules/${name}`;
    if (!(await git(gitDir, ["--git-dir", dir, "rev-parse", "--git-dir"], on)).ok) continue; // never checked out
    const pinned = await git(gitDir, ["--git-dir", gitDir, "rev-parse", `HEAD:${record.slice(at + 1)}`], on);
    // Names are only unique within their parent: nested ones carry its name.
    out.push({ name: parent + name, dir, pinned: pinned.ok ? pinned.out : "" });
    if ((await git(gitDir, ["--git-dir", dir, "cat-file", "-e", "HEAD:.gitmodules"], on)).ok) await modules(dir, ["--blob", "HEAD:.gitmodules"], on, out, `${parent + name}/`);
  }
  return out;
}

// The worktree's submodules, and the names of those with commits that exist
// nowhere else: not on a remote, and not the commit the parent pins (git
// fetches that by hash, so it is often on no remote branch here).
async function submodules(top, on) {
  const gitDir = await git(top, ["rev-parse", "--absolute-git-dir"], on);
  if (!gitDir.ok) throw new Error(gitDir.err || "git rev-parse failed.");
  const mods = await modules(gitDir.out, ["--file", `${top}/.gitmodules`], on);
  const unpushed = [];
  for (const m of mods) {
    const local = await git(gitDir.out, ["--git-dir", m.dir, "rev-list", "-n1", "--all", "--not", "--remotes", ...(m.pinned ? [m.pinned] : [])], on);
    if (!local.ok) throw new Error(local.err || `Couldn't check submodule ${m.name}.`);
    if (local.out) unpushed.push(m.name);
  }
  return { mods, unpushed };
}

// The repo a folder belongs to: its main checkout and name, and whether
// the folder is itself a linked worktree. null outside git.
async function repoOf(folder, on) {
  const top = await git(folder, ["rev-parse", "--show-toplevel"], on);
  const common = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on);
  if (!top.ok || !common.ok) return null;
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  return { top: top.out, main, name: main.split("/").pop(), linked: main !== top.out };
}

export default class Worktree extends View {
  init(_props, cx) {
    this.on = this.space()?.machine;
    this.userHome = this.on ? null : home();
    this.opening = props()?.action === "open";
    this.text = props()?.branch ?? "";
    this.list = undefined; // open: the checkouts, once read
    this.at = 0;
    this.input = InputState.new({ value: this.text, placeholder: this.opening ? "filter worktrees" : "branch name" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = ""; this.at = 0; this.schedulePreview(cx); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(cx));
    // New: what the branch starts from, and the name the space shows.
    // Base is picked from the branches that exist: the input filters the
    // list, Enter or a click picks, and leaving it restores the pick.
    this.baseInput = InputState.new({ value: "", placeholder: "search branches" });
    this.labelInput = InputState.new({ value: props()?.label ?? "", placeholder: "space name (blank: folder name)" });
    this.baseInput.on("change", (_e, cx) => { this.error = ""; this.baseAt = 0; cx.notify(); });
    this.labelInput.on("change", (_e, cx) => { cx.notify(); });
    this.baseInput.on("submit", (_e, cx) => this.pickBase(this.shownBases()[this.baseAt], cx));
    this.labelInput.on("submit", (_e, cx) => this.go(cx));
    this.baseInput.on("blur", (_e, cx) => { if (this.baseInput.value() !== this.baseSel) this.baseInput.set_value(this.baseSel); cx.notify(); });
    this.branches = []; // [{ name, remote }] local then remote-tracking, newest first
    this.locals = new Set(); // local branch names
    this.remotes = new Map(); // branch name -> "origin/name", for names with no local branch
    this.worktreeOf = new Map(); // branch -> checkout path, for branches already in a worktree
    this.baseSel = ""; // the picked base
    this.baseAt = 0; // highlighted row in the base list
    this.template = null; // wt's worktree-path, once read
    this.preview = null; // { branch, refOk, path }
    this.previewSeq = 0;
    // Which field has the keyboard, for its accent border.
    this.field = "branch";
    this.inputFocused = true;
    const track = (state, name) => {
      state.on("focus", (_e, cx) => { this.field = name; this.inputFocused = true; cx.notify(); });
      state.on("blur", (_e, cx) => { if (this.field === name) this.inputFocused = false; cx.notify(); });
    };
    track(this.input, "branch");
    track(this.baseInput, "base");
    track(this.labelInput, "label");
    this.handle = cx.focus_handle();
    this.handle.focus(); // the root is mounted from the first frame: keep the keyboard here while loading
    if (props()?.action !== "remove") this.input.focus();
    this.busy = false;
    this.error = "";
    this.repo = undefined; // undefined: looking, null: not in git
    this.dirty = false;
    this.unpushed = [];
    cx.spawn(async (cx) => {
      try {
        if (this.on) {
          let result;
          try { result = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: this.on }); } catch {}
          if (!result || result.code !== 0 || !result.stdout.trim()) result = await exec("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write($HOME)"], { on: this.on });
          if (result.code !== 0 || !result.stdout.trim()) throw new Error("Could not find the remote home folder.");
          this.userHome = result.stdout.trim().replace(/\\/g, "/");
        }
        this.folder = props()?.folder || place(this.space()) || this.userHome;
        // The repo is set last: Enter does nothing until the warnings it consents to are known.
        const repo = await repoOf(this.folder, this.on);
        if (repo && props().action === "remove") {
          this.dirty = (await git(repo.top, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], this.on)).out !== "";
          this.unpushed = (await submodules(repo.top, this.on)).unpushed;
        }
        if (repo && this.opening) this.list = await checkouts(repo, this.on);
        if (repo && props().action === "new") {
          await this.loadBranches(repo);
          // Start from this checkout's branch (detached: the default branch), changeable.
          const head = await git(repo.top, ["rev-parse", "--abbrev-ref", "HEAD"], this.on);
          const want = props()?.base ?? (head.ok && head.out !== "HEAD" ? head.out : "");
          this.baseSel = this.branches.some((b) => b.name === want) ? want : (this.branches[0]?.name ?? "");
          this.baseInput.set_value(this.baseSel);
          this.template = await wtTemplate(repo, this.on);
        }
        this.repo = repo;
        if (repo && props().action === "new") this.schedulePreview(cx);
        cx.notify();
        // The list (and with it the filter input) only mounts once loading is
        // done, so the keyboard must move there now — a focus call made while
        // loading lands on nothing and the dialog stays keyboard-dead.
        this.handle.focus();
        if (props().action !== "remove") cx.timer.after(100, () => this.input.focus());
        if (props().branch) await this.work(cx);
      } catch (error) { this.repo = null; this.error = String(error); cx.notify(); }
    });
  }

  space() {
    const p = props() ?? {};
    return spaces().find((s) => s.id === p.space) ?? (p.folder ? { folder: p.folder, machine: p.machine ?? null, name: "" } : undefined);
  }

  close() {
    closeOverlay(props().overlay);
  }

  // Local and remote-tracking branches, newest commit first, and which
  // branches already have a worktree.
  async loadBranches(repo) {
    const refs = await git(repo.main, ["for-each-ref", "--sort=-committerdate", "--format=%(refname)%09%(refname:short)", "refs/heads", "refs/remotes"], this.on);
    const locals = [], remotes = [];
    for (const line of refs.out.split("\n").filter(Boolean)) {
      const [full, short] = line.split("\t");
      if (full.startsWith("refs/heads/")) locals.push({ name: short, remote: false });
      else if (!full.endsWith("/HEAD")) remotes.push({ name: short, remote: true });
    }
    this.locals = new Set(locals.map((b) => b.name));
    this.remotes = new Map();
    for (const b of remotes) {
      const bare = b.name.slice(b.name.indexOf("/") + 1);
      if (!this.locals.has(bare) && !this.remotes.has(bare)) this.remotes.set(bare, b.name);
    }
    this.branches = [...locals, ...remotes];
    this.worktreeOf = new Map((await checkouts(repo, this.on)).filter((c) => c.branch).map((c) => [c.branch, c.path]));
  }

  // The base list as filtered by what's typed; the whole list while the
  // field still shows the current pick.
  shownBases() {
    const q = this.baseInput.value().trim().toLowerCase();
    if (!q || q === this.baseSel.toLowerCase()) return this.branches;
    return this.branches.filter((b) => b.name.toLowerCase().includes(q));
  }

  pickBase(b, cx) {
    if (!b) { this.error = "No branch matches."; cx.notify(); return; }
    this.baseSel = b.name;
    this.baseInput.set_value(b.name);
    this.baseAt = 0;
    this.error = "";
    this.labelInput.focus();
    cx.notify();
  }

  // What Enter will do with the typed branch name.
  mode(branch) {
    if (!branch) return null;
    if (this.preview?.branch === branch && this.preview.refOk === false) return { kind: "invalid" };
    if (this.worktreeOf.has(branch)) return { kind: "open", path: this.worktreeOf.get(branch) };
    if (this.locals.has(branch)) return { kind: "local" };
    if (this.remotes.has(branch)) return { kind: "remote", tracks: this.remotes.get(branch) };
    return { kind: "new" };
  }

  // Recompute the preview shortly after typing stops; a newer one wins.
  // (Spawn first and sleep inside: a cx kept from an event handler is gone
  // by the time a timer fires.)
  schedulePreview(cx) {
    if (props()?.action !== "new") return;
    const seq = ++this.previewSeq;
    cx.spawn(async (cx) => {
      await cx.sleep(150);
      if (seq !== this.previewSeq) return;
      let p;
      try { p = await this.computePreview(); }
      catch (e) { p = { branch: this.text.trim(), failed: String(e) }; }
      if (seq !== this.previewSeq) return;
      this.preview = p;
      cx.notify();
    });
  }

  async computePreview() {
    const r = this.repo;
    const branch = this.text.trim();
    if (!r || !branch) return { branch };
    const ref = await git(r.main, ["check-ref-format", "--branch", branch], this.on);
    if (!ref.ok) return { branch, refOk: false };
    if (this.worktreeOf.has(branch)) return { branch, refOk: true, path: this.worktreeOf.get(branch) };
    const path = this.template ? await wtPreviewPath(r, this.template, branch, this.on) : null;
    return { branch, refOk: true, path, failed: path ? undefined : "wt couldn't render its worktree-path" };
  }

  // Tab / shift-tab between the new-worktree fields.
  cycle(back) {
    const order = [["branch", this.input], ["base", this.baseInput], ["label", this.labelInput]];
    const i = order.findIndex(([name]) => name === this.field);
    order[(i + (back ? order.length - 1 : 1)) % order.length][1].focus();
  }

  go(cx) {
    if (this.busy || !this.repo) return;
    cx.spawn(async (cx) => this.work(cx));
  }

  async work(cx) {
    if (this.busy || !this.repo) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    try { this.error = props().action === "remove" ? await this.remove() : await this.create(); }
    catch (error) { this.error = String(error); }
    this.busy = false;
    if (!this.error) this.close();
    cx.notify();
  }

  async create() {
    const branch = this.text.trim();
    if (!branch) return "Type a branch name.";
    if (!(await git(this.repo.main, ["check-ref-format", "--branch", branch], this.on)).ok) return `"${branch}" isn't a valid branch name.`;
    // Refs may have moved since the dialog opened.
    await this.loadBranches(this.repo);
    const m = this.mode(branch);
    if (m.kind === "open") {
      // Already checked out: go to its space (or open one) instead of erroring.
      const all = [...this.worktreeOf].map(([b, path]) => ({ branch: b, path }));
      const s = spaceOf(m.path, all, this.on, spaces(), panes());
      const label = this.labelInput.value().trim();
      if (s) { run("space.select", { id: s.id }); if (label) run("space.rename", { id: s.id, name: label }); }
      else run("space.new", { folder: m.path, machine: this.on ?? "", ...(label ? { name: label } : {}) });
      return "";
    }
    // An existing local branch is checked out; a remote-only one gets a local
    // branch tracking it (wt does that without --create); else a new branch from Base.
    if (m.kind === "new" && !this.branches.some((b) => b.name === this.baseSel)) return "Pick a base branch from the list.";
    const sw = m.kind === "new" ? ["switch", "--create", branch, "--base", this.baseSel, "--no-cd"] : ["switch", branch, "--no-cd"];
    const r = await wt(this.repo.top, sw, this.on, 600_000);
    if (!r.ok) return r.err || "wt switch failed.";
    const path = await wtPath(this.repo, branch, this.on);
    if (!path) return `wt made ${branch} but its folder wasn't in wt list.`;
    await excludeInside(this.repo, path, this.on);
    const p = props();
    // Unnamed spaces follow the checkout folder's name; a Label fixes the name
    // instead. Nesting under the repo goes by git, so either way it nests.
    const label = this.labelInput.value().trim();
    run("space.new", { folder: path, machine: this.on ?? "", tab: p.tab, argv: p.argv, ...(label ? { name: label } : {}) });
    return "";
  }

  shown() {
    const f = this.text.trim().toLowerCase();
    return (this.list ?? []).filter((c) => !f || `${c.branch ?? ""} ${c.path}`.toLowerCase().includes(f));
  }

  open(c) {
    if (!c) return;
    this.close();
    const s = spaceOf(c.path, this.list, this.on, spaces(), panes());
    if (s) run("space.select", { id: s.id });
    else run("space.new", { folder: c.path, machine: this.on ?? "" });
  }

  async remove() {
    const s = this.space();
    const status = await git(this.repo.top, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], this.on);
    if (!status.ok) return status.err || "git status failed.";
    // git refuses a worktree with submodules unless forced, because their
    // history goes with it. The popup already showed what's at risk; only
    // risk that appeared since it opened gets one more warning.
    const { mods, unpushed } = await submodules(this.repo.top, this.on);
    const changed = (status.out && !this.dirty) || unpushed.some((name) => !this.unpushed.includes(name));
    this.dirty ||= status.out !== "";
    this.unpushed = [...new Set([...this.unpushed, ...unpushed])];
    if (changed) return "It changed since this opened. Enter again removes it anyway.";
    // Terminals first: a shell sitting in the folder keeps it busy on Windows.
    run("space.close", { id: s.id, confirmed: true });
    const force = this.dirty || mods.length > 0;
    // The branch stays (--no-delete-branch), as the dialog promises.
    const r = await wt(this.repo.main, ["remove", "--no-delete-branch", "--foreground", ...(force ? ["--force"] : []), this.repo.top], this.on, 600_000);
    return r.ok ? "" : r.err || "wt remove failed.";
  }

  key(e, cx) {
    if (e.key === "escape") return this.close();
    if (this.opening) {
      const n = this.shown().length;
      if (e.key === "enter") this.open(this.shown()[this.at]);
      else if ((e.key === "down" || e.key === "up") && n) this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n;
      else return;
      cx.stop_propagation();
      return cx.notify();
    }
    if (e.key === "enter" && props()?.action === "remove") return this.go(cx);
    if ((e.key === "down" || e.key === "up") && props()?.action === "new" && this.field === "base") {
      const n = this.shownBases().length;
      if (n) this.baseAt = (this.baseAt + (e.key === "down" ? 1 : n - 1)) % n;
      cx.stop_propagation();
      return cx.notify();
    }
    if (e.key === "tab" && props()?.action === "new" && this.repo) {
      this.cycle(Boolean(e.modifiers?.shift));
      cx.stop_propagation();
    }
  }

  renderOpen(t) {
    const r = this.repo;
    const rows = this.shown();
    const all = this.list ?? [];
    const spaceList = spaces();
    const paneList = panes();
    const row = (c, i) => {
      const on = i === this.at;
      const there = spaceOf(c.path, all, this.on, spaceList, paneList);
      return v_flex()
        .id(`wt-${i}`)
        .flex_none()
        .h(44)
        .px(10)
        .justify_center()
        .rounded(7)
        .cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click(() => this.open(c))
        .child(
          h_flex()
            .gap(8)
            .items_center()
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.branch ?? "detached"))
            .when(c.main, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("main checkout")))
            .when(Boolean(there), (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child("open")))
            .when(!there && c.at > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago(c.at)))),
        )
        .child(div().truncate().text_size(11.5).text_color(t.dim).child(tilde(c.path, this.userHome ?? "")));
    };
    const count = rows.length === all.length ? `${all.length} checkouts` : `${rows.length}/${all.length} checkouts`;
    return v_flex()
      .id("worktree")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(h_flex().child(div().flex_1().font_semibold().text_color(t.foreground).child(`Open worktree${r ? ` of ${r.name}` : ""}`)).child(div().text_size(11).text_color(t.dim).child(r ? count : "")))
      .when(r === undefined || (r && this.list === undefined), (el) => el.child(div().text_color(t.muted).child("\u2026")))
      .when(r === null, (el) => el.child(div().text_color(t.muted).child(`${this.folder ? tilde(this.folder, this.userHome ?? "") : "This folder"} is not in a git repository.`)))
      .when(Boolean(r && this.list), (el) =>
        el
          .child(Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1).border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_color(t.foreground))
          .child(
            div()
              .relative()
              .flex_1()
              .min_h(0)
              .child(
                v_flex()
                  .id("wt-list")
                  .size_full()
                  .overflow_y_scroll()
                  .children(rows.map(row))
                  .when(rows.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("No matching worktrees."))),
              )
              .child(Scrollbar.vertical("wt-list").absolute().inset_0()),
          ),
      )
      .child(h_flex().justify_end().text_size(11).text_color(t.dim).child("\u2191\u2193 choose \u00b7 \u21b5 open \u00b7 esc close"));
  }

  render(cx) {
    const t = theme();
    if (this.opening) return this.renderOpen(t);
    const remove = props()?.action === "remove";
    const s = this.space();
    const r = this.repo;
    const title = remove ? `Remove worktree ${s?.name ?? ""}?` : `New worktree${r ? ` of ${r.name}` : ""}`;
    const detail =
      r === undefined
        ? "…"
        : r === null
          ? `${this.folder ? tilde(this.folder, this.userHome) : "This folder"} is not in a git repository.`
          : remove
            ? !r.linked
              ? "This is the repository's main checkout, not a worktree."
              : `Closes the space and deletes ${tilde(r.top, this.userHome)}. The branch stays.`
            : `A new space on a checkout made by wt.`;
    const blocked = !r || (remove && !r.linked);
    // New: the three fields and what they will make.
    const branch = this.text.trim();
    const label = this.labelInput.value().trim();
    const pv = this.preview && this.preview.branch === branch ? this.preview : null;
    const field = (name, caption, state, hint) =>
      v_flex()
        .gap(4)
        .child(
          h_flex()
            .gap(8)
            .child(div().text_size(11.5).text_color(t.muted).child(caption))
            .when(Boolean(hint), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(hint.color ?? t.dim).child(hint.text))),
        )
        .child(
          Input.new(state)
            .h(30)
            .px(10)
            .items_center()
            .rounded(6)
            .border(1)
            .border_color(this.inputFocused && this.field === name ? t.accent : t.input)
            .bg(t.background)
            .text_color(t.foreground),
        );
    // What Enter will do, said plainly and colored by how much it changes.
    const m = this.mode(branch);
    const action = !m ? { text: "Type a branch name.", color: t.dim }
      : m.kind === "invalid" ? { text: `"${branch}" isn't a valid branch name.`, color: t.blocked }
      : m.kind === "new" ? { text: `Creates new branch ${branch} from ${this.baseSel || "?"}`, color: t.accent }
      : m.kind === "local" ? { text: `Checks out existing branch ${branch}`, color: t.foreground }
      : m.kind === "remote" ? { text: `Creates ${branch} tracking ${m.tracks}`, color: t.foreground }
      : { text: `${branch} is already checked out: opens that worktree`, color: t.blocked };
    const baseHint = m && m.kind !== "new" && m.kind !== "invalid" ? { text: "not used: the branch exists" } : null;
    // The base list, while Base has (or last had) the keyboard.
    const bases = this.shownBases();
    const baseList = v_flex()
      .relative()
      .h(Math.min(5, Math.max(1, bases.length)) * 26 + 2)
      .rounded(6)
      .border(1)
      .border_color(t.input)
      .child(
        v_flex()
          .id("wt-bases")
          .size_full()
          .overflow_y_scroll()
          .children(bases.map((b, i) =>
            h_flex()
              .id(`base-${i}`)
              .flex_none()
              .h(26)
              .px(10)
              .gap(8)
              .items_center()
              .cursor_pointer()
              .when(i === this.baseAt, (el) => el.bg(t.selected))
              .when(i !== this.baseAt, (el) => el.hover((s) => s.bg(t.hover)))
              .on_click((_e, cx) => this.pickBase(b, cx))
              .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(b.name))
              .when(b.name === this.baseSel, (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child("picked")))
              .when(b.remote, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("remote")))))
          .when(bases.length === 0, (el) => el.child(div().px(10).py(4).text_size(12).text_color(t.dim).child("No branch matches."))),
      )
      .child(Scrollbar.vertical("wt-bases").absolute().inset_0());
    const row = (k, v, color) =>
      h_flex()
        .gap(10)
        .child(div().w(46).flex_none().text_color(t.dim).child(k))
        .child(div().flex_1().min_w(0).truncate().text_color(color ?? t.foreground).child(v));
    const where = !branch ? "—"
      : m?.kind === "invalid" ? "—"
      : pv?.path ? tilde(pv.path, this.userHome ?? "")
      : pv?.failed ? pv.failed
      : "working out…";
    const shownAs = label || (pv?.path ? pv.path.split("/").pop() : "folder name");
    const previewBox = v_flex()
      .gap(4)
      .p(10)
      .rounded(6)
      .border(1)
      .border_color(t.input)
      .text_size(12)
      .child(div().text_size(12.5).font_semibold().text_color(action.color).child(action.text))
      .child(row("path", where, pv?.path ? undefined : pv?.failed ? t.blocked : t.dim))
      .child(row("space", shownAs, label ? undefined : t.dim));
    return v_flex()
      .id("worktree")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child(title))
      .child(div().text_color(t.muted).child(detail))
      .when(remove && this.dirty, (el) => el.child(div().text_color(t.blocked).child("It has uncommitted changes: they will be lost.")))
      .when(remove && this.unpushed.length > 0, (el) => el.child(div().text_color(t.blocked).child(`Submodule ${this.unpushed.join(", ")} has commits that aren't pushed anywhere: they will be lost.`)))
      .when(!remove && !blocked, (el) =>
        el
          .child(field("branch", "Branch", this.input, null))
          .child(field("base", "Base (branched off of)", this.baseInput, baseHint))
          .when(this.field === "base", (el) => el.child(baseList))
          .child(field("label", "Label (shown in the sidebar)", this.labelInput, null))
          .child(previewBox),
      )
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(
        h_flex()
          .justify_end()
          .text_size(11)
          .text_color(t.dim)
          .gap(6)
          .when(this.busy, (el) => el.child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)))
          .child(this.busy ? "working…" : blocked ? "esc close" : remove ? "↵ remove · esc cancel" : "tab next field · ↵ create · esc cancel"),
      );
  }
}
