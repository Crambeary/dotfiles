import { View } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, props, theme, run, closeOverlay } from "herdr";

// Dialog opened by pane-ops's `move` command: pick the tab to send a pane to.
// props: { terminal, tab } = the pane being moved and the tab it is leaving.
// It does the move itself (park, select the tab, re-add) so it can wait for
// the park to finish; closing first would tear the mod down mid-move.
export default class PanePicker extends View {
  init() {
    this.busy = false;
  }

  go(cx, tabId) {
    if (this.busy) return;
    this.busy = true;
    const { terminal, overlay } = props() ?? {};
    cx.spawn(async (cx) => {
      run("terminal.park", { terminal });
      for (let i = 0; i < 30 && panes().some((p) => p.terminal === terminal); i++) {
        await cx.sleep(100);
      }
      run("tab.select", { id: tabId });
      run("terminal.keep", { terminal, place: "right" });
      closeOverlay(overlay);
    });
  }

  render() {
    const t = theme();
    const { tab: from } = props() ?? {};
    const rows = [];
    for (const s of spaces()) {
      for (const tab of s.tabs) {
        if (tab.id === from) continue;
        rows.push(
          h_flex().id(`mv-${tab.id}`).px(12).py(7).gap(10).items_center()
            .hover((x) => x.bg(t.hover))
            .on_click((_e, cx) => this.go(cx, tab.id))
            .child(`${s.name} / ${tab.name}`)
            .child(h_flex().flex_1().justify_end().text_color(t.muted).child(`${tab.panes} pane${tab.panes === 1 ? "" : "s"}`)));
      }
    }
    return v_flex().size_full().bg(t.popover).text_color(t.foreground).text_size(13)
      .child(h_flex().px(12).py(10).text_color(t.muted).child("Move pane to tab (Esc to cancel)"))
      .child(v_flex().flex_1().overflow_y_scrollbar()
        .children(rows.length ? rows : [h_flex().px(12).py(7).text_color(t.muted).child("No other tabs.")]));
  }
}
