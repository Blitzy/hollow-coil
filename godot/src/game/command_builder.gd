class_name CommandBuilder
## Turns the player's held keys and mouse-look angles into the sim's quantized
## input command. Ported from web/src/game/command.ts.

## Pitch is kept just short of straight up or down.
const MAX_PITCH := 89.0 * PI / 180.0


## What the player is holding this tick, with view angles in radians at full precision.
class HeldInput:
	var yaw := 0.0
	var pitch := 0.0
	var forward := false
	var back := false
	var left := false
	var right := false
	var jump := false
	var attack := false
	## Weapon slot pressed since the last command, or 0.
	var weapon := 0


## Radians to angle units, rounding halves up like JavaScript's Math.round.
static func _to_units(radians: float) -> int:
	return int(floor(radians * InputCommand.ANGLE_UNITS_PER_TURN / TAU + 0.5))


static func build(input: HeldInput) -> InputCommand:
	var pitch := clampf(input.pitch, -MAX_PITCH, MAX_PITCH)
	return InputCommand.make(
		(127 if input.forward else 0) - (127 if input.back else 0),
		(127 if input.right else 0) - (127 if input.left else 0),
		(InputCommand.BUTTON_JUMP if input.jump else 0) | (InputCommand.BUTTON_ATTACK if input.attack else 0),
		InputCommand.wrap_yaw(_to_units(input.yaw)),
		_to_units(pitch),
		input.weapon)
