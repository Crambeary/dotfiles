#!/bin/bash

source "$CONFIG_DIR/colors.sh"

# One popup holds both the slider (added in items/volume.sh) and the output
# device list (rebuilt on each open, since devices come and go). The slider is
# added at config time so it always sits above the devices.
toggle_popup() {
  args=(--remove '/volume.device\.*/' --set "$NAME" popup.drawing=toggle)

  if command -v SwitchAudioSource >/dev/null 2>&1; then
    COUNTER=0
    CURRENT="$(SwitchAudioSource -t output -c)"
    while IFS= read -r device; do
      COLOR=$GREY
      if [ "${device}" = "$CURRENT" ]; then
        COLOR=$WHITE
      fi
      args+=(--add item volume.device.$COUNTER popup."$NAME" \
             --set volume.device.$COUNTER label="${device}" \
                                          label.color="$COLOR" \
                   click_script="SwitchAudioSource -s \"${device}\" && sketchybar --set /volume.device\.*/ label.color=$GREY --set \$NAME label.color=$WHITE --set volume_icon popup.drawing=off")
      COUNTER=$((COUNTER+1))
    done <<< "$(SwitchAudioSource -a -t output)"
  fi

  sketchybar -m "${args[@]}" > /dev/null
}

case "$SENDER" in
  "mouse.exited.global") sketchybar --set "$NAME" popup.drawing=off
  ;;
  *) toggle_popup
  ;;
esac
