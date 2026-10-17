import { describe, expect, it } from "vitest";
import { loadSimConfig, readRepoFile } from "@mandreljs/tools/testing";
import { levelFromMap } from "@mandreljs/sim/level";
import { vec3 } from "@mandreljs/sim/math/vec3";
import { startLevel, type SimEvent } from "@mandreljs/sim/sim";
import { Effects } from "../../src/game/effects.ts";

const config = loadSimConfig();
const state = startLevel(levelFromMap(readRepoFile("example/maps/greybox_01.map")), config);
const player = state.player.id;
const enemy = state.enemies[0]!.id;

/**
 * Every kind of sim event, as the player's and an enemy's where that differs. A record by type, so a new kind of event
 * doesn't compile here until it has samples, and the reset test below covers whatever it starts showing.
 */
const SAMPLES: { readonly [K in SimEvent["type"]]: readonly Extract<SimEvent, { type: K }>[] } = {
  fired: [{ type: "fired", entity: player, weapon: "shotgun" }, { type: "fired", entity: enemy, weapon: "shotgunner" }],
  hitWall: [{ type: "hitWall", entity: player, point: vec3(0, 64, 32), normal: vec3(0, -1, 0) }],
  hitEntity: [
    { type: "hitEntity", entity: player, target: enemy, point: vec3(200, 0, 30), damage: 6 },
    { type: "hitEntity", entity: enemy, target: player, point: vec3(-380, 0, 30), damage: 4 },
  ],
  sighted: [{ type: "sighted", entity: enemy, target: player }],
  damaged: [
    { type: "damaged", entity: player, attacker: enemy, amount: 20, health: 80 },
    { type: "damaged", entity: enemy, attacker: player, amount: 6, health: 34 },
  ],
  died: [{ type: "died", entity: enemy, attacker: player }],
  pain: [{ type: "pain", entity: enemy }],
};
const ALL: readonly SimEvent[] = Object.values(SAMPLES).flat();

const shown = (effects: Effects): { objects: { position: number[] }[]; flash: number } => effects.showing() as never;

describe("Effects", () => {
  it("shows nothing when new", () => {
    expect(shown(new Effects(config.player.eye_height))).toMatchObject({ objects: [], flash: 0 });
  });

  it("marks where shots hit a wall or someone, but not the player's own view", () => {
    const effects = new Effects(config.player.eye_height);
    effects.present([...SAMPLES.hitWall, ...SAMPLES.hitEntity], state, 0, 0);
    // The wall mark and the enemy's blood; a shot hitting the player shows as getting hurt instead.
    expect(shown(effects).objects).toHaveLength(2);
  });

  it("flashes when the player is hurt, not when an enemy is", () => {
    const effects = new Effects(config.player.eye_height);
    effects.present(SAMPLES.damaged.filter((e) => e.entity === enemy), state, 0, 0);
    expect(effects.view.flash).toBe(0);
    effects.present(SAMPLES.damaged.filter((e) => e.entity === player), state, 0, 0);
    expect(effects.view.flash).toBeGreaterThan(0);
  });

  it("fades out over time", () => {
    const effects = new Effects(config.player.eye_height);
    effects.present(ALL, state, 0, 0);
    effects.update(10, 10);
    expect(shown(effects)).toEqual(shown(new Effects(config.player.eye_height)));
  });

  it("leaves nothing of any kind of event behind after reset, showing just what a new one does", () => {
    const effects = new Effects(config.player.eye_height);
    effects.present(ALL, state, 0, 0);
    effects.update(0.1, 0.1); // part way through fading
    expect(effects.showing()).not.toEqual(new Effects(config.player.eye_height).showing());
    effects.reset();
    expect(effects.showing()).toEqual(new Effects(config.player.eye_height).showing());
  });
});
