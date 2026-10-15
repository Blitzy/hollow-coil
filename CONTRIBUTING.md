# Contributing to Mandrel.js

Thanks for your interest in Mandrel.js! The project is early, and its design is still moving. Before working on anything bigger than a small fix, please open an issue to talk it over, so your time goes into something that fits where the engine is headed.

## Getting set up

Follow [Getting Started](README.md#getting-started) in the README. Before opening a pull request, run every check CI runs:

```
npm run check
```

## How the project works

The engine's rules are in [CLAUDE.md](CLAUDE.md): how the simulation stays deterministic, what every gameplay change needs for tests, the code conventions, and the commit message format. It's written for AI coding agents and people alike, so read it before your first change. Decisions and their reasons are in [docs/DECISIONS.md](docs/DECISIONS.md), and the plan is in [docs/PLAN.md](docs/PLAN.md).

## AI tools

Mandrel.js is built with an AI coding agent, and you're welcome to use one too. You're responsible for what you submit: read it, understand it, and test it, as if you'd written it by hand.

If you contribute an asset, such as a texture, a sound, or a model, say in the pull request how it was made: by hand, AI-assisted, or AI-generated, and with which tool (see DECISIONS.md, "Built with agentic coding; players' content is human-authored").

## Licensing

By contributing, you agree that your contributions are licensed under the terms in [LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md), including its additional permission for platform SDKs such as Steamworks. That permission only holds if every contributor grants it, which is why it's a condition of contributing. Only contribute work you have the right to license this way; CLAUDE.md's Licensing section says which outside code and dependencies can be used.
