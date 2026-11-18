import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, theme, run, window, props, layout, shared, setShared, focused, home, nextCommand, settings, agents, terminals, openOverlay, closeOverlay } from "herdr";
import { wallpapers, setWallpaper, setZoomBorder, ZOOM_BORDER } from "./wallpaper.js";
import { buttonTip } from "./shortcuts.js";

const own = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The inbox (omarchy-inbox) shares the sidebar's `sidebar-lists` stack with Agents. Its scope, kept in shared state
// (layouts/.state is the app's): "both" puts it in place of Spaces and Agents (Spaces hides), "agents" only in place of Agents.
const SCOPE = "omarchy-inbox.scope";
const SCOPES = [
  { id: "both", label: "Spaces and agents", hint: "Inbox replaces both lists" },
  { id: "agents", label: "Agents only", hint: "Spaces stays visible" },
];
const scopeOf = () => (shared(SCOPE) === "agents" ? "agents" : "both");
const inboxShown = () => find(layout(), "sidebar-lists")?.active === "inbox";
const narrowNow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Spaces hides while the inbox shows in the "both" scope, and only then.
function placeSpaces(inbox, scope) {
  const hide = inbox && scope === "both", hidden = Boolean(find(layout(), "spaces")?.hidden);
  if (hide && !hidden) run("layout.hide", { id: "spaces" });
  if (!hide && hidden) run("layout.show", { id: "spaces" });
}

// The rail can't show the inbox: going to it unfolds the sidebar first, to the width it had.
function showInbox(on) {
  if (on && narrowNow()) {
    setShared("sidebar.collapsed", false);
    run("layout.resize", { id: "sidebar", px: shared("sidebar.width") ?? 268 });
  }
  if (on && find(layout(), "sidebar")?.hidden) run("layout.show", { id: "sidebar" });
  run("layout.select", { stack: "sidebar-lists", child: on ? "inbox" : "agents" });
  placeSpaces(on, scopeOf());
}
// At the pointer, as omarchy-agents' sort menu.
const openScopeMenu = () => openOverlay({ mod: "omarchy-bar", kind: "popup", width: 210, height: 112, props: { scopeMenu: true } });
const toggleInbox = () => find(layout(), "sidebar-lists") && showInbox(!inboxShown());

function togglePanel(id) {
  const panel = find(layout(), "panel"), body = find(layout(), "panel-body");
  if (!panel || !find(body, id)) return;
  if (!panel.hidden && body.active === id) run("layout.hide", { id: "panel" });
  else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
}

function setScope(scope) {
  setShared(SCOPE, scope);
  placeSpaces(inboxShown(), scope);
}

// Agents that need the person, as the inbox's Needs you reads them (its tree.js): a failed turn counts, and so does
// anything stuck among the sub-agents it started.
function needsYou() {
  const all = terminals(), list = agents(), listed = new Map(list.map((a) => [a.address, a.status]));
  const isAgent = (k) => k.status != null || Boolean(k.program?.agent);
  const kids = (addr, seen) => all.filter((k) => k.parent === addr && k.state === "live" && !seen.has(k.address))
    .flatMap((k) => (seen.add(k.address), isAgent(k) ? [k, ...kids(k.address, seen)] : kids(k.address, seen)));
  const word = (k) => { const s = k.status === "error" ? "error" : listed.get(k.address) ?? k.status; return s === "error" ? "blocked" : s; };
  const byAddress = new Map(all.map((k) => [k.address, k]));
  return list.filter((a) => {
    const own = byAddress.get(a.address)?.status === "error" ? "blocked" : a.status;
    return own != null && (own === "blocked" || kids(a.address, new Set([a.address])).some((k) => word(k) === "blocked"));
  }).length;
}

// Same toggle as omarchy-chrome's header: the rail goes by width.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  const narrow = (width ?? Infinity) < 160;
  if (!narrow) setShared("sidebar.width", width);
  setShared("sidebar.collapsed", !narrow);
  run("layout.resize", { id: "sidebar", px: narrow ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// The theme's next wallpaper, as Omarchy's Super+Ctrl+Space.
async function nextWallpaper() {
  const all = await wallpapers(settings().theme);
  if (!all.length) return;
  setWallpaper(all[(all.indexOf(layout()?.background?.image) + 1) % all.length]);
}

// The wallpaper belongs to the theme: a theme change from any picker brings its first one.
async function matchWallpaper(name) {
  if (layout()?.background?.image?.startsWith(`backgrounds/omarchy/${name}/`)) return;
  const [first] = await wallpapers(name);
  // A newer theme change may have come in while listing.
  if (first && settings().theme === name) setWallpaper(first);
}

export default class OmarchyBar extends View {
  init(_props, cx) {
    // The bar is in the layout twice; one copy takes the key.
    if (props()?.part !== "left") return;
    // Each step touches cx, so a reloaded bar's old loop ends instead of eating the key.
    // `inbox`: Agents <-> Inbox; `inbox-scope-both` / `inbox-scope-agents`: the inbox's scope; `inbox-scope-menu`: the
    // right-click menu, for the keyboard (keys.json, the palette).
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "next-wallpaper") await nextWallpaper();
        else if (command === "inbox") toggleInbox();
        else if (command === "inbox-scope-menu") openScopeMenu();
        else if (command === "graph") togglePanel("graph");
        else if (command === "map") togglePanel("agenttrail");
        else if (command === "forge-sidebar") run("layout.toggle", { id: "forge-sidebar" });
        else if (command.startsWith("inbox-scope-")) setScope(command.slice("inbox-scope-".length));
        cx.notify();
      }
    });
  }

  // Keeps Spaces and the stack consistent with the inbox's scope whatever switched it (the layout's remembered clicks
  // at start, another layout edit), and gives the rail Agents back: commands can't run in render, so a moment later.
  reconcile(cx) {
    const stack = find(layout(), "sidebar-lists");
    if (!stack) return;
    const inbox = stack.active === "inbox";
    const wrong = (inbox && narrowNow()) || Boolean(find(layout(), "spaces")?.hidden) !== (inbox && scopeOf() === "both");
    if (!wrong || this.reconciling) return;
    this.reconciling = true;
    cx.timer.after(300, () => {
      this.reconciling = false;
      if (!find(layout(), "sidebar-lists")) return;
      const now = inboxShown();
      if (now && narrowNow()) showInbox(false);
      else placeSpaces(now, scopeOf());
    });
  }

  // The inbox button's right-click menu: the scope.
  scopeMenu(t) {
    const on = scopeOf();
    return v_flex().w_full().p(5).bg(t.popover).text_size(12)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("inbox scope"))
      .children(SCOPES.map((s) => h_flex().id(`scope-${s.id}`).h(36).px(8).gap(9).rounded(0).items_center()
        .text_color(t.foreground).hover((el) => el.bg(t.foreground + "14"))
        .on_click(() => { setScope(s.id); closeOverlay(props().overlay); })
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().child(s.label))
          .child(div().truncate().text_size(10.5).text_color(t.dim).child(s.hint)))
        .when(s.id === on, (el) => el.child(svg("mods/omarchy-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  render(cx) {
    const t = theme();
    if (props()?.scopeMenu) return this.scopeMenu(t);
    const part = props()?.part;
    if (part === "left") this.reconcile(cx);
    const row = h_flex().id(`omarchy-${part}`).size_full().items_center().bg(t.chrome).text_size(12).text_color(t.muted).overflow_hidden();
    if (part === "right") return this.right(row, t);
    if (part === "center") return this.center(row, t);
    return this.left(row, t);
  }

  center(row, t) {
    return row.justify_center()
      .children([["redline", "Redline", "redline"], ["forge-window", "Forge", "forge"]].map(([name, label, icon]) =>
        own(div().id(`open-${name}`).flex_none().w(30).h_full().flex().items_center().justify_center().cursor_pointer()
          .text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
          .tooltip(buttonTip(label, `mod.open:${name}`))
          .on_click(() => run("mod.open", { name })).child(svg(`mods/omarchy-bar/${icon}.svg`).size(14)))));
  }

  left(row, t) {
    const name = settings().theme;
    if (name !== this.theme) {
      this.theme = name;
      matchWallpaper(name);
    }
    const list = spaces();
    const zoomed = Boolean(list.find((s) => s.active)?.tabs.find((tab) => tab.active)?.zoomed);
    if (zoomed !== this.zoomed) {
      // First render only fixes a thick frame left over from a zoom when the app quit.
      if (zoomed || this.zoomed !== undefined || find(layout(), "main")?.content?.pane?.focus?.width === ZOOM_BORDER) setZoomBorder(zoomed);
      this.zoomed = zoomed;
    }
    const space = list.find((s) => s.active);
    const cwd = focused()?.cwd;
    const here = cwd ? (cwd === home() ? "~" : cwd.split("/").filter(Boolean).pop()) : null;
    const sep = () => div().flex_none().mx(10).text_color(t.border).child("│");
    // macOS draws its window buttons over this corner; leave them room.
    const w = window();
    return row.pl(w?.platform === "macos" && !w.fullscreen ? 76 : 4)
      .on_size_change((_size, cx) => {
        const narrow = globalThis.window.viewport_size().width < 1024;
        if (narrow !== this.narrow) {
          this.narrow = narrow;
          const sizes = [["bar-left", { weight: 1 }], ["bar-right", { weight: 1 }],
            ["bar-controls", { px: (narrow ? 150 : 180) + (w?.buttons ? 90 : 0) }]];
          for (const [id, size] of sizes) {
            const current = find(layout(), id)?.size;
            if (current && (current.px !== size.px || current.weight !== size.weight)) run("layout.resize", { id, ...size });
          }
          cx.notify();
        }
      })
      .child(own(div().id("menu").flex_none().size(24).mr(6).flex().items_center().justify_center().cursor_pointer()
        .tooltip(buttonTip("Command palette", "mod.open:omarchy-palette"))
        .hover((s) => s.bg(t.hover)).on_click(() => run("mod.open", { name: "omarchy-palette" }))
        .text_color(t.accent).child(svg("mods/omarchy-bar/omarchy.svg").size(14))))
      .child(own(div().id("sidebar-toggle").flex_none().w(30).h_full().flex().items_center().justify_center().cursor_pointer().text_color(t.dim)
        .tooltip(buttonTip("Toggle sidebar", "layout.toggle:sidebar"))
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(toggleSidebar)
        .child(svg("mods/omarchy-chrome/sidebar.svg").size(14))))
      .child(own(div().id("search").flex_none().w(30).h_full().flex().items_center().justify_center().cursor_pointer().text_color(t.dim)
        .tooltip(buttonTip("Search spaces and agents", "mod.open:picker"))
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => run("mod.open", { name: "picker" }))
        .child(svg("mods/omarchy-chrome/search.svg").size(14))))
      .when(Boolean(find(layout(), "sidebar-lists")), (el) => el.child(this.inboxButton(t)))
      .when(Boolean(space), (el) => el.child(sep())
        .child(div().flex_none().text_color(t.foreground).child(space.name))
        // The focused terminal may have moved away from the folder its space was named after.
        .when(Boolean(here) && here !== space.name, (e) => e.child(div().flex_none().ml(8).text_color(t.muted).child(here)))
        .when(Boolean(space.branch), (e) => e.child(div().flex_none().ml(8).text_color(t.dim).child(space.branch)))
        .when(Boolean(space.machine), (e) => e.child(div().flex_none().ml(8).text_color(t.dim).child(`@${space.machine}`))));
  }

  // Left-click: Agents <-> Inbox in the current scope. Right-click: the scope. The count: agents that need you.
  inboxButton(t) {
    const shown = inboxShown(), count = needsYou();
    const label = `${shown ? "Show agents" : "Show inbox"}${count ? ` (${count} need${count === 1 ? "s" : ""} you)` : ""}. Right-click: scope`;
    return own(div().id("inbox-toggle").relative().flex_none().w(30).h_full().flex().items_center().justify_center().cursor_pointer()
      .text_color(shown ? t.foreground : t.dim).when(shown, (el) => el.bg(t.foreground + "14"))
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(buttonTip(label, "omarchy-bar.inbox"))
      .on_click(() => toggleInbox())
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        openScopeMenu();
      })
      .child(svg("mods/omarchy-inbox/icons/inbox.svg").size(14))
      .when(count > 0, (el) => el.child(div().absolute().top(3).right(2).min_w(12).h(12).px(2).flex().items_center().justify_center()
        .bg(t.accent).text_color(t.background).text_size(9).font_bold().child(count > 99 ? "99+" : String(count)))));
  }

  right(row, t) {
    const w = window();
    const space = spaces().find(s => s.active);
    const panel = find(layout(), "panel"), body = find(layout(), "panel-body");
    // A focused mod has no branch. Keep the repo context of this space's terminals.
    const hasRepo = space?.branch != null || panes().some(p => p.terminal && p.branch != null && space?.tabs.some(tab => tab.id === p.tab));
    // Match the tab mod's per-space restore eligibility; only the controls move.
    const enabled = panel && body
      ? [...(shared("workspace.panels") ?? ["files", "changes"]), "graph", "agenttrail"].filter(id => Boolean(find(body, id)))
        .filter(id => id !== "changes" || hasRepo)
      : [];
    const panelButton = (id, label, icon, actions = []) => {
      const on = panel && !panel.hidden && body?.active === id;
      return own(div().id(`panel-${id}`).flex_none().w(30).h_full().flex().items_center().justify_center().cursor_pointer()
        .tooltip(buttonTip(label, actions)).bg(t.foreground + (on ? "2e" : "0a")).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.foreground + (on ? "2e" : "14")))
        .on_click(() => togglePanel(id)).child(svg(icon).size(14)));
    };
    const btn = (id, label, icon, cmd, danger) => own(
      div().id(id).flex_none().w(30).h_full().flex().items_center().justify_center().cursor_pointer().text_color(t.dim)
        .tooltip(buttonTip(label, cmd))
        .hover((s) => s.bg(danger ? t.blocked : t.hover).text_color(danger ? t.background : t.foreground))
        .on_click(() => run(cmd))
        .child(svg(`mods/terminals-bar/${icon}.svg`).size(14)));
    return row.justify_end()
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg", ["herdr-nvim.toggle", "mod.open:herdr-nvim", "layout.select:panel-body:files"])))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg", ["mod.open:gitview-sidebar", "layout.select:panel-body:changes"])))
      .when(enabled.includes("graph"), el => el.child(panelButton("graph", "Graph", "mods/omarchy-tabs/icons/graph.svg", "omarchy-bar.graph")))
      .when(enabled.includes("agenttrail"), el => el.child(panelButton("agenttrail", "Map", "mods/omarchy-tabs/icons/map.svg", "omarchy-bar.map")))
      .when(Boolean(find(layout(), "forge-sidebar")), el => el.child(own(div().id("forge-sidebar-toggle")
        .flex_none().w(30).h_full().flex().items_center().justify_center().cursor_pointer()
        .tooltip(buttonTip("Merge requests and pipelines", "omarchy-bar.forge-sidebar"))
        .text_color(find(layout(), "forge-sidebar")?.hidden ? t.muted : t.accent)
        .bg(t.foreground + (find(layout(), "forge-sidebar")?.hidden ? "0a" : "2e"))
        .hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("layout.toggle", { id: "forge-sidebar" }))
        .child(svg("mods/omarchy-bar/forge.svg").size(14)))))
      .when(Boolean(w?.buttons), (el) => el
        .child(btn("wb-min", "Minimize window", "win-min", "window.minimize"))
        .child(btn("wb-max", w.maximized ? "Restore window" : "Maximize window", w.maximized ? "win-restore" : "win-max", "window.maximize"))
        .child(btn("wb-close", "Close window", "win-close", "window.close", true)));
  }
}
