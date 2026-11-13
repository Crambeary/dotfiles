// omarchy-screensaver: the tuios screensavers (tuiffects: a Go port of
// TerminalTextEffects) on the whole herdr window, rebuilt as text from the layout
// and the app's data (skeleton.js). An empty floating watcher polls the desktop
// idle time; past the delay it starts saver.sh in a terminal, shows it in a
// full-window overlay, and hands it the frame. A key, or the mouse moving or
// clicking over the window, ends it (the terminal exits, the overlay closes).
//   layout:   root "floating": [{ "id": "screensaver", "content": { "mod": "omarchy-screensaver" } }]
//   command:  "alt-ctrl-s": "omarchy-screensaver:start"   (keys.json)
//   settings: shared("screensaver") = { enabled, idle_seconds, effect, seconds, source: "window" | "terminal" }
//             seconds: cap on one effect (tuiffects -t); default 0, every effect plays to its end
import { View, div } from "gpui-kit";
import { exec, appHome, focused, readTextFile, writeTextFile, shared, setShared, window, openOverlay, nextCommand } from "herdr";
import { skeleton, snapshot } from "./skeleton.js";

const IDLE_SECONDS = 300;

async function systemIdle() {
  try {
    if (window().platform === "macos") {
      const r = await exec("sh", ["-c", "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print $NF/1000000000; exit}'"], { timeout: 3000 });
      const v = parseFloat(r.stdout);
      return Number.isFinite(v) ? v : null;
    }
    const r = await exec("xprintidle", [], { timeout: 3000 });
    const v = parseInt(r.stdout, 10);
    return Number.isFinite(v) ? v / 1000 : null;
  } catch { return null; }
}

export default class Screensaver extends View {
  init(_props, cx) {
    setShared("screensaver_open", false); // persisted: a reload mid-run would leave it stuck
    cx.spawn(async (cx) => {
      for (;;) {
        await cx.sleep(5000);
        const cfg = shared("screensaver") ?? {};
        if (cfg.enabled === false || shared("screensaver_open")) continue;
        const idle = await systemIdle();
        if (idle != null && idle >= (cfg.idle_seconds ?? IDLE_SECONDS)) await this.start(cx, cfg.effect);
      }
    });
    cx.spawn(async (cx) => {
      for (;;) if ((await nextCommand()) === "start" && !shared("screensaver_open")) await this.start(cx);
    });
  }

  async start(cx, effect) {
    const snap = snapshot();
    const fallback = focused()?.terminal;
    if (!snap.tab) return;
    const mod = `${appHome()}/mods/omarchy-screensaver`, frame = `${appHome()}/data/screensaver.ans`;
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setShared("screensaver_open", true);
    try {
      const r = await exec("hc", ["run", "--bg", "--json", "--no-parent", "--rm", "--name", "screensaver",
        "bash", `${mod}/saver.sh`, frame, nonce, effect ?? "random", fallback ?? "",
        String((shared("screensaver") ?? {}).seconds ?? 0)], { timeout: 10000 });
      const address = JSON.parse(r.stdout).address;
      openOverlay({ kind: "dialog", frame: "none", modal: true, width: 1, height: 1,
        layout: { type: "block", content: { terminal: address } } });
      // The terminal starts small and the overlay resizes it: render once its size holds.
      if ((shared("screensaver") ?? {}).source !== "terminal") {
        let last = "", same = 0, size = null;
        for (let i = 0; i < 40 && same < 3; i++) {
          await cx.sleep(100);
          const g = await exec("hc", ["get", address, "--json"], { timeout: 3000 }).catch(() => null);
          try { const j = JSON.parse(g.stdout); size = [j.cols, j.rows]; } catch { continue; }
          same = String(size) === last ? same + 1 : 0; last = String(size);
        }
        if (size) {
          const text = await skeleton(size[0], size[1], snap);
          const old = await readTextFile(frame).catch(() => null);
          await writeTextFile(frame, `${nonce}\n${text}`, old);
        }
      }
      // Until the terminal is gone: saver.sh ends on a key, or on the mouse moving or
      // clicking over the window (its terminal reports the mouse). Input elsewhere on
      // the desktop doesn't end it, as tuios's saver only sees its own terminal.
      for (;;) {
        await cx.sleep(2000);
        const g = await exec("hc", ["get", address], { timeout: 3000 }).catch(() => null);
        if (!g || g.code !== 0) break;
      }
    } catch (e) {
      console.log("screensaver:", String(e));
    } finally {
      setShared("screensaver_open", false);
    }
  }

  render() { return div(); } // floats in the layout with nothing to show, like pane-ops
}
