# Alveolus Variant Icons — Done

## Background

Variants were introduced for two alveolus types: [`pile`](engines/rules/src/content/alveoli.ts) and [`engineer`](engines/rules/src/content/alveoli.ts). The design:

- On-board visual: the main icon remains the root (e.g., the pile icon). Variant state is shown as a **badge overlay** (e.g., wood/planks/reinforced, building/research/road).
- The Pixi renderer overlays a small variant badge sprite anchored top-right of the main sprite.
- The tile inspector uses a `<details><summary>` icon picker — the summary shows the current variant badge (or ∅ for root), the dropdown panel shows all variant icons as clickable buttons.
- HivePlanCanvas and LinkedEntityControl also show variant badge overlays.

---

## 1. Sprite Assets

All badges live in [`variantBadges`](engines/pixi/assets/visual-content.ts:102).

### 1.1 Pile variant badges

| Variant | Badge source | Status |
|---------|--------------|--------|
| `pile.wood` | `goods.wood` | ✅ |
| `pile.planks` | `goods.planks` | ✅ |
| `pile.stone` | `goods.stone` | ✅ |
| `pile.wood.extra` | `variants.extra-wood` | ✅ |
| `pile.planks.extra` | `variants.extra-planks` | ✅ |
| `pile.stone.extra` | `variants.extra-stone` | ✅ |

### 1.2 Engineer variant badges

| Variant | Badge source | Status |
|---------|--------------|--------|
| `engineer.building` | `buildings.trowel` | ✅ |
| `engineer.research` | `buildings.variant-building` | ✅ |
| `engineer.road` | `variants.road` | ✅ |

---

## 2. Files Updated

### 2.1 Pixi renderer — [`alveolus-visual.ts`](engines/pixi/src/renderers/alveolus-visual.ts)

✅ `alveolusVariantBadgeKey()` derives the badge key as `alveolus.name + '.' + alveolus.variant`. A reactive effect creates/destroys a small `Sprite` anchored top-right with `tileSize * 0.35` scaling.

### 2.2 Visual content registry — [`visual-content.ts`](engines/pixi/assets/visual-content.ts)

✅ Separate `variantBadges` registry with entries for all pile + engineer variants. Pile variants reuse goods icons; extra-tier variants use dedicated sprites; engineer variants use trowel/variant-building/road sprites.

### 2.3 Tile properties inspector — [`TileProperties.tsx`](apps/browser/src/components/properties/TileProperties.tsx)

✅ `collectVariantOptions()` returns `VariantOption[]` with `badgeSprite` from `variantBadges`. The `<VariantPicker>` component (a `<details><summary>` icon picker) replaces the old plain `<select>`. Labels use `variantDisplayLabel()` which maps `extra` → "Reinforced".

### 2.4 Variant picker — [`VariantPicker.tsx`](apps/browser/src/components/properties/VariantPicker.tsx)

✅ Standalone component:
- `<details><summary>` shows the currently selected variant's badge icon (or ∅ for root)
- Dropdown panel shows all variant icons as clickable buttons
- Click outside or select a variant closes the panel
- Buttons carry `title` tooltips with the display label

### 2.5 HivePlanCanvas — [`HivePlanCanvas.tsx`](apps/browser/src/components/HivePlanCanvas.tsx)

✅ When `entry.variant` is set, renders a small badge `Sprite` anchored top-right of the plan cell sprite, using `variantBadges` lookup.

### 2.6 LinkedEntityControl — [`LinkedEntityControl.tsx`](apps/browser/src/components/LinkedEntityControl.tsx)

✅ Reactive state field `variantBadgeSprite` tracks the variant badge. When the tile content is an `Alveolus` with `variant`, a small badge overlay is rendered in the visual area.

### 2.7 Plan editor — [`plan-manager.tsx`](apps/browser/src/widgets/plan-manager.tsx)

✅ Variant `<select>` in the "Selected cell" panel, populated from `planEntryVariantOptions()` with "Reinforced" display labels. Changing the alveolus type clears the variant.

### 2.8 Game class — [`game.ts`](engines/ssh/src/lib/game/game.ts)

✅ `changeAlveolusVariant(tile, alveolusType, variant?)` bulldozes the tile and sets a new build project with the requested variant.

