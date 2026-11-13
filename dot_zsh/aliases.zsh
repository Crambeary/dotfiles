# Alias
# ---
#
# mac OS shortcuts
alias code="open -a 'Visual Studio Code'"

# ALIAS COMMANDS
alias ls="eza --grid --icons --group-directories-first"
alias ll="eza --icons --group-directories-first -l"
alias res="toggle-panel-res"
alias bat="bat --theme=ansi"
alias audio-separator="$HOME/tools/audio-separator/.venv/bin/audio-separator"

# Updates
# mup — Omarchy's alias for `mise upgrade`, adopted globally so it works
# outside Omarchy too (all CLI tools here are mise-managed, see ~/.config/mise/config.toml).
alias mup="mise upgrade"
alias upall="mise upgrade && sudo apt update && sudo apt upgrade"

