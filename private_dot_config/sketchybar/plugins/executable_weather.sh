sketchybar --set "$NAME" \
  label="Loading..." \
  icon.color=0xff5edaff

# fetch weather data
[ -f "$CONFIG_DIR/local.sh" ] && source "$CONFIG_DIR/local.sh"

LOCATION="${SKETCHYBAR_WEATHER_LOCATION:-Ishpeming, Michigan, United States}"
REGION=""
LANG="en"

# Line below replaces spaces with +
LOCATION_ESCAPED="${LOCATION// /+}+${REGION// /+}"
WEATHER_JSON=$(curl -fsS --max-time 15 "https://wttr.in/$LOCATION_ESCAPED?0pq&format=j1&lang=$LANG")

# Fallback if empty
if [ -z "$WEATHER_JSON" ]; then
  sketchybar --set "$NAME" label="$LOCATION"
  exit 0
fi

TEMPERATURE=$(printf '%s' "$WEATHER_JSON" | jq -r '.current_condition[0].temp_F')
WEATHER_DESCRIPTION=$(printf '%s' "$WEATHER_JSON" | jq -r '.current_condition[0].weatherDesc[0].value' | sed 's/\(.\{16\}\).*/\1.../')

sketchybar --set "$NAME" \
  label="$TEMPERATURE$(echo '°')F • $WEATHER_DESCRIPTION"
