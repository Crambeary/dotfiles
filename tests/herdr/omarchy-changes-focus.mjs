// Run: node --experimental-vm-modules tests/herdr/omarchy-changes-focus.mjs
// Render the real toolbar and tab eligibility against focus-dependent snapshots.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule } from 'node:vm';

class Element {
  constructor() {
    this.nodes = [];
    const proxy = new Proxy(this, { get: (o, k) => k in o ? o[k] : () => proxy });
    return proxy;
  }
  id(key) { this.key = key; return this; }
  child(node) { this.nodes.push(node); return this; }
  children(nodes) { nodes.forEach(n => this.child(n)); return this; }
  when(on, fn) { return on ? fn(this) : this; }
}
const el = () => new Element();
const colors = new Proxy({}, { get: () => '#112233' });
let space, ps;
const tree = { id: 'panel', hidden: false, children: [{ id: 'panel-body', active: 'changes', children: [
  { id: 'files' }, { id: 'changes', content: { mod: 'gitview' } }, { id: 'graph' },
] }] };
const api = {
  spaces: () => [space], panes: () => ps, terminals: () => [], theme: () => colors,
  layout: () => tree, window: () => ({}), shared: () => undefined, props: () => ({}),
  settings: () => ({}), focused: () => ({}),
};
async function load(name) {
  const path = `private_dot_config/herdr-app/mods/${name}/main.js`;
  const source = await readFile(path, 'utf8');
  const module = new SourceTextModule(source);
  await module.link(async (specifier) => {
    // Stub host APIs and unrelated helpers; exercise each mod's actual render.
    const imports = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)];
    const names = imports.filter(m => m[2] === specifier).flatMap(m => m[1].split(',').map(n => n.trim()));
    return new SyntheticModule(names, function () {
      for (const key of names) this.setExport(key, key === 'View' ? class {} :
        ['div', 'svg', 'image', 'h_flex', 'v_flex'].includes(key) ? el : api[key] ?? (() => {}));
    });
  });
  await module.evaluate();
  return module.namespace.default;
}
const Bar = await load('omarchy-bar');
const Tabs = await load('omarchy-tabs');
const bar = new Bar(), tabs = new Tabs();
tabs.track = () => {};
tabs.autoTitle = true;
let enabled;
tabs.syncPanel = (_space, _panel, _body, ids) => { enabled = ids; };
function contains(node, key) {
  return node?.key === key || (node?.nodes ?? []).some(n => contains(n, key));
}
function check(label, branch, terminalBranch, expected) {
  space = { id: 'space', active: true, branch, tabs: [{ id: 'tab', active: true, name: 'Work', named: true }] };
  ps = [{ pane: 'terminal', terminal: 't1', tab: 'tab', branch: terminalBranch, title: 'Work' },
    { pane: 'diff', terminal: null, mod: 'gitview-diff', tab: 'tab', branch: null },
    { pane: 'elsewhere', terminal: 't2', tab: 'other-space-tab', branch: 'main' }];
  const row = bar.right(el(), colors);
  assert.equal(contains(row, 'panel-changes'), expected, `${label}: Changes button`);
  tabs.render({});
  assert.equal(enabled.includes('changes'), expected, `${label}: per-space panel eligibility`);
  console.log(`PASS ${label}`);
}
check('terminal focused', 'main', 'main', true);
check('gitview focused, space branch unavailable', null, 'main', true);
check('outside a Git repo', null, null, false);
