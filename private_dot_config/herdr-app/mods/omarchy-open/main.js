// Pick a space, then a terminal or an installed agent to open there; or choose a machine and folder for a new space.
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, spaces, machines, panes, knownAgents, run, exec, closeOverlay, props, home, shared, setShared } from "herdr";
import { projectMark, placeOf, newTab } from "./project.js";
import { step, scrollList } from "./list.js";
import { keyLabel } from "./tip.js";
import { stopsInit, stopsEnd, stop, focusRoot } from "./focus.js";

const ROW = 48;
const LIST_MAX = 420 - 2 - 48 - 8 - 28 - 8 - 41;
const STATE = { ready: "Connected", loading: "Loading…", unavailable: "Unavailable" };
// The agents each machine last reported, shared with the New tab menu (new-menu-wt) so either shows them at once.
const KNOWN = "new-menu.agents";
const isPath = (s) => s.startsWith("/") || s.startsWith("~");
const basename = (s) => s.replace(/\/+$/, "").split("/").pop() || "/";
// Paths are positional arguments, never shell source. Expand home on the target,
// without eval (quotes, dollar signs and command substitutions stay literal).
const EXPAND = `p=$1
case "$p" in
  '~') p=$HOME ;;
  '~/'*) p="$HOME/\${p#??}" ;;
  /*) ;;
  *) exit 2 ;;
esac
`;
const DIRECTORIES = EXPAND + `case "$p" in
  */) dir=$p; partial= ;;
  *) dir=\${p%/*}/; partial=\${p##*/} ;;
esac
[ -d "$dir" ] && [ -r "$dir" ] && [ -x "$dir" ] || exit 1
for f in "$dir"* "$dir".[!.]* "$dir"..?*; do
  [ -d "$f" ] || continue
  name=\${f##*/}
  case "$name" in "$partial"*) printf '%s\\0' "$f" ;; esac
done
`;
const DIRECTORY = EXPAND + '[ -d "$p" ] && cd -P -- "$p" && printf "%s" "$PWD"';

export default class OpenMenu extends View {
  init(_props, cx) {
    stopsInit(this, cx, "modal");
    this.page = "spaces";
    this.at = 0;
    this.filter = "";
    this.generation = 0;
    this.suggestions = [];
    const field = (placeholder) => {
      const input = InputState.new({ placeholder });
      input.on("change", (_e, cx) => { this.filter = input.value(); this.at = 0; cx.notify(); });
      input.on("submit", (_e, cx) => this.choose(this.items()[this.at], cx));
      return input;
    };
    this.spaceInput = field("Search spaces…");
    this.machineInput = field("Search machines…");
    this.startInput = field("Terminal or agent…");
    this.folderInput = InputState.new({ placeholder: "Folder on this machine: / or ~/…" });
    this.folderInput.on("change", (_e, cx) => this.loadFolders(cx));
    this.folderInput.on("submit", (_e, cx) => {
      if (this.at >= 0) this.fill(this.items()[this.at], cx);
      else this.createSpace(cx);
    });
    this.activeInput().focus();
  }

  activeInput() { return this.page === "folder" ? this.folderInput : this.page === "machines" ? this.machineInput : this.page === "start" ? this.startInput : this.spaceInput; }

  // What a new tab in the picked space can start: a terminal, then the agents installed on its machine, as New tab offers.
  loadAgents(cx) {
    const machine = this.space?.machine ?? null, where = machine ?? "";
    this.agents = (shared(KNOWN)?.[where] ?? []).filter(a => a.installed);
    this.agentsChecked = false;
    const request = this.generation;
    cx.spawn(async cx => {
      try {
        const all = await knownAgents({ on: machine });
        setShared(KNOWN, { ...shared(KNOWN), [where]: all });
        if (request !== this.generation) return;
        this.agents = all.filter(a => a.installed);
      } catch { if (request !== this.generation) return; }
      this.agentsChecked = true;
      cx.notify();
    });
  }

  startRows() {
    const s = this.space;
    if (!s) return [];
    return [{ key: "start:terminal", start: "terminal", name: "Terminal", sub: `New tab in ${s.name}` },
      ...(this.agents ?? []).map(a => ({ key: `start:${a.key}`, start: "agent", agent: a, name: a.name, sub: `Start ${a.name} in ${s.name}` }))];
  }

  start(item) {
    const s = this.space;
    closeOverlay(props().overlay);
    if (item.start === "terminal") newTab(s);
    else run("tab.new", { name: item.agent.name, space: s.id, folder: placeOf(s, panes()), argv: item.agent.run });
  }

  close() {
    ++this.generation;
    this.debounce?.cancel();
    stopsEnd(this);
    setShared("omarchy-open.closed", Date.now());
  }

  // Keep T3's machine picker and space ordering, with local represented once.
  machineRows() {
    const here = spaces().find(s => s.active)?.machine || null;
    const others = [...machines().map(k => k.name), ...spaces().map(s => s.machine)].filter(Boolean).sort();
    return [...new Set([here, null, ...others])].map(m => {
      const layout = m ? machines().find(k => k.name === m)?.layout ?? "unavailable" : "ready";
      return { key: `machine:${m ?? ""}`, machine: m, name: m ?? "This computer", sub: m ? STATE[layout] : "Local", off: layout !== "ready" };
    });
  }

  knownFolders() {
    const ps = panes();
    return [...new Set(spaces().filter(s => (s.machine || null) === this.machine)
      .flatMap(s => [s.folder, placeOf(s, ps)]).filter(Boolean).map(p => p.replace(/\/+$/, "") || "/"))]
      .map(folder => ({ key: `folder:${folder}`, folder, name: basename(folder), sub: folder }));
  }

  items() {
    const q = this.filter.toLowerCase();
    if (this.page === "folder") return this.suggestions;
    if (this.page === "start") return this.startRows().filter(r => r.name.toLowerCase().includes(q));
    if (this.page === "machines") return this.machineRows().filter(m => m.name.toLowerCase().includes(q));
    const ps = panes(), here = spaces().find(s => s.active)?.machine ?? null;
    const rank = (s) => (s.active ? 0 : (s.machine ?? null) === here ? 1 : 2);
    return spaces().filter(s => s.id !== shared("t3-home.space") && `${s.name} ${s.machine ?? ""} ${placeOf(s, ps)}`.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || (a.machine ?? "").localeCompare(b.machine ?? ""))
      .map(s => ({ key: `space:${s.id}`, space: s }));
  }

  choose(item, cx) {
    if (!item || item.off) return;
    if (item.space) { this.space = item.space; this.show("start", cx); }
    else if (item.start) this.start(item);
    else if (item.folder) this.fill(item, cx);
    else { this.machine = item.machine; this.show("folder", cx); }
  }

  show(page, cx) {
    ++this.generation;
    this.debounce?.cancel();
    this.page = page;
    this.at = page === "folder" ? -1 : 0;
    this.filter = "";
    this.error = "";
    this.loading = false;
    this.creating = false;
    this.activeInput().set_value("");
    if (page === "folder") this.loadFolders(cx);
    if (page === "start") this.loadAgents(cx);
    this.activeInput().focus();
    cx.notify();
  }

  newSpace(cx) {
    const rows = this.machineRows();
    this.pickedMachine = rows.length > 1;
    if (this.pickedMachine) this.show("machines", cx);
    else { this.machine = rows[0].machine; this.show("folder", cx); }
  }

  back(cx) { this.show(this.page === "folder" && this.pickedMachine ? "machines" : "spaces", cx); }

  loadFolders(cx) {
    const request = ++this.generation, text = this.folderInput.value(), machine = this.machine;
    this.debounce?.cancel();
    this.at = -1;
    this.error = "";
    this.creating = false;
    this.loading = false;
    this.suggestions = [];
    if (!isPath(text)) {
      this.suggestions = this.knownFolders().filter(r => r.folder.toLowerCase().includes(text.toLowerCase()));
    } else {
      this.loading = true;
      this.debounce = cx.timer.after(180, cx => {
        cx.spawn(async cx => {
          try {
            const result = await exec("sh", ["-c", DIRECTORIES, "sh", text === "~" ? "~/" : text], { on: machine ?? null, timeout: 6000 });
            if (request !== this.generation) return;
            if (result.code !== 0) throw new Error("directory listing failed");
            this.suggestions = [...new Set(result.stdout.split("\0").filter(Boolean))].sort()
              .map(folder => ({ key: `folder:${folder}`, folder, name: basename(folder), sub: folder }));
          } catch {
            if (request !== this.generation) return;
            this.error = "Could not list this folder on the selected machine.";
          }
          this.loading = false;
          cx.notify();
        });
      });
    }
    cx.notify();
  }

  fill(item, cx) {
    if (!item?.folder) return;
    this.folderInput.set_value(item.folder.replace(/\/+$/, "") + "/");
    this.loadFolders(cx);
    this.folderInput.focus();
  }

  createSpace(cx) {
    const text = this.folderInput.value();
    if (this.creating) return;
    if (!isPath(text)) { this.error = "Enter an absolute folder path or ~/…"; cx.notify(); return; }
    const request = ++this.generation, machine = this.machine;
    this.debounce?.cancel();
    this.creating = true;
    this.loading = false;
    this.error = "";
    cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await exec("sh", ["-c", DIRECTORY, "sh", text], { on: machine ?? null, timeout: 6000 });
        if (request !== this.generation) return;
        if (result.code !== 0 || !result.stdout.startsWith("/")) throw new Error("invalid directory");
        const folder = result.stdout;
        run("space.new", { machine: machine ?? "", folder, name: basename(folder) });
        closeOverlay(props().overlay);
      } catch {
        if (request !== this.generation) return;
        this.creating = false;
        this.error = "Could not open this directory on the selected machine.";
        cx.notify();
      }
    });
  }

  row(item, i, ps) {
    const t = theme(), on = this.at === i, s = item.space, h = home();
    const short = p => p && h && (p === h || p.startsWith(h + "/")) ? "~" + p.slice(h.length) : p ?? "";
    const sub = s ? (s.machine ? placeOf(s, ps) || "~" : short(placeOf(s, ps))) : item.sub;
    return h_flex().id(item.key).w_full().h(ROW).px(8).py(6).gap(8).rounded(0).items_center().flex_none()
      .role("button").accessibility_label(s ? s.name : item.name)
      .when(on, el => el.bg(t.foreground + "14"))
      .hover(el => el.bg(t.foreground + "14"))
      .when(Boolean(item.off), el => el.opacity(0.64))
      .on_hover((over, cx) => { if (over && this.at !== i) { this.at = i; cx.notify(); } })
      .on_click((_e, cx) => this.choose(item, cx))
      .child(h_flex().w(16).h(20).pt(2).self_start().flex_none().items_center().justify_center()
        .child(s ? projectMark(s, 16, t, ps)
          : item.agent ? (item.agent.tint || !item.agent.icon ? svg(item.agent.icon ?? "icons/shell.svg").size(16).text_color(t.foreground) : image(item.agent.icon).size(16))
          : item.start ? svg("icons/shell.svg").size(16).text_color(t.muted)
          : svg(`mods/omarchy-open/icons/${item.folder ? "folder-plus" : item.machine ? "server" : "monitor"}.svg`).size(16).text_color(t.muted)))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_color(t.foreground).child(s ? s.name : item.name))
        .child(h_flex().min_w(0).gap(4).items_center().text_size(12).line_height("16px").text_color(t.dim)
          .when(Boolean(s?.machine), el => el
            .child(svg("mods/omarchy-open/icons/server.svg").size(12).flex_none().text_color(t.muted))
            .child(div().flex_none().text_color(t.muted).child(`${s.machine} ·`)))
          .child(div().min_w(0).truncate().child(sub))))
      .when(Boolean(s || item.start) && i < 9, el => el.child(div().flex_none().text_size(12).font_medium().text_color(t.muted).child(keyLabel(`cmd-${i + 1}`))));
  }

  render() {
    const t = theme(), ps = panes(), items = this.items(), folder = this.page === "folder";
    const key = label => div().flex().flex_none().min_w(20).h(20).px(4).items_center().justify_center().rounded(0).bg(t.foreground + "14").text_size(12).text_color(t.foreground).child(label);
    const hint = (label, what) => h_flex().gap(4).items_center().children(label.split(" ").map(key)).child(what);
    const footButton = (id, label) => h_flex().id(id).gap(4).px(8).rounded(0).items_center().flex_none().text_size(12).line_height("16px")
      .role("button").accessibility_label(label).hover(el => el.bg(t.foreground + "14").text_color(t.foreground));
    return focusRoot(this, v_flex().id("omarchy-open").size_full().min_h(0).rounded(0).border(1).border_color(t.border).bg(t.popover).shadow_2xl().text_size(14).line_height("20px")
      .on_key_down((e, cx) => {
        if (e.key === "escape") { cx.stop_propagation(); return closeOverlay(props().overlay); }
        if (folder && e.key === "tab" && !e.modifiers.shift && items.length) {
          cx.stop_propagation(); return this.fill(items[this.at >= 0 ? this.at : 0], cx);
        }
        const to = step(e, this.at, items.length);
        if (to >= 0) this.at = to;
        else if ((this.page === "spaces" || this.page === "start") && /^[1-9]$/.test(e.key) && e.modifiers.platform) { cx.stop_propagation(); return this.choose(items[Number(e.key) - 1], cx); }
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().h(36).my(6).flex_none().pl(18).pr(20).gap(7).items_center()
        .child(svg("mods/omarchy-open/icons/search.svg").size(16).flex_none().text_color(t.dim))
        .child(Input.new(this.activeInput()).flex_1().h_full().text_size(14).text_color(t.foreground)))
      .child(div().mt(8).px(16).py(6).flex_none().text_size(12).line_height("16px").font_medium().text_color(t.muted)
        .child(folder ? "Folder" : this.page === "machines" ? "Machines" : this.page === "start" ? `Open in ${this.space?.name ?? "space"}` : "Spaces"))
      .child(div().flex_1().min_h(0).mb(8).px(8)
        .when(items.length > 0, el => el.child(scrollList(this, "open-rows", { count: items.length, row: ROW, at: this.at, height: Math.min(items.length * ROW, LIST_MAX),
          draw: i => this.row(items[i], i, ps), wheeled: keep => { this.at = keep; } })))
        .when(Boolean(this.error), el => el.child(div().px(8).py(6).text_size(12).text_color(t.foreground).child(this.error)))
        .when(this.page === "start" && !this.agentsChecked && items.length > 0, el => el.child(div().px(8).py(6).text_size(12).text_color(t.dim).child("Checking installed agents…")))
        .when(items.length === 0 && !this.error, el => el.child(div().py(40).text_center().text_color(t.dim)
          .child(folder ? this.creating ? "Opening…" : this.loading ? "Looking for folders…" : "Type a folder path; Enter opens it." : this.page === "machines" ? "No matching machines." : "No matching spaces."))))
      .child(h_flex().flex_none().px(16).py(10).gap(8).items_center().justify_between().rounded(0).border_t(1).border_color(t.foreground + "12").bg(t.foreground + "06").font_medium().text_color(t.muted)
        .child(h_flex().gap(12).items_center()
          .child(hint("↑ ↓", "Navigate"))
          .child(hint(folder ? "Tab" : "Enter", folder ? "Fill" : this.page === "spaces" ? "Choose" : this.page === "machines" ? "Select" : "Open"))
          .child(hint(folder ? "Enter" : "Esc", folder ? "Open" : "Close")))
        .when(this.page !== "spaces", el => el.child(stop(this, t, "open-back", footButton("open-back", "Back").on_click((_e, cx) => this.back(cx)).child("← Back"), 0)))
        .when(this.page === "spaces", el => el.child(stop(this, t, "open-new-space", footButton("open-new-space", "New space").on_click((_e, cx) => this.newSpace(cx))
          .child(svg("mods/omarchy-open/icons/folder-plus.svg").size(14).text_color(t.muted)).child("New space"), 0)))));
  }
}
