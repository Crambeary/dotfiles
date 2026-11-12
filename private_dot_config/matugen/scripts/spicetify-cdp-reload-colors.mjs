// Bumps the cache-busting query string on Spotify's spicetify-generated
// colors.css <link>, forcing the browser to refetch just that stylesheet.
// CSS custom properties (--spice-*) cascade instantly to everything using
// var(--spice-main) etc, so this is a live color swap with no navigation --
// unlike spicetify's own "watch" mode, which does a full CDP Page.reload()
// and resets the SPA back to Home.
//
// Requires Spotify's remote-debugging port to already be up (spicetify
// enable-devtools / a prior "spicetify watch" run turns this on
// persistently). If the port isn't reachable, exit non-zero so the caller
// can fall back to a full reload.
const PORT = 9222;

const res = await fetch(`http://127.0.0.1:${PORT}/json`).catch(() => null);
if (!res || !res.ok) process.exit(1);

const targets = await res.json();
const page = targets.find((t) => t.type === "page" && t.url.includes("xpui.app.spotify.com"));
if (!page) process.exit(1);

const ws = new WebSocket(page.webSocketDebuggerUrl);

const expression = `
(() => {
  let n = 0;
  document.querySelectorAll('link[href*="colors.css"]').forEach((l) => {
    l.href = l.href.split('?')[0] + '?t=' + Date.now();
    n++;
  });
  return n;
})()
`;

const done = (code) => {
  try { ws.close(); } catch {}
  process.exit(code);
};

ws.onopen = () => {
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression } }));
};
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  const n = msg?.result?.result?.value;
  done(n > 0 ? 0 : 1);
};
ws.onerror = () => done(1);
setTimeout(() => done(1), 5000);
