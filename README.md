# gaditor

Recipes drawn as **flow tables**: ingredients are rows, time is columns, merged cells
show where streams join. A client-only web app — no server, no accounts.

The source of truth for a recipe is a **graph**. The table is one rendering of that
graph. See [SPEC.md](SPEC.md) for the full v1 specification.

## Running it

```sh
npm install
npm run dev      # http://localhost:5173/gaditor/
npm test         # solver unit tests
npm run build
```

`base` in `vite.config.ts` is `/gaditor/` — it must match the repository name or every
asset 404s on GitHub Pages. Change it if you fork under a different name.

## How it fits together

| Area | Files |
|---|---|
| Data model | `src/model/types.ts` |
| Solver (the only place a subtle bug is silent) | `src/solver/` |
| Rendering | `src/ui/Diagram.tsx` |
| Storage, overlay, import/export | `src/store/storage.ts` |
| Pages | `src/pages/` |

The solver is three pure functions, unit-tested in `src/solver/solver.test.ts`:

1. **Column layering** — longest path over the DAG; a step never precedes its inputs.
2. **Critical path** — sum along a chain, `max` at a merge, so parallel waits overlap.
3. **Row ordering** — default is descending downstream wait total; `rowOrder` overrides
   it; merges must span adjacent rows, and when no valid order exists the solver emits a
   reference marker rather than failing. **The render can never fail.**

## Publishing recipes

Recipes live in `public/recipes.json`, fetched on every load. Local edits go to a
localStorage overlay (`gaditor:v1:overlay`) and **local always wins** — a recipe you have
never touched tracks the published version, an edited one stays yours until reverted.

To publish your local work: **Settings → Export merged bundle**, commit the downloaded
file over `public/recipes.json`, then revert the local changes.
