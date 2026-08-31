# Colormap
function colormap() {
  for i in {0..255}; do print -Pn "%K{$i}  %k%F{$i}${(l:3::0:)i}%f " ${${(M)$((i%6)):#3}:+$'\n'}; done
}

# Inverts the current kitty window's colors for the duration of an ssh
# session, so a remote shell is visually unmistakable regardless of
# whatever theme matugen currently has applied. Requires
# allow_remote_control in kitty.conf. Reads the live fg/bg (not a cached
# theme snapshot) so it always inverts whatever's currently on screen, and
# --reset on exit reloads straight from kitty.conf, so it lands back on
# matugen's current theme even if it changed mid-session.
function ssh-invert() {
  local fg bg
  fg=$(kitten @ get-colors | awk '/^foreground /{print $2}')
  bg=$(kitten @ get-colors | awk '/^background /{print $2}')
  kitten @ set-colors foreground="$bg" background="$fg" cursor="$bg"
  ssh "$@"
  kitten @ set-colors --reset
}