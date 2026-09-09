# gaditor — Specification (v1)

A client-only web app for writing, browsing and sharing recipes drawn as **flow tables**:
ingredients are rows, time is columns, merged cells show where streams join.

The source of truth for a recipe is a **graph**. The table is one rendering of that graph.

---

## 1. Notation

### 1.1 Reading rules

1. The leftmost column lists ingredients, one per row, with quantity.
2. Every column to the right is a step. **Time flows left → right.**
3. A step cell spans the rows of every ingredient it acts on.
4. When two cells merge into one taller cell, those streams have joined. From that point
   they are a single thing and move together.
5. **A cell spans rightward until its output is consumed.** An ingredient not yet used
   keeps its own name cell stretched across the idle columns; an intermediate result
   stretches its action cell. Cells are never blank.
6. A vessel is implicit: a group of touching cells is one vessel, a gap starts a new one.

How to read it:

- **Along a row** — what happens to one ingredient, start to finish.
- **Down a column** — what is happening at one moment, across the whole dish.
- **Where a box gets taller** — two streams became one.
- **Where boxes do not touch** — independent work, running in parallel.

### 1.2 Example — sauteed spinach

```
+---------------------+----------+---------------+--------+-----------+
| 1/2 lb spinach      | wash & drain             |        |           |
+---------------------+----------+---------------+        |           |
| 1 clove garlic      | mince    | heat until    | saute  | season    |
+---------------------+----------+ translucent   |        | to taste  |
| 1 Tbs. canola oil              |               |        |           |
+--------------------------------+---------------+--------+           |
| 1 pinch salt                                            |           |
+---------------------------------------------------------+-----------+
```

Spinach is washed on its own. Garlic is minced, then meets the oil and heats until
translucent. The two streams join at `saute`. Salt sits out until `season to taste`,
which spans everything.

### 1.3 Example — split

A `split` keeps the first portion on the current row and emits the remainder as a new
row, which any later node may consume.

```
+-----------+---------------+----------------+----------+---------+
| blood                     | mix                       |         |
+-----------+---------------+                |          | mix     |
| egg       | mix           | split 75       |          |         |
+-----------+ egg + flour   | (25 -> A)      |          |         |
| flour     |               |                |          |         |
+-----------+---------------+----------------+----------+         |
| sugar     | mix                            | rest 1h  |         |
+-----------+                                |          |         |
| A         |                                |          |         |
+-----------+--------------------------------+----------+---------+
```

### 1.4 Limits accepted in v1

- **Width is text length, not duration.** Deliberate: duration-proportional columns
  destroy the compact, screenshot-friendly map. Timed waits carry their duration as text.
- **Vessels are implicit** — readable from the topology, never stated.
- **A span still carries two meanings** — "these are now together" and "this happens
  next". Resolved in authoring, not in notation: if an instruction applies to two things
  that do not combine, author it as two nodes.

---

## 2. Data model

### 2.1 Recipe

```ts
type Recipe = {
  version: number // format version, migrated on load
  id: string // human-readable slug, stable forever
  title: string
  lang: 'en' | 'fr' // language the content is authored in
  servings: number // baseline for the multiplier
  prepMinutes: number // manual estimate of active time
  note?: string // free text: tools, provenance, anything
  tags: string[]
  nodes: Node[]
  rowOrder: string[] // presentation override, see 3.2
}
```

`note` is plain multi-line text. Line breaks are rendered; no markdown parsing.

### 2.2 Nodes

All nodes share `{ id, type, inputs: string[] }`. `inputs` holds node ids. Type changes
appearance and validation only — the renderer and solver treat nodes uniformly.

| type         | params                           | rules                                                                                             |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `ingredient` | `name`, `qty?`, `unit?`, `ref?`  | Source: `inputs` is always empty. `unit` is free text, not an enum. `ref` is another recipe's id. |
| `action`     | `label`                          | Free text. N inputs → 1 output.                                                                   |
| `split`      | `portions: { percent, label }[]` | 1 input → N outputs.                                                                              |
| `wait`       | `minutes`, `label`               | 1 input → 1 output.                                                                               |

**There is no merge node.** Any node with two or more inputs _is_ a merge, rendered as a
cell spanning those rows.

**`ingredient.ref`** marks a subrecipe. It renders as a normal ingredient row plus a
button that navigates to the referenced recipe. v1 does **not** inline the child graph and
does **not** propagate the multiplier across the boundary. A recipe may not reference
itself. A reference to a missing recipe renders as a visible "missing recipe" marker.

**`ingredient.qty` / `unit` empty ⇒ the ingredient does not scale.** There is no explicit
toggle. This is what makes `1 pinch salt` and `oil for frying` behave.

**`split`**: the first portion continues on the current row. Every other portion spawns a
new row, auto-labelled `A`, `B`, `C`, … A single split node may emit several portions.
Percentages are scale-invariant — the multiplier does not touch them.

**`wait`**: an explicitly timed wait, feeding both the time calculation (§3.3) and the
default row order (§3.2). Untimed waiting ("rest until cool") is just an `action`.

---

## 3. Layout solver

Three pure functions, independently unit-tested (§9).

### 3.1 Columns — automatic, never authorable

Longest-path layering over the DAG. A node's column is `1 + max(column of its inputs)`.
This guarantees a step never precedes its inputs. Column position is not authorable.

### 3.2 Rows

Rows are streams: ingredient sources, plus rows spawned by splits.

**Default order**: descending **downstream wait total** — for each source, the sum of
`wait.minutes` on the path from it to the final node. The stream with the most waiting
ahead of it floats to the top, because that is the one you must start first. Ranking by a
stream's own waits alone would miss a stream that waits little itself but feeds a long
rest later.

**Override**: `rowOrder` is applied as a preference on top of the default. It is edited in
the editor's solved-render pane (§6.2), and it is part of the recipe — display is data.

**Contiguity constraint**: a node with N inputs must span **adjacent** rows. The solver
finds the valid order closest to the requested one. Implementation: build the merge tree,
order children by the mean position of their subtree, emit rows depth-first.

**Fallback**: when no valid contiguous order exists, the solver emits a **reference
marker** (`25 -> A` on the producing cell, `A` as a separate row) rather than failing.
**The render can never fail.** A render that sometimes refuses to draw is a bug factory.

### 3.3 Time

```
total = prepMinutes + criticalPath(waits)
```

`criticalPath` is a longest-path DP over the same layering: **sum along a chain, `max` at
a merge**. Two streams each resting 1h in parallel cost 1h, not 2h.

Displayed as a breakdown — `prep 20 min + wait 1 h = 1 h 20` — so it is obvious which half
is the author's estimate and which is derived.

Wait durations do **not** scale with the multiplier. Neither does `prepMinutes`.

### 3.4 Validation

- **Cycles are hard-blocked at connect time.** A cycle makes layering impossible.
- Everything else is **advisory**, surfaced as a warnings badge in the editor:
  - multiple terminal nodes → rendered as parallel top-level blocks
  - orphan nodes → rendered as their own single-cell rows, so they are visible
  - missing quantities, empty labels

Authoring is a sequence of invalid states. Nothing except a cycle may block the render.

---

## 4. Rendering

### 4.1 Table

A real `<table>` with `rowspan` / `colspan`, emitted directly from the solver output.
Column widths are **text-driven** — the browser's own layout. Never duration-driven.

### 4.2 Orientation

- **Horizontal**: ingredients are rows, time flows left → right.
- **Vertical**: a pure transpose of the same solved layout.

A toggle offers both on desktop and mobile. When the table exceeds the viewport it
scrolls. There is no separate mobile notation and no second solver.

LTR only. No direction abstraction.

### 4.3 Interaction

- **Tap any node → done colour.** Applies to every node type.
- Done state is **in memory only** — not localStorage. A refresh clears it.
- There is no collapse behaviour anywhere.

### 4.4 Multiplier

- UI is expressed in **servings** ("serves 6"), with preset chips and a free numeric input;
  the multiplier is derived from `servings`.
- Scaling is **exact — no rounding**. The cook rounds. Repeating decimals are displayed
  trimmed to a few decimal places with trailing zeros stripped, since literal no-rounding
  is not representable.
- Quantities are formatted with `Intl.NumberFormat` in the **UI** locale (`0,75` in FR).
- Multiplier state is **in memory only**, like done marks.

---

## 5. Share image

One **Share** button. The diagram is cloned into an offscreen container at full size,
unclipped, and rasterised with a DOM-to-image library at 2–3× device pixels. It is a full
render, never a screenshot of the viewport.

**Contents**: the complete header (title, time breakdown, note) plus the diagram. The
header text block is capped to a readable measure (~60–80 characters per line) and
left-aligned above the diagram — text stretched across a 2000px-wide image is unreadable.

**Orientation**: horizontal or vertical, chosen in the share dialog.

**Theme**: dark or light, chosen in the share dialog, defaulting to the current app theme.

**Delivery, in order**:

1. `navigator.share({ files: [png] })` — the native share sheet. Primary path on mobile;
   it drops the image straight into a chat app.
2. `navigator.clipboard.write` with a PNG `ClipboardItem`.
3. `<a download>`.

Rasterise **before** the gesture-sensitive call wherever possible — on iOS an `await` can
lose the user gesture and fail silently. As a final fallback the dialog displays the
rendered PNG so it can be long-pressed and saved.

---

## 6. Pages

### 6.1 List page

- Search box over **title + tags + ingredient names**, via **fuzzysort**.
- Space-separated terms are **ANDed**: fuzzysort matches a query as a subsequence, so
  terms are split and per-term result sets intersected. Typing `chicken lemon` finds
  recipes containing both — the "what's in my fridge" query, with no extra UI.
- Index built in memory at load; results update as you type.
- Search state lives in **query params**, so the list is deep-linkable and restores.
- Click a result → recipe page. Browser back returns to the list.
- No swipe, no prev/next navigation inside a recipe.
- Recipes with a local overlay show a **"modified locally"** badge (§7).

### 6.2 Editor page

Two coupled views:

- **Node canvas** — React Flow. Add nodes, drag, connect, edit params inline.
- **Solved render pane** — the live table. **Row reordering happens here**, writing to
  `rowOrder`.

Also:

- **Warnings badge** (§3.4).
- **Undo/redo** — snapshot-based on a debounced stack. React Flow provides none, and a
  node canvas without undo is unusable after one mis-drag.
- **Autosave** — debounced write to the local overlay, with a "saved" indicator. No
  explicit Save button. Losing a 20-node graph to a stray refresh is unacceptable.

Code-split, so the viewer bundle ships none of the editor or React Flow.

### 6.3 Recipe page

Header (title, time breakdown, servings/multiplier control, note) above the diagram.
Orientation toggle, share button, screen wake lock (§8).

---

## 7. Storage and publishing

### 7.1 Base layer

A single **`recipes.json`** bundle in the repository, fetched on **every** load.

At ~1–3 KB per recipe, 100 recipes is ~150–300 KB raw and ~40–60 KB gzipped: one request,
millisecond parse. Splitting into an index plus lazy per-recipe files is unnecessary below
roughly 1000 recipes — and because ids are stable slugs, that split later is a build-step
change, not a format migration.

The bundle carries a `version` field so format changes migrate on load rather than
breaking silently.

### 7.2 Overlay layer

localStorage under a versioned key `gaditor:v1:overlay` holds **only local changes**:
created recipes, edited copies, and tombstones for deletions.

**Local wins.** A recipe never touched locally always reflects the latest published
version; an edited one stays yours until reverted.

- **"modified locally"** badge wherever the recipe appears.
- Per-recipe **"revert to published"** — also the cleanup step after committing.

Seed-and-forget was rejected: it permanently pins a device to its first snapshot.

### 7.3 Import / export

- **Export merged bundle** — the exact file to commit as the new `recipes.json`.
- **Export single recipe.**
- **Import** from pasted or uploaded JSON. Without it there is no way to move work between
  devices.

---

## 8. Platform

- **React + Vite + TypeScript.** TypeScript is non-negotiable: the project is a typed
  graph transformation (nodes → solver → table → renderer), which is exactly where types
  pay for themselves and what makes the solver debuggable.
- **React Flow** (`@xyflow/react`) for the editor canvas only.
- **fuzzysort** for search.
- A **DOM-to-image** library for the share render.
- State: `useReducer` + context. No state library at this size.
- **Routing is hash-based** — `#/recipe/carbonara?q=egg`. GitHub Pages cannot serve SPA
  deep links from real paths.
- **PWA** via `vite-plugin-pwa`: precache the app shell and `recipes.json`; installable to
  the home screen; works offline. Updates surface as a **"new version — reload" toast**,
  not a silent swap.
- **Screen Wake Lock** (`navigator.wakeLock`) on the recipe view, with a toggle. Keeps the
  screen alive mid-cook.
- **Theme**: dark and light, following the system by default, toggle persisted.
- **Deploy**: GitHub Actions → GitHub Pages. `base` in `vite.config.ts` **must** be set to
  the repository name or every asset 404s.

### 8.1 Internationalisation

- UI chrome in **English and French**, day one.
- Hand-rolled `t(key, params)` over two JSON dictionaries, keyed by area
  (`editor.addNode`, `viewer.share`). ~60 strings; a library is not worth 40 KB.
- Language defaults from `navigator.language`, with a manual toggle **persisted in
  localStorage** — unlike multiplier and done marks, this is a real preference.
- Recipe **content is single-language**, tagged with `lang` and shown as a badge. Recipes
  are not translated.

---

## 9. Testing

Unit tests for the three pure solver functions, and nothing else:

1. **Column layering** — longest path; a node never precedes its inputs.
2. **Critical path** — sum along chains, `max` at merges; parallel waits overlap.
3. **Row ordering and contiguity** — default wait-based order; `rowOrder` override;
   contiguity satisfied; reference-marker fallback when it cannot be.

This is the only code where a subtle bug produces a silently wrong diagram.

---

## 10. Deferred to v2

- Tag chips and max-time filters on the list page.
- Subrecipe inlining (splicing a child graph into the parent).
- Multiplier propagation across a subrecipe boundary (needs a `yield` field per recipe).
- Structured tools / provenance fields (v1 folds these into free-text `note`).
- Richer search (instruction text, dedicated ingredient picker).
- Per-recipe file storage with a search index, if the library outgrows one bundle.
