import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, focused, panes, shared, setShared, props, openOverlay, settings, theme, exec, layout, run } from "herdr";

import { PROVIDERS, sourcesFor, fetchUsage } from "./providers.js";
import { clock, pace, resets, resetsShort } from "./time.js";
import { SCRIPT, parseStats } from "./stats.js";
import { HEIGHT, densityOf, nextDensity, footerModel } from "./footer.js";

const MOD = "omarchy-ai-usage";
const keyOf = id => `${MOD}.${id}`;
const SHOWN = keyOf("shown");
const STATS = keyOf("sysstats");
const DENSITY = keyOf("density");
const STATS_EVERY = 4e3;
const EVERY = 5 * 60e3;
// One missed cycle plus slack, so a slow fetch doesn't flash the bar grey.
const STALE = 12 * 60e3;
const AMBER = "#ffb347", RED = "#ff5d6c";
const PINNED = [["claude", "Claude Code"], ["codex", "Codex"]];
const POPUP_W = 320, GAP = 6;

async function refreshOne(src) {
  if (!src.provider) return;
  const prev = shared(keyOf(src.id)) ?? {};
  const now = new Date().toISOString();
  try {
    setShared(keyOf(src.id), { checked: now, fetched: now, error: null, windows: await fetchUsage(src) });
  } catch (e) {
    setShared(keyOf(src.id), { ...prev, checked: now, error: String(e?.message ?? e) });
  }
}

const shownList = () => shared(SHOWN)?.list ?? [];
const due = src => src.provider && Date.now() - (Date.parse(shared(keyOf(src.id))?.checked ?? "") || 0) >= EVERY;
const refreshAll = (force) => Promise.all(shownList().filter(s => force || due(s)).map(refreshOne));
const isStale = u => !u?.fetched || Boolean(u.error) || Date.now() - Date.parse(u.fetched) > STALE;

// Agent terminals the person sees now, the focused one first. A zoomed pane hides the rest.
function visible() {
  const f = focused();
  if (!f) return [];
  let ps = panes().filter(p => p.tab === f.tab && p.terminal && p.program?.agent);
  if (ps.some(p => p.zoomed)) ps = ps.filter(p => p.zoomed);
  const list = ps.map(p => ({ terminal: p.terminal, program: p.program, focused: p.focused }));
  const block = f.terminal && !list.some(v => v.terminal === f.terminal) && agents().find(a => a.address === f.terminal);
  if (block) list.push({ terminal: block.address, program: block.program, focused: true });
  return list.sort((a, b) => b.focused - a.focused);
}

export default class AiUsage extends View {
  init(_props, cx) {
    if (props()?.overlay) return;
    this.sig = null;
    cx.timer.every(60e3, cx => { cx.spawn(async () => refreshAll()); cx.notify(); });
    // The footer is the one place that shows system stats, so it is the one that polls them.
    if (props()?.footer) cx.timer.every(STATS_EVERY, cx => {
      if (this.polling) return;
      this.polling = true;
      cx.spawn(async () => {
        try {
          const r = await exec("sh", ["-c", SCRIPT]);
          const next = r.code === 0 ? parseStats(r.stdout, shared(STATS)) : null;
          if (next) setShared(STATS, next);
        } catch { /* keep the last reading */ } finally { this.polling = false; }
      });
    });
  }

  // Runs when what's visible changes; keeps the last list when no agent is in view.
  sync(cx) {
    // The footer is not about what is in view: Claude and Codex always show, with the icons of any such agent seen.
    const vis = props()?.footer
      ? PINNED.map(([key, name]) => ({ terminal: key, program: agents().find(a => a.program?.key === key)?.program ?? { key, name, icon: null, tint: null } }))
      : visible();
    const sig = vis.map(v => `${v.terminal}:${v.program.key}:${v.program.icon ?? ""}`).join(",");
    if (sig === this.sig) return;
    this.sig = sig;
    if (!vis.length) { if (shownList().length && !shared(SHOWN)?.idle) setShared(SHOWN, { list: shownList(), idle: true }); return; }
    cx.spawn(async () => {
      const seen = new Set(), list = [];
      for (const v of vis) for (const s of await sourcesFor(v)) if (!seen.has(s.id)) { seen.add(s.id); list.push(s); }
      if (this.sig !== sig) return;
      if (JSON.stringify(shared(SHOWN)) !== JSON.stringify({ list, idle: false })) setShared(SHOWN, { list, idle: false });
      await refreshAll();
    });
  }

  render(cx) {
    if (props()?.overlay) return this.details();
    this.sync(cx);
    if (props()?.footer) return this.footer(cx);
    return props()?.compact ? this.compact() : this.bar();
  }

  // Bottom bar: popup sits above, card pinned to its bottom. Top bar: below, pinned to its top.
  open() {
    const b = this.anchor;
    const z = Number(settings()?.zoom) || 1;
    const list = shownList();
    const rows = list.reduce((n, s) => n + Math.max(1, shared(keyOf(s.id))?.windows?.length ?? 0), 0);
    const want = 90 + list.length * 100 + rows * 75;
    const below = b && b.y / z < 200;
    const height = !b || below ? want : Math.min(want, b.y / z - GAP);
    // The footer's segments sit at the left: the popup opens over the segment, not toward its right edge.
    const x = !b ? 0 : props()?.footer ? Math.max(0, b.x) : Math.max(0, b.x + b.width - (POPUP_W + GAP) * z);
    const at = !b ? undefined : below ? { x, y: b.y + b.height + GAP * z } : { x, y: b.y - (height + GAP) * z };
    openOverlay({ mod: MOD, kind: "popup", frame: "none", width: POPUP_W, height, at, props: { details: true, height, below } });
  }

  icon(s, size, dim) {
    if (!s.icon) return div().size(size).flex_none();
    const el = s.tint ? svg(s.icon).text_color(theme().muted) : image(s.icon);
    return el.size(size).flex_none().opacity(dim ? 0.5 : 1);
  }

  tip(s) {
    const u = shared(keyOf(s.id));
    if (s.note) return `${s.agent}: ${s.note}`;
    const ws = u?.windows ?? [];
    return `${s.agent} (${s.label}): ` + (ws.length
      ? ws.map(w => `${w.long} ${w.used}%, ${resets(w)}`).join("; ") + (u.error ? ` (${u.error})` : "")
      : u?.error ?? (u?.fetched ? "no limits reported" : "loading"));
  }

  shell(el) {
    const t = theme(), edge = props()?.border;
    return el.id("root").size_full().items_center().bg(t.chrome).overflow_hidden()
      .on_size_change((_size, cx) => {
        const narrow = globalThis.window.viewport_size().width < 1024;
        if (narrow !== this.narrow) { this.narrow = narrow; cx.notify(); }
      })
      .when(edge === "top", el => el.border_t(1).border_color(t.border))
      .when(edge === "bottom", el => el.border_b(1).border_color(t.border))
      .on_mouse_down("left", (e, cx) => { this.anchor = e.bounds; cx.stop_propagation(); })
      .on_click(() => this.open())
      .tooltip(shownList().map(s => this.tip(s)).join("\n") || "No agent in view");
  }

  // Orca-style status bar: a segment per provider (click: the usage popup), system stats at the right (click: density).
  footer(cx) {
    const t = theme(), idle = shared(SHOWN)?.idle;
    const narrow = this.narrow ?? globalThis.window.viewport_size().width < 1024;
    const list = shownList();
    const m = footerModel({
      density: shared(DENSITY), narrow, stats: shared(STATS),
      rows: list.map(s => { const u = shared(keyOf(s.id)); return { s, u, stale: idle || isStale(u) }; }),
    });
    this.fit(cx, m.height);
    const expanded = m.density === "expanded", row = expanded ? 24 : m.height;
    const win = (w, p, s) => {
      const c = color(w.w, p.stale, t, s);
      return h_flex().gap(5).items_center().flex_none()
        .child(div().whitespace_nowrap().text_color(t.dim).child(w.short))
        .when(w.bar > 0, el => el.child(div().relative().w(w.bar).h(expanded ? 6 : 5).bg(t.border).child(div().absolute().left(0).top(0).h_full().w(`${w.used}%`).bg(c))))
        .child(div().whitespace_nowrap().text_color(p.stale || w.used >= 80 ? c : t.muted).child(`${w.used}%`))
        .when(Boolean(w.reset), el => el.child(div().whitespace_nowrap().text_size(10.5).text_color(!p.stale && w.used >= 80 ? c : t.dim).child(`↻ ${w.reset}`)));
    };
    const seg = (p, i) => {
      const s = list[i];
      return h_flex().id(`usage-seg-${p.id}`).h(row).gap(6).items_center().flex_none().cursor_pointer()
        .hover(e => e.bg(t.hover)).px(6)
        .tooltip(this.tip(s))
        .on_mouse_down("left", (e, cx) => { this.anchor = e.bounds; cx.stop_propagation(); })
        .on_click(() => this.open())
        .child(this.icon(s, 12, p.stale))
        .child(div().whitespace_nowrap().font_semibold().text_color(p.stale ? t.dim : t.foreground).child(p.label))
        .when(Boolean(p.note), el => el.child(div().whitespace_nowrap().text_color(t.dim).child(p.note)))
        .children(p.windows.map(w => win(w, p, s)));
    };
    const sep = i => div().id(`usage-sep-${i}`).flex_none().text_color(t.border).child("│");
    const providers = m.providers.flatMap((p, i) => (i && !expanded ? [sep(i), seg(p, i)] : [seg(p, i)]));
    const item = it => {
      const hot = it.battery ? it.pct <= 20 && !it.label.startsWith("⚡") : it.pct >= 80;
      return h_flex().gap(4).items_center().flex_none().whitespace_nowrap()
        .child(div().text_color(t.dim).child(it.label))
        .when(Boolean(it.spark), el => el.child(div().text_color(t.dim).child(it.spark)))
        .child(div().text_color(hot ? (it.pct >= 95 || it.battery ? RED : AMBER) : t.muted).child(it.text))
        .when(Boolean(it.detail), el => el.child(div().text_size(10.5).text_color(t.dim).child(it.detail)));
    };
    const rows = expanded ? [m.sys.slice(0, 2), m.sys.slice(2)] : [m.sys];
    const cycle = () => setShared(DENSITY, nextDensity(m.density));
    return h_flex().id("root").size_full().items_center().bg(t.chrome).overflow_hidden().text_size(11).px(6)
      .border_t(1).border_color(t.border)
      .on_size_change((_size, cx) => {
        const n = globalThis.window.viewport_size().width < 1024;
        if (n !== this.narrow) { this.narrow = n; cx.notify(); }
      })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); cycle(); })
      .child(expanded ? v_flex().flex_none().children(providers) : h_flex().gap(8).items_center().flex_none().children(providers))
      .child(div().flex_1())
      .child(v_flex().id("sysstats").flex_none().cursor_pointer().px(6).py(expanded ? 4 : 0)
        .tooltip(`System stats. Click or right-click: density (${m.density})`)
        .on_click(cycle)
        .children(rows.map((r, i) => h_flex().id(`sys-row-${i}`).h(expanded ? 24 : m.height).gap(narrow ? 10 : 14).items_center().justify_end().children(r.map(item)))));
  }

  // The footer's height follows its density. Commands can't run in render, so a moment later.
  fit(cx, px) {
    const cur = find(layout(), "footer")?.size?.px;
    if (cur === undefined || cur === px || this.fitting) return;
    this.fitting = true;
    cx.timer.after(200, () => {
      this.fitting = false;
      run("layout.resize", { id: "footer", px: HEIGHT[densityOf(shared(DENSITY))] });
    });
  }

  bar() {
    const t = theme(), idle = shared(SHOWN)?.idle;
    const rows = shownList().map(s => {
      const u = shared(keyOf(s.id));
      const stale = idle || isStale(u);
      const ws = (u?.windows ?? []).slice(0, 2);
      return h_flex().h(19).gap(6).items_center().flex_none()
        .child(this.icon(s, 13, stale))
        .child(div().w(64).flex_none().whitespace_nowrap().font_semibold().text_color(stale ? t.dim : t.foreground).child(s.label))
        .when(Boolean(s.note) || !ws.length, el => el.child(div().text_color(t.dim).child(s.note ?? (u?.error ? "no data" : u?.fetched ? "no limits" : "…"))))
        .children(ws.map(w => h_flex().gap(4).items_center().flex_none()
          .child(div().text_color(t.dim).child(w.short))
          .child(div().w(70).child(meter(w, stale, t, 5)))
          .child(div().w(28).text_color(stale ? t.dim : w.used >= 80 ? color(w, stale, t) : t.muted).child(`${w.used}%`))
          .child(div().w(78).flex_none().whitespace_nowrap().text_size(11).text_color(!stale && w.used >= 80 ? color(w, stale, t) : t.dim).child(`↻ ${resetsShort(w)}`))));
    });
    return this.shell(h_flex()).pl(12).pr(8).gap(12).text_size(11.8).child(v_flex().gap(2).children(rows));
  }

  // 330px: one provider gets label, bar and two windows; two drop the label; more keep one window each.
  compact() {
    const t = theme(), list = shownList(), idle = shared(SHOWN)?.idle;
    const narrow = this.narrow ?? globalThis.window.viewport_size().width < 1024;
    const n = list.length;
    // Icon, then each window (5h, 7d) as its label, a bar and the percent. The popup has the rest.
    const barW = n === 1 ? 70 : n === 2 ? 48 : 32;
    const segs = list.map(s => {
      const u = shared(keyOf(s.id));
      const stale = idle || isStale(u);
      const [first, second] = u?.windows ?? [];
      const win = (w) => {
        const c = color(w, stale, t, s);
        return h_flex().gap(5).items_center().flex_none()
          .child(div().whitespace_nowrap().text_color(t.dim).child(w.short))
          // Narrow windows: no bar, the percent carries the color instead.
          .when(!narrow, el => el.child(div().relative().w(barW).h(6).bg(t.border).child(div().absolute().left(0).top(0).h_full().w(`${clamp(w.used)}%`).bg(c))))
          .child(div().whitespace_nowrap().text_color(narrow || stale || w.used >= 80 ? c : t.muted).child(`${w.used}%`));
      };
      return h_flex().gap(6).items_center().flex_none()
        .child(this.icon(s, 12, stale))
        .when(Boolean(s.note) || !first, el => el.child(div().whitespace_nowrap().text_color(t.dim).child(s.note ?? (u?.error ? "no data" : u?.fetched ? "no limits" : "…"))))
        .when(Boolean(first), el => el.child(win(first)))
        .when(Boolean(second), el => el.child(win(second)));
    });
    // The same │ the bar puts between space and folder, only between segments.
    const sep = i => div().id(`usage-sep-${i}`).flex_none().text_color(t.border).child("│");
    return this.shell(h_flex()).when(narrow, el => el.justify_end(), el => el.justify_center()).px(10).gap(narrow ? 10 : 14).text_size(11).children(segs.flatMap((seg, i) => (i ? [sep(i), seg] : [seg])));
  }

  details() {
    const t = theme(), idle = shared(SHOWN)?.idle, list = shownList();
    const section = s => {
      const u = shared(keyOf(s.id));
      const stale = idle || isStale(u);
      const footer = s.note ?? (!u?.fetched ? (u?.error ?? "not fetched yet")
        : u.error ? `fetch failed: ${u.error} · data from ${clock(Date.parse(u.fetched))}`
        : `updated ${clock(Date.parse(u.fetched))}`);
      return v_flex().gap(10).p(10).rounded(0).border(1).border_color(stale ? t.border : t.input)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(this.icon(s, 14, stale))
          .child(div().flex_none().text_size(12.5).font_bold().text_color(t.foreground).child(title(s)))
          .when(Boolean(s.sub), el => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(s.sub))))
        .children((u?.windows ?? []).map(w => v_flex().gap(6)
          .child(h_flex().justify_between().items_end()
            .child(div().text_color(t.foreground).child(w.long))
            .child(div().text_size(18).font_semibold().text_color(color(w, stale, t, s)).child(`${w.used}%`)))
          .child(meter(w, stale, t, 6, s))
          .child(div().text_size(11.5).text_color(t.dim).child(resets(w)))))
        .child(div().text_size(11.5).text_color(u?.error ? t.blocked : t.dim).child(footer));
    };
    return v_flex().w_full().h(props().height ?? 0).when(!props().below, el => el.justify_end()).child(v_flex().w_full().p(14).gap(14).text_size(12).text_color(t.muted)
      .bg(t.popover).border(1).border_color(t.border).rounded(0)
      .child(h_flex().justify_between().items_center()
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child(idle ? "AI usage (last seen)" : "AI usage"))
        .child(div().id("refresh").px(6).py(2).rounded(0).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => cx.spawn(async () => refreshAll(true))).child("Refresh")))
      .when(!list.length, el => el.child(div().text_color(t.dim).child("No agent in view")))
      .children(list.map(section)));
  }
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const clamp = v => Math.min(100, Math.max(0, v ?? 0));
// "Codex · codex" says it twice; add the label only when it names something more (a Claude account, "pi").
const title = s => {
  const name = s.provider ? PROVIDERS[s.provider].name : s.label;
  return s.provider && s.label.toLowerCase() !== name.toLowerCase() ? `${name} · ${s.label}` : name;
};

// Each provider's own brand color (Claude clay, Codex blue, Copilot purple) until it nears its limit.
function color(w, stale, t, s) {
  if (stale) return t.dim;
  if (w.used >= 95) return RED;
  if (w.used >= 80) return AMBER;
  return PROVIDERS[s?.provider]?.color ?? t.accent;
}

// The elapsed share of the window is drawn as a ghost fill: lit past it means running ahead of pace.
function meter(w, stale, t, height, s) {
  const ghost = stale ? null : pace(w);
  return div().relative().w_full().h(height).rounded(0).bg(t.border)
    .when(ghost !== null, el => el.child(div().absolute().left(0).top(0).h_full().w(`${ghost * 100}%`).rounded(0).bg(t.dim).opacity(0.35)))
    .child(div().absolute().left(0).top(0).h_full().w(`${clamp(w.used)}%`).rounded(0).bg(color(w, stale, t, s)));
}
