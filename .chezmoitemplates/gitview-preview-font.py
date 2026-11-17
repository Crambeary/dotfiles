"""Reapply the personal preview controls after Chezmoi extracts Gitview.

Validate every anchor before writing anything. Accept already-patched files,
but fail visibly if an upstream upgrade needs a fresh integration review.
"""
from pathlib import Path
import sys


def patched(text, old, new, name):
    # An old anchor can be a suffix of its replacement.
    if text.count(new) == 1 and old not in text.replace(new, "", 1):
        return text
    if text.count(old) != 1 or new in text:
        raise ValueError(f"Gitview preview font patch: {name} changed upstream; review the patch")
    return text.replace(old, new, 1)


def apply(folder):
    folder = Path(folder)
    if not folder.exists():
        return
    if not (folder / "preview-font.js").is_file():
        raise ValueError("Gitview preview font patch: install preview-font.js first")
    edits = {
        "main.js": [
            (
                'import * as diffs from "./diffview.js";\n',
                'import { previewFontHelp, previewFontKey } from "./preview-font.js";\nimport * as diffs from "./diffview.js";\n',
            ),
            (
                'const KEYS = [\n',
                'const KEYS = [\n  ...previewFontHelp,\n',
            ),
            (
                '    const act = actionFor([KEYS], k);\n',
                '    if (this.inPreview() && previewFontKey(k, previewKind(this.view))) return true;\n    const act = actionFor([KEYS], k);\n',
            ),
        ],
        "preview.js": [
            (
                'import { pill } from "./chrome.js";\n',
                'import { previewFontSize } from "./preview-font.js";\nimport { pill } from "./chrome.js";\n',
            ),
            (
                '    .font_family(ctx.uiFont)\n    .text_size(13)\n',
                '    .font_family(ctx.uiFont)\n    .text_size(previewFontSize())\n',
            ),
        ],
    }
    pending = []
    for name, replacements in edits.items():
        path = folder / name
        before = after = path.read_text()
        for old, new in replacements:
            after = patched(after, old, new, name)
        if after != before:
            pending.append((path, after))
    for path, content in pending:
        staging = path.with_name("." + path.name + ".preview-font-patch")
        staging.write_text(content)
        staging.replace(path)


if __name__ == "__main__":
    apply(sys.argv[1])
