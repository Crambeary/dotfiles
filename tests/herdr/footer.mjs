// Run: node --experimental-vm-modules tests/herdr/footer.mjs
// omarchy-ai-usage stats.js (macOS and Linux output) and footer.js (segments per density). Both are pure.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SourceTextModule } from 'node:vm';

const dir = resolve('private_dot_config/herdr-app/mods/omarchy-ai-usage');
const cache = new Map();
async function build(name) {
  if (cache.has(name)) return cache.get(name);
  const m = new SourceTextModule(await readFile(`${dir}/${name}`, 'utf8')); cache.set(name, m);
  await m.link(spec => build(spec.slice(2)));
  return m;
}
const load = async name => { const m = await build(name); await m.evaluate(); return m.namespace; };
const { parseStats, sections, SCRIPT } = await load('stats.js');
const { footerModel, sysItems, windowsFor, spark, nextDensity, densityOf, HEIGHT } = await load('footer.js');

const DARWIN = `##os Darwin
##cpu
CPU usage: 12.99% user, 12.15% sys, 74.85% idle 
##vm
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     4212.
Pages active:                                 944158.
Pages wired down:                             200000.
Pages occupied by compressor:                 100000.
##memsize
68719476736
##batt
Now drawing from 'AC Power'
 -InternalBattery-0 (id=23068771)	100%; charged; 0:00 remaining present: true
##gpu
"Device Utilization %"=23
`;
const m = parseStats(DARWIN);
assert.equal(m.os, 'darwin');
assert.equal(m.cpu, 25);
assert.equal(m.mem.pct, Math.round((1244158 * 16384) / 68719476736 * 100));
assert.equal(m.mem.total, 68719476736);
assert.deepEqual(m.batt, { pct: 100, charging: true });
assert.equal(m.gpu, 23);
// Discharging on battery; desktop Mac with no battery and no GPU line.
const dis = parseStats(DARWIN.replace("'AC Power'", "'Battery Power'").replace('100%; charged', '64%; discharging'));
assert.deepEqual(dis.batt, { pct: 64, charging: false });
const bare = parseStats('##os Darwin\n##cpu\n##batt\nNow drawing from \'AC Power\'\n##gpu\n');
assert.equal(bare.cpu, null); assert.equal(bare.batt, null); assert.equal(bare.gpu, null); assert.equal(bare.mem, null);

const linux = (user, idle, extra = '') => `##os Linux
##cpu
cpu  ${user} 0 0 ${idle} 0 0 0 0 0 0
##mem
MemTotal:       16000000 kB
MemAvailable:    4000000 kB
##batt
87 Discharging
##gpu
${extra}`;
const first = parseStats(linux(100, 900, '41\n7\n'));
assert.equal(first.os, 'linux');
assert.equal(first.cpu, null, 'one /proc/stat sample has no delta');
assert.equal(first.mem.pct, 75);
assert.deepEqual(first.batt, { pct: 87, charging: false });
assert.equal(first.gpu, 41, 'busiest GPU');
const second = parseStats(linux(130, 970), first);
assert.equal(second.cpu, 30, '30 busy of 100 ticks');
assert.equal(second.gpu, null);
assert.deepEqual(second.history.cpu, [30]);
assert.equal(parseStats('##os Linux\n##cpu\n##batt\n87 Charging\n##gpu\n').batt.charging, true);
assert.equal(parseStats('garbage'), null);
assert.equal(parseStats(''), null);
assert.deepEqual(sections('##os Linux\n##cpu\nx\n').cpu, ['x']);
assert.match(SCRIPT, /uname/);

// History keeps the last 12 readings.
let st = null;
for (let i = 0; i < 15; i++) st = parseStats(DARWIN, st);
assert.equal(st.history.cpu.length, 12);

// Footer segments per density.
const ws = [{ short: '5h', used: 14, resets_at: null, span: 1 }, { short: '7d', used: 20, resets_at: null, span: 1 }];
const rows = [
  { s: { id: 'claude', label: 'Work' }, u: { windows: ws, fetched: 'x' }, stale: false },
  { s: { id: 'codex', label: 'codex' }, u: { windows: [{ short: '5h', used: 62 }, { short: '7d', used: 9 }], fetched: 'x' }, stale: true },
];
const stats = { ...m, history: { cpu: [10, 50, 90], gpu: [] } };
const compact = footerModel({ density: 'compact', rows, stats });
assert.equal(compact.height, 22);
assert.deepEqual(compact.providers.map(p => p.windows.map(w => w.short)), [['7d'], ['5h']], 'tightest window only');
assert.deepEqual(compact.providers.map(p => p.stale), [false, true]);
assert.ok(compact.providers.every(p => p.windows.every(w => w.bar === 36)));
assert.deepEqual(compact.sys.map(i => i.key), ['cpu', 'mem', 'gpu', 'batt']);
assert.ok(compact.sys.every(i => !i.spark && !i.detail));
const normal = footerModel({ density: 'normal', rows, stats });
assert.equal(normal.height, 30);
assert.deepEqual(normal.providers.map(p => p.windows.map(w => w.short)), [['5h', '7d'], ['5h', '7d']]);
assert.ok(normal.providers[0].windows.every(w => w.bar === 60));
const exp = footerModel({ density: 'expanded', rows, stats });
assert.equal(exp.height, 56);
assert.equal(exp.sys.find(i => i.key === 'cpu').spark, '▁▅█');
assert.equal(exp.sys.find(i => i.key === 'mem').detail, `${Math.round(m.mem.used / 2 ** 30)}G/64G`);
assert.ok(exp.providers[0].windows.every(w => w.bar === 90));
// Narrow window: compact drops the bar, normal drops reset text.
const narrow = footerModel({ density: 'compact', narrow: true, rows, stats });
assert.ok(narrow.providers.every(p => p.windows.every(w => w.bar === 0)));
// Notes and missing data.
const noted = footerModel({ density: 'normal', rows: [{ s: { id: 'x', label: 'pi', note: 'no limits API' }, u: null }, { s: { id: 'y', label: 'Y' }, u: { error: 'boom' } }, { s: { id: 'z', label: 'Z' }, u: null }], stats: null });
assert.deepEqual(noted.providers.map(p => p.note), ['no limits API', 'no data', '…']);
assert.deepEqual(noted.sys, []);
// Battery shows the bolt while charging, BAT otherwise.
assert.equal(sysItems('normal', stats).at(-1).label, '⚡');
assert.equal(sysItems('normal', dis).at(-1).label, 'BAT');
// Density cycling.
assert.deepEqual(['compact', 'normal', 'expanded', 'compact'].map(nextDensity), ['normal', 'expanded', 'compact', 'normal']);
assert.equal(densityOf('bogus'), 'normal');
assert.equal(HEIGHT.normal, 30);
assert.equal(spark([0, 100]), '▁█');
assert.equal(windowsFor('compact', []).length, 0);
console.log('footer: ok');
