-- Window rules. Deploy writes ~/.config/hypr/dms/windowrules.lua

-- Float + center any command launched via dms-launch-floating-terminal
-- (kitty --class dms.floating-terminal) -- e.g. the webapp installer's
-- guided prompts. Same trick omarchy uses for its own popout terminal.
hl.window_rule({ match = { class = "^(dms.floating-terminal)$" }, float = true })
hl.window_rule({ match = { class = "^(dms.floating-terminal)$" }, center = true })
hl.window_rule({ match = { class = "^(dms.floating-terminal)$" }, size = "875 600" })

-- Zen Browser's popout/PiP video player: float + pin on top immediately,
-- no rounded corners, no active-border focus highlight.
hl.window_rule({ match = { class = "^(zen)$", title = "^(Picture-in-Picture)$" }, float = true })
hl.window_rule({ match = { class = "^(zen)$", title = "^(Picture-in-Picture)$" }, pin = true })
hl.window_rule({ match = { class = "^(zen)$", title = "^(Picture-in-Picture)$" }, rounding = 0 })
hl.window_rule({ match = { class = "^(zen)$", title = "^(Picture-in-Picture)$" }, border_size = 0 })
