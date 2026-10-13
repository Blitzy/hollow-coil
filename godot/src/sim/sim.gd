class_name Sim
## The simulation: plain, serializable state advanced one fixed tick at a time
## by input commands. It reads nothing else: no clock, devices, or renderer.
## Ported from web/src/sim/sim.ts.

## Spawn origins are raised 1 unit so the player doesn't start touching the floor (docs/MOVEMENT.md, Spawning).
const SPAWN_RAISE := 1.0


## The result of one tick: the new state and what happened during it.
class StepResult:
	var state: SimState
	## Things that happened during the tick, for presentation (audio, effects). None yet in M1.
	var events: Array = []

	func _init(result_state: SimState) -> void:
		state = result_state


## A new sim with the player at a spawn point. Angles are in angle units.
static func create(player: PlayerData, origin: Vec3, yaw: int, pitch := 0, seed_value := 0) -> SimState:
	var s := SimState.new()
	s.rng = SimRandom.seed_state(seed_value)
	s.player.origin = origin.add(Vec3.of(0, 0, SPAWN_RAISE))
	s.player.yaw = yaw
	s.player.pitch = pitch
	s.player.health = player.health
	return s


## Builds the movement context once per level and data; pass it to step.
static func movement_context(level: Level, player: PlayerData) -> PlayerMovement.Context:
	return PlayerMovement.Context.new(level.world, player)


## Advances the sim by one tick.
static func step(state: SimState, cmd: InputCommand, ctx: PlayerMovement.Context) -> StepResult:
	var moved := PlayerMovement.player_move(state.player.body(), cmd, ctx)
	var next := SimState.new()
	next.tick = state.tick + 1
	next.rng = state.rng
	next.next_entity_id = state.next_entity_id
	var p := next.player
	p.id = state.player.id
	p.origin = moved.origin
	p.velocity = moved.velocity
	p.on_ground = moved.on_ground
	p.jump_held = moved.jump_held
	p.yaw = cmd.yaw
	p.pitch = cmd.pitch
	p.health = state.player.health
	return StepResult.new(next)
