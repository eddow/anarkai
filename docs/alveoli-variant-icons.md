# Alveolus Variant Icons — Status & Remaining Work

## Background

Variants were introduced for two alveolus types: [`pile`](engines/rules/src/content/alveoli.ts:109) and [`engineer`](engines/rules/src/content/alveoli.ts:161). The design doc specifies:

> "On-board visual: the main icon remains the root (e.g., the pile icon). Variant state is shown as a badge overlay (e.g., wood/planks/extra, building/research/road)"

This means each variant-capable building needs:
- **1 main icon** (already exists for `pile` and `engineer`)
- **N badge sprites** (1 per variant, to be created)

Additionally, UI panels that currently show **text labels** for variants need to show icons instead.

---

## 1. Sprite Assets to Create

### 1.1 Pile variant badges

| Variant | Badge source | Notes |
|---------|--------------|-------|
| `pile.wood` | Reuse `goods.wood` sprite as badge | Wood good icon already exists |
| `pile.planks` | Reuse `goods.planks` sprite as badge | Planks good icon already exists |
| `pile.stone` | Reuse `goods.stone` sprite as badge | Stone good icon already exists |
| `pile.<variant>.extra` | New badge: "upgraded" marker (star / chevron / plus) | No existing sprite |

### 1.2 Engineer variant badges

| Variant | Badge source | Notes |
|---------|--------------|-------|
| `engineer.building` | New badge: building/construct icon (e.g., trowel) | `buildings.trowel` exists for construction site |
| `engineer.research` | New badge: research/flask icon | No existing sprite |
| `engineer.road` | New badge: road/path icon | `tablerOutlineRoad` exists as vector icon but not as sprite |

### 1.3 Extra-tier indicator

The `extra` sub-variant (`pile.wood.extra`, `pile.planks.extra`, `pile.stone.extra`) needs a visual indicator — could be a small star, chevron, or "II" marker.

---

## 2. Files Requiring Changes

### 2.1 Pixi renderer — [`engines/pixi/src/renderers/alveolus-visual.ts`](engines/pixi/src/renderers/alveolus-visual.ts)

**Current**: [`alveolusVisualKey()`](engines/pixi/src/renderers/alveolus-visual.ts:24) looks up sprite by `alveolus.name` only (e.g. `"pile"`, `"engineer"`). No variant awareness.

**Needed**: 
1. Keep the main sprite from `alveolus.name` (as today).
2. If `alveolus.variantId` is set, render a **badge sprite** overlay positioned relative to the main sprite (e.g., top-right corner).
3. The badge sprite key could be derived as: `alveolus.name + '.' + variantId` (e.g., `"pile.wood"`) — but lookup would need new entries in [`visual-content.ts`](engines/pixi/assets/visual-content.ts).

**Alternative approach** (simpler): Since the doc says "badge overlay", the renderer could:
- Look up a badge sprite via a naming convention: e.g. `variant-badge.<variantId>` → `goods.wood`, `goods.planks`, `goods.stone` for pile variants; new sprites for engineer variants.
- Render it as a small Sprite child anchored top-right of the main sprite.

### 2.2 Visual content registry — [`engines/pixi/assets/visual-content.ts`](engines/pixi/assets/visual-content.ts)

**Current**: The [`alveoli`](engines/pixi/assets/visual-content.ts:41) map has entries only for root types (`pile`, `engineer`). No variant entries.

**Needed**: Add variant badge entries. Two approaches:

**Option A** — Add variant sub-entries to `alveoli`:
```ts
alveoli['pile.wood'] = { sprites: ['buildings.woodpile'] } // or goods.wood
alveoli['pile.planks'] = { sprites: ['goods.planks'] }
alveoli['pile.stone'] = { sprites: ['goods.stone'] }
alveoli['pile.wood.extra'] = { sprites: ['buildings.woodpile'] } // same base + title badge
alveoli['engineer.building'] = { sprites: ['buildings.engineer'] } // with badge
```

**Option B** — Add a separate `badges` registry for variant indicators.

### 2.3 Tile properties inspector — [`apps/browser/src/components/properties/TileProperties.tsx`](apps/browser/src/components/properties/TileProperties.tsx)

**Current** (lines 376-389): The variant `<select>` dropdown shows plain text labels:
```tsx
<for each={model.variantOptions}>
  {(opt) => <option value={opt.value}>{opt.label}</option>}
</for>
```
And [`collectVariantOptions()`](apps/browser/src/components/properties/TileProperties.tsx:301) uses `fullId` as both value and label.

**Needed**:
- Replace the text-only `<select>` with a variant picker that also shows an icon/badge per variant option.
- Like a grid of `<EntityBadge>` items (icon + label) that are clickable.
- The badge sprite for each option should be: for pile variants, reuse the corresponding `goods.*` sprite; for engineer variants, use new badge sprites.

### 2.4 Palette variant entries — [`apps/browser/src/lib/app-shell-controls.ts`](apps/browser/src/lib/app-shell-controls.ts)

**Current** (lines 105-108): Variant entries in the palette use the **root icon** for all variants of that type:
```ts
const variantEntries = getAppShellVariantEntries().map((v) => ({
    value: v.value,
    label: v.label,
    icon: getBuildIcon?.(v.rootName),  // ← same icon for all variants!
    keywords: ['build', 'construction', 'variant', v.rootName],
}))
```
And [`getAppShellVariantEntries()`](apps/browser/src/lib/app-shell-controls.ts:50) generates labels like `"Build pile (wood)"`, `"Build engineer (building)"` — all text, no icons.

**Needed**:
- Each variant entry should show a **distinct icon** that combines the root icon + an indicator of the variant material/role.
- The labels should be nicer (e.g., "Wood Pile" instead of "Build pile (wood)").
- Pattern: `<ResourceImage>` for the root building + small badge overlay.

### 2.5 HivePlanCanvas — [`apps/browser/src/components/HivePlanCanvas.tsx`](apps/browser/src/components/HivePlanCanvas.tsx)

**Current** (line 127): Uses root sprite key without variant awareness:
```ts
const spriteKey = visualAlveoli[entry.alveolusType]?.sprites?.[0]
```

**Needed**: When `entry.variantId` is set, render a badge overlay on top of the root sprite, similar to the Pixi renderer.

### 2.6 LinkedEntityControl — [`apps/browser/src/components/LinkedEntityControl.tsx`](apps/browser/src/components/LinkedEntityControl.tsx)

**Current** (line 158-160): No variant awareness:
```ts
const type = tile.content.name as keyof typeof visualAlveoli | undefined
const nextSprite = type ? visualAlveoli[type]?.sprites?.[0] : undefined
```

**Needed**: When the alveolus has a `variantId`, show a badge indicator alongside the main sprite.

### 2.7 Browser palette icon provider — [`apps/browser/src/palette/browser-palette.tsx`](apps/browser/src/palette/browser-palette.tsx)

**Current** (lines 62-67): The `getBuildIcon` callback looks up sprites by root name only:
```ts
const sprite = visualAlveoli[name]?.sprites?.[0]
```

**Needed**: The `name` parameter here receives **both** root names and variant IDs (from `getAppShellVariantEntries`). Should resolve variant-specific icons (or composite root + badge icons).

### 2.8 Hive properties ad rows — [`apps/browser/src/components/HiveProperties.tsx`](apps/browser/src/components/HiveProperties.tsx)

This file already uses goods sprites correctly (line 209: `const sprite = goodSprite(entry.goodType)`). No change needed for variants specifically, but relevant context.

---

## 3. Summary of Required Changes

| Priority | Area | What to do |
|----------|------|------------|
| **P0** | New sprite assets | Create badge sprites: `variant-badge.research`, `variant-badge.road`, `variant-badge.extra`. Optionally `variant-badge.building` (could reuse `buildings.trowel`). |
| **P0** | [`visual-content.ts`](engines/pixi/assets/visual-content.ts) | Add variant badge entries (or a new badges registry) |
| **P0** | [`alveolus-visual.ts`](engines/pixi/src/renderers/alveolus-visual.ts) | Add badge sprite rendering for variant-capable alveoli |
| **P1** | [`TileProperties.tsx`](apps/browser/src/components/properties/TileProperties.tsx) | Replace text-only `<select>` with icon + label variant picker |
| **P1** | [`app-shell-controls.ts`](apps/browser/src/lib/app-shell-controls.ts) | Give each variant entry its own icon (root + badge composited) |
| **P1** | [`HivePlanCanvas.tsx`](apps/browser/src/components/HivePlanCanvas.tsx) | Show variant badge on plan canvas tiles |
| **P1** | [`LinkedEntityControl.tsx`](apps/browser/src/components/LinkedEntityControl.tsx) | Show variant badge in linked-entity inspector |
| **P2** | [`browser-palette.tsx`](apps/browser/src/palette/browser-palette.tsx) | Resolve variant icons properly in palette |
| **P2** | [`alveoli-variants.md`](engines/ssh/docs/alveoli-variants.md) | Update to reflect stone variant existence (done) |

---

## 4. Existing sprites that can be reused as badges

| Good sprite | Can badge for | Currently exists as |
|-------------|---------------|---------------------|
| `goods.wood` | `pile.wood` | [`visual-content.ts:150`](engines/pixi/assets/visual-content.ts:150) |
| `goods.planks` | `pile.planks` | [`visual-content.ts:142`](engines/pixi/assets/visual-content.ts:142) |
| `goods.stone` | `pile.stone` | [`visual-content.ts:146`](engines/pixi/assets/visual-content.ts:146) |
| `buildings.trowel` | `engineer.building` (optional) | [`visual-content.ts:43`](engines/pixi/assets/visual-content.ts:43) |

Sprites that need to be **created** (as 24×24 or 32×32 PNGs in [`engines/pixi/assets/buildings/`](engines/pixi/assets/buildings/)):
- `variant-research.png` — a flask/book icon for engineer.research
- `variant-road.png` — a road segment icon for engineer.road
- `variant-extra.png` — a star/chevron/"II" icon for pile.*.extra
