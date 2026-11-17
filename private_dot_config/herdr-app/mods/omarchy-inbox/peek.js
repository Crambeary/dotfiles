import { shared, run, openOverlay } from "herdr";

// Identical in omarchy-inbox/peek.js and omarchy-agents/peek.js: mod imports stay within their own folder.
// Keep other layouts on Herdr's native peek. Both Omarchy sidebars share this frame.
export function peekTerminal(terminal) {
  if (shared("layout") !== "omarchy") return run("terminal.peek", { terminal });
  return openOverlay({
    kind: "dialog", frame: "none", width: 0.8, height: 0.8,
    layout: {
      type: "column", background: "background", radius: 0,
      border: { width: 2, color: "accent" }, resizable: false,
      children: [
        { type: "block", size: { px: 30 }, content: { mod: "omarchy-peek", props: { terminal } } },
        { type: "block", content: { terminal } },
      ],
    },
  });
}
