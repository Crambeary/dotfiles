# Bound to alt+h / alt+l / alt+j / alt+k on Windows. Focuses the neighboring
# pane in the given direction; if there's no pane there (tab edge), wraps to
# the previous/next tab instead, cycling continuously like zellij's
# move-focus-with-tab-wrap. left/up wrap to the previous tab, right/down
# wrap to the next tab.
#
# PowerShell port of the Linux/macOS focus-pane-or-tab.sh (bash/jq aren't
# available by default on Windows, so cmd.exe /d /c can't source that
# shebang script directly).

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('left', 'right', 'up', 'down')]
    [string]$Direction
)

$ErrorActionPreference = 'Stop'

$result = herdr pane focus --direction $Direction | ConvertFrom-Json
if ($result.result.focus.changed) {
    exit 0
}

$tabs = (herdr tab list --workspace $env:HERDR_ACTIVE_WORKSPACE_ID | ConvertFrom-Json).result.tabs
$count = $tabs.Count
if ($count -le 1) {
    exit 0
}

$currentIndex = 0
for ($i = 0; $i -lt $count; $i++) {
    if ($tabs[$i].tab_id -eq $env:HERDR_ACTIVE_TAB_ID) {
        $currentIndex = $i
        break
    }
}

if ($Direction -eq 'left' -or $Direction -eq 'up') {
    $nextIndex = ($currentIndex - 1 + $count) % $count
} else {
    $nextIndex = ($currentIndex + 1) % $count
}

$targetTab = $tabs[$nextIndex].tab_id
herdr tab focus $targetTab | Out-Null

$opposite = switch ($Direction) {
    'left' { 'right' }
    'right' { 'left' }
    'up' { 'down' }
    'down' { 'up' }
}

for ($i = 0; $i -lt 32; $i++) {
    $pushResult = herdr pane focus --direction $opposite | ConvertFrom-Json
    if (-not $pushResult.result.focus.changed) {
        break
    }
}
