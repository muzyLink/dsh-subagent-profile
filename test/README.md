# test/ — host-side automated tests

Host-side automated tests built on the built-in `node:test` runner (zero new dependency, no npm
test package). `characterization.test.mjs` snapshots the observable `apply(ctx)` behavior;
`pure.test.mjs` unit-tests the import-free pure functions.

## Running

```bash
node --test "test/**/*.test.mjs"
```

> Node 24 no longer accepts the bare directory argument `node --test test/` (parses it as a single
> module and fails with `MODULE_NOT_FOUND`); use the glob form above (matching only `*.test.mjs`).
> `npm test` also works from the repo root.

## Snapshot maintenance

`characterization.test.mjs` is a snapshot of `apply()`; on a host upgrade or an intentional change,
re-verify the fake ctx surfaces and the assertions against the new service signatures, and state the
reason in the commit message.

Design basis: `docs/V2-SPEC.md` §6.4 test matrix.
