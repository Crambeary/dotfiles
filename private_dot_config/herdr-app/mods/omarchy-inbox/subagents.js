// Inbox-only grouping. Shared tree helpers remain unchanged for tabs, headers and Agents.
import { descendants, isAgent } from "./tree.js";

// agents() omits pane-less orphans. Keep live child agents eligible even after their parent exits.
export function inboxAgents(runs, all, spaces) {
  const live = new Map(all.filter(k => k.state === "live").map(k => [k.address, k]));
  const listed = new Map(runs.map(a => [a.address, a]));
  return [...runs, ...all.filter(k => k.state === "live" && k.parent && isAgent(k) && !listed.has(k.address)).map(k => {
    const seen = new Set([k.address]);
    let parent = live.get(k.parent), place;
    while (parent && !seen.has(parent.address)) {
      seen.add(parent.address);
      if (listed.has(parent.address)) { place = listed.get(parent.address); break; }
      parent = live.get(parent.parent);
    }
    const space = spaces.find(s => s.id === k.labels?.["herdr.space"]);
    return { ...k, pane: null, focused: false, space: place?.space ?? space?.id ?? null,
      space_name: place?.space_name ?? space?.name ?? "Subagents", tab: place?.tab ?? null,
      program: k.program ?? { name: k.report?.app || "Agent" } };
  })];
}

// Walk live parent links, including intermediate shells. A missing/ended link promotes an orphan.
export function inboxRoots(every, all) {
  const live = new Map(all.filter(k => k.state === "live").map(k => [k.address, k]));
  const listed = new Set(every.filter(a => !a.mod && live.has(a.address)).map(a => a.address));
  return every.filter(a => {
    const seen = new Set([a.address]);
    let k = live.get(live.get(a.address)?.parent), ancestor = false;
    while (k && !seen.has(k.address)) {
      seen.add(k.address);
      if (listed.has(k.address)) ancestor = true;
      k = live.get(k.parent);
    }
    // Malformed cycles must not make every card disappear.
    return k ? a.address === [...seen].filter(x => listed.has(x)).sort()[0] : !ancestor;
  });
}

export const treeMembers = (a, all) => [a, ...descendants(all, a.address)];
export const childrenExpanded = (choices, address, words) => choices[address] ?? words.includes("blocked");
export const childActivity = k => String(k.report?.msg || ({
  working: "Working", blocked: "Needs you", error: "Needs you", done: "Done", idle: "Idle",
})[k.status] || "Starting").replace(/\s+/g, " ").trim();
