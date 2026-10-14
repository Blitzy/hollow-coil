# @mandreljs/data

Validation for the engine's and games' data files, games' TrenchBroom configs, and `/spec` scenarios. Browser-safe (no file access), so editors can check what they save the same way CI does. `npm run validate` (`tools/src/validate.ts`) runs it over the repo.

- `src/schema.ts`: `SchemaValidator`, our subset of JSON Schema. It rejects any keyword it doesn't support, so a schema can't silently check less than it appears to. It takes a function that loads schema files by name.
- `src/checks.ts`: the cross-file checks (weapons, slots, enemy classnames, light styles against the FGD, hulls, a game's name in its TrenchBroom config and map headers, scenario markers and timing), plus reading a TrenchBroom config and resolving an FGD's `@include`s. They take file text, and functions that read other files (an included FGD, a scenario's map).
- `tests/`: the tests.
