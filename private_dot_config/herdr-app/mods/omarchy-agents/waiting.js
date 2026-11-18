// Waiting: an agent parked on something outside it (a pipeline, a download), declared as a Watch in its terminal's
// `waiting*` labels by `herdr-watch` or its hooks. An overlay on the agent's status, never a status word: the core drops
// unknown ones. Pure reading, no herdr calls, so tests load it as is. A copy lives in each mod that uses it
// (omarchy-inbox, omarchy-agents, omarchy-watch); tests/herdr/waiting.mjs checks they stay the same.
//
// Contract v1 (seven keys, all strings):
//   waiting=1                 the contract version; anything else isn't read
//   waiting.id=<id>           this declaration
//   waiting.subject=<text>    what it waits on, shown as is
//   waiting.since=<ms>        when it was declared (Unix ms); polling never moves it
//   waiting.stamp=<turn>:<0|1> the terminal's turn then, and whether it was working
//   waiting.ref=<url>         optional: an https GitLab MR or pipeline URL, no credentials
//   waiting.ended=<id>        a tombstone: `herdr-watch clear --id`, or the inbox seeing new work, ended that declaration
// A Watch is live only when the record is complete and valid and `waiting.ended` isn't its id. A record that isn't
// is no Watch, and nobody deletes it. It ends on a clear, on new work since its stamp, or with its terminal.

export const VERSION = "1";
// Past this from its declaration a Watch shows stale: dimmed, still counted.
export const STALE_MS = 2 * 3600000;

// The https URL `waiting.ref` may carry, or null: no user or password in it, a host, and an MR or pipeline path.
// `{ host, project, kind: "mr" | "pipeline", iid }`.
export function parseRef(ref) {
  if (typeof ref !== "string" || !ref) return null;
  const m = /^https:\/\/([^/?#@:]+)(?::\d+)?\/(.+?)\/-\/(merge_requests|pipelines)\/(\d+)\/?(?:[?#].*)?$/.exec(ref);
  if (!m) return null;
  return { host: m[1], project: m[2], kind: m[3] === "merge_requests" ? "mr" : "pipeline", iid: Number(m[4]) };
}

// A terminal's labels as a Watch record, live or ended, or null when they aren't a complete v1 record.
// `{ id, subject, since, then, was, ref, ended }`: `then`/`was` from the stamp; `ref` only when valid; `ended` true when
// the tombstone names this declaration.
export function readWatch(labels) {
  if (!labels || labels.waiting !== VERSION) return null;
  const id = labels["waiting.id"], subject = labels["waiting.subject"], since = labels["waiting.since"], stamp = labels["waiting.stamp"];
  if (!id || typeof subject !== "string" || !subject.trim()) return null;
  if (!/^\d+$/.test(since ?? "")) return null;
  const s = /^(\d+):([01])$/.exec(stamp ?? "");
  if (!s) return null;
  const raw = labels["waiting.ref"];
  // A ref that's there but isn't one we can read leaves the record malformed, as the contract has it.
  if (raw && !parseRef(raw)) return null;
  return { id, subject: subject.trim(), since: Number(since), then: Number(s[1]), was: s[2] === "1", ref: raw || null,
    ended: labels["waiting.ended"] === id };
}

// New work since the stamp: the `snoozed-turn` rule. Finishing the turn that declared it keeps the Watch; working on a
// turn begun since, or a turn ended past the one it was on, ends it.
export function newWorkSince(w, status, turn) {
  const t = turn ?? 0;
  return (status === "working" && (!w.was || t > w.then)) || t > w.then + (w.was ? 1 : 0);
}

// `k`'s Watch if it's live and no new work has ended it yet (the inbox writes the tombstone a moment later), else null.
// `k` is a terminal as terminals() has it; `status` its own word if it differs from k.status (agents() vs terminals()).
export function watchOf(k, status = k?.status) {
  if (!k || k.state === "finished") return null;
  const w = readWatch(k.labels);
  if (!w || w.ended || newWorkSince(w, status, k.turn)) return null;
  return w;
}

// The declaration new work has ended but whose tombstone isn't written yet: the inbox writes `waiting.ended=<id>`.
// Null when there's nothing to end. `pending` is a tombstone already on its way.
export function endsNow(k, status = k?.status, pending) {
  const w = readWatch(k?.labels);
  if (!w || w.ended || pending === w.id) return null;
  return newWorkSince(w, status, k.turn) ? w.id : null;
}

// Stop waiting, by hand: the tombstone for each live Watch in a tree (`members` its terminals, root first), as the
// new-work rule writes it, one `waiting.ended=<id>` each. `pending`: address → tombstone already on its way.
// `[{ address, id, was }]`, `was` the tombstone it replaces ("" for none), for Undo.
export function stopWrites(members, pending = {}) {
  return members.flatMap((k) => {
    const w = watchOf(k);
    return w && pending[k.address] !== w.id ? [{ address: k.address, id: w.id, was: k.labels?.["waiting.ended"] ?? "" }] : [];
  });
}

export const isStale = (w, now) => now - w.since >= STALE_MS;

// A member's word with its Watch over it: working or idle on a Watch is waiting (a long foreground command with a
// Watch counts as one); blocked stays blocked; its own done stays done (the reply is the news).
export const overWord = (word, w) => (w && (word === "working" || word === "idle" || word == null) ? "waiting" : word);

// A tree's reading with Waiting (ticket 03): blocked anywhere > the root's own done > working > waiting > the root's
// own word. `own`: the root's word; `kids`: each member's word with its Watch over it (overWord), so a sub-agent busy
// on a Watch reads waiting and only one working on its own makes the tree Working. Mirrors tree.js treeStatus.
export function waitingTreeStatus(own, rootWatch, kids) {
  if (own == null) return own;
  if (own === "blocked" || kids.includes("blocked")) return "blocked";
  if (own === "done") return "done";
  const mine = overWord(own, rootWatch);
  if (mine === "working" || kids.includes("working")) return "working";
  if (mine === "waiting" || kids.includes("waiting")) return "waiting";
  return own;
}

// A tree's Watches: the root and its members (root first, each `{ k, w }` with `w` null for one without), as the
// inbox card and the Agents list read them. Null when nobody in it waits.
// `{ count, oldest: { k, w }, more, stale, members: [{ k, w }] (the root left out), watches: [{ k, w }] }`:
// oldest by declaration; `more` the other waiting members; stale only when every Watch is.
export function rollup(members, now) {
  const watches = members.filter((m) => m.w).sort((x, y) => x.w.since - y.w.since || String(x.k.address).localeCompare(String(y.k.address)));
  if (!watches.length) return null;
  return { count: watches.length, oldest: watches[0], more: watches.length - 1, stale: watches.every((m) => isStale(m.w, now)),
    members: members.slice(1), watches };
}

// The shelf: cards with a rollup, oldest Watch first; its header counts Watches and shows the oldest one's age.
export function shelfSummary(rolls) {
  const cards = rolls.filter((r) => r.roll).sort((x, y) => x.roll.oldest.w.since - y.roll.oldest.w.since || String(x.key).localeCompare(String(y.key)));
  const count = cards.reduce((n, r) => n + r.roll.count, 0);
  return { cards, count, oldest: cards[0]?.roll.oldest.w.since ?? null };
}

// As the sidebars' times: 5m, 3h, 2d; under a minute, "now".
export function age(ms, now) {
  const m = Math.floor((now - ms) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

// Every Waiting colour, from the theme only (light and dark name the same ones): one scheme across row marks,
// hairlines, pills and hover cards. Green passed, yellow running / waiting for a runner / outdated, red failed;
// the Watch itself in the accent; stale and unknown dim.
export const waitColors = (t) => ({ wait: t.accent, pass: t.done, run: t.working, fail: t.blocked, stale: t.dim, faint: t.muted });
