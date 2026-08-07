#!/usr/bin/env python3
"""Claude Code PreToolUse hook: steer Bash away from grep/sed/find toward
rg/sd/fd, but only where the modern tool actually covers the same ground.

grep is denied outright (rg is a strict superset for this use). sed and find
are denied only for the shapes fd/sd genuinely cover; where they don't, the
legacy tool stays allowed rather than pushing Claude onto a worse workaround.
For sed that means ranges/prints/deletes stay allowed. For find the allowed
set is deliberately narrow — fd does have -x/-X (exec), -S (size),
--changed-within/--changed-before (mtime) and -o (owner), so those all route
to fd; only predicates fd cannot express at all stay with find.

Heuristic, not a shell parser: tokenizes with shlex (punctuation-aware so
`;`/`&&`/`|` split even without surrounding spaces), splits on those
operators, and inspects each segment's effective command name after
stripping sudo/env/xargs-style wrappers. Good enough to catch the common
cases; obfuscated invocations can still slip through.
"""
import json
import re
import shlex
import sys

DENY_EXIT = 2

CONTROL_OPERATORS = {"&&", "||", "|", ";", "&"}

# Wrapper words whose real payload command follows them. "rtk" is the local
# token-reducing CLI proxy: `rtk grep ...` must deny just like bare grep,
# while `rtk rg ...` stays allowed because rg is not a denied name.
WRAPPER_WORDS = {
    "sudo", "doas", "nice", "ionice", "time", "env", "command", "builtin", "rtk",
}

# xargs-specific flags that consume a following value token.
XARGS_VALUE_FLAGS = {"-I", "-n", "-P", "-L", "-s", "-a", "--max-args", "--max-procs"}

# fd is the general replacement for find, so find is denied by DEFAULT and
# escapes only via this list — the predicates fd genuinely cannot express.
# An allow-list alone is the right shape: a deny-list would silently pass
# anything it forgot to name (`find . -size +1M` has no -name/-type to catch).
#
# Deliberately NOT here, because fd does cover them: -exec/-execdir (fd -x per
# file, fd -X batched like `-exec {} +`), -size (fd -S), -mtime/-mmin
# (fd --changed-within/--changed-before), -user/-group (fd -o), -delete
# (fd -X rm). -ok/-okdir are omitted too: they prompt interactively, which is
# useless to an agent. fd is mtime-only, hence -atime/-ctime staying below.
FIND_ALLOW_PREDICATES = {
    "-perm", "-newer", "-newermt", "-anewer", "-cnewer", "-atime", "-ctime",
    "-amin", "-cmin", "-inum", "-links", "-samefile", "-empty", "-printf",
    "-fprintf", "-prune",
}

_SED_NUM_RE = re.compile(r"\d+")
_SED_SLASH_ADDR_RE = re.compile(r"/(?:\\.|[^/\\])*/")
_SED_BACKSLASH_ADDR_RE = re.compile(r"\\(.)((?:\\.|(?!\1).)*)\1")
_SED_SUBST_HEAD_RE = re.compile(r"s[/#|,:@]")


def _match_sed_address(script, i):
    """Match one sed address atom (line number, $, /regex/, \\cregexc) at i."""
    if script[i : i + 1] == "$":
        return i + 1
    for pattern in (_SED_NUM_RE, _SED_SLASH_ADDR_RE, _SED_BACKSLASH_ADDR_RE):
        m = pattern.match(script, i)
        if m:
            return m.end()
    return None


def strip_sed_address(script):
    """Strip a leading sed address (incl. ranges and a trailing '!') from
    script, returning whatever command text follows it."""
    n = len(script)
    i = 0
    while i < n and script[i].isspace():
        i += 1
    end = _match_sed_address(script, i)
    if end is None:
        return script
    i = end
    if i < n and script[i] == ",":
        j = i + 1
        while j < n and script[j].isspace():
            j += 1
        step_m = re.match(r"[~+]\d+", script[j:])
        if step_m:
            i = j + step_m.end()
        else:
            end2 = _match_sed_address(script, j)
            if end2 is not None:
                i = end2
    while i < n and script[i].isspace():
        i += 1
    if i < n and script[i] == "!":
        i += 1
    while i < n and script[i].isspace():
        i += 1
    return script[i:]


def is_sed_substitution(script):
    """True if script contains an s/// command, address-prefixed or not,
    at the start or after a ';'/'{' command separator."""
    candidates = [0] + [m.end() for m in re.finditer(r"[;{]", script)]
    for start in candidates:
        remainder = strip_sed_address(script[start:])
        if _SED_SUBST_HEAD_RE.match(remainder):
            return True
    return False


def tokenize(command):
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    try:
        return list(lexer)
    except ValueError:
        return None


def split_segments(tokens):
    segments = []
    current = []
    for tok in tokens:
        if tok in CONTROL_OPERATORS:
            if current:
                segments.append(current)
            current = []
        else:
            current.append(tok)
    if current:
        segments.append(current)
    return segments


def is_assignment(tok):
    return re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", tok) is not None


def effective_command(segment):
    """Return (command_name, remaining_args) after stripping wrappers."""
    toks = list(segment)
    while toks and is_assignment(toks[0]):
        toks.pop(0)
    while toks:
        head = toks[0]
        if head in WRAPPER_WORDS:
            toks.pop(0)
            while toks and toks[0].startswith("-"):
                toks.pop(0)
            continue
        if head == "xargs":
            toks.pop(0)
            while toks and toks[0].startswith("-") and toks[0] != "--":
                flag = toks[0]
                toks.pop(0)
                if flag in XARGS_VALUE_FLAGS or (
                    len(flag) > 2 and flag[:2] in XARGS_VALUE_FLAGS
                ):
                    if toks:
                        toks.pop(0)
            if toks and toks[0] == "--":
                toks.pop(0)
            continue
        break
    if not toks:
        return None, []
    return toks[0], toks[1:]


def basename(cmd):
    return cmd.rsplit("/", 1)[-1]


def check_grep(name, args):
    # git grep passes here because "git" is not in WRAPPER_WORDS, so
    # effective_command never strips it: `git grep foo` yields name == "git",
    # not "grep", and this function never sees it. If "git" is ever added to
    # WRAPPER_WORDS, this needs an explicit guard reinstated for git grep.
    if name in {"grep", "egrep", "fgrep"}:
        return (
            f"'{name}' is denied — use rg (ripgrep) instead. "
            "Same regex/flags in almost all cases (rg -n, rg -l, rg -i, "
            "rg --hidden for dotfiles)."
        )
    return None


def check_sed(name, args):
    if name != "sed":
        return None
    for a in args:
        if a == "-i" or a.startswith("-i") or a == "--in-place" or a.startswith("--in-place"):
            return (
                "'sed -i' is denied — for in-place edits use the Edit tool, "
                "or 'sd PATTERN REPLACEMENT FILE' for simple substitutions."
            )
    script_args = [a for a in args if not a.startswith("-")]
    for script in script_args:
        if is_sed_substitution(script):
            return (
                "sed substitution is denied — use 'sd PATTERN REPLACEMENT [FILE]' "
                "instead (sd takes plain regex/replacement, no delimiters/escaping). "
                "sed is still allowed for ranges/prints/deletes (e.g. sed -n '5,10p', "
                "sed '2d') since sd can't do those."
            )
    return None


def check_find(name, args):
    if name != "find":
        return None
    if any(a in FIND_ALLOW_PREDICATES for a in args):
        return None
    return (
            "'find' is denied here — use fd instead. Queries: fd PATTERN, "
            "fd -e py, fd -t f, fd -S +1M, fd --changed-before 30d, fd -o USER. "
            "Actions: fd -x CMD (once per file) or fd -X CMD (batched, like "
            "-exec {} +) — so `find . -name '*.pyc' -exec rm {} +` is `fd -e pyc -X rm`. "
            "Two differences to account for: fd skips .gitignore'd and hidden files "
            "(add -I -H to match find), and it matches the basename as a regex, so "
            "use -g for globs. find remains allowed only for what fd can't express: "
            "-perm, -newer FILE, -atime/-ctime, -inum/-links/-samefile, -empty, "
            "-printf, -prune."
    )


CHECKS = (check_grep, check_sed, check_find)


def find_violation(command):
    tokens = tokenize(command)
    if tokens is None:
        return None
    for segment in split_segments(tokens):
        name, args = effective_command(segment)
        if not name:
            continue
        name = basename(name)
        for check in CHECKS:
            msg = check(name, args)
            if msg:
                return msg
    return None


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0

    if payload.get("tool_name") != "Bash":
        return 0

    command = (payload.get("tool_input") or {}).get("command")
    if not command:
        return 0

    violation = find_violation(command)
    if violation:
        print(violation, file=sys.stderr)
        return DENY_EXIT

    return 0


if __name__ == "__main__":
    sys.exit(main())
