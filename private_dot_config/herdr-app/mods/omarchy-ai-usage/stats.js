// System stats for the footer: one `sh -c` every few seconds, parsed here so macOS and Linux share a shape.
// Pure (no `herdr` import) so tests can load it.

// Sections start with `##name`; the script picks the OS itself so the mod needs no platform switch.
export const SCRIPT = `os=$(uname -s)
echo "##os $os"
if [ "$os" = Darwin ]; then
  echo "##cpu"; top -l 2 -n 0 -s 1 | grep '^CPU usage'
  echo "##vm"; vm_stat
  echo "##memsize"; sysctl -n hw.memsize
  echo "##batt"; pmset -g batt
  echo "##gpu"; ioreg -r -d 1 -w 0 -c IOAccelerator | grep -o '"Device Utilization %"=[0-9]*'
else
  echo "##cpu"; head -1 /proc/stat
  echo "##mem"; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo
  echo "##batt"; for b in /sys/class/power_supply/BAT*; do [ -r "$b/capacity" ] && echo "$(cat "$b/capacity") $(cat "$b/status" 2>/dev/null)"; done
  echo "##gpu"; nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null || cat /sys/class/drm/card*/device/gpu_busy_percent 2>/dev/null
fi`;

export const HISTORY = 12;

export function sections(text) {
  const out = {};
  let name = null;
  for (const line of String(text ?? "").split("\n")) {
    const m = /^##(\w+)\s*(.*)$/.exec(line);
    if (m) { name = m[1]; out[name] = m[2] ? [m[2]] : []; }
    else if (name && line.trim()) out[name].push(line);
  }
  return out;
}

const pct = v => Math.min(100, Math.max(0, Math.round(v)));
const num = (re, text) => { const m = re.exec(text); return m ? Number(m[1]) : null; };
const maxOf = lines => {
  const ns = lines.map(l => Number(l.trim().split(/[\s,]+/)[0])).filter(Number.isFinite);
  return ns.length ? pct(Math.max(...ns)) : null;
};

function darwin(s) {
  const idle = num(/([\d.]+)% idle/, (s.cpu ?? []).at(-1) ?? "");
  const vm = (s.vm ?? []).join("\n");
  const page = num(/page size of (\d+) bytes/, vm);
  const pages = ["Pages active", "Pages wired down", "Pages occupied by compressor"].map(k => num(new RegExp(`${k}:\\s+(\\d+)`), vm));
  const total = Number(s.memsize?.[0]);
  const mem = page && total && pages.every(n => n !== null)
    ? (used => ({ used, total, pct: pct(used / total * 100) }))(pages.reduce((a, b) => a + b, 0) * page) : null;
  const text = (s.batt ?? []).join("\n");
  const b = /(\d+)%;\s*([a-z ]+);/.exec(text);
  const batt = b ? { pct: Number(b[1]), charging: /AC Power/.test(text) || /^(charging|charged|finishing charge)$/.test(b[2]) } : null;
  const gpu = maxOf((s.gpu ?? []).map(l => l.split("=")[1] ?? ""));
  return { cpu: idle === null ? null : pct(100 - idle), cpuRaw: null, mem, gpu, batt };
}

function linux(s, prev) {
  const f = (s.cpu?.[0] ?? "").trim().split(/\s+/).slice(1, 9).map(Number);
  let cpu = null, cpuRaw = null;
  if (f.length >= 4 && f.every(Number.isFinite)) {
    cpuRaw = { total: f.reduce((a, b) => a + b, 0), idle: f[3] + (f[4] ?? 0) };
    if (prev && cpuRaw.total > prev.total) cpu = pct((1 - (cpuRaw.idle - prev.idle) / (cpuRaw.total - prev.total)) * 100);
  }
  const text = (s.mem ?? []).join("\n");
  const total = num(/MemTotal:\s+(\d+)/, text), avail = num(/MemAvailable:\s+(\d+)/, text);
  const mem = total && avail !== null ? (used => ({ used, total: total * 1024, pct: pct(used / (total * 1024) * 100) }))((total - avail) * 1024) : null;
  const b = /^(\d+)\s*(.*)$/.exec((s.batt ?? [])[0]?.trim() ?? "");
  const batt = b ? { pct: Number(b[1]), charging: b[2] !== "Discharging" } : null;
  return { cpu, cpuRaw, mem, gpu: maxOf(s.gpu ?? []), batt };
}

const push = (hist, v) => (v === null ? hist : [...hist, v].slice(-HISTORY));

// `prev` is the last result; Linux CPU is a delta of /proc/stat against it. Returns null on unusable output.
export function parseStats(text, prev) {
  const s = sections(text);
  const os = (s.os?.[0] ?? "").trim();
  if (os !== "Darwin" && os !== "Linux") return null;
  const r = os === "Darwin" ? darwin(s) : linux(s, prev?.cpuRaw);
  const history = prev?.history ?? { cpu: [], gpu: [] };
  return { ...r, os: os.toLowerCase(), history: { cpu: push(history.cpu, r.cpu), gpu: push(history.gpu, r.gpu) } };
}
