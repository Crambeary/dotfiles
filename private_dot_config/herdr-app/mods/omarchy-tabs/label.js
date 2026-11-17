// What a tab says: its name, the tooltip's detail, its status word and the icons of the agents in it.
// Shared by the strip's tabs and the stack menu's rows.
import { shared } from "herdr";

export const STATUS = { working: "Working", blocked: "Needs input", done: "Done", idle: "Idle" };

export function describeTab(c, allPanes, allTerminals, autoTitle) {
  const tabPanes = allPanes.filter(p => p.tab === c.id);
  const lead = tabPanes.find(p => p.program?.agent && p.status === c.status) ?? tabPanes.find(p => p.program?.agent) ?? tabPanes[0];
  const program = lead?.program;
  const terminal = allTerminals.find(p => p.address === lead?.terminal);
  const report = Object.values(terminal?.records ?? {}).find(r => r.state === c.status && r.title);
  const liveTitle = terminal?.report?.title || report?.title || lead?.title;
  const title = (liveTitle === program?.name ? lead?.branch || liveTitle : liveTitle || "").replace(/^\[[^\]]*\]\s*[^|]*\|\s*/, "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const status = STATUS[c.status];
  // A tab with several agents shows their icons; the person's own tab name wins (names.js records its own names).
  const agentPanes = tabPanes.filter(p => p.program?.agent);
  const programs = [...new Map(agentPanes.map(p => [p.program.name, p.program])).values()];
  const multi = agentPanes.length > 1;
  const personNamed = c.named && shared("tab-titles.set")?.[c.id] !== c.name && !programs.some(p => p.name === c.name);
  // The icons already say which agents run here; the label carries what they work on.
  const isProgram = n => !n || tabPanes.some(p => p.program?.name === n || p.terminal === n) || n === "Claude Code";
  const folder = lead?.cwd ? (/^\/(home\/[^/]+|root)\/?$/.test(lead.cwd) ? "~" : lead.cwd.split("/").filter(Boolean).pop()) : "";
  const work = [title, folder, lead?.branch].find(n => !isProgram(n)) ?? (isProgram(c.name) ? "" : c.name);
  // Auto Title's names are meant to be read as given: a tab it names after a running program (ping) says what
  // runs there, which no icon does. Only an agent's own name says nothing the icon doesn't.
  const agentName = !c.name || programs.some(p => p.name === c.name) || c.name === "Claude Code";
  const name = autoTitle && c.named ? (agentName ? work : c.name) : personNamed && !isProgram(c.name) ? c.name : work;
  const detail = multi
    ? agentPanes.map(p => `${p.program.name}: ${({ working: "working", blocked: "needs input", done: "done" })[p.status] ?? "idle"}`).join("\n")
    : [status, c.named && title && title !== c.name ? title : program?.name].filter(Boolean).join(" · ");
  const icons = (multi ? programs.slice(0, 3) : [program]).filter(p => p?.icon);
  return { name, detail, status, icons };
}
