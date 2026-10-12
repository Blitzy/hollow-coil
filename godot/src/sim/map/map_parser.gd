class_name MapParser
extends RefCounted
## Parser for TrenchBroom .map files: entities with key/value pairs and brushes.
##
## Faces may use the Valve 220 or standard texture format, and may end with the
## Quake 2 contents, surface flags, and value fields. The same key/value entity
## text appears in a .bsp's entity lump, which parse_entities() reads.
## Ported from web/src/sim/map/parse.ts.


## The outcome of a parse: entities, or an error with its line number.
class Result:
	var entities: Array[MapEntity] = []
	var error := ""
	var line := 0

	func ok() -> bool:
		return error == ""


const _NEWLINE := 10
const _QUOTE := 34
const _OPEN_PAREN := 40
const _CLOSE_PAREN := 41
const _OPEN_BRACKET := 91
const _CLOSE_BRACKET := 93
const _OPEN_BRACE := 123
const _CLOSE_BRACE := 125
const _SLASH := 47
const _END := -1

var _text: String
var _length: int
var _pos := 0
var _line := 1
var _error := ""
var _error_line := 0


func _init(text: String) -> void:
	_text = text
	_length = text.length()


## Parses a .map file into its entities. The first entity is normally worldspawn.
static func parse_map(text: String) -> Result:
	var parser := MapParser.new(text)
	var result := Result.new()
	while parser._error == "" and parser._peek() != _END:
		var entity := parser._parse_entity()
		if parser._error == "":
			result.entities.append(entity)
	if parser._error != "":
		result.entities.clear()
		result.error = "line %d: %s" % [parser._error_line, parser._error]
		result.line = parser._error_line
	return result


## Parses entity key/value text with no brushes, such as a .bsp entity lump.
## Returns an empty array if the text doesn't parse.
static func parse_entities(text: String) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for entity in parse_map(text).entities:
		out.append(entity.properties.duplicate())
	return out


# --- Cursor ---------------------------------------------------------------


static func _is_space(c: int) -> bool:
	return c == 32 or c == 9 or c == 13 or c == _NEWLINE


## Skips whitespace and // comments; returns the next character code without consuming it, or _END.
func _peek() -> int:
	while _pos < _length:
		var c := _text.unicode_at(_pos)
		if c == _NEWLINE:
			_line += 1
			_pos += 1
		elif c == 32 or c == 9 or c == 13:
			_pos += 1
		elif c == _SLASH and _pos + 1 < _length and _text.unicode_at(_pos + 1) == _SLASH:
			while _pos < _length and _text.unicode_at(_pos) != _NEWLINE:
				_pos += 1
		else:
			return c
	return _END


func _fail(message: String) -> void:
	if _error == "":
		_error = message
		_error_line = _line


func _describe(c: int) -> String:
	return "end of file" if c == _END else "'%s'" % String.chr(c)


func _expect(c: int) -> bool:
	var next := _peek()
	if next != c:
		_fail("expected '%s', found %s" % [String.chr(c), _describe(next)])
		return false
	_pos += 1
	return true


## A run of non-whitespace characters, such as a number or a texture name.
func _word() -> String:
	if _peek() == _END:
		_fail("unexpected end of file")
		return ""
	var start := _pos
	while _pos < _length and not _is_space(_text.unicode_at(_pos)):
		_pos += 1
	return _text.substr(start, _pos - start)


func _number() -> float:
	var w := _word()
	if _error != "":
		return 0.0
	if not w.is_valid_float():
		_fail("expected a number, found '%s'" % w)
		return 0.0
	return w.to_float()


## True if the next word starts like a number, without consuming it.
func _peek_number() -> bool:
	var c := _peek()
	return c == 45 or c == 43 or c == 46 or (c >= 48 and c <= 57)


func _quoted() -> String:
	if not _expect(_QUOTE):
		return ""
	var end := _text.find('"', _pos)
	if end < 0:
		_fail("unterminated string")
		return ""
	var s := _text.substr(_pos, end - _pos)
	_line += s.count("\n")
	_pos = end + 1
	return s


# --- Grammar --------------------------------------------------------------


func _parse_point() -> Vec3:
	_expect(_OPEN_PAREN)
	var p := Vec3.new(_number(), _number(), _number())
	_expect(_CLOSE_PAREN)
	return p


func _parse_axis() -> PackedFloat64Array:
	_expect(_OPEN_BRACKET)
	var axis := PackedFloat64Array([_number(), _number(), _number(), _number()])
	_expect(_CLOSE_BRACKET)
	return axis


func _parse_face() -> MapFace:
	var face := MapFace.new()
	face.points = [_parse_point(), _parse_point(), _parse_point()]
	face.texture = _word()
	if _peek() == _OPEN_BRACKET:
		face.format = MapFace.TextureFormat.VALVE
		face.u = _parse_axis()
		face.v = _parse_axis()
	else:
		face.format = MapFace.TextureFormat.STANDARD
		face.offset = PackedFloat64Array([_number(), _number()])
	face.rotation = _number()
	face.scale = PackedFloat64Array([_number(), _number()])
	if _peek_number():
		face.contents = int(_number())
		face.surface_flags = int(_number())
		face.value = int(_number())
	return face


func _parse_brush() -> Array[MapFace]:
	var faces: Array[MapFace] = []
	_expect(_OPEN_BRACE)
	while _error == "" and _peek() == _OPEN_PAREN:
		faces.append(_parse_face())
	_expect(_CLOSE_BRACE)
	return faces


func _parse_entity() -> MapEntity:
	var entity := MapEntity.new()
	_expect(_OPEN_BRACE)
	while _error == "":
		var next := _peek()
		if next == _QUOTE:
			var key := _quoted()
			entity.properties[key] = _quoted()
		elif next == _OPEN_BRACE:
			entity.brushes.append(_parse_brush())
		elif next == _CLOSE_BRACE:
			_pos += 1
			return entity
		else:
			_fail("unterminated entity" if next == _END else "unexpected %s in entity" % _describe(next))
	return entity
