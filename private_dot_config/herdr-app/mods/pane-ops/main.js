import { View, div } from "gpui-kit";
import { run, panes, spaces, focused, agents, nextCommand, notify, exec, openOverlay, pickFolder } from "herdr";

// Headless: lives in a floating block, renders nothing, and handles the
// `pane-ops.*` key commands. Only app commands and `git` are used, so it
// behaves the same on macOS, Linux and Windows.
//
// flip: herdr exposes no split direction, so the direction a tab is believed
// to be in is remembered here (default "right", what pane.split:right makes).
// A wrong first guess costs one press that looks like a no-op, after which
// the memory matches reality.
const KEY = "dirs";

// park removes a terminal's pane but keeps it running; it applies after the
// core replies, so wait for the pane to actually go before re-adding it.
async function detach(cx, terminal) {
  run("terminal.park", { terminal });
  for (let i = 0; i < 30 && panes().some((p) => p.terminal === terminal); i++) {
    await cx.sleep(100);
  }
}

const info = (body) => notify({ title: "pane-ops", body, level: "info", timeout: 3000 });

export default class PaneOps extends View {
  init(_props, cx) {
    this.dirs = {};
    try { this.dirs = JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch (_) {}
    this.lastAttention = null;
    cx.spawn(async (cx) => {
      for (;;) {
        const cmd = await nextCommand();
        try {
          if (cmd === "flip") await this.flip(cx);
          else if (cmd === "break") await this.breakToTab(cx);
          else if (cmd === "move") this.move();
          else if (cmd === "review") await this.review(focused()?.cwd, false);
          else if (cmd === "review-wt") await this.review(focused()?.cwd, true);
          else if (cmd === "review-dir") await this.reviewDir();
          else if (cmd === "attention") this.attention();
          else if (cmd === "wt-new") this.worktree("new");
          else if (cmd === "wt-open") this.worktree("open");
          else if (cmd === "wt-remove") this.worktree("remove");
        } catch (e) {
          info(`${cmd} failed: ${e}`);
        }
        cx.notify();
      }
    });
  }

  // Terminal panes of the focused tab, or null (after a toast) when the
  // focused pane isn't a terminal or the tab has fewer than `min` panes.
  tabPanes(min) {
    const f = focused();
    if (!f || !f.pane) return null;
    const mine = panes().filter((p) => p.tab === f.tab);
    if (mine.length < min) { info(`Needs a tab with at least ${min} panes.`); return null; }
    const me = mine.find((p) => p.pane === f.pane);
    if (!me || !me.terminal) { info("Focus a terminal pane first."); return null; }
    return { f, mine, me };
  }

  async flip(cx) {
    const t = this.tabPanes(2);
    if (!t) return;
    if (t.mine.length !== 2 || t.mine.some((p) => !p.terminal)) {
      info("Flip only works on a tab with exactly two terminals.");
      return;
    }
    const other = t.mine.find((p) => p.pane !== t.f.pane);
    const next = (this.dirs[t.f.tab] ?? "right") === "right" ? "down" : "right";
    await detach(cx, other.terminal);
    run("terminal.keep", { terminal: other.terminal, place: next });
    this.dirs[t.f.tab] = next;
    try { localStorage.setItem(KEY, JSON.stringify(this.dirs)); } catch (_) {}
  }

  // Focused pane out into a new tab of its own (its program keeps running).
  async breakToTab(cx) {
    const t = this.tabPanes(2);
    if (!t) return;
    await detach(cx, t.me.terminal);
    run("terminal.keep", { terminal: t.me.terminal, place: "tab" });
  }

  // The picker does the move itself so it can wait on the park; it needs to
  // know which terminal and which tab it came from.
  move() {
    const t = this.tabPanes(2);
    if (!t) return;
    openOverlay({
      mod: "pane-ops-picker",
      props: { terminal: t.me.terminal, tab: t.f.tab },
      kind: "dialog", width: 420, height: 360,
    });
  }

  // tuicr on the working-tree diff when there are uncommitted changes, else
  // tuicr's own commit selector so a clean repo still has something to browse.
  // `forceWorktree` skips the check and always shows the working tree.
  async review(cwd, forceWorktree, folder) {
    const f = focused();
    if (!f || !f.pane) return;
    let dirty = forceWorktree;
    if (!dirty) {
      try {
        const r = await exec("git", ["status", "--porcelain"], { cwd: cwd ?? undefined });
        dirty = r.stdout.trim().length > 0;
      } catch (_) {}
    }
    const argv = dirty ? ["tuicr", "-w"] : ["tuicr"];
    if (folder) run("terminal.open", { argv, folder, place: "down" });
    else run("pane.split", { direction: "down", pane: f.pane, argv });
  }

  // Same as review, but for any folder you choose (e.g. reviewing chezmoi
  // from a pane sitting in an unrelated repo).
  async reviewDir() {
    const folder = await pickFolder({ prompt: "Review" });
    if (folder) await this.review(folder, false, folder);
  }

  // The worktree-wt dialog (wt-backed clone of Herdr's worktree dialog) for
  // the focused space, same sizes the menus open it at.
  worktree(action) {
    const f = focused();
    const space = f && spaces().find((s) => (s.tabs ?? []).some((t) => t.id === f.tab));
    if (!space) { info("Focus a terminal in a space first."); return; }
    openOverlay({
      mod: "worktree-wt", kind: "dialog",
      ...(action === "open" ? { width: 560, height: 480 } : action === "new" ? { width: 520, height: 560 } : { width: 440, height: 260 }),
      props: { space: space.id, folder: f.cwd, action },
    });
  }

  // Cycle through agents that are blocked or done, newest first, wrapping.
  // Remembering the last jump keeps a still-blocked agent from bouncing
  // between the same two panes.
  attention() {
    const list = agents()
      .filter((a) => a.status === "blocked" || a.status === "done")
      .sort((a, b) => b.seq - a.seq);
    if (!list.length) { info("No agents need attention."); return; }
    const i = list.findIndex((a) => a.address === this.lastAttention);
    const next = list[(i + 1) % list.length];
    this.lastAttention = next.address;
    run("agent.focus", { terminal: next.address });
  }

  render() {
    return div();
  }
}
