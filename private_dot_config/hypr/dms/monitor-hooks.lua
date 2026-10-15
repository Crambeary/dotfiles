-- Post-processing after the output set changes (dock/undock, DMS display
-- profile switch). Debounced, since one switch fires several events.
--   * hyprsplit: a disabled monitor's workspaces (e.g. 31-40) land on the
--     surviving monitor outside its 1-10 block; pull their windows back in.
--   * waynergy: it only reads output geometry on its own events and ends up at
--     0x0 after an output vanishes, which kills absolute mouse motion.
local hyprsplit = require("hyprsplit")

local pending = false

local function settle()
	pending = false
	hyprsplit.dsp.grab_rogue_windows()()
	hl.exec_cmd("systemctl --user restart waynergy")
end

local function schedule()
	if pending then
		return
	end
	pending = true
	hl.timer(settle, { timeout = 2000, type = "oneshot" })
end

hl.on("monitor.added", schedule)
hl.on("monitor.removed", schedule)
