// auto-tabs: herdr's tab bar (cloned) with wider names; names.js names the tabs.
import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { syncNames } from "./names.js";
import { renderPaneHeader } from "./pane.js";
import { spaces, panes, terminals, props, run, openOverlay, theme, shared, setShared, layout, settings, exec, readTextFile, home, appHome, nextCommand, notify } from "herdr";
import { resumeCommand, argvOf } from "./reopen.js";
import { describeTab } from "./label.js";
import { splitTabs, hidingInbox, initStack, renderStack, stackHeight } from "./stack.js";

// Terminal-style dots, animated natively without JavaScript redraw timers.
const WORKING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// The last closed tabs (newest last), kept across restarts for ctrl-alt-shift-t.
const CLOSED = "omarchy-tabs.closed";

// Tabs share the strip: each is TAB_MAX wide, shrinking to TAB_MIN, then the strip scrolls.
const TAB_MAX = 240, TAB_MIN = 120, TAB_COMPACT = 175;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.hovered = false;
    if (_props?.pane) return;
    // An overlay's props arrive through props(), not always as init's argument.
    if ((props() ?? _props)?.stack) return initStack(this, cx);
    // Auto Title (its own service, mods/auto-title installs it) names tabs where it's installed; naming them here
    // too, each would take the other's names for the person's and stop. Unknown until checked: name nothing.
    this.autoTitle = null;
    cx.spawn(async (cx) => {
      const copies = [`${home()}/Library/Application Support/herdr-auto-title/bin/herdr-auto-title`,
        `${home()}/.local/share/herdr-auto-title/herdr-auto-title`];
      const found = await Promise.all(copies.map(c => exec("test", ["-x", c]).then(r => r.code === 0, () => false)));
      this.autoTitle = found.includes(true);
      cx.notify();
    });
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    this.snap = {};
    this.roots = {};
    this.commands = {};
    this.shells = {};
    cx.spawn(async (cx) => {
      this.source = await readTextFile(`${appHome()}/mods/omarchy-tabs/reopen.py`).catch(() => null);
      this.refresh(cx);
    });
    // Poll gently for pure resizes; tab, pane and status changes refresh immediately.
    cx.timer.every(10000, cx => this.refresh(cx));
    // Each step touches cx, so a reloaded strip's old loop ends instead of eating the key.
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "reopen") this.reopen(cx);
        cx.notify();
      }
    });
  }

  track(cx) {
    if (this.reopening) return;
    const ids = new Set(spaces().flatMap(s => s.tabs.map(t => t.id)));
    if (this.known) {
      const gone = [...this.known].filter(id => !ids.has(id) && this.snap[id]?.panes.length);
      if (gone.length) setShared(CLOSED, [...(shared(CLOSED) ?? []), ...gone.map(id => this.snap[id])].slice(-10));
      for (const id of gone) delete this.snap[id];
    }
    this.known = ids;
    for (const s of spaces()) for (const t of s.tabs) {
      const list = panes().filter(p => p.tab === t.id && p.terminal).map(p => ({
        terminal: p.terminal.split('/').pop(), cwd: p.cwd, cmd: this.commands[p.terminal] ?? null,
      }));
      this.snap[t.id] = { space: s.id, machine: s.machine, spaceName: s.named ? s.name : null,
        name: t.named ? t.name : null, index: t.index, shell: this.shells[s.machine] ?? '/bin/sh',
        root: this.roots[t.id], panes: list };
    }
    const sig = JSON.stringify([spaces().map(s => s.tabs), panes().map(p => [p.tab, p.terminal, p.cwd, p.program?.key, p.status])]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.refresh(cx);
  }

  refresh(cx) {
    if (!this.source || this.scanning || this.reopening) return;
    this.scanning = true;
    cx.spawn(async (cx) => {
      try {
        for (const machine of new Set(spaces().map(s => s.machine))) {
          const r = await exec('python3', ['-c', this.source, 'scan'], { on: machine });
          if (r.code !== 0) throw new Error(r.stderr);
          const { shell, procs, document } = JSON.parse(r.stdout);
          this.shells[machine] = shell;
          for (const s of spaces().filter(s => s.machine === machine)) for (const t of s.tabs) {
            const saved = document?.spaces?.find(x => x.id === s.id.split('/').pop())?.tabs?.find(x => x.id === t.id.split('/').pop());
            if (saved) this.roots[t.id] = saved.root;
            for (const p of panes().filter(p => p.tab === t.id && p.terminal)) {
              const proc = procs[p.terminal.split('/').pop()];
              const cmd = resumeCommand(proc, proc?.session, home());
              // Keep a known session through a transient session-file write.
              if (cmd && (proc.session || !this.commands[p.terminal])) this.commands[p.terminal] = cmd;
              if (!proc && !p.program?.agent) delete this.commands[p.terminal];
            }
          }
        }
        cx.notify();
      } catch (e) {
        console.log(`Reopen snapshot: ${e}`);
      } finally {
        this.scanning = false;
      }
    });
  }

  reopen(cx) {
    if (this.reopening) return;
    const closed = shared(CLOSED) ?? [], last = closed[closed.length - 1];
    if (!last) return notify({ title: "No closed tab to reopen" });
    setShared(CLOSED, closed.slice(0, -1));
    this.reopening = true;
    cx.spawn(async (cx) => {
      try {
        if (!this.source) throw new Error('Reopen helper unavailable');
        const saved = { ...last, panes: last.panes.map((p, i) => ({ ...p, terminal: p.terminal ?? `old-${i}`, argv: argvOf(p.cmd, last.shell) })) };
        const r = await exec('python3', ['-c', this.source, 'restore', JSON.stringify(saved)]);
        if (r.code !== 0) throw new Error(r.stderr);
      } catch (e) {
        const [first, ...rest] = last.panes;
        const space = spaces().some(s => s.id === last.space) ? last.space : undefined;
        run('tab.new', { space, name: last.name ?? undefined, folder: first.cwd ?? undefined, argv: argvOf(first.cmd, last.shell) });
        for (const p of rest) run('terminal.open', { folder: p.cwd ?? undefined, argv: argvOf(p.cmd, last.shell), place: 'right' });
        notify({ title: 'Reopened with basic pane layout' });
      } finally {
        this.reopening = false;
        cx.notify();
      }
    });
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    // A remembered panel this space can't show now (Changes outside git) stays remembered.
    if (now === null && this.panels[space.id] && !enabled.includes(this.panels[space.id])) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render(cx) {
    if (props()?.pane) return renderPaneHeader(this);
    if (props()?.stack) return renderStack(this);
    this.track(cx);
    if (this.autoTitle === false) syncNames();
    const t = theme();
    const space = spaces().find(p => p.active);
    // With "Hide inbox sessions" on, the Inbox's tabs wait in the stack at the right end (stack.js).
    const { shown, hidden } = splitTabs(space);
    const stop = (_e, cx) => cx.stop_propagation();
    const f = t.foreground, idle = f + "0a", hov = f + "14";
    const allPanes = panes(), allTerminals = terminals();
    // Strip geometry: tab width from the measured strip, then a scroll offset kept in range and following the active tab.
    const n = shown.length, strip = this.stripW ?? n * TAB_MAX;
    const tabW = n ? Math.round(Math.max(TAB_MIN, Math.min(TAB_MAX, strip / n))) : TAB_MAX;
    const maxScroll = Math.max(0, n * tabW - strip);
    let off = Math.max(0, Math.min(this.scrollX ?? 0, maxScroll));
    const activeAt = shown.findIndex(c => c.active), activeId = shown[activeAt]?.id;
    if (activeId !== this.seenActive && activeAt >= 0 && this.stripW !== undefined) {
      this.seenActive = activeId;
      off = Math.max(0, Math.min(off, activeAt * tabW), (activeAt + 1) * tabW - strip);
      off = Math.min(off, maxScroll);
    }
    this.scrollX = off;
    const compact = tabW < TAB_COMPACT;
    const item = (c, i) => {
      const { name, detail, status, icons } = describeTab(c, allPanes, allTerminals, this.autoTitle);
      return h_flex().id(`tab-${c.id}`).w(tabW).absolute().top(0).bottom(0).left(i * tabW - off).px(compact ? 8 : 10).gap(compact ? 5 : 7).rounded(0).items_center().flex_none().text_size(12)
        .tooltip(`${name}\n${detail}`)
        // The close button shows on the active tab and on the one under the pointer.
        .on_hover((over, cx) => { if (over) this.overTab = c.id; else if (this.overTab === c.id) this.overTab = null; cx.notify(); })
        // Matches the pane's focus frame.
        .when(c.active, el => el.border_2().border_color(t.accent)).when(!c.active, el => el.border_r(1).border_color(t.border))
        .bg(c.active ? t.background : idle).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(c.active ? t.background : hov))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu-wt", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(icons.length > 0, el => el.child(h_flex().flex_none().gap(6).children(icons.map(p => p.tint ? svg(p.icon).size(14).text_color(t.muted) : image(p.icon).size(14)))))
        .child(div().flex_1().min_w(0).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(Boolean(status) && !compact, el => el.child(div().flex_none().text_size(10.5).text_color(t[c.status] ?? t.muted).child(status)))
        .when(c.status === "working", el => el.child(div().w(12).flex_none().text_size(14).text_color(t.working).frames(WORKING_FRAMES, 80)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(0).bg(t[c.status])))
        .when(c.active || this.overTab === c.id, el => el.child(div().id(`close-${c.id}`).flex_none().p(3).rounded(0).text_color(t.dim).hover(s => s.bg(hov).text_color(t.foreground)).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(14))));
    };
    const root = layout();
    const panel = find(root, "panel"), body = find(root, "panel-body");
    // Match the toolbar even when Gitview, rather than a terminal, has focus.
    const hasRepo = space?.branch != null || allPanes.some(p => p.terminal && p.branch != null && space?.tabs.some(tab => tab.id === p.tab));
    const enabled = panel && body
      ? [...(shared("workspace.panels") ?? ["files", "changes"]), "graph"].filter(id => Boolean(find(body, id)))
        .filter(id => id !== "changes" || hasRepo)
      : [];
    this.syncPanel(space, panel, body, enabled);
    return h_flex().size_full().min_w(0).gap(0).items_center().bg(t.chrome)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(div().id("tab-scroll").relative().overflow_hidden().w(n * TAB_MAX).flex_shrink(1).min_w(0).h_full()
        .on_size_change((size, cx) => {
          const w = size.width / (Number(settings()?.zoom) || 1);
          if (Math.abs(w - (this.stripW ?? -1)) >= 0.5) { this.stripW = w; cx.notify(); }
        })
        // The wheel (or a sideways swipe) scrolls the strip; the bar around it still steps through tabs.
        .on_scroll_wheel((e, cx) => {
          cx.stop_propagation();
          const z = Number(settings()?.zoom) || 1;
          const d = Math.abs(e.delta.x) > Math.abs(e.delta.y) ? e.delta.x : e.delta.y;
          const next = Math.max(0, Math.min((this.scrollX ?? 0) - d / z, Math.max(0, n * tabW - (this.stripW ?? n * TAB_MAX))));
          if (next === this.scrollX) return;
          this.scrollX = next;
          cx.notify();
        })
        .children(shown.map(item)))
      .child(div().id("tab-new").h_full().w(36).flex_none().flex().items_center().justify_center().rounded(0).border_r(1).border_color(t.border).bg(idle).text_color(t.dim)
        .hover(s => s.bg(hov).text_color(t.foreground)).on_mouse_down("left", stop)
        .on_click(() => openOverlay({ mod: "new-menu-wt", kind: "popup", width: 250, height: 512 })).child("+"))
      .child(div().flex_1())
      .child(this.stackButton(t, space, hidden, idle, hov, stop));
  }

  // The stack at the far right: the hidden tabs, and the switch that hides them. Lit while the tab in view is one of them.
  stackButton(t, space, hidden, idle, hov, stop) {
    const on = hidingInbox(), inside = hidden.some(c => c.active);
    const label = !on ? "Hidden tabs (off)" : hidden.length ? `${hidden.length} hidden tab${hidden.length === 1 ? "" : "s"}` : "No hidden tabs";
    return h_flex().id("tab-stack").h_full().px(10).gap(5).flex_none().items_center().justify_center().rounded(0)
      .border_l(1).border_color(t.border).bg(inside ? t.background : idle).text_color(inside ? t.foreground : t.dim)
      .when(inside, el => el.border_2().border_color(t.accent))
      .hover(s => s.bg(inside ? t.background : hov).text_color(t.foreground)).on_mouse_down("left", stop)
      .tooltip(label)
      .on_click(() => openOverlay({ mod: "omarchy-tabs", kind: "popup", width: 300, height: stackHeight(space),
        props: { stack: true, autoTitle: this.autoTitle } }))
      .child(svg("mods/omarchy-tabs/icons/layers.svg").size(15))
      .when(on && hidden.length > 0, el => el.child(div().text_size(11).child(String(hidden.length))));
  }
}
