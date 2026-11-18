// The Waiting observer: keeps pipeline Watches' progress fresh for every mod (tickets 07, 11, 12, 13). Shown as an empty
// floating block in the Omarchy layout, so it runs whatever the sidebar shows; it draws nothing.
//
// - One poller app-wide: every copy ticks, and only the one holding the lease in `globalThis` polls (research 11:
//   visible to every copy and mod, survives a hot reload, never persisted). A lost owner is taken over after TTL.
// - Demand is rebuilt from terminals() each tick: live Watches with a `waiting.ref` (waiting.js's predicate), one target
//   per distinct MR or pipeline. A Watch that ends or is replaced drops out; its late reply is dropped.
// - GitLab through `glab api --hostname <host> graphql` (its own keyring auth; no token here), budget and backoff in
//   pipeline.js. Observations go to `shared("omarchy-waiting.obs")`, only when they change (each publish redraws every mod).
// - An ended Watch's target is no longer refreshed, but its last observation stays for its card (ticket 13) until no
//   terminal's record names it.
import { View, div } from "gpui-kit";
import { terminals, shared, setShared, exec, checking } from "herdr";
import { watchOf, readWatch, parseRef } from "./waiting.js";
import { OBS_KEY, TIMEOUT_MS, refKey, glabArgs, parseReply, applyReply, worthPublishing, newSchedule, demandOf, plan, finish } from "./pipeline.js";

const LEASE = "__omarchyWaitingObserver";
export const TICK_MS = 5000, TTL_MS = 15000;
let copies = 0;

export default class WaitingObserver extends View {
  init(_props, cx) {
    if (checking()) return;
    this.me = `${Date.now().toString(36)}.${++copies}.${Math.random().toString(36).slice(2, 7)}`;
    this.sched = newSchedule();
    this.tick(Date.now());
    this.timer = cx.timer.every(TICK_MS, () => this.tick(Date.now()));
  }

  // Released, so a follower claims it on its next tick rather than after the TTL. A reload or crash skips this.
  close() {
    this.timer?.cancel();
    const l = globalThis[LEASE];
    if (l?.owner === this.me) globalThis[LEASE] = { owner: null, beat: 0 };
  }

  holds() { return globalThis[LEASE]?.owner === this.me; }

  tick(now) {
    const l = globalThis[LEASE];
    if (l?.owner !== this.me) {
      if (l?.owner && now - l.beat <= TTL_MS) return;
      // No lease ever in this app run: what shared.json kept from the last one isn't an observation of this run (ticket
      // 07: unavailable until a new one succeeds). A takeover keeps the cache: the observations are this run's.
      if (l === undefined) this.forgetLive();
      globalThis[LEASE] = { owner: this.me, beat: now };
      this.sched = newSchedule();
    } else l.beat = now;
    const terms = terminals();
    for (const pick of plan(this.sched, demandOf(terms, watchOf, parseRef), now)) this.fetch(pick);
    this.prune(terms);
  }

  async fetch(pick) {
    let out;
    try {
      out = await exec("glab", glabArgs(pick.p, pick.head), { timeout: TIMEOUT_MS });
    } catch (e) {
      out = { code: -1, stdout: "", stderr: String(e?.message ?? e) };
    }
    const now = Date.now(), reply = parseReply(pick.p, out, now, pick.head);
    // A copy that lost the lease while this ran (a takeover, a reload) drops it: the owner has its own request.
    if (!this.holds()) return;
    const keep = finish(this.sched, pick, reply, now);
    if (reply.again) this.tick(now);
    if (!keep) return;
    const obs = shared(OBS_KEY) ?? {}, prev = obs[pick.key], next = applyReply(prev, reply, now);
    if (worthPublishing(prev, next, now)) setShared(OBS_KEY, { ...obs, [pick.key]: next });
  }

  // Drop what no terminal's record names any more, live or ended. Ended ones keep theirs (ticket 13).
  prune(terms) {
    const obs = shared(OBS_KEY);
    if (!obs || typeof obs !== "object") return;
    const named = new Set();
    for (const k of terms) {
      if (k.state === "finished") continue;
      const p = parseRef(readWatch(k.labels)?.ref);
      if (p) named.add(refKey(p));
    }
    const keys = Object.keys(obs), kept = keys.filter((key) => named.has(key));
    if (kept.length !== keys.length) setShared(OBS_KEY, Object.fromEntries(kept.map((key) => [key, obs[key]])));
  }

  // At the first claim of an app run: live Watches' targets start unavailable.
  forgetLive() {
    const obs = shared(OBS_KEY);
    if (!obs || typeof obs !== "object") return;
    const live = demandOf(terminals(), watchOf, parseRef);
    const kept = Object.keys(obs).filter((key) => !live.has(key));
    if (kept.length !== Object.keys(obs).length) setShared(OBS_KEY, Object.fromEntries(kept.map((key) => [key, obs[key]])));
  }

  render() {
    return div();
  }
}
