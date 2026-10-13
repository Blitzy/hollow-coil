class_name Snapshot
## Snapshots and state hashes. The hash covers every value in the state, in a
## fixed order, and is what golden demos compare tick by tick. It uses the same
## algorithm and state shape as the web build, so equal states hash equally in
## both engines. Ported from web/src/sim/snapshot.ts.
##
## Unlike the web build, snapshots use Godot's binary format, not JSON: Godot's
## JSON parser isn't correctly rounded, so a float written with all 17 digits
## can read back one bit off (504.66885717102565 became 504.66885717102571).
## The binary format stores each float's exact bits. to_json() gives the same
## state as readable text, for debugging.

const FNV_OFFSET := 0x811C9DC5
const FNV_PRIME := 0x01000193
const MASK := 0xFFFFFFFF


static func take(state: SimState) -> PackedByteArray:
	return var_to_bytes(state.to_dict())


## The state from a snapshot, or null if the bytes aren't a valid snapshot.
static func restore(bytes: PackedByteArray) -> SimState:
	var data: Variant = bytes_to_var(bytes)
	return SimState.from_dict(data) if data is Dictionary else null


## The state as JSON text, in the web build's snapshot shape. For reading, not restoring.
static func to_json(state: SimState) -> String:
	return JSON.stringify(state.to_dict(), "", false, true)


## A 32-bit FNV-1a hash of the whole state, as 8 hex digits.
static func hash_state(state: SimState) -> String:
	return hash_value(state.to_dict())


## Hashes plain data (numbers, bools, strings, arrays, dictionaries) the way the web build does.
static func hash_value(value: Variant) -> String:
	var hasher := Hasher.new()
	hasher.value(value)
	return "%08x" % hasher.h


class Hasher:
	var h := FNV_OFFSET
	var _bytes := PackedByteArray()

	func _init() -> void:
		_bytes.resize(8)

	func byte(b: int) -> void:
		h = ((h ^ (b & 0xFF)) * FNV_PRIME) & MASK

	func uint32(n: int) -> void:
		for i in 4:
			byte(n >> (i * 8))

	## Every number hashes as a little-endian float64, ints included, as in JavaScript.
	func float64(n: float) -> void:
		_bytes.encode_double(0, 0.0 if n == 0.0 else n) # -0 and 0 hash the same, as JSON can't tell them apart
		for i in 8:
			byte(_bytes[i])

	func string(s: String) -> void:
		uint32(s.length())
		for i in s.length():
			uint32(s.unicode_at(i))

	func value(v: Variant) -> void:
		match typeof(v):
			TYPE_NIL:
				byte(0x7A)
			TYPE_INT, TYPE_FLOAT:
				byte(0x6E)
				float64(float(v))
			TYPE_BOOL:
				byte(0x62)
				byte(1 if v else 0)
			TYPE_STRING, TYPE_STRING_NAME:
				byte(0x73)
				string(String(v))
			TYPE_ARRAY:
				byte(0x61)
				uint32(v.size())
				for item: Variant in v:
					value(item)
			TYPE_DICTIONARY:
				var keys: Array = v.keys()
				keys.sort()
				byte(0x6F)
				uint32(keys.size())
				for key: Variant in keys:
					string(String(key))
					value(v[key])
			_:
				push_error("can't hash a %s" % type_string(typeof(v)))
