// Run: node --experimental-vm-modules tests/herdr/ai-usage.mjs
// omarchy-ai-usage providers.js with a stubbed `herdr` module: Keychain fallback, no token in errors, one Claude source.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SourceTextModule, SyntheticModule } from 'node:vm';

const dir = resolve('private_dot_config/herdr-app/mods/omarchy-ai-usage');
const SECRET = 'sk-ant-oat01-SECRET-TOKEN-VALUE';
const state = { files: {}, execs: [], keychain: null, fetched: [] };
const api = {
  home: () => '/h',
  readTextFile: async p => { if (p in state.files) return state.files[p]; throw new Error('ENOENT'); },
  exec: async (cmd, args) => { state.execs.push([cmd, ...args]); if (state.keychain === null) return { code: 44, stdout: '' }; return { code: 0, stdout: state.keychain }; },
};
globalThis.fetch = async (url, opts) => { state.fetched.push(opts.headers.Authorization); return { ok: true, json: async () => ({ five_hour: { utilization: 10, resets_at: null }, seven_day: { utilization: 20, resets_at: null } }) }; };

const cache = new Map();
async function build(name) {
  if (cache.has(name)) return cache.get(name);
  const source = await readFile(`${dir}/${name}`, 'utf8');
  const m = new SourceTextModule(source); cache.set(name, m);
  await m.link(async spec => {
    if (spec.startsWith('./')) return build(spec.slice(2));
    const names = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']herdr["']/g)].flatMap(x => x[1].split(',').map(n => n.trim()));
    return new SyntheticModule(names, function () { for (const k of names) this.setExport(k, api[k] ?? (() => null)); });
  });
  return m;
}
const mod = await build('providers.js'); await mod.evaluate();
const { sourcesFor, fetchUsage } = mod.namespace;

// One Claude source, whichever terminal asks.
const v = { terminal: 't1', program: { key: 'claude', name: 'Claude Code', icon: null, tint: null } };
const srcs = await sourcesFor(v);
assert.equal(srcs.length, 1);
assert.equal(srcs[0].id, 'claude');
assert.ok(!JSON.stringify(srcs).includes('claude-personal'));

// Keychain path when the credentials file is missing.
state.keychain = JSON.stringify({ claudeAiOauth: { accessToken: SECRET, expiresAt: Date.now() + 3600e3 } });
const ws = await fetchUsage(srcs[0]);
assert.deepEqual(state.execs[0], ['security', 'find-generic-password', '-s', 'Claude Code-credentials', '-w']);
assert.equal(state.fetched[0], `Bearer ${SECRET}`);
assert.deepEqual(ws.map(w => w.short), ['5h', '7d']);
assert.ok(!JSON.stringify(ws).includes(SECRET));

// File wins; Keychain not consulted.
state.execs.length = 0;
state.files['/h/.claude/.credentials.json'] = JSON.stringify({ claudeAiOauth: { accessToken: 'file-token', expiresAt: Date.now() + 3600e3 } });
await fetchUsage(srcs[0]);
assert.equal(state.execs.length, 0);
assert.equal(state.fetched.at(-1), 'Bearer file-token');
delete state.files['/h/.claude/.credentials.json'];

// Errors carry no token: no Keychain item, unparsable output, expired token.
for (const kc of [null, 'not json ' + SECRET, JSON.stringify({ claudeAiOauth: { accessToken: SECRET, expiresAt: 1 } })]) {
  state.keychain = kc;
  await assert.rejects(fetchUsage(srcs[0]), e => { assert.ok(!e.message.includes(SECRET), e.message); return true; });
}
state.keychain = null;
await assert.rejects(fetchUsage(srcs[0]), /no Claude Code login/);
console.log('ai-usage: ok');
