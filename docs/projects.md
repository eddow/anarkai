# Construction projects

A **project** is a planned, connected set of construction entries authored *before* any tile is built.
It is the design surface for a future hive: place alveoli (with variants and configuration), bulldoze
mistakes, validate the layout, then push it onto the board.

Internal name: `HivePlan` (`engines/ssh/src/lib/hive-plan.ts`). Working notes and open questions live
in [`../plans/projects.md`](../plans/projects.md); this document records decisions and what is done.

## Concept

- A project is authored as **entries**, not as live tiles. Nothing is built until it is pushed.
- It behaves like a git branch: draft → validated → pushed (`working`); it can be archived, restored,
  and merged with other projects.
- A project carries the **future demand** of what it will build — this is what lets commerce plan
  imports before anything exists (see [commerce.md](./commerce.md)).

## Scope and granularity

Projects are the **primary construction surface**. Editing a live hive (placing a single alveolus into
an existing one) is the advanced, rare path — the normal flow is to design a whole building cluster as a
project and place it.

- The smallest project is **one building = one hive** (e.g. a lone freight bay).
- A project **composes** buildings into a cluster: wood-chopper + sawmill + freight bay authored as one
  3-alveoli plan, which the player then scatters several copies of around a forest.
- The same plan is **reusable** — place it, then stamp the identical cluster elsewhere (see "reusable
  plans" in the working notes).
- Projects also manage **roads / track laying**, and **city relations**: building a stop or station in
  a city is a project whose cost may include demolishing existing buildings.

So a project is not only "a future hive" — it is the authoring unit for buildings, transport links, and
city interfaces alike.

## Entry

An entry is `{ coord, alveolusType, variant?, configuration? }`:

- `alveolusType` + `variant` resolve to the concrete building and its construction recipe.
- `configuration` names a shared config (`{ scope: 'named', name }`) or embeds an individual
  `AlveolusConfiguration` — the same config the finished alveolus runs with (storage buffers, working,
  transform ratios, …).

## Lifecycle

Stages: `draft → validating → working → archived`.

| Stage | Meaning | Editable |
|---|---|---|
| `draft` | private intent; no board demand, no construction | yes |
| `validating` | structure checks pass; consumes engineer work + survey goods | no |
| `working` | **pushed** — materializes as construction sites on the board | no |
| `archived` | retired (`manual` / `obsolete`); restorable to `draft` | no |

Transitions (`HivePlanCollection`):

- `createDraft` / `updateDraft` — draft editing only.
- `sendToValidation` — runs structural validation, moves to `validating`.
- `applyResearchWork` — engineer work fills `workSecondsRequired`; when full → `working`.
- `archive` / `unarchive`.

## Structure & validation

`validateHivePlanStructure` rejects:

- empty, disconnected (entries must form one connected hive), unknown alveolus type, missing named
  configuration.

Every plan also carries a rotation-invariant `knownnessFingerprint` used to dedupe identical designs, and
a "novelty cost" that makes reusing an already-known layout cheaper to validate than a novel one.

## Placement

A `working` plan is placed onto the board via `previewHivePlanPlacement` (anchor + rotation), which
checks each cell (`overlap`, `missing tile`, `blocked`, `not clear`) before committing. Placement creates
one construction site per entry (`createConstructionSiteForHivePlanEntry`), each carrying the plan and
the entry's configuration so the finished alveolus is built already-configured.

## Interface

The project window is `plan-manager.tsx` (+ `HivePlanCanvas.tsx`):

- **Sidebar** — New; stage filters (all / draft / validating / working / archived); plan list.
- **Designer** — name field, the hex canvas (build:/bulldoze tools from the palette), live structural
  issue list.
- **Selected cell** — alveolus picker, variant picker, named-configuration picker.
- **Plan actions** — validate, archive, unarchive, place (with rotation).

## Bill of materials → commerce

The decided direction: a project is a **forward declaration of demand**, not just a blueprint.

1. `validationProgress.requiredGoods` (currently a survey-good stub) becomes the **real bill** — the sum
   of construction recipes over all entries.
2. The configured **operating demand** of the future alveoli (storage buffers, transform inputs) joins
   the bill.
3. On push, the bill enters the group's **net-deficit ledger**, so freight/trade can start importing
   missing goods *before* construction stalls.

This is what turns "buy all not produced" from a UI shortcut into a computed quantity, and it is the same
demand origin trade already understands — projects are a demand source, not a separate trading mechanism.

The bill is not a flat `{ good: qty }` — it is a set of **sourcing requirements** ("buy X units of good G
from source S"), splittable across sources with **quotas** (own forester 40 + NPC settlement 60). Quotas
stay editable while the project runs, and resolution is **internal-first** (own hives after their own
demand + reserve, then external sources ranked by price × stock × distance). See
[commerce.md](./commerce.md#net-deficit-ledger-and-sourcing).
