// The side panel's toggles, for the bar's end: Files, Changes and Graph share one hidden-by-default `panel` column whose
// `panel-body` stack shows one of them. A button opens its view; the lit one closes the panel. omarchy-tabs' pattern.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, layout, spaces } from "herdr";
import { tip, glow } from "./tip.js";
import { stop } from "./focus.js";

const VIEWS = [["files", "Files"], ["changes", "Changes"], ["graph", "Graph"]];
// Changes and Graph read the repo: outside one they'd show nothing.
const NEEDS_GIT = new Set(["changes", "graph"]);

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const open = (id) => { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); };
const close = () => run("layout.hide", { id: "panel" });

// Remembered per space, as omarchy's: switching shows that space's choice (closed if it never had one),
// and opening or closing records it. `view.panels` is loaded from localStorage by the caller's init.
function sync(view, space, now, enabled) {
  if (!space) return;
  if (space.id !== view.panelSpace) {
    const first = view.panelSpace === undefined;
    view.panelSpace = space.id; view.panelPending = null;
    // The first frame leaves a space with no record alone: the app opens with whatever the layout's clicks kept.
    if (!(first && !(space.id in view.panels))) {
      const stored = view.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
      if (want !== now) {
        view.panelPending = { want, until: Date.now() + 1000 };
        if (want) open(want); else close();
        return;
      }
    }
  }
  // Until the restore lands (or something else won), the old state isn't a choice.
  if (view.panelPending) {
    if (view.panelPending.want !== now && Date.now() < view.panelPending.until) return;
    view.panelPending = null;
  }
  if (view.panels[space.id] === now) return;
  // A remembered view this space can't show now (Changes outside git) stays remembered.
  if (now === null && view.panels[space.id] && !enabled.includes(view.panels[space.id])) return;
  view.panels[space.id] = now;
  try { localStorage.setItem("panels", JSON.stringify(view.panels)); } catch {}
}

export function loadPanels() {
  try { return JSON.parse(localStorage.getItem("panels") ?? "{}") ?? {}; } catch { return {}; }
}

// A segmented control as the Actions one: outlined, 24 high, each view an icon in a 24 square; the open one filled.
// Null when the layout has no panel.
export function panelToggles(view, t, stopPress) {
  const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
  if (!panel || !body) return null;
  const space = spaces().find(s => s.active);
  const git = space?.branch != null;
  const enabled = VIEWS.map(([id]) => id).filter(id => find(body, id) && (git || !NEEDS_GIT.has(id)));
  const now = panel.hidden ? null : body.active ?? null;
  sync(view, space, now, enabled);
  if (!enabled.length) return null;
  const shown = VIEWS.filter(([id]) => enabled.includes(id));
  const button = ([id, label], i) => {
    const on = now === id, key = `panel-${id}`, last = i === shown.length - 1, words = on ? `Hide ${label}` : `Show ${label}`;
    return tip(view, t, key, words, stop(view, t, key, div().id(key).h(22).w(i === 0 || last ? 23 : 24).flex_none().flex().items_center().justify_center()
      .when(i === 0, el => el.rounded_l(8)).when(last, el => el.rounded_r(8))
      .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : view.hot === key ? t.foreground : t.dim)
      .hover(s => s.bg(on ? t.selected : t.hover)).on_hover(glow(view, key))
      .role("button").accessibility_label(words)
      .on_mouse_down("left", stopPress).on_click((_e, cx) => { if (on) close(); else open(id); cx.notify(); })
      .child(svg(`mods/t3-tabs/icons/panel-${id}.svg`).size(14)), 8), { below: true });
  };
  return h_flex().id("panel-toggles").h(24).flex_none().items_center().rounded(8).border(1).border_color(t.border).overflow_hidden()
    .children(shown.flatMap((v, i) => i === 0 ? [button(v, i)] : [div().w(1).h(22).flex_none().bg(t.border), button(v, i)]));
}
