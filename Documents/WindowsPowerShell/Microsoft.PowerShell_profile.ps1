# Shared PowerShell profile managed by chezmoi. PowerShell 7 loads this through
# Documents\PowerShell\Microsoft.PowerShell_profile.ps1.

# Unlike zsh/fish, PowerShell has no rc-file convention that already sets this,
# so tools that shell out to $EDITOR (yazi, git, etc.) fell back to whatever
# Windows registers as the default file handler (Zed) instead of staying in
# the terminal.
$env:EDITOR = "hx"

# Yazi shells out to file(1) for mime-type detection, which Windows lacks.
# Point it at Git for Windows' file.exe -- the Scoop/Chocolatey builds mangle
# Unicode filenames and are missing flags yazi needs.
$gitFileOne = "C:\Program Files\Git\usr\bin\file.exe"
if (Test-Path $gitFileOne) {
    $env:YAZI_FILE_ONE = $gitFileOne
}

# On Windows yazi always reads %AppData%\yazi\config, never ~/.config/yazi,
# regardless of any XDG_CONFIG_HOME-style variable. Redirect it to the
# chezmoi-managed config so the same yazi.toml/keymap.toml apply on every OS.
$env:YAZI_CONFIG_HOME = Join-Path $HOME ".config\yazi"

# The piper.yazi plugin (used for the glow markdown preview) hardcodes
# Command("sh") to run its pipeline, with no Windows-specific fallback. Git's
# usr\bin -- already on PATH via YAZI_FILE_ONE-adjacent tools -- doesn't cover
# this; only Git\bin ships sh.exe, and only bash.exe/git.exe/sh.exe live there,
# so adding it here doesn't risk shadowing other commands the way Git's
# usr\bin (full unix toolset) would.
$gitBin = "C:\Program Files\Git\bin"
if ((Test-Path $gitBin) -and ($env:PATH -notlike "*$gitBin*")) {
    $env:PATH = "$env:PATH$([IO.Path]::PathSeparator)$gitBin"
}

$env:PROTO_HOME = Join-Path $HOME ".proto"
# Windows OpenSSH builds a session's environment from the machine PATH only, so
# user-scoped tools (scoop, cargo, proto) are invisible over SSH. Re-merge the
# user PATH, then dedupe case-insensitively with first-wins ordering.
$candidates = @(
  (Join-Path $env:PROTO_HOME "shims"),
  (Join-Path $env:PROTO_HOME "bin")
)
$candidates += $env:PATH -split [IO.Path]::PathSeparator
$candidates += [Environment]::GetEnvironmentVariable("Path", "User") -split [IO.Path]::PathSeparator

$seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$env:PATH = ($candidates | Where-Object { $_ -and $seen.Add($_.TrimEnd([char]0x5C)) }) -join [IO.Path]::PathSeparator

# Over SSH, pubkey auth yields a NETWORK logon token, and Windows refuses to
# traverse symbolic links from such a session ("the path cannot be traversed
# because it contains an untrusted mount point"). That hides every symlinked
# PATH dir - herdr's bin, and every scoop apps\*\current junction - so tools
# there vanish. Map each link to its target as well, which needs no change to
# the machine-wide SymlinkEvaluation policy. Gated on the network-logon SID so
# local shells pay nothing.
$networkSid = [Security.Principal.SecurityIdentifier]"S-1-5-2"
if ([Security.Principal.WindowsIdentity]::GetCurrent().Groups -contains $networkSid) {
  $withTargets = foreach ($dir in $env:PATH -split [IO.Path]::PathSeparator) {
    $dir
    if ($dir) {
      $item = Get-Item -LiteralPath $dir -Force -ErrorAction SilentlyContinue
      if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        # .Target is a collection on PowerShell 5.1, a string on 7+.
        $target = @($item.Target)[0]
        if ($target) { $target }
      }
    }
  }
  $seenTargets = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $env:PATH = ($withTargets | Where-Object { $_ -and $seenTargets.Add($_.TrimEnd([char]0x5C)) }) -join [IO.Path]::PathSeparator
}

# Mirrors dot_zsh/starship.zsh's distro-icon detection for native Windows, so
# starship.toml's env_var.STARSHIP_DISTRO segment isn't blank here. Windows
# PowerShell only ever runs natively (no WSL badge case to cover).
$env:STARSHIP_DISTRO = [char]0xf17a

# Prompt and shell integrations are optional. Initialise only what is actually
# on PATH so a session without these tools still starts cleanly.
if (Get-Command starship -ErrorAction SilentlyContinue) {
    Invoke-Expression (&starship init powershell)
}
if (Get-Command zoxide -ErrorAction SilentlyContinue) {
    Invoke-Expression (& { (zoxide init powershell | Out-String) })
}
if (Get-Command mise -ErrorAction SilentlyContinue) {
    (&mise activate pwsh) | Out-String | Invoke-Expression
}

# Enable inline command predictions when the installed PSReadLine supports it.
if (Get-Module -ListAvailable -Name PSReadLine) {
    Import-Module PSReadLine -ErrorAction SilentlyContinue
    $psReadLineModule = Get-Module PSReadLine

    if ($psReadLineModule -and $psReadLineModule.Version -ge [version]'2.1.0') {
        $canRenderPredictions = ($Host.Name -eq 'ConsoleHost') -and (-not [Console]::IsOutputRedirected)
        if ($canRenderPredictions) {
            Set-PSReadLineOption -PredictionSource History -ErrorAction Stop
            if ((Get-Command Set-PSReadLineOption).Parameters.ContainsKey('PredictionViewStyle')) {
                Set-PSReadLineOption -PredictionViewStyle InlineView
            }
        }
        Set-PSReadLineOption -HistorySaveStyle SaveIncrementally

        # Vi editing mode -- PSReadLine's built-in equivalent of zsh's bindkey -v
        # (what zsh-vi-mode wraps). Gives modes, hjkl/w/b/e, d/c/y operators,
        # f/t motions and / history search. No surround or full text objects,
        # and no Visual/select mode -- only Insert and Command (Normal) exist.
        # NOTE: setting EditMode resets the keymap to that mode's defaults, so it
        # must stay ahead of anything that binds keys (atuin, PSFzf). A binding
        # made before this line is silently reverted to the vi default.
        Set-PSReadLineOption -EditMode Vi

        # Without a mode indicator there is no way to tell which mode you are in.
        # -ViModeIndicator Prompt string-matches -PromptText inside the rendered
        # prompt and swaps it out, which needs a literal stable suffix to match --
        # starship's [character] symbols are empty here, so there's nothing to
        # match. A DECSCUSR cursor-shape swap (the other built-in option) also
        # doesn't render reliably over SSH. So track the mode in a global and have
        # the prompt function itself emit a plain-text tag -- that works over any
        # transport since it's just prompt text, not a terminal escape sequence.
        $global:__viMode = 'Insert'
        if ((Get-Command Set-PSReadLineOption).Parameters.ContainsKey('ViModeIndicator')) {
            Set-PSReadLineOption -ViModeIndicator Script -ViModeChangeHandler {
                $global:__viMode = $args[0]
                # Setting the variable alone doesn't redraw anything -- the
                # prompt line is already on screen and PSReadLine only edits
                # the buffer after it. InvokePrompt() is the same call
                # -ViModeIndicator Prompt uses internally to force a redraw.
                # It throws "the handle is invalid" without a real attached
                # console (e.g. some remote/redirected sessions) -- swallow
                # that so a failed redraw never surfaces as a visible error;
                # worst case the tag just catches up on the next Enter.
                # Skip recomputing the underlying prompt (starship shells out
                # and checks git status -- slow enough over SSH to flicker)
                # since nothing it depends on changes mid-edit of one line;
                # just redraw with the cached text and the new tag.
                $global:__viModeSkipRecompute = $true
                try { [Microsoft.PowerShell.PSConsoleReadLine]::InvokePrompt() } catch {}
                $global:__viModeSkipRecompute = $false
            }

            # Wrap whatever `prompt` currently resolves to (starship's, chained
            # through zoxide's real init output above) with the mode tag. This
            # must run after both of those have installed their own `prompt`,
            # which they have by this point in the file.
            $global:__viModePromptOld = $function:prompt
            function global:prompt {
                if (-not $global:__viModeSkipRecompute -or -not $global:__viModePromptCache) {
                    # -join instead of Out-String -NoNewline: this profile is
                    # shared with Windows PowerShell 5.1, whose Out-String
                    # lacks -NoNewline.
                    $global:__viModePromptCache = (& $global:__viModePromptOld) -join ''
                }
                $rendered = $global:__viModePromptCache
                if ($global:__viMode -ne 'Command') { return $rendered }

                # Bold yellow arrow right before the last line -- where the
                # cursor actually sits -- not the whole (possibly multi-line)
                # prompt, or it lands a line above the input instead of on it.
                $viTag = "$([char]27)[1;33m$([char]10094) $([char]27)[0m"
                $lines = $rendered -split "`n"
                $lines[-1] = $viTag + $lines[-1]
                $lines -join "`n"
            }
        }
    }
}


# =============================================================================
#
# Utility functions for zoxide.
#

# Call zoxide binary, returning the output as UTF-8.
function global:__zoxide_bin {
    $encoding = [Console]::OutputEncoding
    try {
        [Console]::OutputEncoding = [System.Text.Utf8Encoding]::new()
        $result = zoxide @args
        return $result
    } finally {
        [Console]::OutputEncoding = $encoding
    }
}

# pwd based on zoxide's format.
function global:__zoxide_pwd {
    $cwd = Get-Location
    if ($cwd.Provider.Name -eq "FileSystem") {
        $cwd.ProviderPath
    }
}

# cd + custom logic based on the value of _ZO_ECHO.
function global:__zoxide_cd($dir, $literal) {
    $dir = if ($literal) {
        Set-Location -LiteralPath $dir -Passthru -ErrorAction Stop
    } else {
        if ($dir -eq '-' -and ($PSVersionTable.PSVersion -lt 6.1)) {
            Write-Error "cd - is not supported below PowerShell 6.1. Please upgrade your version of PowerShell."
        }
        elseif ($dir -eq '+' -and ($PSVersionTable.PSVersion -lt 6.2)) {
            Write-Error "cd + is not supported below PowerShell 6.2. Please upgrade your version of PowerShell."
        }
        else {
            Set-Location -Path $dir -Passthru -ErrorAction Stop
        }
    }
}

# =============================================================================
#
# Hook configuration for zoxide.
#

# Hook to add new entries to the database.
$global:__zoxide_oldpwd = __zoxide_pwd
function global:__zoxide_hook {
    $result = __zoxide_pwd
    if ($result -ne $global:__zoxide_oldpwd) {
        if ($null -ne $result) {
            zoxide add -- $result
        }
        $global:__zoxide_oldpwd = $result
    }
}

# Initialize hook.
$global:__zoxide_hooked = (Get-Variable __zoxide_hooked -ErrorAction SilentlyContinue -ValueOnly)
if ($global:__zoxide_hooked -ne 1) {
    $global:__zoxide_hooked = 1
    $global:__zoxide_prompt_old = $function:prompt

    function global:prompt {
        if ($null -ne $__zoxide_prompt_old) {
            & $__zoxide_prompt_old
        }
        $null = __zoxide_hook
    }
}

# =============================================================================
#
# When using zoxide with --no-cmd, alias these internal functions as desired.
#

# Jump to a directory using only keywords.
function global:__zoxide_z {
    if ($args.Length -eq 0) {
        __zoxide_cd ~ $true
    }
    elseif ($args.Length -eq 1 -and ($args[0] -eq '-' -or $args[0] -eq '+')) {
        __zoxide_cd $args[0] $false
    }
    elseif ($args.Length -eq 1 -and (Test-Path $args[0] -PathType Container)) {
        __zoxide_cd $args[0] $true
    }
    else {
        $result = __zoxide_pwd
        if ($null -ne $result) {
            $result = __zoxide_bin query --exclude $result -- @args
        }
        else {
            $result = __zoxide_bin query -- @args
        }
        if ($LASTEXITCODE -eq 0) {
            __zoxide_cd $result $true
        }
    }
}

# Jump to a directory using interactive search.
function global:__zoxide_zi {
    $result = __zoxide_bin query -i -- @args
    if ($LASTEXITCODE -eq 0) {
        __zoxide_cd $result $true
    }
}

# =============================================================================
#
# Commands for zoxide. Disable these using --no-cmd.
#

Set-Alias -Name z -Value __zoxide_z -Option AllScope -Scope Global -Force
Set-Alias -Name zi -Value __zoxide_zi -Option AllScope -Scope Global -Force

# =============================================================================

function ezaGrid($a) { 
  eza --grid --icons --sort type $a
  }
# These alias over builtins (ls, cd), so only install them when the backing
# tool exists -- otherwise a missing binary breaks basic navigation.
if (Get-Command eza -ErrorAction SilentlyContinue) {
    Set-Alias -Name ls -Value ezaGrid -Option AllScope -Scope Global -Force
}
if (Get-Command zoxide -ErrorAction SilentlyContinue) {
    Set-Alias -Name cd -Value __zoxide_z -Option AllScope -Scope Global -Force
    Set-Alias -Name cdi -Value __zoxide_zi -Option AllScope -Scope Global -Force
}

# Atuin shell history. Must load after the PSReadLine EditMode call above, since
# switching EditMode resets the keymap and would discard atuin's bindings. Atuin
# binds Ctrl+r and UpArrow without -ViMode, so they apply to vi insert mode only.
# For a multi-line prompt, set ATUIN_POWERSHELL_PROMPT_OFFSET (-1 for two lines);
# left unset, atuin infers it from the prompt on first search.
if (Get-Command atuin -ErrorAction SilentlyContinue) {
    atuin init powershell | Out-String | Invoke-Expression
}
