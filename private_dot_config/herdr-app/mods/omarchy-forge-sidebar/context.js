// Pure helpers: the sidebar follows the active space, independently of Forge's
// globally remembered project and the existing per-space Files/Changes panel.
export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export function visible(node, id, hidden = false) {
  if (!node) return false;
  hidden ||= Boolean(node.hidden);
  if (node.id === id) return !hidden;
  const active = node.type === "stack" ? node.active ?? node.children?.[0]?.id : null;
  return (node.children ?? []).some(child => visible(child, id, hidden || (active != null && child.id !== active)));
}

export function contextOf(spaces, panes, focus) {
  const space = spaces.find(s => s.active);
  if (!space) return null;
  const tab = space.tabs?.find(t => t.active);
  const tabs = new Set((space.tabs ?? []).map(t => t.id));
  const terminals = panes.filter(p => p.terminal && p.cwd && tabs.has(p.tab));
  const cwd = (focus?.space === space.id && focus.terminal ? focus.cwd : null)
    ?? terminals.find(p => p.tab === tab?.id && p.focused)?.cwd
    ?? terminals.find(p => p.tab === tab?.id)?.cwd
    ?? terminals[0]?.cwd ?? space.folder;
  return cwd ? { space: space.id, cwd, on: space.machine ?? null } : null;
}

export const contextKey = c => c ? JSON.stringify([c.space, c.on, c.cwd]) : "";

export function projectOf(url, where) {
  const match = /^[\w.-]+@([^:/]+):(.+?)(?:\.git)?\/?$/.exec(url.trim())
    ?? /^\w+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!match) throw new Error("This checkout has no supported origin remote.");
  const host = match[1].toLowerCase(), repo = match[2];
  if (/(^|\.)(bitbucket\.org|codeberg\.org|sr\.ht)$/.test(host)) throw new Error("Forge supports GitLab and GitHub repositories.");
  return { host, repo, provider: /(^|[.-])github([.-]|$)/.test(host) ? "github" : "gitlab", on: where.on };
}

// Pin the version carried by the installed Forge panels we inspected. The
// unversioned agent entry point may advance independently; list commands are
// internal contracts. Fail visibly if this copy is absent or has another shape.
export const BACKEND_VERSION = "0.1.6+4f839e38dd0e";
// Match Forge's touch-and-run boot: its installer prunes version copies whose
// mtime says nobody has used them for two weeks. Never create a missing copy.
const BOOT = `import os,sys
d=os.environ.get("HERDR_FORGE_HOME") or os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"),"herdr-forge")
p=os.path.join(d,"forge-${BACKEND_VERSION}.py")
if not os.path.exists(p): sys.exit(2)
try: os.utime(p)
except OSError: pass
sys.argv=[p]+sys.argv[1:]
exec(compile(open(p,"rb").read(),p,"exec"),{"__name__":"__main__","__file__":p})`;
export const BACKEND = `exec python3 -I -c '${BOOT}' "$@"`;
export const versionArgs = () => ["-c", BACKEND, "forge-sidebar", "version"];
export function validateBackend(result) {
  if (result.code !== 0) throw new Error(`Forge backend ${BACKEND_VERSION} is missing. Open the installed Forge panels on this machine to install it, then refresh.`);
  let out;
  try { out = JSON.parse(result.stdout); } catch { /* report compatibility below */ }
  if (out?.version !== BACKEND_VERSION || out?.shapes !== 2) {
    throw new Error(`Incompatible Forge backend. This sidebar needs ${BACKEND_VERSION} with shapes 2. Reinstall matching Forge panels or update the sidebar, then refresh.`);
  }
}

// Values are separate argv entries, never interpolated shell text. Forge reads
// only; boot refreshes the backend's local last-used timestamp.
export function readArgs(project, view, force = false) {
  return ["-c", BACKEND, "forge-sidebar", view, project.provider, project.host, project.repo, force ? "0" : "60", force ? "1" : "0"];
}

export function jobsArgs(project, id) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid pipeline ID.");
  return ["-c", BACKEND, "forge-sidebar", "jobs", project.provider, project.host, project.repo, String(id), "60", "0"];
}

export function parseReply(result, view) {
  if (result.code !== 0) throw new Error("Forge backend could not run. Open Forge once on this machine to install it; check its CLI connection, then refresh.");
  let out;
  try { out = JSON.parse(result.stdout); } catch { throw new Error("Forge returned an invalid response. Refresh to retry."); }
  const rows = out[view];
  if (!Array.isArray(rows)) throw new Error(out.error ? String(out.error) : "Forge returned no list. Refresh to retry.");
  return { rows, at: Number.isFinite(out.at) && out.at > 0 ? out.at * 1000 : null,
    error: out.error ? String(out.error) : null };
}
