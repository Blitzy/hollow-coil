class_name InputCommand
extends RefCounted
## The sim's only input: one command per tick. Matches
## spec/schemas/input_command.schema.json. Ported from web/src/sim/input.ts.

const BUTTON_ATTACK := 1
const BUTTON_JUMP := 2
const ANGLE_UNITS_PER_TURN := 65536

## Absolute yaw, 65536 units per turn; 0 faces +x, increasing counterclockwise.
var yaw := 0
## Absolute pitch, 65536 units per turn; positive looks up.
var pitch := 0
## -127 to 127; positive is forward.
var forward := 0
## -127 to 127; positive is right.
var side := 0
var buttons := 0
## Weapon slot to switch to, or 0 for no change.
var weapon := 0


static func make(cmd_forward := 0, cmd_side := 0, cmd_buttons := 0, cmd_yaw := 0, cmd_pitch := 0, cmd_weapon := 0) -> InputCommand:
	var cmd := InputCommand.new()
	cmd.forward = cmd_forward
	cmd.side = cmd_side
	cmd.buttons = cmd_buttons
	cmd.yaw = cmd_yaw
	cmd.pitch = cmd_pitch
	cmd.weapon = cmd_weapon
	return cmd


## No movement, no buttons, facing +x.
static func neutral() -> InputCommand:
	return InputCommand.new()


static func angle_to_radians(units: float) -> float:
	return units * 2.0 * PI / ANGLE_UNITS_PER_TURN


## Degrees to angle units, rounding to the nearest unit (spec/README.md, Conversion rules).
static func degrees_to_units(degrees: float) -> int:
	return int(floor(degrees * ANGLE_UNITS_PER_TURN / 360.0 + 0.5))


## Wraps a yaw in angle units into 0..65535.
static func wrap_yaw(units: int) -> int:
	return posmod(units, ANGLE_UNITS_PER_TURN)
