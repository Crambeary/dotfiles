// A pipeline Watch on its row (ticket 08, option C): a 2px hairline along the row's bottom split by job count, a mark by
// the age, and on hover a detail card. Observations come from the Waiting observer (omarchy-watch) through
// shared("omarchy-waiting.obs"); this only reads them. An ended Watch keeps its last one, frozen (ticket 13).
// Colours are waiting.js's waitColors only: green passed, yellow running / waiting for a runner / outdated, red failed.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { shared } from "herdr";
import { parseRef, age, isStale, waitColors } from "./waiting.js";
import { OBS_KEY, refKey, reading, phaseOf, stagesDone, barOf, stageWord, stageActive } from "./pipeline.js";

const PULSE = /** @type {const} */ ({ from: 0.35, to: 1, period: 1200 });
const BAR_W = 246;

// A Watch's pipeline as the row shows it: null for a Watch without a ref. `live`: false once the Watch has ended, so its
// observation is shown as it was, never outdated (ticket 13).
export function pipelineOf(w, now, live = true) {
  const p = w && parseRef(w.ref);
  if (!p) return null;
  const obs = shared(OBS_KEY);
  return { p, live, ...reading(obs && typeof obs === "object" ? obs[refKey(p)] : null, now, live) };
}

const GLYPH = { running: "●", queued: "○", passed: "✓", failed: "✗", manual: "○" };
const WORD = { running: "Running", queued: "Waiting for a runner", passed: "Passed", failed: "Failed", manual: "Waiting on a manual job" };
const phaseColor = (wc, phase) => ({ running: wc.run, queued: wc.run, passed: wc.pass, failed: wc.fail })[phase] ?? wc.stale;

// The split, as percentages of a full-width track: passed (with skipped), failed, running (pulsing), waiting for a runner.
function split(t, rd, h) {
  const wc = waitColors(t), track = h_flex().h(h).w_full().overflow_hidden().bg(t.foreground + "14");
  if (rd.state !== "pipeline") return track;
  const b = barOf(rd.result), pct = (x) => `${Math.round(x * 1000) / 10}%`;
  return track
    .child(div().h(h).flex_none().w(pct(b.pass)).bg(wc.pass))
    .child(div().h(h).flex_none().w(pct(b.fail)).bg(wc.fail))
    .child(div().h(h).flex_none().w(pct(b.run)).bg(wc.run).loop("opacity", PULSE))
    .child(div().h(h).flex_none().w(pct(b.wait)).bg(wc.run + "66"));
}

// The row's hairline: absolute along its bottom. Outdated dims it; a stale Watch dims it with the rest of the row.
export const hairline = (t, rd, stale) => div().absolute().left(0).right(0).bottom(0).h(2)
  .opacity((rd.outdated ? 0.4 : 1) * (stale ? 0.5 : 1)).child(split(t, rd, 2));

// The mark by the age: `● 3/5`, `○ 1/5`, `✓ 3/3`, `✗ 3/3`; outdated dim with a yellow `!`; unavailable `?`; awaiting `○ –`.
export function pipelineMark(t, rd, mono) {
  const wc = waitColors(t), mark = h_flex().gap(3).flex_none().items_center().text_size(11).font_family(mono);
  if (rd.state === "unavailable") return mark.text_color(wc.stale).child("?");
  if (rd.state === "awaiting") return mark.text_color(wc.stale).child("○ –");
  const r = rd.result, ph = phaseOf(r), s = stagesDone(r);
  return mark.text_color(rd.outdated ? wc.stale : phaseColor(wc, ph)).child(GLYPH[ph]).child(`${s.done}/${s.total}`)
    .when(rd.outdated, (el) => el.child(div().text_color(wc.run).child("!")));
}

const clock = (ms) => new Date(ms).toTimeString().slice(0, 5);
// Seconds too, for an observation's age: 12s, 4m, 1h.
const ago = (ms, now) => (now - ms < 60000 ? `${Math.max(0, Math.floor((now - ms) / 1000))}s` : age(ms, now));
const target = (rd) => {
  const p = rd.p, r = rd.result?.kind === "pipeline" ? rd.result : null;
  const where = p.kind === "mr" ? `${p.project} !${p.iid}` : p.project;
  return r ? `Pipeline #${r.iid ?? r.id} · ${where}` : p.kind === "mr" ? `MR · ${where}` : `Pipeline #${p.iid} · ${where}`;
};

// The card's title and lines, for details.js's detailsCard. `w` the Watch, `name` its agent's title.
// `rd` null: a plain Watch, with no MR or pipeline link.
export function pipelineCard(t, rd, w, name, now, mono) {
  const wc = waitColors(t), stale = rd?.live !== false && isStale(w, now);
  const small = (color, text) => div().text_size(11).text_color(color).child(text);
  const watchLine = rd?.live === false
    ? small(wc.stale, `Watch ended · since ${clock(w.since)} · ${name}`)
    : small(stale ? wc.stale : t.muted, `${stale ? "Stale" : "Waiting"} ${age(w.since, now)} · since ${clock(w.since)} · ${name}`);
  const head = (color, glyph, word, extra) => h_flex().gap(6).items_center().text_color(color)
    .child(div().flex_none().child(glyph)).child(div().flex_none().child(word))
    .when(Boolean(extra), (el) => el.child(div().min_w(0).truncate().font_normal().text_color(wc.stale).child(`· ${extra}`)));
  const box = (tint, title, titleColor, body) => v_flex().gap(1).px(6).py(4).bg(tint).text_size(11)
    .child(div().font_medium().text_color(titleColor).child(title))
    .when(Boolean(body), (el) => el.child(div().text_color(t.muted).child(body)));

  if (!rd) return { title: head(wc.wait, "◷", "Waiting"), lines: [watchLine,
    small(wc.stale, "This Watch has no MR or pipeline link, so there's no progress to show.")] };
  if (rd.state === "unavailable") return { title: head(wc.stale, "?", "Progress unavailable"), lines: [small(t.muted, target(rd)), watchLine,
    box(t.foreground + "0f", "No observation yet", t.muted, rd.problem ?? (rd.live ? "Asking GitLab…" : null))] };
  const seen = rd.live ? `Observed ${ago(rd.at, now)} ago` : `Observed ${ago(rd.at, now)} ago (${clock(rd.at)}) · no longer refreshed`;
  if (rd.state === "awaiting") return { title: head(wc.stale, "○", "Awaiting pipeline"), lines: [small(t.muted, target(rd)), watchLine,
    small(t.muted, `The MR's new head ${rd.result.head} has no pipeline yet. The previous pipeline's result no longer applies.`),
    small(wc.stale, seen)] };

  const r = rd.result, ph = phaseOf(r), s = stagesDone(r), c = r.counts, out = rd.outdated;
  const total = Math.max(0, c.all - c.manual);
  const stat = (n, label, color) => h_flex().gap(4).items_center().child(div().font_family(mono).text_color(color).child(String(n))).child(div().text_color(wc.stale).child(label));
  const square = (status) => {
    const base = div().size(8).flex_none();
    if (status === "success" || status === "skipped") return base.bg(wc.pass);
    if (status === "failed" || status === "canceled") return base.bg(wc.fail);
    if (stageActive(status)) return base.bg(wc.run).loop("opacity", PULSE);
    if (status === "pending" || status === "waiting_for_resource") return base.border(1).border_color(wc.run);
    return base.bg(t.foreground + "26");
  };
  const stageLine = (name, status, key) => h_flex().id(key).gap(6).items_center().text_size(11)
    .child(square(status))
    .child(div().flex_1().min_w(0).truncate().text_color(status === "created" ? wc.stale : t.muted).child(name))
    .child(div().flex_none().text_color(wc.stale).child(stageWord(status)));
  const ds = (r.downstream ?? []).map((d, i) => stageLine(`↳ ${d.project?.split("/").pop() ?? "downstream"} #${d.iid ?? d.id}`, String(d.status ?? "").toLowerCase(), `ds-${i}`));
  const progress = v_flex().gap(4).opacity(out ? 0.55 : 1)
    .child(div().w(BAR_W).child(split(t, rd, 6)))
    .child(h_flex().gap(10).text_size(11)
      .child(stat(`${c.done}/${total}`, "jobs done", t.foreground))
      .child(stat(c.ok, "passed", c.ok ? wc.pass : wc.stale))
      .child(stat(c.bad, "failed", c.bad ? wc.fail : wc.stale)))
    .when(c.run + c.wait > 0, (el) => el.child(h_flex().gap(10).text_size(11)
      .child(stat(c.run, "running", c.run ? wc.run : wc.stale))
      .child(stat(c.wait, "waiting for a runner", c.wait ? wc.run : wc.stale))))
    .child(v_flex().gap(1).mt(2).children(r.stages.map((x, i) => stageLine(x.name, x.status, `stage-${i}`))).children(ds)
      .when(Boolean(r.more), (el) => el.child(small(wc.stale, "and more downstream"))));
  const obsLine = out
    ? box(wc.run + "1f", `Outdated · observed ${ago(rd.at, now)} ago (${clock(rd.at)})`, wc.run, rd.problem ?? `no successful refresh for ${ago(rd.at, now)}`)
    : small(wc.stale, seen);
  return { title: head(out ? wc.stale : phaseColor(wc, ph), GLYPH[ph], WORD[ph], s.total ? `stage ${s.at} of ${s.total}` : null),
    lines: [small(t.muted, target(rd)), watchLine, progress, obsLine] };
}
