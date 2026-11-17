// The stack: with "Hide inbox sessions" on, a tab the Inbox lists leaves the strip, so the strip holds only what the
// Inbox doesn't (plain terminals, GUIs, agents Herdr doesn't recognise), and the stack button at the strip's right end
// lists the hidden ones. Off, every tab shows and the menu holds only the switch.
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, panes, terminals, shared, setShared, run, props, closeOverlay, theme } from "herdr";
import { describeTab } from "./label.js";

// Terminal-style dots, animated natively without JavaScript redraw timers.
const WORKING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// ↑/↓, round the ends (omarchy-inbox/list.js's step): the row to move to, or -1 for any other key.
const step = (e, at, n) => !n || (e.key !== "down" && e.key !== "up") ? -1 : e.key === "down" ? (at + 1) % n : (at <= 0 ? n : at) - 1;

// Shared, so the strip and an open menu follow the switch together. Unset: on.
const HIDE = "omarchy-tabs.hide-inbox";
export const hidingInbox = () => shared(HIDE) !== false;

// The Inbox's own rule (omarchy-inbox/main.js compute): a card for each agent, and for an agentless tab's
// mod pane whose mod asks for one (`inbox: true` in shared("<mod>.program")).
export function inboxTabIds(runs = agents(), ps = panes()) {
  const ids = new Set(runs.map(a => a.tab).filter(Boolean));
  for (const p of ps) if (p.mod && shared(`${p.mod}.program`)?.inbox) ids.add(p.tab);
  return ids;
}

// The active space's tabs, split into those the strip shows and those the stack holds.
export function splitTabs(space) {
  const tabs = space?.tabs ?? [];
  if (!hidingInbox()) return { shown: tabs, hidden: [] };
  const managed = inboxTabIds();
  return { shown: tabs.filter(c => !managed.has(c.id)), hidden: tabs.filter(c => managed.has(c.id)) };
}

export const ROW = 32, PAD = 5, RULE = 9;
// The popup's height: the switch, a rule, and a row for each tab the switch hides (or the empty line), so turning
// the switch on in the open menu has room for them. Past 12 the rows scroll.
export function stackHeight(space) {
  const managed = inboxTabIds(), n = (space?.tabs ?? []).filter(c => managed.has(c.id)).length;
  return PAD * 2 + ROW + RULE + Math.max(1, Math.min(n, 12)) * ROW;
}

export function initStack(view, cx) {
  view.at = 0;
  view.handle = cx.focus_handle();
  view.handle.focus();
}

export function renderStack(view) {
  const t = theme();
  const space = spaces().find(s => s.active);
  const { hidden } = splitTabs(space);
  const allPanes = panes(), allTerminals = terminals();
  const close = () => closeOverlay(props()?.overlay);
  const toggle = () => setShared(HIDE, !hidingInbox());
  const pick = c => { close(); run("tab.select", { id: c.id }); };
  const count = 1 + hidden.length;
  if (view.at >= count) view.at = count - 1;
  const choose = i => i === 0 ? toggle() : pick(hidden[i - 1]);
  const lit = i => el => el.when(i === view.at, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
    .on_hover((over, cx) => { if (over && view.at !== i) { view.at = i; cx.notify(); } });

  const on = hidingInbox();
  const switchRow = lit(0)(h_flex().id("stack-hide").h(ROW).px(8).gap(9).flex_none().items_center().rounded(0)
    .text_color(t.foreground).on_click(() => toggle())
    .child(div().size(14).flex_none().flex().items_center().justify_center().border_1().border_color(on ? t.accent : t.dim).bg(on ? t.accent : t.popover)
      .when(on, el => el.child(svg("mods/omarchy-tabs/icons/check.svg").size(11).text_color(t.background))))
    .child(div().flex_1().child("Hide inbox sessions"))
    .child(div().text_size(11).text_color(t.dim).child(on ? `${hidden.length} hidden` : "")));

  const row = (c, i) => {
    const { name, status, icons } = describeTab(c, allPanes, allTerminals, props()?.autoTitle);
    return lit(i)(h_flex().id(`stack-${c.id}`).h(ROW).px(8).gap(9).flex_none().items_center().rounded(0)
      .text_color(c.active ? t.foreground : t.muted).on_click(() => pick(c))
      .when(c.active, el => el.border_l_2().border_color(t.accent))
      .child(h_flex().w(14).flex_none().gap(4).children(icons.slice(0, 1).map(p => p.tint ? svg(p.icon).size(14).text_color(t.muted) : image(p.icon).size(14))))
      .child(div().flex_1().min_w(0).truncate().child(name || c.name || "Tab"))
      .when(Boolean(status), el => el.child(div().flex_none().text_size(10.5).text_color(t[c.status] ?? t.muted).child(status)))
      .when(c.status === "working", el => el.child(div().w(12).flex_none().text_size(14).text_color(t.working).frames(WORKING_FRAMES, 80)))
      .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).flex_none().bg(t[c.status]))));
  };

  return v_flex().id("stack").track_focus(view.handle).size_full().min_h(0).p(PAD).bg(t.popover).text_size(12.8)
    .on_key_down((e, cx) => {
      const to = step(e, view.at, count);
      if (to >= 0) view.at = to;
      else if (e.key === "enter" || e.key === "space") choose(view.at);
      else if (e.key === "escape") return close();
      else return;
      cx.stop_propagation();
      cx.notify();
    })
    .child(switchRow)
    .when(on, el => el
      .child(div().mx(7).my(4).h(1).flex_none().bg(t.border))
      .child(v_flex().id("stack-rows").flex_1().min_h(0).overflow_y_scroll()
        .children(hidden.map((c, i) => row(c, i + 1)))
        .when(hidden.length === 0, el => el.child(div().h(ROW).px(8).flex().items_center().text_color(t.dim).child("No hidden tabs")))));
}
