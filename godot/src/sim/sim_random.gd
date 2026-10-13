class_name SimRandom
## The sim's seeded random number generator. Its whole state is one unsigned
## 32-bit integer stored in the sim state, so snapshots capture it exactly.
##
## Algorithm: mulberry32 (public domain). Every operation is 32-bit integer
## math, reproduced bit for bit from the web build; web/src/sim/rng.test.ts holds
## the reference sequence. GDScript ints are 64-bit, so results are masked to 32.
## Ported from web/src/sim/rng.ts.

const MASK := 0xFFFFFFFF


class Result:
	## Uniform in [0, 1).
	var value: float
	var state: int

	func _init(result_value: float, result_state: int) -> void:
		value = result_value
		state = result_state


static func seed_state(seed_value: int) -> int:
	return seed_value & MASK


## The low 32 bits of a * b, for 32-bit unsigned a and b, like JavaScript's Math.imul.
## Split into 16-bit halves so the product never overflows a 64-bit int.
static func _imul(a: int, b: int) -> int:
	return (a * (b & 0xFFFF) + (((a * (b >> 16)) & 0xFFFF) << 16)) & MASK


static func next(state: int) -> Result:
	var next_state := (state + 0x6D2B79F5) & MASK
	var t := next_state
	t = _imul(t ^ (t >> 15), t | 1)
	t ^= (t + _imul(t ^ (t >> 7), t | 61)) & MASK
	return Result.new(float((t ^ (t >> 14)) & MASK) / 4294967296.0, next_state)
