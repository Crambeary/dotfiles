import { run, shared, setShared, props, notify, openOverlay, terminals } from "herdr";
import { readPins, writePins } from "./pins.js";
import { focusAgent, focusPane } from "./zoom.js";
import { detailsFor } from "./details.js";
import { placeOf } from "./project.js";
import { treeMembers } from "./subagents.js";
import { peekTerminal } from "./peek.js";

export function inboxActions(view, model) {
  const { every, all, viewing, term, napUntil, wake, state, settledAt, busy, pinned, out, busyRows, sp, ps, put } = model;
  // A row moving away from under the pointer reports no leave.
  const away = (a, cx) => {
    if (view.hovered !== a.address) return;
    view.hovered = null;
    detailsFor(view, null, cx);
  };
  // Undo puts back only the pins it took, where they were: pins made since stay.
  const repin = (before, took) => {
    const current = [...(readPins())];
    for (const p of before.filter((p) => took.includes(p) && !current.includes(p))) {
      const next = before.slice(before.indexOf(p) + 1).find((q) => current.includes(q));
      current.splice(next ? current.indexOf(next) : current.length, 0, p);
    }
    writePins(current);
  };
  // Brought back, it's news again: the top of the list.
  const unsettle = (a, cx) => {
    away(a, cx);
    for (const k of treeMembers(a, all)) view.setLabel("settled", k.address, "", cx);
    view.changed[a.address] = { ...view.changed[a.address], at: Date.now(), start: null };
    localStorage.setItem("changes", JSON.stringify(view.changed));
  };
  // Orphaned subagents can be top-level cards without a pane to focus.
  const go = (a) => a.mod ? focusPane(a.pane) : a.pane ? focusAgent(a.address) : peekTerminal(a.address);
  // Putting away the agent in view moves on to the next card down the list, from the top past the end, as T3 does;
  // one in the background moves nothing.
  const moveOn = (xs) => {
    const cards = [...pinned, ...out, ...busyRows], i = cards.findIndex(viewing);
    if (i < 0 || !xs.includes(cards[i])) return false;
    const next = [...cards.slice(i + 1), ...cards.slice(0, i)].find((a) => !xs.includes(a));
    if (next) go(next);
    return Boolean(next);
  };
  // Settling ends a snooze and a pin, as T3's. A mod pane closes, once the view has moved on from it.
  const settle = (xs, cx) => {
    const panes = xs.filter((a) => a.mod);
    const kept = [...new Map(xs.filter(a => !a.mod).flatMap(a => treeMembers(a, all)).map(a => [a.address, a])).values()];
    for (const a of xs) away(a, cx);
    const naps = new Map(kept.map((a) => [a, napUntil(a)]));
    const settled = new Map(kept.map(a => [a, view.pending.settled[a.address] ?? term.get(a.address)?.labels?.settled ?? ""]));
    const before = [...(readPins())];
    const took = kept.map((a) => a.address);
    if (before.some((p) => took.includes(p))) writePins(before.filter((p) => !took.includes(p)));
    let undone = false;
    for (const a of kept) {
      view.setLabel("settled", a.address, `${Date.now()}:${term.get(a.address)?.turn ?? 0}`, cx, () => {
        if (!undone && before.includes(a.address)) repin(before, [a.address]);
      });
      if (naps.get(a)) view.setLabel("snoozed", a.address, "", cx);
    }
    // Undone, they're back where they were: no news, as T3 restores a thread, with its pin and a snooze that hasn't
    // run out.
    if (kept.length) view.remember("Settled", kept.length, (cx) => {
      undone = true;
      repin(before, took);
      for (const a of kept) {
        view.setLabel("settled", a.address, settled.get(a), cx);
        if (naps.get(a) > Date.now()) view.setLabel("snoozed", a.address, String(naps.get(a)), cx);
      }
    }, cx);
    const moved = moveOn(xs);
    for (const a of panes) run("pane.close", { pane: a.pane });
    return moved;
  };
  const snooze = (a, at, cx) => {
    const members = treeMembers(a, all), before = new Map(members.map(k => [k.address, napUntil(k)]));
    const turnLabel = (k) => view.pending["snoozed-turn"][k.address] ?? term.get(k.address)?.labels?.["snoozed-turn"] ?? "";
    const turnsBefore = new Map(members.map(k => [k.address, turnLabel(k)]));
    for (const k of members) {
      // Where it stood, so new work can end the snooze (main.js). From its terminal, as main.js reads it back: a card's
      // agents() row has no turn, so a top-level agent would mark 0 and wake at once on any turn it had already ended.
      const now = term.get(k.address);
      view.setLabel("snoozed-turn", k.address, `${now?.turn ?? 0}:${now?.status === "working" ? 1 : 0}`, cx);
      view.setLabel("snoozed", k.address, String(at), cx);
    }
    view.remember("Snoozed", members.length, (cx) => {
      for (const k of members) {
        view.setLabel("snoozed", k.address, before.get(k.address) ? String(before.get(k.address)) : "", cx);
        view.setLabel("snoozed-turn", k.address, turnsBefore.get(k.address), cx);
      }
    }, cx);
    // The card moves away without a pointer-leave event, for it or for the clock under the pointer.
    view.napMenu = view.hovered = view.hot = null;
    detailsFor(view, null, cx);
    moveOn([a]);
  };
  // As T3's pick: a duration counts from the click; a time that passed since the menu was drawn is refused.
  const pick = (a, p, cx) => {
    if (p.custom) {
      // A dialog covers the card, and nothing reports leaving it until the pointer moves.
      view.napMenu = view.hovered = view.hot = null;
      detailsFor(view, null, cx);
      openOverlay({ mod: "omarchy-inbox", kind: "dialog", frame: "none", width: 384, props: { customSnooze: a.address } });
      return;
    }
    const at = p.hours ? Date.now() + p.hours * 3600000 : p.at;
    if (at > Date.now()) return snooze(a, at, cx);
    view.napAt = -1;
    notify({ title: "Couldn't snooze the agent", body: "That time has passed. Choose another.", level: "warning" });
  };
  // The Custom dialog's answer. By then it may have come to need the person, which T3 refuses too.
  view.customSnooze = (answer, cx) => {
    const i = answer.lastIndexOf(":"), at = Number(answer.slice(i + 1)), a = every.find((x) => x.address === answer.slice(0, i));
    if (a && state(a) !== "blocked" && at > Date.now()) snooze(a, at, cx);
  };
  // The settle key: the agent in view, as its card's Settle (finished) or its settled row's undo.
  view.settleKey = (cx) => {
    const a = every.find(viewing);
    if (!a) return;
    if (settledAt(a)) unsettle(a, cx);
    else if (!busy(a)) settle([a], cx);
  };

  // Clear closes settled agents' panes; Herdr then closes emptied tabs. The one in view stays.
  const spaceNow = sp.find((s) => s.active), tabNow = spaceNow?.tabs.find((c) => c.active)?.id;
  const doomed = put.filter((a) => !a.mod && !viewing(a) && a.tab !== tabNow && !busy(a));
  view.clearSettled = () => {
    // Recheck at confirmation time: a child may have started work since Clear was offered.
    const live = terminals();
    const safe = doomed.filter(a => {
      const root = live.find(k => k.address === a.address && k.state === "live");
      return root && !treeMembers(root, live).some(k => ["working", "blocked", "error"].includes(k.status));
    });
    const withPanes = safe.filter(a => a.pane);
    const gone = new Set(withPanes.map((a) => a.pane));
    for (const id of new Set(withPanes.map((a) => a.space))) {
      const s = sp.find((s) => s.id === id), tabs = s?.tabs.map((c) => c.id) ?? [];
      const mine = ps.filter((p) => tabs.includes(p.tab));
      // The space stays: pane.close refuses its last pane, so a space left empty gets a fresh shell tab first,
      // where its terminals are now: an unnamed space is named after that, and s.folder is only where it began.
      if (mine.every((p) => gone.has(p.pane))) run("tab.new", { space: id, folder: placeOf(s, ps) });
      for (const a of withPanes.filter((a) => a.space === id)) {
        // Explicitly end descendants too, including ones opted out of core parent-lifetime cleanup.
        for (const k of treeMembers(a, live).slice(1).reverse()) run("terminal.kill", { terminal: k.address });
        run("pane.close", { pane: a.pane });
      }
    }
    for (const a of safe.filter(a => !a.pane)) {
      for (const k of treeMembers(a, live).reverse()) run("terminal.kill", { terminal: k.address });
    }
    // tab.new shows the new tab; go back to where the person was.
    if (tabNow) { run("space.select", { id: spaceNow.id }); run("tab.select", { id: tabNow }); }
  };

  return { away, repin, unsettle, go, settle, pick, doomed };
}
