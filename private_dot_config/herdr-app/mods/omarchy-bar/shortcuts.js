import { keys, shared, window } from "herdr";

function keyLabel(strokes) {
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return strokes.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

// Resolve layout overrides before matching actions, so a rebound key never advertises its old action.
export function buttonTip(name, actions = [], hint = "") {
  const section = `layout:${shared("layout")}`;
  const all = keys();
  const local = all.filter(k => k.section === section);
  const overridden = new Set(local.map(k => keyLabel(k.keys)));
  const effective = [...local, ...all.filter(k => k.section === "global" && !overridden.has(keyLabel(k.keys)))];
  const wanted = Array.isArray(actions) ? actions : [actions];
  const shortcuts = [...new Set(effective.filter(k => wanted.includes(k.action)).map(k => keyLabel(k.keys)))];
  return `${name}${shortcuts.length ? ` · ${shortcuts.join(" / ")}` : ""}${hint ? `\n${hint}` : ""}`;
}
