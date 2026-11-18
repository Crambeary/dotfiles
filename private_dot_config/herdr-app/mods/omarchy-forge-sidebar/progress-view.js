// Adapted from omarchy-inbox/pipeline-view.js: square Omarchy card, phase mark,
// split hairline and native pulse. WATCH's Popup supplies the anchored surface.
import { div } from "gpui-kit";
import { h_flex, v_flex, Popup } from "gpui-base";
import { progressOf, tint, glyph, word } from "./progress.js";

const PULSE = { from: 0.35, to: 1, period: 1200 };
const text = (t, value) => div().text_size(11).text_color(t.muted).child(value);
export function split(t, p, height) {
  return h_flex().h(height).w_full().overflow_hidden().bg(t.foreground + '14')
    .children(p.parts.map((part, i) => div().flex_none().h(height).w(`${part * 100}%`)
      .bg([t.done, t.blocked, t.working, t.working + '66'][i])
      .when(i === 2 && part > 0, el => el.loop('opacity', PULSE))));
}

export function progressCard(t, row, entry, provider, now = Date.now(), note = '', identity = row.id) {
  const p = progressOf(row, entry, now), c = p.data?.counts;
  const phase = ({ running: 'Running', queued: 'Waiting for a runner', passed: 'Passed', failed: 'Failed', manual: 'Waiting on a manual job', unknown: 'Progress unavailable' })[p.phase];
  return v_flex().id(`forge-progress-card-${identity}`).w(290).p(12).gap(8).rounded(0)
    .border(2).border_color(t.border).bg(t.chrome).shadow_xl().text_size(12).text_color(t.foreground)
    .child(div().font_medium().text_color(tint(t, p.phase)).child(`${glyph(p.phase)} ${phase}`))
    .child(text(t, `Pipeline #${row.iid ?? row.id} · ${row.ref ?? ''}`))
    .child(text(t, `${note ? 'Last seen status' : 'Pipeline status'}: ${word(row.status ?? 'unknown')}`))
    .when(Boolean(note), el => el.child(div().text_size(11).text_color(t.working).child(note)))
    .when(Boolean(c), el => el.child(v_flex().gap(5).opacity(p.outdated ? 0.55 : 1)
      .child(split(t, p, 6))
      .child(text(t, `${c.done}/${p.total} jobs done · ${c.ok} passed · ${c.bad} failed`))
      .child(text(t, `${c.run} running · ${c.wait} waiting for a runner · ${c.manual} manual excluded`))
      .child(text(t, `${p.done}/${p.data.stages.length} job groups finished (inferred from jobs)`))
      .children(p.data.stages.slice(0, 8).map((stage, i) => h_flex().id(`forge-stage-${identity}-${i}`).gap(6).items_center()
        .child(div().size(8).flex_none().bg(tint(t, ['success', 'skipped'].includes(stage.status) ? 'passed' : ['failed', 'canceled'].includes(stage.status) ? 'failed' : ['running', 'preparing', 'pending', 'waiting_for_resource'].includes(stage.status) ? 'running' : 'unknown')))
        .child(div().flex_1().min_w(0).truncate().child(stage.name))
        .child(text(t, word(stage.status)))))
      .when(p.data.stages.length > 8, el => el.child(text(t, `${p.data.stages.length - 8} more job groups`)))))
    .when(Boolean(entry?.at), el => el.child(div().text_size(11).text_color(p.outdated ? t.working : t.dim)
      .child(`${p.outdated ? 'Outdated · ' : ''}Observed ${Math.max(0, Math.floor((now - entry.at) / 60000))}m ago`)))
    .when(Boolean(p.problem), el => el.child(text(t, p.problem)))
    .child(text(t, 'Groups follow job ID order; group status is inferred, including allowed failures.'))
    .when(Boolean(c?.bad) && row.status === 'success', el => el.child(text(t, 'Pipeline passed with failed jobs; allowed failures remain counted.')))
    .child(text(t, provider === 'github' ? 'Workflow jobs only; groups are not pipeline stages. Other runs are not included.' : 'Parent jobs only; downstream pipelines are not included.'));
}

// pin: {pinned, stale, note, toggle}. A stale row is a cached pin the list no
// longer returns: never painted as live, and its status is labelled last seen.
export function pipelineRow(t, row, entry, provider, open, hover, shown = false, moved = () => {}, pin = {}) {
  const identity = pin.identity ?? row.id;
  const detail = pin.stale && !pin.observed ? undefined : entry;
  const p = progressOf(row, detail);
  const trigger = v_flex().id(`forge-sidebar-row-${identity}`).relative().px(8).py(8).gap(5)
    .bg(t.surface).cursor_pointer().hover(s => s.bg(t.hover)).on_hover(hover).on_mouse_move(moved).on_click(open)
    .accessibility_label(`Pipeline ${row.iid ?? row.id}: ${row.status ?? 'unknown'}`)
    .child(h_flex().gap(6).items_center()
      .child(div().flex_none().text_color(tint(t, p.phase)).child(`#${row.iid ?? row.id}`))
      .child(div().flex_1().min_w(0).truncate().child(row.ref ?? 'Pipeline'))
      .child(div().flex_none().text_size(11).text_color(p.outdated ? t.dim : tint(t, p.phase))
        .child(`${glyph(p.phase)}${p.data ? ` ${p.done}/${p.data.stages.length}` : ''}${p.data && p.outdated ? ' !' : ''}`))
      .when(Boolean(pin.toggle), el => el.child(div().id(`forge-sidebar-pin-${identity}`).flex_none().px(4).cursor_pointer()
        .text_color(pin.pinned ? t.accent : t.dim).hover(s => s.text_color(t.foreground))
        .tooltip(pin.pinned ? 'Unpin pipeline' : 'Pin pipeline to the top')
        .accessibility_label(`${pin.pinned ? 'Unpin' : 'Pin'} pipeline ${row.iid ?? row.id}`)
        .on_mouse_down('left', (_e, cx) => cx.stop_propagation())
        .on_click((e, cx) => pin.toggle(e, cx)).child(pin.pinned ? '★' : '☆'))))
    .when(Boolean(pin.origin), el => el.child(div().truncate().text_size(10).text_color(t.dim).tooltip(pin.origin).child(pin.origin)))
    .child(text(t, `${pin.stale ? 'last seen ' : ''}${(row.status ?? 'unknown').replace(/_/g, ' ')} · ${row.sha?.slice(0, 8) ?? ''}`))
    .when(Boolean(pin.note), el => el.child(div().truncate().text_size(10).text_color(pin.stale ? t.working : t.dim).tooltip(pin.note).child(pin.note)))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).opacity(p.outdated ? 0.4 : 1).child(split(t, p, 2)));
  // Keep the tiny anchor measured before opening, as WATCH details do. Pin the
  // card's right corner to the row's left edge, away from the right window edge.
  return trigger.child(Popup.new(`forge-pipeline-hover-${identity}`, div()).absolute().top(0).left(0).size(1).anchor('top_right')
    .when(shown, popup => popup.content(progressCard(t, row, detail, provider, Date.now(), pin.stale ? pin.note : '', identity).mr(4))));
}
