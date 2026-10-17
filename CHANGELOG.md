# Changelog

## TBD

### ✨ Added

### 🔧 Changed

### 🐛 Fixed

### 🗑️ Removed

## v0.0.2 - 2026-10-17

### ✨ Added

- Watch a demo by dropping it on the game page, with pause and 1/4x to 4x speed. ([#3](https://github.com/mandreljs/mandrel.js/pull/3))
  - Show where play first differs from the recording, and which map or data changed since it was recorded.

## v0.0.1

The first release: an early vertical slice, playable in the browser.

### ✨ Added

- Add Quake-style movement and collision on levels made in TrenchBroom, with baked, colored lighting and flickering and pulsing lights.
- Add the pistol and the shotgun, switched with the number keys or the mouse wheel.
- Add the shotgunner, an enemy that spots, chases, and shoots the player, and turns on other enemies that hurt it.
  - Its health, senses, speed, and attack are set in a game's `data/enemies.json`.
- Show getting hurt and dying as Quake did, and restart the level after death.
- Add the `mandreljs` command, which a game's own repo installs from npm to play, check, compile, and build the game.
  - `mandreljs build` makes a release that runs on any static web host.
  - `mandreljs install-trenchbroom` sets up TrenchBroom to edit the game's maps.
- Add the example game, with three test maps, placeholder textures, and data to start a new game from.
