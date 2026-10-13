class_name SimConstants
## The one place the simulation's tick rate is defined. Durations in data are in
## seconds and are converted to ticks from this constant.

const TICK_RATE := 60


## Seconds to ticks, rounding to the nearest tick (spec/README.md, Conversion rules).
static func seconds_to_ticks(seconds: float, tick_rate := TICK_RATE) -> int:
	return int(floor(seconds * tick_rate + 0.5))

# Brush contents bits, using Quake 2's values (they are what .map faces and .bsp brushes store).
const CONTENTS_SOLID := 1
const CONTENTS_WINDOW := 2
const CONTENTS_PLAYERCLIP := 0x10000
const CONTENTS_MONSTERCLIP := 0x20000
