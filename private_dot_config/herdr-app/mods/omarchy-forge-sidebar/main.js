import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { checking, exec, spaces, panes, focused, layout, theme, run, shared, setShared, nextCommand } from "herdr";
import { visible, contextOf, contextKey, projectOf, versionArgs, validateBackend, readArgs, parseReply } from "./context.js";
import { jobsArgs } from "./context.js";
import { LIVE } from "./progress.js";
import { PINS, arrange, readPins, pinKey, pinnedIn, togglePin, validId } from "./pins.js";
import { pipelineRow, progressCard } from "./progress-view.js";
import { pinReadArgs, parsePinReply } from "./pin-reader.js";
import { PinSchedule, readPool, reserve, release, cadence } from "./pin-refresh.js";

const ID = "forge-sidebar", VIEW = "omarchy-forge-sidebar.view";
const viewOf = () => shared(VIEW) === "pipelines" ? "pipelines" : "requests";
const whereNow = () => contextOf(spaces(), panes(), focused());
const age = at => !at ? "" : `${Math.max(0, Math.floor((Date.now() - at) / 60000))}m ago`;
const message = e => String(e?.message ?? e);

export default class ForgeSidebar extends View {
  init(_props, cx) {
    this.rows = [];
    this.ticket = 0;
    this.key = null;
    this.last = 0;
    this.shown = false;
    this.jobs = new Map();
    this.jobAttempts = new Map();
    // Newest observation of each pinned row (pinKey -> {row, at}); in memory only.
    // It reaches shared state with the next pin/unpin, never on refresh or render.
    this.seen = new Map();
    this.listedKey = null;
    this.jobBudget = readPool();
    this.pinSchedule = new PinSchedule();
    if (checking()) return;
    // Hidden mods stay alive. Only the shown sidebar and selected list fetch.
    this.timer = cx.timer.every(1000, cx => {
      const shown = visible(layout(), ID);
      const opened = shown && !this.shown;
      if (!shown && this.shown) { this.ticket++; this.loading = false; this.clearHover(); this.pinSchedule.hide(); }
      this.shown = shown;
      this.pinSchedule.sync(shared(PINS));
      if (!shown) return;
      if (this.preferJobs && this.key === this.currentKey() && viewOf() === "pipelines" && this.project && !this.loading) this.enrich(cx, this.project,
        () => !this.closed && this.key === this.currentKey() && visible(layout(), ID));
      this.refreshPins(cx);
      const key = this.currentKey();
      if (opened || key !== this.key || (!this.loading && Date.now() - this.last >= 60000)) this.refresh(cx);
    });
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "requests" || command === "pipelines") this.select(command, cx);
        else if (command === "refresh") this.refresh(cx, true);
        cx.notify();
      }
    });
  }

  currentKey() { return `${contextKey(whereNow())}:${viewOf()}`; }

  close() { this.closed = true; this.timer?.cancel(); this.pinSchedule.hide(); }

  refreshPins(cx) {
    if (checking() || this.closed || !visible(layout(), ID)) return;
    this.pinSchedule.sync(shared(PINS));
    const pick = this.pinSchedule.pick(Date.now());
    if (!pick) return;
    const token = reserve(this.jobBudget, Date.now(), 2);
    if (!token) { pick.ref.inflight = false; return; }
    const { key, id, project } = pick.ref;
    const current = () => {
      this.pinSchedule.sync(shared(PINS));
      if (!visible(layout(), ID)) { this.pinSchedule.hide(); return false; }
      return !this.closed && this.jobBudget.busy === token && this.pinSchedule.accepts(pick);
    };
    cx.spawn(async cx => {
      let result = {}, phase = "status";
      try {
        // No cwd: identity/auth/backend all belong to project.on. Missing
        // remote capability is an error, never a request on this computer.
        const out = await exec("python3", pinReadArgs(project, id, pick.age), { on: project.on, timeout: 30000 });
        if (!current()) return;
        result = parsePinReply(out, id);
        const previous = this.seen.get(key) ?? { row: pick.ref.row, at: pick.ref.seenAt, observed: false };
        const newer = result.at && result.at >= (previous?.at ?? 0);
        if (result.at && !newer) result.error ||= "Origin reply predates saved observation.";
        const beforeRow = previous?.row ?? pick.ref.row;
        const changed = beforeRow?.status !== result.row.status || beforeRow?.updated_ms !== result.row.updated_ms;
        this.seen.set(key, { ...previous, ...(newer ? result : {}),
          statusSince: newer && changed ? result.at : previous?.statusSince ?? 0,
          error: result.error || (!result.at ? "Pipeline observation has no timestamp." : null), observed: Boolean(newer || previous?.observed) });
        cx.notify();
        // A hidden sidebar or removed/re-pinned pin cannot start this second
        // network phase. An already running process is allowed to finish.
        if (result.error || !result.at || !current()) return;
        phase = "jobs";
        const jobs = await exec("python3", pinReadArgs(project, id, pick.age, "jobs"), { on: project.on, timeout: 30000 });
        if (!current()) return;
        const detail = parsePinReply(jobs, id, "jobs");
        const status = this.seen.get(key), before = status?.jobsEntry;
        result.jobsError = detail.error || (!detail.at ? "Job observation has no timestamp." : null)
          || (detail.at < status.statusSince ? "Job observation predates changed pipeline status." : null);
        const freshJobs = detail.at && detail.at >= (before?.at ?? 0);
        this.seen.set(key, { ...status, jobsEntry: {
          ...(before ?? {}), ...(freshJobs ? { jobs: detail.jobs, at: detail.at, status: result.row.status, updated_ms: result.row.updated_ms } : {}),
          error: result.jobsError } });
      } catch (e) {
        const error = message(e);
        if (phase === "jobs") result.jobsError = error; else result.error = error;
        if (current()) {
          const previous = this.seen.get(key);
          this.seen.set(key, phase === "jobs" ? { ...previous, jobsEntry: { ...previous?.jobsEntry, error } } : { ...previous, error });
        }
      } finally {
        if (current()) this.pinSchedule.finish(pick, result, Date.now());
        release(this.jobBudget, token);
        this.preferJobs = true;
        cx.notify();
      }
    });
  }

  select(view, cx) {
    setShared(VIEW, view);
    this.refresh(cx);
    cx.notify();
  }

  refresh(cx, force = false) {
    if (checking() || !visible(layout(), ID)) return;
    const where = whereNow(), view = viewOf(), key = this.currentKey();
    if (this.loading && this.key === key) return;
    const ticket = ++this.ticket;
    if (key !== this.key) { this.rows = []; this.project = null; this.at = 0; this.jobs.clear(); this.jobAttempts.clear(); this.clearHover(); }
    this.key = key;
    this.error = null;
    this.last = Date.now();
    this.loading = Boolean(where);
    if (!where) { cx.notify(); return; }
    cx.notify();
    // Recheck both context and visibility after each async boundary: old replies
    // cannot populate a new space, a different view, or a hidden sidebar.
    const current = () => ticket === this.ticket && key === this.currentKey() && visible(layout(), ID);
    cx.spawn(async cx => {
      try {
        const remote = await exec("git", ["remote", "get-url", "origin"], { cwd: where.cwd, on: where.on, timeout: 10000 });
        if (!current()) return;
        if (remote.code !== 0) throw new Error("No origin remote here. Select a terminal in a GitLab or GitHub checkout.");
        const project = projectOf(remote.stdout, where);
        this.project = project;
        cx.notify();
        const backend = await exec("sh", versionArgs(), { cwd: where.cwd, on: project.on, timeout: 10000 });
        if (!current()) return;
        validateBackend(backend);
        const result = await exec("sh", readArgs(project, view, force), { cwd: where.cwd, on: project.on, timeout: 30000 });
        if (!current()) return;
        const out = parseReply(result, view);
        this.rows = out.rows;
        this.at = out.at;
        this.listedKey = key;
        if (view === "pipelines") {
          const pinned = pinnedIn(shared(PINS), project);
          for (const r of out.rows) if (pinned.has(r.id)) {
            const key = pinKey(project, r.id), previous = this.seen.get(key);
            const changed = previous?.row?.status !== r.status || previous?.row?.updated_ms !== r.updated_ms;
            if (out.at && out.at > (previous?.at ?? 0)) this.seen.set(key, { ...previous, row: r, at: out.at,
              statusSince: changed ? out.at : previous?.statusSince ?? 0, error: out.error, observed: true });
          }
        }
        this.error = out.error ? `${out.rows.length ? "Refresh failed; showing cached results. " : ""}${out.error}` : null;
        if (view === "pipelines") this.enrich(cx, project, current);
      } catch (e) {
        if (current()) this.error = message(e);
      } finally {
        if (ticket === this.ticket) { this.loading = false; this.last = Date.now(); }
        cx.notify();
      }
    });
  }

  clearHover() {
    this.hoverDelay?.cancel();
    this.hoverWatch?.cancel();
    this.hovered = this.details = this.hoverBox = null;
  }

  hoverRow(row, on, cx, identity = row.id) {
    if (!on && this.hovered !== identity) return;
    this.clearHover();
    if (on) {
      this.hovered = identity;
      const key = this.currentKey();
      this.hoverDelay = cx.timer.after(150, cx => {
        if (key === this.currentKey() && visible(layout(), ID) && this.hovered === identity) this.details = identity;
        cx.notify();
      });
      // As WATCH details: a row disappearing or a suppressed pointer-leave must
      // not strand its popup. This watcher exists only while a row is hovered.
      this.hoverWatch = cx.timer.every(100, cx => {
        const p = globalThis.window?.mouse_position?.(), b = this.hoverBox;
        if (key !== this.currentKey() || !visible(layout(), ID) || !(typeof identity === "string" ? readPins(shared(PINS)).some(e => pinKey({ on: e.project[0], host: e.project[1], repo: e.project[2] }, e.id) === identity)
          : this.rows.some(r => r.id === row.id) || (this.project && pinnedIn(shared(PINS), this.project).has(row.id)))
          || (p && b && !(p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height))) {
          this.clearHover(); cx.notify();
        }
      });
    }
    cx.notify();
  }

  // Local unpinned enrichment shares the four-read rolling budget and serial
  // lease with exact pin reads. Forge retains its existing 60s jobs cache and
  // host backoff; oldest attempts rotate. WATCH is unchanged.
  enrich(cx, project, current) {
    if (this.jobsBusy) return;
    // Pins use the independent exact-ID status/jobs scheduler above. Local
    // list enrichment never spends extra reads on them or guesses status.
    const pinned = pinnedIn(shared(PINS), project);
    const picks = this.rows.filter(p => validId(p.id) && !pinned.has(p.id) && Date.now() - (this.jobAttempts.get(p.id) ?? 0) >= 60000)
      .sort((a, b) => (a.id === this.hovered ? -1 : b.id === this.hovered ? 1 :
        Number(pinned.has(b.id)) - Number(pinned.has(a.id)) ||
        Number(LIVE.has(b.status)) - Number(LIVE.has(a.status)) ||
        (this.jobAttempts.get(a.id) ?? 0) - (this.jobAttempts.get(b.id) ?? 0)))
      .slice(0, 4);
    if (!picks.length) return;
    this.preferJobs = false;
    this.jobsBusy = true;
    cx.spawn(async cx => {
      try {
        for (const row of picks) {
          if (!current()) break;
          const token = reserve(this.jobBudget, Date.now(), 1);
          if (!token) break;
          this.jobAttempts.set(row.id, Date.now());
          try {
            const result = await exec("sh", jobsArgs(project, row.id), { cwd: whereNow().cwd, on: project.on, timeout: 30000 });
            if (!current()) break;
            const out = parseReply(result, "jobs");
            this.jobs.set(row.id, { jobs: out.rows, at: out.at, error: out.error, status: row.status, updated_ms: row.updated_ms });
          } catch (e) {
            if (!current()) break;
            this.jobs.set(row.id, { ...this.jobs.get(row.id), error: message(e) });
          } finally { release(this.jobBudget, token); }
          cx.notify();
        }
      } finally { this.jobsBusy = false; cx.notify(); }
    });
  }

  // The only setShared writes besides the view choice: one per pin/unpin click.
  togglePin(row, cx, project = this.project) {
    if (!project || !validId(row?.id)) return;
    this.pinAt = Date.now();
    setShared(PINS, togglePin(shared(PINS), project, row, this.seen, this.pinAt));
    this.pinSchedule.sync(shared(PINS));
    cx.notify();
  }

  // Exported through the view for isolated native renderer fixtures too.
  progressCard(row, t = theme(), provider = this.project?.provider) {
    return progressCard(t, row, this.jobs.get(row.id), provider);
  }

  open(url) {
    if (!/^https?:\/\//.test(url ?? "")) return;
    exec("open", [url]).catch(() => exec("xdg-open", [url]).catch(() => {}));
  }

  render() {
    const t = theme(), view = viewOf(), fresh = this.key === this.currentKey();
    const project = fresh ? this.project : null;
    const loading = !fresh || this.loading, error = fresh ? this.error : null;
    // The pinned pipeline shelf survives every space/list view, even before
    // origin resolution or in a folder with no origin. Unpinned lists stay local.
    const listed = view === "pipelines" && fresh && this.listedKey === this.key;
    const items = arrange(view === "pipelines" && fresh ? this.rows : [], shared(PINS), project, this.seen, listed, this.at);
    if (view === "requests" && fresh) items.push(...this.rows.map(row => ({ row, pinned: false, stale: false })));
    const rows = items.map(i => i.row);
    const control = (id, label, action, tip = label) => div().id(id).px(8).py(5).flex_none().cursor_pointer()
      .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(action).child(label);
    const title = view === "pipelines" ? "Pipelines" : project?.provider === "github" ? "Pull requests" : "Merge requests";
    const color = status => ({ success: t.done, failed: t.blocked, running: t.working, pending: t.working, manual: t.accent }[status] ?? t.dim);
    const empty = !whereNow() ? "Select a space with a repository."
      : loading ? "Loading…" : view === "requests" ? "No open merge requests." : "No recent pipelines.";
    return v_flex().id("omarchy-forge-sidebar").size_full().min_h(0).bg(t.chrome).text_color(t.foreground).text_size(12)
      .child(h_flex().h(34).flex_none().items_center().border_b(1).border_color(t.border).pl(10)
        .child(div().flex_1().font_semibold().child("Forge"))
        .child(control("forge-sidebar-refresh", loading ? "…" : "↻", (_e, cx) => this.refresh(cx, true), "Refresh this list"))
        .child(control("forge-sidebar-close", "×", () => run("layout.hide", { id: ID }), "Hide merge requests and pipelines")))
      .child(v_flex().px(10).py(8).gap(3).flex_none()
        .child(div().truncate().tooltip(project ? `${project.host}/${project.repo}` : "Follows the active space's terminal repository")
          .child(project?.repo ?? "Current space"))
        .child(div().truncate().text_size(10).text_color(t.dim)
          .child(project ? `${project.host} · ${project.on ?? "this computer"}` : "GitLab / GitHub")))
      .child(h_flex().flex_none().border_b(1).border_color(t.border)
        .children([["requests", project?.provider === "github" ? "PRs" : "MRs"], ["pipelines", "Pipelines"]].map(([id, label]) =>
          div().id(`forge-sidebar-${id}`).flex_1().py(7).flex().justify_center().cursor_pointer()
            .bg(view === id ? t.selected : t.chrome).text_color(view === id ? t.accent : t.muted)
            .hover(s => s.bg(t.hover)).on_click((_e, cx) => this.select(id, cx)).child(label))))
      .child(h_flex().px(10).py(7).items_center().flex_none().text_size(10).text_color(t.dim)
        .child(div().flex_1().child(`${title}${rows.length ? ` · ${rows.length}` : ""}`))
        .child(div().child(loading ? "Updating…" : fresh ? age(this.at) : "")))
      .when(Boolean(error), el => el.child(div().px(10).py(8).text_color(t.blocked).child(error)))
      .child(v_flex().id(`forge-sidebar-${view}-list`).flex_1().min_h(0).overflow_y_scrollbar().px(5).gap(3)
        .when(!rows.length && !error, el => el.child(div().px(5).py(12).text_color(t.muted).child(empty)))
        .children(items.map(({ row, project: origin, key, pinned, stale, foreign, unconfirmed, seenAt, observation }) => {
          const pipeline = pinned || view === "pipelines", status = pipeline ? row.status : row.ci?.status;
          // A request list and foreign project can share this numeric pipeline
          // ID. Only a confirmed local pipeline row can consume local jobs.
          const identity = foreign || view === "requests" ? key : row.id;
          const detail = pinned ? observation?.jobsEntry : this.jobs.get(row.id);
          const entry = detail && { ...detail, ...(pinned ? { maxAge: cadence(row) + 30000 } : {}),
            error: detail.error || observation?.error || (stale ? "Pipeline status is outdated." : null) };
          const note = pinned ? `${stale ? observation?.error || (foreign ? "Cached pin from another project" : unconfirmed ? "Cached pin, list not confirmed" : "Not in Forge's recent list") : "Status observed"}${seenAt ? ` · seen ${age(seenAt)}` : ""}.${stale ? " Status may have changed." : ""}` : "";
          if (pipeline) return pipelineRow(t, row, entry, origin?.provider,
            (_e, cx) => { if (Date.now() - (this.pinAt ?? 0) < 300) return; this.clearHover(); cx.notify(); this.open(row.url); },
            (on, cx) => this.hoverRow(row, on, cx, identity),
            this.details === identity && visible(layout(), ID), e => { this.hoverBox = e.bounds; },
            { pinned, stale, identity, observed: Boolean(observation?.observed), origin: pinned ? `${origin.host}/${origin.repo} · ${origin.on ?? "this computer"}` : null,
              toggle: (_e, cx) => this.togglePin(row, cx, origin),
              note });
          const prefix = project?.provider === "github" ? "#" : "!";
          return v_flex().id(`forge-sidebar-row-${row.id ?? row.iid}`).px(8).py(8).gap(5)
            .bg(t.surface).cursor_pointer().hover(s => s.bg(t.hover))
            .tooltip("Open in browser").on_click(() => this.open(row.url))
            .child(h_flex().gap(6).items_center()
              .child(div().flex_none().text_color(status ? color(status) : t.accent)
                .child(pipeline ? `#${row.iid ?? row.id}` : `${prefix}${row.iid}`))
              .child(div().flex_1().min_w(0).truncate().child(pipeline ? row.ref ?? "Pipeline" : row.title ?? "Untitled"))
              .when(Boolean(row.draft), el => el.child(div().text_size(10).text_color(t.dim).child("Draft"))))
            .child(div().truncate().text_size(10).text_color(t.muted)
              .child(pipeline ? `${(status ?? "unknown").replace(/_/g, " ")} · ${row.sha?.slice(0, 8) ?? ""}`
                : `${row.author ?? ""}${row.source ? ` · ${row.source}` : ""}${status ? ` · ${status}` : ""}`));
        })))
      .child(h_flex().flex_none().mt(6).border_t(1).border_color(t.border).justify_end()
        .child(control("forge-sidebar-full", "Open Forge ↗", () => run("mod.open", { name: "forge-window" }), "Open the existing Forge interface")));
  }
}
