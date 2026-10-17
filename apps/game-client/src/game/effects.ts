// What events start and leave showing after their tick: marks where shots hit,
// and the player getting hurt. Everything else on screen is drawn from the sim's
// state each frame, so these are what a start must clear (the level starting
// over, a demo starting or playing again, and later, seeking).
//
// A new effect that events start (particles, decals, sounds, pickup messages)
// goes in here: it gets the events from present, puts what it draws in group,
// and goes back to how it started in reset. tests/game/effects.test.ts feeds
// every kind of event in and checks reset leaves nothing behind.

import * as THREE from "three";
import { ImpactMarks } from "@mandreljs/render/impacts";
import { normalize, sub, vec3 } from "@mandreljs/sim/math/vec3";
import type { SimEvent, SimState } from "@mandreljs/sim/sim";
import { DamageView } from "./damage-view.ts";

export class Effects {
  /** Everything the effects draw in the world. */
  readonly group = new THREE.Group();
  /** The red flash and view kick of getting hurt. */
  readonly view = new DamageView();
  private readonly impacts = new ImpactMarks();
  /** Where shots hit someone: placeholder blood, facing the player, until real effects (M5). */
  private readonly blood = new ImpactMarks({ color: 0xb01010, size: 4, lifetime: 0.5 });
  private readonly eyeHeight: number;

  /** eyeHeight: the player's, above their origin (player.json). */
  constructor(eyeHeight: number) {
    this.eyeHeight = eyeHeight;
    this.group.add(this.impacts.group, this.blood.group);
  }

  /** Starts what happened in a tick that ended in state, at time now (seconds), with the player facing yaw (radians). */
  present(events: readonly SimEvent[], state: SimState, now: number, yaw: number): void {
    const player = state.player;
    const eye = vec3(player.origin.x, player.origin.y, player.origin.z + this.eyeHeight);
    for (const event of events) {
      if (event.type === "hitWall") this.impacts.add(event.point, event.normal, now);
      else if (event.type === "hitEntity" && event.target !== player.id) this.blood.add(event.point, normalize(sub(eye, event.point)), now);
      else if (event.type === "damaged" && event.entity === player.id) {
        const attacker = state.enemies.find((e) => e.id === event.attacker);
        this.view.hurt(event.amount, player.origin, yaw, attacker?.origin ?? null);
      }
    }
  }

  /** Moves the effects on, once a frame: seconds since the last frame, and now, the time present was given. */
  update(seconds: number, now: number): void {
    this.view.update(seconds);
    this.impacts.update(now);
    this.blood.update(now);
  }

  /** Clears everything, back to how a new Effects starts. */
  reset(): void {
    this.view.reset();
    this.impacts.clear();
    this.blood.clear();
  }

  /**
   * What the effects show right now, for tests: every object drawn (where, and how opaque), and the view's flash and
   * kick. An effect that shows itself another way (a sound playing, a message) adds that here.
   */
  showing(): unknown {
    const objects: { position: number[]; opacity: number }[] = [];
    this.group.traverseVisible((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.Material;
      objects.push({ position: object.position.toArray(), opacity: material.opacity });
    });
    return { objects, flash: this.view.flash, pitch: this.view.pitch, roll: this.view.roll };
  }
}
