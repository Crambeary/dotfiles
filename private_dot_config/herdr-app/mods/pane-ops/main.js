import { View, div } from "gpui-kit";
import { run, panes, focused, nextCommand, notify, exec } from "herdr";

// Headless: lives in a floating block, renders nothing, and handles the
// `pane-ops.*` key commands. Only app commands and `git` are used, so it
// behaves the same on macOS, Linux and Windows.
//
// flip: herdr exposes no split direction, so the direction a tab is believed
// to be in is remembered here (default "right", what pane.split:right makes).
// A wrong first guess costs one press that looks like a no-op, after which
// the memory matches reality.
const KEY = "dirs";

export default class PaneOps extends View {
  init(_props, cx) {
    this.dirs = {};
    try { this.dirs = JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch (_) {}
    cx.spawn(async (cx) => {
      for (;;) {
        const cmd = await nextCommand();
        if (cmd === "flip") await this.flip(cx);
        if (cmd === "review") await this.review();
        cx.notify();
      }
    });
  }

  async flip(cx) {
    const f = focused();
    if (!f || !f.pane) return;
    const mine = panes().filter((p) => p.tab === f.tab);
    if (mine.length !== 2 || mine.some((p) => !p.terminal)) {
      notify({ title: "Flip split", body: "Only works on a tab with exactly two terminals.", level: "info", timeout: 3000 });
      return;
    }
    const other = mine.find((p) => p.pane !== f.pane);
    const next = (this.dirs[f.tab] ?? "right") === "right" ? "down" : "right";

    // park removes the pane but keeps the terminal running; it applies after
    // the core replies, so wait for the pane to actually go before re-adding.
    run("terminal.park", { terminal: other.terminal });
    for (let i = 0; i < 30 && panes().filter((p) => p.tab === f.tab).length > 1; i++) {
      await cx.sleep(100);
    }
    run("terminal.keep", { terminal: other.terminal, place: next });

    this.dirs[f.tab] = next;
    try { localStorage.setItem(KEY, JSON.stringify(this.dirs)); } catch (_) {}
  }

  // tuicr on the working-tree diff when there are uncommitted changes, else
  // tuicr's own commit selector so a clean repo still has something to browse.
  async review() {
    const f = focused();
    if (!f || !f.pane) return;
    let dirty = false;
    try {
      const r = await exec("git", ["status", "--porcelain"], { cwd: f.cwd ?? undefined });
      dirty = r.stdout.trim().length > 0;
    } catch (_) {}
    run("pane.split", { direction: "down", pane: f.pane, argv: dirty ? ["tuicr", "-w"] : ["tuicr"] });
  }

  render() {
    return div();
  }
}
