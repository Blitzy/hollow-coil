# Contributing to Mandrel.js

Thanks for your interest in Mandrel.js! The project is early: the engine is a vertical slice, and its design is still moving. Before working on anything bigger than a small fix, please open an issue to talk it over, so your time goes into something that fits where the engine is headed.

## Getting set up

Follow [Getting Started](README.md#getting-started) in the README: install Node.js 24 or newer, run `npm install` and `npm run setup`, then `npm run dev` to play. Every command is listed under [Commands](README.md#commands).

Before opening a pull request, run the checks CI runs:

```
npm run validate
npm run typecheck
npm test
npm run compile -- --mode check
```

If you changed the tools or the `mandreljs` package, also run `npm run test:package`.

## How the project works

The project's guidelines are in [CLAUDE.md](CLAUDE.md). It's written for AI coding agents and people alike, so it's the place to start. Decisions and the reasons for them are in [docs/DECISIONS.md](docs/DECISIONS.md), and the current plan is in [docs/PLAN.md](docs/PLAN.md). The rules that matter most:

- **The simulation is deterministic, and separate from presentation.** Sim code (`packages/sim`) runs on a fixed tick, reads only per-tick input commands, takes all randomness from its seeded RNG, and never touches Three.js, the DOM, or Node. Recorded demos replay exactly because of this, so these rules aren't optional.
- **Gameplay changes come with tests:** unit tests for the logic, plus a scenario in `scenarios/` when the behavior is observable in play.
- **Never change a test's expectations just to make it pass.** If a test fails, explain why in the pull request. Golden demos are re-recorded only for intentional behavior changes.
- **Content is data, not code.** Weapons, enemies, and movement are tuned in a game's `data/` files. A new behavior is a generic engine feature, plus example content and tests that use it.
- **Movement, weapons, and enemies follow their references:** [docs/MOVEMENT.md](docs/MOVEMENT.md), [docs/WEAPONS.md](docs/WEAPONS.md), and [docs/ENEMIES.md](docs/ENEMIES.md).
- **Maps compile cleanly.** A leak or a missing texture fails the build.

Commit messages use [Conventional Commits](https://www.conventionalcommits.org/), such as `fix(sim): stop step-up through ceilings`. CLAUDE.md lists the types and scopes.

## AI tools

Mandrel.js is built with an AI coding agent, and you're welcome to use one too. You're responsible for what you submit: read it, understand it, and test it, as if you'd written it by hand.

The content players see (levels, tuning, encounters, and art direction) is made by people (see DECISIONS.md, "Built with agentic coding; players' content is human-authored"). If you contribute an asset, such as a texture, a sound, or a model, say in the pull request how it was made: by hand, AI-assisted, or AI-generated, and with which tool.

## Licensing

By contributing, you agree that your contributions are licensed under the project's terms in [LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md):

- **Code** is licensed under the GNU GPL v3.0 or later, **including the additional permission for platform SDKs** such as Steamworks. That permission only holds if every contributor grants it, which is why it's a condition of contributing.
- **Example content** (maps, textures, and gameplay data in `example/`) is licensed under CC BY 4.0.

Only contribute work you have the right to license this way. In particular:

- Code adapted from Quake, ericw-tools, or other GPLv2-or-later or GPLv3 projects is welcome. Credit the source in a comment next to the adapted code.
- Code from GPLv2-only projects can't be combined with GPLv3, so it can't be used.
- New dependencies need a GPLv3-compatible license, such as MIT, BSD, Apache-2.0, LGPL, or GPLv3. Please ask in an issue before adding one.
