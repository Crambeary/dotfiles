// Sidebar-owned extension, not a patch to Forge's generated/versioned backend.
// Transport the checked-in program as argv to the origin machine: it needs only
// that machine's exact backend + CLI login, never a local repository or helper.
import { BACKEND_VERSION } from "./context.js";

export const PIN_READ = String.raw`
import json, os, runpy, sys

def read():
    version, mode, provider, host, repo, ident, age = sys.argv[1:]
    pid, age = int(ident), int(age)
    if mode not in ("status", "jobs") or pid <= 0 or provider not in ("gitlab", "github") or age < 0:
        raise RuntimeError("Invalid pinned pipeline read")
    home = os.environ.get("HERDR_FORGE_HOME") or os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "herdr-forge")
    path = os.path.join(home, "forge-" + version + ".py")
    if not os.path.isfile(path):
        raise RuntimeError("Pinned Forge backend missing on origin machine: " + version)
    f = runpy.run_path(path, run_name="sidebar_pin_reader")
    if f.get("VERSION") != version or f.get("SHAPES") != 2:
        raise RuntimeError("Incompatible Forge backend on origin machine")
    if not callable(f.get("Project")) or not callable(f.get("ms")):
        raise RuntimeError("Forge backend lacks pinned-read capability")
    try:
        os.utime(path)
    except OSError:
        pass
    p = f["Project"](provider, host, repo)
    if not all(callable(getattr(p, name, None)) for name in ("cached", "jobs")) or not callable(getattr(p.forge, "api", None)):
        raise RuntimeError("Forge backend lacks pinned-read capability")
    if provider == "github" and not callable(getattr(p.forge, "run_out", None)):
        raise RuntimeError("Forge backend lacks workflow-run normalization")
    def detail():
        if provider == "gitlab":
            r = p.forge.api(p.forge.project + "/pipelines/" + str(pid))
            row = {"id": r["id"], "iid": r.get("iid"), "ref": r.get("ref"), "sha": r.get("sha"),
                   "status": r["status"], "updated_ms": f["ms"](r.get("updated_at")), "url": r["web_url"]}
        else:
            r = p.forge.api(p.forge.repo + "/actions/runs/" + str(pid))
            row = p.forge.run_out(r)
        if row.get("id") != pid or not isinstance(row.get("status"), str) or not row["status"]:
            raise RuntimeError("Pinned pipeline detail returned another run or no status")
        return row
    # Distinct from Forge's recent-20 list; the jobs cache is shared with Forge.
    if mode == "jobs":
        return p.jobs(pid, age, False)
    row, at, error = p.cached("sidebar-pin-v1:" + str(pid), age, detail, None)
    return {"row": row, "at": at, "error": error}

try:
    out = read()
except Exception as e:
    out = {"error": str(e) if isinstance(e, RuntimeError) else type(e).__name__ + ": " + str(e)}
print(json.dumps(out))
`;

export function pinReadArgs(project, id, age = 60, mode = "status") {
  if (!Number.isSafeInteger(id) || id <= 0 || ![60, 300].includes(age) || !["status", "jobs"].includes(mode)) throw new Error("Invalid pinned pipeline read.");
  return ["-I", "-c", PIN_READ, BACKEND_VERSION, mode, project.provider, project.host, project.repo, String(id), String(age)];
}

const stamp = at => Number.isFinite(at) && at > 0 ? at * 1000 : null;
export function parsePinReply(out, id, mode = "status") {
  if (out.code !== 0) throw new Error("Pinned pipeline read failed on origin machine.");
  let r;
  try { r = JSON.parse(out.stdout); } catch { throw new Error("Invalid pinned pipeline reply."); }
  if (mode === "jobs") {
    if (!Array.isArray(r?.jobs)) throw new Error(String(r?.error || "Pinned jobs reply has no jobs."));
    return { jobs: r.jobs, at: stamp(r.at), error: r.error || null };
  }
  if (!r?.row && r?.error) throw new Error(String(r.error));
  if (r?.row?.id !== id || typeof r.row.status !== "string" || !r.row.status) {
    throw new Error("Pinned pipeline reply has no matching pipeline/status/jobs.");
  }
  return { row: r.row, at: stamp(r.at), error: r.error || null };
}
