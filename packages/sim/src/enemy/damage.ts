// Enemies taking damage: losing health, dying, turning on whoever hurt them,
// and flinching. Follows Quake's T_Damage in combat.qc and the monsters'
// pain_finished check (id Software, GPLv2 or later). See docs/ENEMIES.md, "Damage".

import { PLAYER_ID } from "../constants.ts";
import { nextRandom } from "../rng.ts";
import { alive, type EnemyState, type EnemyType } from "./enemy.ts";

export type DamageEvent =
  | { readonly type: "damaged"; readonly entity: number; readonly attacker: number; readonly amount: number; readonly health: number }
  | { readonly type: "died"; readonly entity: number; readonly attacker: number }
  | { readonly type: "pain"; readonly entity: number }
  | { readonly type: "sighted"; readonly entity: number; readonly target: number };

/** Who did the damage: the player (type null) or an enemy of a type. */
export interface Attacker {
  readonly id: number;
  readonly type: string | null;
}

export interface DamageResult {
  readonly enemy: EnemyState;
  readonly rng: number;
  readonly events: readonly DamageEvent[];
}

/**
 * Applies one attack's damage to an enemy on this tick. A shot's pellets are
 * added up first and applied once, as in Quake's multi-damage, so a shotgun
 * blast is one hit. The pain roll draws one value from the RNG, unless the
 * enemy dies or is still flinching.
 */
export function damageEnemy(enemy: EnemyState, amount: number, by: Attacker, tick: number, type: EnemyType, rng: number): DamageResult {
  const attacker = by.id;
  if (!alive(enemy)) return { enemy, rng, events: [] };
  const health = enemy.health - amount;
  const events: DamageEvent[] = [{ type: "damaged", entity: enemy.id, attacker, amount, health }];
  if (health <= 0) {
    events.push({ type: "died", entity: enemy.id, attacker });
    return { enemy: { ...enemy, health, mode: "dead" }, rng, events };
  }

  let next: EnemyState = { ...enemy, health };
  // Turn on the attacker, as on first sighting (Quake's FoundTarget), unless already hunting it, or it's
  // an enemy of the same type and this type doesn't fight its own kind. Leaving the player for another
  // enemy, remember the player to go back to (Quake's oldenemy). Turning cancels an attack in progress.
  const ownKind = by.type !== null && by.type === enemy.type && !type.data.fights_own_kind;
  if (attacker !== enemy.target && attacker !== enemy.id && !ownKind) {
    const oldTarget = enemy.target === PLAYER_ID ? PLAYER_ID : enemy.oldTarget;
    const mode = next.mode === "idle" || next.mode === "attack" ? "chase" : next.mode;
    next = { ...next, target: attacker, oldTarget, attackReadyAt: tick + type.reactionTicks, mode };
    events.push({ type: "sighted", entity: enemy.id, target: attacker });
  }

  let state = rng;
  if (tick >= enemy.painUntil) {
    const roll = nextRandom(state);
    state = roll.state;
    if (roll.value < type.data.pain.chance) {
      next = { ...next, mode: "pain", painUntil: tick + type.painTicks };
      events.push({ type: "pain", entity: enemy.id });
    }
  }
  return { enemy: next, rng: state, events };
}
