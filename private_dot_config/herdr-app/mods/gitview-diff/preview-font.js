// Personal Gitview preview preference. Herdr persists shared state across restarts.
import { setShared, shared } from "herdr";

const KEY = "gitview.previewFontSize";
const DEFAULT = 16;
const MIN = 10;
const MAX = 32;
const clamp = (n) => Math.max(MIN, Math.min(MAX, Math.round(n)));

export function previewFontSize() {
  const saved = shared(KEY);
  return typeof saved === "number" && Number.isFinite(saved) ? clamp(saved) : DEFAULT;
}

// The caller routes only unmodified keys in Preview, outside the note composer.
export function previewFontKey(key, kind) {
  if (kind !== "markdown" && kind !== "html") return false;
  if (!["+", "=", "-", "0"].includes(key)) return false;
  setShared(KEY, key === "0" ? DEFAULT : clamp(previewFontSize() + (key === "-" ? -1 : 1)));
  return true;
}

const textPreview = (v) => v.inPreview() && ["markdown", "html"].includes(v.preview?.kind);
export const previewFontHelp = [
  { caps: ["+", "-"], label: "preview font size (= also enlarges)", when: textPreview, on: {} },
  { caps: ["0"], label: "reset preview font size (16 px)", when: textPreview, on: {} },
];
