// Pins, as Omarchy's agents list keeps them: membership is the core's (`terminal.pin`, the terminal's `herdr.pinned`
// label), so pinning here or in omarchy-agents is one pin. Only the order the inbox shows them in is its own: a shared
// list over those pins. A pin made elsewhere joins at the end; an unpinned one drops out of the order.
import { terminals, agents, run, shared, setShared } from "herdr";

const ORDER = "omarchy-inbox.pin-order";
// A pin written but not echoed by the core yet: address → { pinned, at }. Module scope: copies share one JS context, and
// the echo is what ends it. Given up after a while, so a refused write can't hold a pin forever.
const pending = new Map();
const PATIENCE = 10000;

const pinnable = (address) => !address.startsWith("pane:");

export function readPins() {
  const now = Date.now(), on = new Set();
  const marked = new Set(agents().filter((a) => a.pinned).map((a) => a.address));
  for (const k of terminals()) {
    if (k.state !== "live") continue;
    let pinned = Boolean(k.labels?.["herdr.pinned"]) || marked.has(k.address);
    const p = pending.get(k.address);
    if (p) {
      if (p.pinned === pinned || now - p.at > PATIENCE) pending.delete(k.address);
      else pinned = p.pinned;
    }
    if (pinned) on.add(k.address);
  }
  const order = (shared(ORDER) ?? []).filter((a) => on.has(a));
  for (const a of on) if (!order.includes(a)) order.push(a);
  return order;
}

// The pins in this order: pins or unpins the difference on the core, and keeps the order.
export function writePins(list) {
  const next = list.filter(pinnable), before = new Set(readPins()), now = Date.now();
  for (const a of next) if (!before.has(a)) { pending.set(a, { pinned: true, at: now }); run("terminal.pin", { terminal: a, pinned: true }); }
  for (const a of before) if (!next.includes(a)) { pending.set(a, { pinned: false, at: now }); run("terminal.pin", { terminal: a, pinned: false }); }
  if (JSON.stringify(next) !== JSON.stringify(shared(ORDER) ?? [])) setShared(ORDER, next);
}
