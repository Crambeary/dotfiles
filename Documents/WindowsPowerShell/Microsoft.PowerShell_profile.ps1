# Shared PowerShell profile managed by chezmoi. PowerShell 7 loads this through
# Documents\PowerShell\Microsoft.PowerShell_profile.ps1.
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

# Prompt and shell integrations are optional. Initialise only what is actually
# on PATH so a session without these tools still starts cleanly.
if (Get-Command starship -ErrorAction SilentlyContinue) {
    Invoke-Expression (&starship init powershell)
}
if (Get-Command zoxide -ErrorAction SilentlyContinue) {
    Invoke-Expression (& { (zoxide init powershell | Out-String) })
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
        # f/t motions and / history search. No surround or full text objects.
        # NOTE: setting EditMode resets the keymap to that mode's defaults, so it
        # must stay ahead of anything that binds keys (atuin, PSFzf). A binding
        # made before this line is silently reverted to the vi default.
        Set-PSReadLineOption -EditMode Vi

        # Without a mode indicator there is no way to tell which mode you are in.
        # Script mode lets us switch the cursor shape via DECSCUSR, which needs a
        # real console -- reuse the prediction guard for that. Build the escape
        # from [char]27 inline rather than `e, which Windows PowerShell cannot parse.
        if ($canRenderPredictions -and
            (Get-Command Set-PSReadLineOption).Parameters.ContainsKey('ViModeIndicator')) {
            Set-PSReadLineOption -ViModeIndicator Script -ViModeChangeHandler {
                if ($args[0] -eq 'Command') {
                    [Console]::Write("$([char]27)[1 q")  # steady block: normal mode
                } else {
                    [Console]::Write("$([char]27)[5 q")  # blinking bar: insert mode
                }
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
