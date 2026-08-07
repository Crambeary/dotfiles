#!/bin/sh

# The slider lives in volume_icon's popup rather than inline in the bar. Popups
# draw outside the bar's layout flow, so expanding it costs zero horizontal
# space and can never push the right cluster into the notch. (sketchybar's
# notch_width only constrains items anchored at position q/e, and everything
# here is plain left/right, so the bar will not enforce that boundary for us.)
SLIDER_WIDTH=120

volume_slider=(
  script="$PLUGIN_DIR/volume.sh"
  updates=on
  label.drawing=off
  icon.drawing=off
  slider.highlight_color=$BLUE
  slider.background.height=5
  slider.background.corner_radius=3
  slider.background.color=$BACKGROUND_2
  slider.knob=􀀁
  slider.knob.drawing=on
)

volume_icon=(
  click_script="$PLUGIN_DIR/volume_click.sh"
  padding_left=10
  icon=$VOLUME_100
  icon.width=0
  icon.align=left
  icon.color=$GREY
  icon.font="$FONT:Regular:14.0"
  label.width=25
  label.align=left
  label.font="$FONT:Regular:14.0"
  popup.horizontal=off
  popup.align=right
  popup.height=30
)

status_bracket=(
  background.color=$BACKGROUND_1
  background.border_color=$BACKGROUND_2
)

sketchybar --add item volume_icon right                          \
           --set volume_icon "${volume_icon[@]}"                  \
           --subscribe volume_icon mouse.exited.global            \
           --add slider volume popup.volume_icon "$SLIDER_WIDTH"  \
           --set volume "${volume_slider[@]}"                     \
           --subscribe volume volume_change                       \
                              mouse.clicked

sketchybar --add bracket status brew volume_icon \
           --set status "${status_bracket[@]}"
