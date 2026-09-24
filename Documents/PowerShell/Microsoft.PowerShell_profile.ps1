# Managed PowerShell 7 entry point. The shared profile below is also managed by
# chezmoi, so this remains portable between Windows PowerShell and PowerShell 7.
. "$HOME\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1"

if (Get-Command wt -ErrorAction SilentlyContinue) { Invoke-Expression (& wt config shell init powershell | Out-String) }
