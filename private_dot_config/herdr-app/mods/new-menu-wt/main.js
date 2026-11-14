import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, panes, knownAgents, run, exec, openOverlay, closeOverlay, props, window, keys, shared, setShared } from "herdr";

// The last agents each machine reported, shown at once while knownAgents() checks again.
const KNOWN = "new-menu.agents";
// Hermes agents in Docker: the container, the user Hermes runs as in it, and where its profiles live. The default profile is the
// container's own; every folder under profiles/ is another agent, so a new profile shows up here without touching this file.
const HERMES = { container: "hermes", user: "hermes", profiles: "/opt/data/profiles" };
const HERMES_KNOWN = "new-menu.hermes";

function shortcut(name) {
  const k = keys().find(b => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

export default class NewMenu extends View {
  init(_props, cx) {
    const machine = spaces().find(s => s.active)?.machine;
    const where = machine ?? "";
    this.agents = shared(KNOWN)?.[where] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async cx => {
      try {
        this.agents = await knownAgents({ on: machine });
        setShared(KNOWN, { ...shared(KNOWN), [where]: this.agents });
      }
      catch { this.failed = true; }
      cx.notify();
    });
  }
  // The Hermes agents in Docker, a step of this menu. Asked of the container each time it opens, as a profile can come and go.
  showHermes(on, cx) {
    this.hermes = on;
    if (!on) return cx.notify();
    this.profiles = shared(HERMES_KNOWN) ?? [];
    this.hermesFailed = false;
    cx.spawn(async cx => {
      try {
        const r = await exec("docker", ["exec", HERMES.container, "ls", "-1", HERMES.profiles]);
        if (r.code !== 0) throw new Error(r.stderr);
        this.profiles = ["default", ...r.stdout.split("\n").map(n => n.trim()).filter(Boolean).sort()];
        setShared(HERMES_KNOWN, this.profiles);
      } catch { this.hermesFailed = true; this.profiles = []; }
      cx.notify();
    });
    cx.notify();
  }
  openHermes(profile, space) {
    const argv = ["docker", "exec", "-it", "-u", HERMES.user, HERMES.container, "hermes", ...(profile === "default" ? [] : ["-p", profile])];
    run("tab.new", { name: profile === "default" ? "Hermes" : `Hermes · ${profile}`, space: space?.id, argv });
  }
  // `stay`: the row opens another step of this menu, so the popup stays.
  row(id, icon, name, action, hint = "", enabled = true, stay = false) {
    const t = theme();
    return h_flex().id(id).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
      .text_color(enabled ? t.foreground : t.dim).when(enabled, el => el.hover(s => s.bg(t.selected)))
      .on_click((_e, cx) => { if (enabled) { if (!stay) closeOverlay(props().overlay); action(cx); } })
      .child(icon).child(div().flex_1().child(name)).child(div().text_size(11).text_color(t.dim).child(hint));
  }
  renderHermes(t, space) {
    const agents = this.profiles ?? [];
    return v_flex().min_h(0).w_full().h(Math.min(491, 78 + Math.max(1, agents.length) * 31)).bg(t.popover).p(5).text_size(12.8)
      .id("new-menu").track_focus(this.handle)
      .on_key_down((e) => {
        const agent = /^[1-9]$/.test(e.key) && !e.modifiers.control && !e.modifiers.platform && !e.modifiers.alt ? agents[Number(e.key) - 1] : null;
        if (!agent) return;
        closeOverlay(props().overlay);
        this.openHermes(agent, space);
      })
      .child(this.row("hermes-back", svg("mods/omarchy-chrome/chevron-left.svg").size(14), "Hermes in Docker", (cx) => this.showHermes(false, cx), "", true, true))
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(agents.map((p, i) => this.row(`hermes:${p}`, svg("mods/new-menu-wt/icons/bot.svg").size(14), p === "default" ? "Hermes" : p,
          () => this.openHermes(p, space), i < 9 ? String(i + 1) : "")))
        .when(agents.length === 0, el => el.child(div().px(9).py(6).text_color(t.dim).child(this.hermesFailed ? `Couldn't reach the "${HERMES.container}" container` : "Looking for agents…"))));
  }
  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    if (this.hermes) return this.renderHermes(t, space);
    const installed = this.agents.filter(a => a.installed);
    const choices = this.failed ? installed : [...installed, ...this.agents.filter(a => !a.installed).slice(0, 2)];
    return v_flex().min_h(0).w_full().h(Math.min(512, 198 + Math.max(1, choices.length + (this.failed ? 1 : 0)) * 31)).bg(t.popover).p(5).text_size(12.8)
      .id("new-menu").track_focus(this.handle)
      .on_key_down((e) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (!agent) return;
        closeOverlay(props().overlay);
        run("tab.new", { name: agent.name, space: space?.id, argv: agent.run });
      })
      .child(this.row("terminal", svg("icons/shell.svg").size(14), "Terminal", () => run("tab.new", { space: space?.id }), shortcut("tab.new")))
      .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child("Start an agent"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(choices.map((a, i) => this.row(a.key, a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14), a.name,
          () => run("tab.new", { name: a.name, space: space?.id, argv: a.run }), a.installed ? (i < 9 ? String(i + 1) : "") : "not installed", a.installed)))
        .when(this.failed || this.agents.length === 0, el => el.child(div().px(9).py(6).text_color(t.dim).child(this.failed ? "Could not check installed agents" : "Checking installed agents…"))))
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(this.row("hermes", svg("mods/new-menu-wt/icons/bot.svg").size(14), "Hermes in Docker…", (cx) => this.showHermes(true, cx), "›", true, true))
      .child(this.row("space", div().w(14).child("+"), "New space", () => run("space.new"), shortcut("space.new")))
      .child(this.row("worktree", svg("mods/workspace-chrome/branch.svg").size(14), "New worktree…", () => openOverlay({ mod: "worktree-wt", kind: "dialog", width: 520, height: 560, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "new" } }), "", Boolean(space)))
      .child(this.row("worktree-open", svg("mods/workspace-chrome/branch.svg").size(14), "Open worktree\u2026", () => openOverlay({ mod: "worktree-wt", kind: "dialog", width: 560, height: 480, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "open" } }), "", Boolean(space)));
  }
}
