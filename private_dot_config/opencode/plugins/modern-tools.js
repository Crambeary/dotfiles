// Port of the Claude Code PreToolUse chain: RTK rewrites supported commands,
// then this policy blocks legacy tools where rg, sd, or fd are equivalent.
const CONTROL_OPERATORS = new Set(["&&", "||", "|", ";", "&"])
const WRAPPER_WORDS = new Set([
  "sudo", "doas", "nice", "ionice", "time", "env", "command", "builtin", "rtk",
])
const XARGS_VALUE_FLAGS = new Set(["-I", "-n", "-P", "-L", "-s", "-a", "--max-args", "--max-procs"])
const FIND_ALLOW_PREDICATES = new Set([
  "-perm", "-newer", "-newermt", "-anewer", "-cnewer", "-atime", "-ctime",
  "-amin", "-cmin", "-inum", "-links", "-samefile", "-empty", "-printf",
  "-fprintf", "-prune",
])

function tokenize(command) {
  const tokens = []
  let token = ""
  let quote = ""
  let escaped = false

  const push = () => {
    if (token) tokens.push(token)
    token = ""
  }

  for (let index = 0; index < command.length; index++) {
    const character = command[index]
    if (escaped) {
      token += character
      escaped = false
      continue
    }
    if (character === "\\") {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = ""
      else token += character
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (/\s/.test(character)) {
      push()
      continue
    }
    const twoCharacterOperator = command.slice(index, index + 2)
    if (twoCharacterOperator === "&&" || twoCharacterOperator === "||") {
      push()
      tokens.push(twoCharacterOperator)
      index++
      continue
    }
    if ("|;&".includes(character)) {
      push()
      tokens.push(character)
      continue
    }
    token += character
  }
  if (quote || escaped) return undefined
  push()
  return tokens
}

function effectiveCommand(segment) {
  const tokens = [...segment]
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0] ?? "")) tokens.shift()
  while (tokens.length) {
    if (WRAPPER_WORDS.has(tokens[0])) {
      tokens.shift()
      while (tokens[0]?.startsWith("-")) tokens.shift()
      continue
    }
    if (tokens[0] !== "xargs") break
    tokens.shift()
    while (tokens[0]?.startsWith("-") && tokens[0] !== "--") {
      const flag = tokens.shift()
      if (XARGS_VALUE_FLAGS.has(flag) || XARGS_VALUE_FLAGS.has(flag.slice(0, 2))) tokens.shift()
    }
    if (tokens[0] === "--") tokens.shift()
  }
  return [tokens[0]?.split("/").at(-1), tokens.slice(1)]
}

function sedSubstitution(script) {
  // An optional address (or address range) may precede an s/// command.
  return /(?:^|[;{])\s*(?:(?:\d+|\$|\/(?:\\.|[^/\\])*\/)(?:\s*,\s*(?:\d+|\$|\/(?:\\.|[^/\\])*\/|[+~]\d+))?\s*!?\s*)?s[/#|,:@]/.test(script)
}

function violation(command) {
  const tokens = tokenize(command)
  if (!tokens) return undefined
  let segment = []
  for (const token of [...tokens, ";"]) {
    if (!CONTROL_OPERATORS.has(token)) {
      segment.push(token)
      continue
    }
    const [name, args] = effectiveCommand(segment)
    segment = []
    if (["grep", "egrep", "fgrep"].includes(name)) {
      return `'${name}' is denied - use rg (ripgrep) instead. Use rg -n, rg -l, rg -i, or rg --hidden for dotfiles.`
    }
    if (name === "sed") {
      if (args.some((argument) => argument === "-i" || argument.startsWith("-i") || argument === "--in-place" || argument.startsWith("--in-place"))) {
        return "'sed -i' is denied - use the Edit tool, or sd PATTERN REPLACEMENT FILE for simple substitutions."
      }
      if (args.filter((argument) => !argument.startsWith("-")).some(sedSubstitution)) {
        return "sed substitution is denied - use sd PATTERN REPLACEMENT [FILE] instead. sed remains allowed for ranges, prints, and deletes."
      }
    }
    if (name === "find" && !args.some((argument) => FIND_ALLOW_PREDICATES.has(argument))) {
      return "'find' is denied here - use fd instead. Use fd PATTERN, fd -e py, fd -t f, fd -S +1M, fd --changed-before 30d, fd -o USER, fd -x CMD, or fd -X CMD."
    }
  }
}

async function rewriteWithRtk(command) {
  try {
    const process = Bun.spawn(["rtk", "hook", "check", "--agent", "claude", command], {
      stdout: "pipe",
      stderr: "ignore",
    })
    if (await process.exited !== 0) return command
    const rewritten = (await new Response(process.stdout).text()).trim()
    return rewritten || command
  } catch {
    // RTK is optional; command execution must still work while it is absent.
    return command
  }
}

export const ModernToolsPlugin = async () => ({
  "tool.execute.before": async (input, output) => {
    if (input.tool !== "bash" || typeof output.args.command !== "string") return
    const message = violation(output.args.command)
    if (message) throw new Error(message)
    output.args.command = await rewriteWithRtk(output.args.command)
  },
})
