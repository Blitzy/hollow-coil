# @mandreljs/data

Validation for the shared `/data` files and `/spec` scenarios. Browser-safe (no file access), so editors can check what they save the same way CI does. `npm run validate` (`tools/src/validate.ts`) runs it over the repo.

- `src/schema.ts`: `SchemaValidator`, our subset of JSON Schema. It rejects any keyword it doesn't support, so a schema can't silently check less than it appears to. It takes a function that loads schema files by name.
- `src/checks.ts`: the cross-file checks (weapons, slots, enemy classnames, light styles against the FGD, hulls, scenario markers and timing). They take file text, and scenario checks take a function that reads a map.
- `tests/`: the tests.
