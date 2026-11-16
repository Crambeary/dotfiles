import { spaces, panes, agents, terminals, run, openOverlay, closeOverlay, focused, hc, notify, layout, shared, setShared, window } from "herdr";
import { namer, programOf } from "./name.js";
import { descendants, kidStatus, ownStatus, treeStatus } from "./tree.js";
import { focusAgent, focusPane } from "./zoom.js";
import { sidebarParts } from "./sidebar.js";
import { newTab } from "./project.js";

// One instance per Tabs view; the Herdr operations also admit the check's fake core.
export function navigation(beforeAsk = (_cx) => {}, core = { spaces, panes, agents, terminals, run, openOverlay, closeOverlay, focused, hc, notify, layout, shared, setShared, window: () => window(), namer, programOf, focusAgent, focusPane }) {
  const { spaces, panes, agents, terminals, run, openOverlay, closeOverlay, focused, hc, notify, layout, shared, setShared, window, namer, programOf, focusAgent, focusPane } = core;
  const trail = {}, owed = new Map(), waking = new Map();
  let states = new Map();
  let going, inView, unread, focusWas, zoomOff, asking;
  const inboxShown = () => sidebarParts(layout()).stack?.active === "inbox";
  const nameOf = (c, lead, name) => c.named ? c.name : lead ? name(lead) : "Terminal";

  // The selected sidebar's rows, shown or hidden, stopping at either end.
  function step(command) {
    const { order = [], view = null } = shared(inboxShown() ? "t3-inbox.rows" : "t3-agents.rows") ?? {};
    const i = view === null ? -1 : order.indexOf(view);
    const to = view === null ? (command === "next" ? order[0] : order.at(-1)) : i < 0 ? null : order[command === "next" ? i + 1 : i - 1];
    if (to?.startsWith("pane:")) focusPane(to.slice(5));
    else if (to) focusAgent(to);
  }
  // A space by the keys. Out of view Herdr may have moved its active tab to a closed one's neighbour, and being shown costs an
  // agent its unread done: return to the tab last shown there. tab.select brings the space along; the space first would show its active tab for that step.
  function showSpace(s) {
    const back = trail[s.id]?.find(id => s.tabs.some(c => c.id === id));
    run(back ? "tab.select" : "space.select", { id: back ?? s.id });
  }
  // The spaces the keys count and walk, wrapping as space.next does.
  function selectSpace(index) {
    const s = spaces()[index - 1];
    if (s) showSpace(s);
  }
  function walkSpaces(by) {
    const list = spaces();
    if (!list.length) return;
    const i = list.findIndex(s => s.active);
    // Without a selection, start at the first or last space.
    showSpace(list[i < 0 ? (by > 0 ? 0 : list.length - 1) : (i + by + list.length) % list.length]);
  }

  // A pane is empty when its own shell holds the foreground. No answer counts as busy: better to ask.
  // shortcut: a shell's background jobs read as empty, upgrade if Herdr ever reports them.
  const SHELL = /^-?(zsh|bash|fish|sh|dash|ksh|tcsh|nu)$/;
  async function atPrompt(terminal) {
    try {
      const k = JSON.parse((await hc(["get", terminal, "--json"])).stdout);
      return k.foreground?.pid === k.pid && SHELL.test(k.foreground.name);
    } catch { return false; }
  }

  // As T3's confirmTerminalClose: `Close terminal "Pi"?` or `Close 2 terminals?`, then what that ends. A held cmd-w replaces the dialog rather than stacking it.
  function ask(names, more, command, cx) {
    // The dialog covers it, nothing reports the leaving until the pointer moves, and the × stops the press that would close the card.
    beforeAsk(cx);
    if (asking) closeOverlay(asking);
    const [title, detail] = names.length === 1
      ? [`Close terminal "${names[0]}"?`, "This stops the running process and clears its history."]
      : [`Close ${names.length} terminals?`, `This stops their running processes and clears their histories: ${names.map(n => `"${n}"`).join(", ")}.`];
    // t3-actions draws T3's alert dialog: the shipped confirm mod's measures are its own.
    asking = openOverlay({ mod: "t3-actions", kind: "dialog", frame: "none", width: 512, props: { actions: "confirm", title, detail: detail + more, command: { name: command } } });
  }

  // Ending a program asks first; empty panes have none to lose, and Herdr still asks if it's the space's last tab.
  async function closeTab(id, cx) {
    const space = spaces().find(s => s.tabs.some(c => c.id === id));
    if (!space) return;
    const c = space.tabs.find(c => c.id === id), mine = panes().filter(p => p.tab === id);
    const live = mine.filter(p => p.terminal), empty = await Promise.all(live.map(p => atPrompt(p.terminal)));
    // A lone pane goes by its tab's name, as the tab shows it.
    const name = namer();
    const names = live.filter((_, k) => !empty[k]).map(p => mine.length === 1 ? nameOf(c, p, name) : name(p));
    if (names.length === 0) return closeTabNow(id, {}, cx);
    ask(names, space.tabs.length === 1 ? " It's the space's last tab, so the space closes too." : "", `t3-tabs.close-tab-now:${id}`, cx);
  }

  async function closeTabNow(id, args, cx) {
    await leave(id, cx);
    run("tab.close", { id, ...args });
  }

  async function closePaneNow(pane, cx) {
    const ps = panes(), p = ps.find(p => p.pane === pane), tab = p?.tab;
    if (ps.filter(p => p.tab === tab).length === 1) await leave(tab, cx);
    else if (focused()?.pane === pane && p?.mod && programOf(p)?.inbox) {
      const mine = agents().filter(a => a.tab === tab), back = mine.find(a => a.address === focused()?.agent) ?? mine[0];
      if (back) focusAgent(back.address);
    }
    run("pane.close", { pane });
  }

  async function writeLabel(address, key, value, quiet = false) {
    const r = await hc(["label", address, `${key}=${value}`]).catch(e => ({ code: 1, stderr: String(e) }));
    if (r.code === 0) return true;
    if (!quiet) notify({ title: "Couldn't update the agent", body: r.stderr.trim(), level: "error" });
    return false;
  }

  // Going first, so Herdr's neighbour never shows: being shown costs an agent its unread done, one the bar hides included.
  async function leave(id, cx) {
    const space = spaces().find(s => s.active);
    // Out of view, closing it moves nothing.
    if (!space?.tabs.find(c => c.id === id)?.active) return;
    // A space's last tab takes the space, and Herdr may still ask.
    if (space.tabs.length === 1) return;
    goBack(space.id, id);
  }

  // Back to where the person was before a tab with no agent. Nowhere remembered: Herdr's pick stands.
  function goBack(space, from) {
    const back = trail[space]?.find(id => id !== from && spaces().some(s => s.tabs.some(c => c.id === id)));
    if (!back) return;
    going = { tab: back, until: Date.now() + 500 };
    run("tab.select", { id: back });
  }

  async function closePane(pane, cx) {
    const ps = panes(), p = ps.find(p => p.pane === pane);
    if (!p) return;
    const space = spaces().find(s => s.tabs.some(c => c.id === p.tab)), tabs = space?.tabs.map(c => c.id) ?? [];
    const last = ps.filter(q => tabs.includes(q.tab)).length === 1;
    // A space's last pane closes the space, and Herdr asks that itself.
    if (!p.terminal || last || await atPrompt(p.terminal)) return closePaneNow(pane, cx);
    ask([namer()(p)], "", `t3-tabs.close-pane-now:${pane}`, cx);
  }

  // Where the person has been, once a frame, by what the app reports: each space's tabs, latest shown first. The one memory
  // the bar keeps; which agent it holds and where a close lands both read from it, so they can't disagree.
  // shortcut: it's gone after a restart, so Herdr's pick stands until a tab has been shown; upgrade if that matters.
  function track() {
    const all = spaces(), space = all.find(s => s.active), tab = space?.tabs.find(c => c.active);
    const alive = (id) => all.some(s => s.tabs.some(c => c.id === id));
    const was = inView;
    // For the closes this mod doesn't make, which leave() can't go ahead of: the tab's menu, the program ending. Herdr has
    // already picked the neighbour, and it may have been shown.
    const terms = terminals(), every = agents();
    if (was && !alive(was.tab)) {
      if (space?.id === was.space) goBack(was.space, was.tab);
      // Herdr marked what it showed as seen in the same step it picked it (window active), before any mod hears of it. An agent
      // unread a frame ago that only the pick showed is owed its done back, the way Herdr's Mark unread writes it.
      for (const a of every.filter(a => a.tab === tab?.id)) {
        const before = unread?.get(a.address);
        if (before) owed.set(a.address, { ...before, until: Date.now() + 3000 });
      }
    }
    zoomFollows(every);
    payBack(tab, terms, every);
    endSnoozes(terms, every);
    // What's unread now, for the next frame's close: its turn, and a snooze it woke from (seeing it clears that too).
    unread = new Map(every.filter(a => a.status === "done").map(a => {
      const k = terms.find(k => k.address === a.address);
      return [a.address, { turn: k?.turn ?? 0, snoozed: k?.labels?.snoozed }];
    }));
    if (going && (tab?.id === going.tab || Date.now() > going.until)) going = null;
    // Until a close's target shows, what shows is Herdr's pick, not somewhere the person went.
    if (space && tab && !going) trail[space.id] = [tab.id, ...(trail[space.id] ?? []).filter(id => id !== tab.id && alive(id))];
    inView = tab ? { tab: tab.id, space: space.id, agent: every.some(a => a.tab === tab.id) } : null;
  }

  // For what focuses a pane without zoom.js going first, Herdr's own: a toast, hc, the palette, its keys. Its focus moved and the
  // zoom stayed, or a zoom landed on a pane the focus isn't on: the later of the two wins. What the stale zoom showed for that
  // frame is owed its done, as a close's neighbour is. Once per disagreement: pane.zoom toggles, and a repeat would undo it.
  function zoomFollows(every) {
    const ps = panes(), f = ps.find(p => p.focused), z = f && ps.find(p => p.tab === f.tab && p.zoomed), was = focusWas;
    const off = z && z.pane !== f.pane ? `${f.pane}:${z.pane}` : null, told = zoomOff;
    focusWas = f?.pane; zoomOff = off;
    if (!off || off === told) return;
    if (was === f.pane) return run("pane.focus", { pane: z.pane });
    run("pane.zoom", { pane: f.pane });
    const before = unread?.get(z.terminal);
    if (before && every.some(a => a.address === z.terminal)) owed.set(z.terminal, { ...before, until: Date.now() + 3000 });
  }

  // Once what Herdr's pick showed is out of view, and its seen has come back from the core (or the lower write could land first),
  // its turn is unread again. Still in view after a few seconds: the person stayed there, so it was seen after all.
  function payBack(tab, terms, every) {
    for (const [addr, o] of owed) {
      const k = terms.find(k => k.address === addr), a = every.find(a => a.address === addr);
      if (!k || (k.turn ?? 0) !== o.turn || o.turn < 1) { owed.delete(addr); continue; }
      // Done already (the window wasn't active, so nothing was marked): only a cleared snooze may be owed.
      if (a?.status === "done") o.seen = true;
      // In its tab but zoomed away from isn't in view either.
      const covered = panes().some(p => p.tab === a?.tab && p.zoomed && p.terminal !== addr);
      if (a?.tab === tab?.id && !covered) { if (Date.now() > o.until) owed.delete(addr); continue; }
      if (!o.seen && !o.seenWriting && Number(k.labels?.["herdr.seen"]) >= o.turn) {
        o.seenWriting = true;
        writeLabel(addr, "herdr.seen", String(o.turn - 1), o.seenTold).then(ok => { o.seenWriting = false; if (ok) o.seen = true; });
        o.seenTold = true;
      }
      // The Inbox clears a woken snooze when it's seen, and that write may come back after ours: wait for it.
      if (o.snoozed && !o.snoozeWriting && !k.labels?.snoozed) {
        o.snoozeWriting = true;
        writeLabel(addr, "snoozed", o.snoozed, o.snoozeTold).then(ok => { o.snoozeWriting = false; if (ok) o.snoozed = null; });
        o.snoozeTold = true;
      }
      if ((o.seen && !o.snoozed) || Date.now() > o.until) owed.delete(addr);
    }
  }

  // A snooze ends on a failure in its tree or a new turn given in view, as the Inbox ends it; here too, in either sidebar,
  // as the Inbox copy may not have started (docs/adr/0003). Seeing it once it has woken stays the Inbox's: Woke is its mark.
  function endSnoozes(terms, every) {
    const was = states, active = window()?.active, now = Date.now();
    const listed = new Map(every.map(a => [a.address, a.status]));
    const state = (a) => treeStatus(ownStatus(a.status, a.address, terms), descendants(terms, a.address).map(k => kidStatus(k, listed)));
    states = new Map(every.map(a => [a.address, state(a)]));
    const viewed = inViewAgent(terms, every);
    for (const a of every) {
      const k = terms.find(k => k.address === a.address);
      if (!k?.labels?.snoozed || now - (waking.get(a.address) ?? -Infinity) < 10000) continue;
      const failed = k.status === "error" || descendants(terms, a.address).some(d => d.status === "error");
      const turned = active && a.address === viewed && states.get(a.address) === "working" && ["idle", "done"].includes(was.get(a.address));
      if (!failed && !turned) continue;
      // Once per 10s: the label takes a moment to come back, and a refused write mustn't retry, and tell, on every frame.
      waking.set(a.address, now);
      writeLabel(a.address, "snoozed", "");
    }
  }

  // The agent in view, as the Inbox's row in view (t3-inbox/row-model.js inboxInView): the focused one; else a sub-agent with
  // no row of its own (a block, a peek) stands for its nearest agent; a mod pane for the agent beside it, unless it has a card.
  function inViewAgent(terms, every) {
    const own = every.find(a => a.focused);
    if (own) return own.address;
    const f = focused(), byAddress = new Map(terms.map(k => [k.address, k])), listed = (k) => every.some(a => a.address === k.address);
    if (f?.pane && !f.terminal) {
      const p = panes().find(p => p.pane === f.pane);
      if (p?.mod && programOf(p)?.inbox) return null;
      const here = every.filter(a => a.tab === f.tab);
      return (here.find(a => a.address === f.agent) ?? here[0])?.address ?? null;
    }
    const seen = new Set();
    let k = byAddress.get(f?.pane ? f.terminal : f?.agent ?? f?.terminal);
    while (k && !listed(k) && !seen.has(k.address)) { seen.add(k.address); k = byAddress.get(k.parent); }
    return k && listed(k) ? k.address : null;
  }

  // With the Inbox showing, cards lead to the agents, so the bar holds what's around the work in view: the agent, its
  // sub-agents' tabs, then the tabs with no agent in their own order. In a tab with no agent, the agent is the one last
  // looked at in this space, so the way back stays in reach.
  function visibleTabs() {
    const space = spaces().find(s => s.active);
    if (!space) return [];
    if (!inboxShown()) return space.tabs;
    const every = agents(), all = terminals(), f = focused();
    const shownTab = going?.tab ?? space.tabs.find(c => c.active)?.id;
    const inTab = [shownTab, ...(trail[space.id] ?? [])].find(id => every.some(a => a.tab === id));
    const here = every.filter(a => a.tab === inTab);
    const viewed = here.find(a => a.focused) ?? here.find(a => a.address === f?.agent) ?? here[0];
    // A sub-agent counts as the agent at its top.
    const byAddress = new Map(all.map(k => [k.address, k])), seen = new Set();
    let top = viewed?.address;
    while (!seen.has(top) && byAddress.get(byAddress.get(top)?.parent)?.state === "live") { seen.add(top); top = byAddress.get(top).parent; }
    const family = new Set([top, ...descendants(all, top).map(k => k.address)]);
    const lead = space.tabs.find(c => c.id === every.find(a => a.address === top)?.tab);
    const kin = space.tabs.filter(c => c !== lead && every.some(a => a.tab === c.id && family.has(a.address)));
    return [...(lead ? [lead] : []), ...kin, ...space.tabs.filter(c => !every.some(a => a.tab === c.id))];
  }

  // The next or previous tab the bar shows, going around.
  function walkTabs(by) {
    const list = visibleTabs();
    if (!list.length) return;
    run("tab.select", { id: list[(list.findIndex(c => c.active) + by + list.length) % list.length].id });
  }

  return {
    async handle(command, cx) {
      if (command === "close-tab") await closeTab(focused()?.tab, cx);
      else if (command === "close-pane") await closePane(focused()?.pane, cx);
      else if (command.startsWith("close-tab:")) await closeTab(command.slice("close-tab:".length), cx);
      else if (command.startsWith("close-pane:")) await closePane(command.slice("close-pane:".length), cx);
      // What a close's dialog runs, once the person has said yes.
      else if (command.startsWith("close-tab-now:")) await closeTabNow(command.slice("close-tab-now:".length), { confirmed: true }, cx);
      else if (command.startsWith("close-pane-now:")) await closePaneNow(command.slice("close-pane-now:".length), cx);
      else if (command === "next" || command === "prev") step(command);
      else if (command === "new") {
        const space = spaces().find(s => s.active);
        if (space) newTab(space);
        else run("mod.open", { name: "t3-new-menu" });
      }
      else if (command.startsWith("space:")) selectSpace(Number(command.slice("space:".length)));
      else if (command === "space-next") walkSpaces(1);
      else if (command === "space-prev") walkSpaces(-1);
      else if (command.startsWith("tab:")) {
        const c = visibleTabs()[Number(command.slice("tab:".length)) - 1];
        if (c) run("tab.select", { id: c.id });
      }
      else if (command === "tab-next") walkTabs(1);
      else if (command === "tab-prev") walkTabs(-1);
    },
    // Only the strip tracks: the layout's other copies just ask what to draw.
    frame(trackFrame = true) {
      if (trackFrame) track();
      return { tabs: visibleTabs() };
    },
  };
}
