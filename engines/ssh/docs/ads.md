# Advertisement Model

This document describes the global advertisement model: how every alveolus decides what goods it wants to give or receive, and how the hive matches providers with demanders to create convey movements.

## Concepts

### Parties

Every alveolus in a hive is a potential **party** on the advertisement board. There are three kinds:

| Kind | Class | Storage | Examples |
|------|-------|---------|----------|
| **Transform** | `TransformAlveolus` | Process buffer | Sawmill, tree chopper, stonecutter |
| **General storage** | `StorageAlveolus` + `SlottedStorage` | Slot-based | "General store" (slotted-storage) |
| **Dedicated storage** | `StorageAlveolus` + `SpecificStorage` | Per-good max amounts | Plank pile, woodpile, stone pile |
| **Docked vehicle** | `VehicleFreightDock` | Vehicle storage | Docked wheelbarrow, docked SUV |

### Priority Tiers

Every advertisement carries a priority. Higher-numbered priorities match first:

| Priority | Index | Meaning | Source urgency |
|----------|-------|---------|----------------|
| `2-use` | 2 | Must move **now** — direct consumption or forbidden overflow | Sawmill needs wood to run; store has goods it's not allowed to keep |
| `1-buffer` | 1 | Medium urgency — replenishing a buffer or transform feed | Store below its buffer target; transform feeding next stage |
| `0-store` | 0 | Low urgency — surplus that can sit in general storage | Store above its buffer; any surplus that doesn't need immediate action |

### Matching Rule

Providers at priority N can serve demanders at all priorities ≤ N. Demanders at priority N can only be served by providers at ≥ N.

```
Provider    →   Demander
  2-use     →   2-use, 1-buffer, 0-store
  1-buffer  →   1-buffer, 0-store
  0-store   →   0-store only
```

This ensures high-priority demand (a sawmill that stopped because it has no wood) gets served before low-priority surplus (a store that's simply over its buffer).

When a new advertisement arrives, the matcher scans opposite-side buckets from highest priority to lowest, stopping at the first successful movement.

---

## Per-Storage Advertisement Logic

### SlottedStorage (General Store)

A slotted storage has N slots, each with a capacity C. For each good type, a **rule** defines:
- `minSlots`: buffer / keep target (slots reserved for this good)
- `maxSlots`: additional ceiling on top of buffer (slots allowed for this good beyond buffer)

Goods with no rule sit in **general slots** and are treated as excess only.

```
Stock level vs configured thresholds:
                              maxAllowed
  ┌──────────────────────────────────────────────┐
  │  ┌─────────────────────┐                      │
  │  │      buffer         │   allowed overflow   │  forbidden
  │  │   (minSlots × C)    │   (maxSlots × C)     │  overflow
  │  └─────────────────────┘                      │
  └──────────────────────────────────────────────┘
  0                  bufferQty              maxAllowedQty

For plannedQty (stock + allocated):

  plannedQty > maxAllowedQty  →  provide  2-use     FORBIDDEN: must evacuate immediately
  plannedQty > bufferQty      →  provide  0-store   SURPLUS:  above buffer, available to give
  plannedQty < bufferQty      →  demand   1-buffer  DEFICIT:  below buffer, wants more

  goods with no rule, occupiedSlots > 0:
                              →  provide  0-store   SURPLUS:  unmanaged goods can be given away
```

### SpecificStorage (Dedicated Store / Pile)

A specific storage has per-good `maxAmount`. A `buffer` (keep target) can be optionally configured per good.

```
  plannedQty > bufferAmount   →  provide  0-store   SURPLUS: above keep target
  plannedQty < maxAmount      →  demand   1-buffer  ROOM:    has space and wants goods
```

Note: `maxAmount` here is a hard cap — the storage can never exceed it. The buffer is a soft keep target.

### Transform Alveolus (not storage, but advertises)

Each transform (sawmill, tree chopper, etc.) advertises for its process buffer:
- **demand** `2-use` for inputs it currently needs
- **provide** `1-buffer` for outputs it has produced and wants to push downstream

---

## Matching Flow

### 1. Direct Match

When alveolus A advertises `provide` for good G at priority P:

1. Look at the `demand` bucket for good G.
2. Scan demanders at priority 2, then 1, then 0 (stop when P > demand side priority gap allows).
3. Find nearest reachable demander via pathfinding.
4. Create movement: A → demander.

Similarly for `demand` advertisements.

### 2. General Storage Fallback

If no direct match exists, the hive tries to route through its general-purpose storages (`SlottedStorage` alveoli):

- **Provider fallback**: a `provide` advertiser (non-storage, or non-0-store storage) can dump into any general storage that `canTake` the good.
- **Demander fallback**: a `demand` advertiser can pull from any general storage that `canGive` the good.

**Blocked paths** (prevent churn):
- Storage → storage transfers are forbidden in the fallback (both sides are `generalStorages`).
- `0-store` providers cannot use general storage as a fallback (they'd just be shuffling deck chairs).

### 3. General Storage as Consumer (reverse fallback)

When a general storage itself is registered on the board, the hive scans existing `provide` buckets to see if non-storage producers can route goods into it.

---

## `canGive` Priority Gating

The `canGive(goodType, priority)` check determines whether an alveolus is **willing** to release a good at a given priority:

| Priority | SlottedStorage | SpecificStorage | Meaning |
|----------|---------------|-----------------|---------|
| `2-use` | Available > 0 (always, bypasses buffer) | Available > 0 (always) | Emergency: give regardless of buffer |
| `1-buffer` | Available > buffer (same as 0-store) | releasable > 0 | Medium urgency |
| `0-store` | Available > buffer | releasable > 0 | Only give what's above buffer |

Key insight: **`2-use` bypasses buffer protection entirely**. A store configured to keep 0 of a good (buffer=0) will give at `0-store` too, since `available > 0` and buffer=0. But `2-use` signals higher urgency to the matcher.

---

## Complete Decision Table

For a **SlottedStorage** alveolus with rule (minSlots, maxSlots) for good G:

| Stock position | Advertisement | Priority | What it means |
|---------------|--------------|----------|---------------|
| stock > min+max | `provide` | `2-use` | Over allowed ceiling — must evacuate |
| stock > min | `provide` | `0-store` | Above buffer — surplus available |
| stock < min | `demand` | `1-buffer` | Below buffer — want to refill |
| no rule, stock > 0 | `provide` | `0-store` | Unmanaged goods — can give away |

For a **SpecificStorage** alveolus:

| Stock position | Advertisement | Priority | What it means |
|---------------|--------------|----------|---------------|
| stock > buffer | `provide` | `0-store` | Above keep target — surplus |
| stock < max | `demand` | `1-buffer` | Has room — can accept |

---

## Scenario: General Store configured to keep 0 of Good G

When a SlottedStorage has `minSlots=0, maxSlots=0` for planks:

1. `bufferQty = 0 * capacity = 0`
2. `maxAllowedQty = (0 + 0) * capacity = 0`
3. Any plank stock means `plannedQty > maxAllowedQty` → advertise **provide `2-use`**
4. The `2-use` provider matches against demanders at all priorities (2, 1, 0)

Meanwhile, a plank pile (SpecificStorage) with room advertises **demand `1-buffer`**.

The matcher sees:
- Board has `provide` for planks at `2-use` (general store)
- Board has `demand` for planks at `1-buffer` (plank pile)
- `2-use` provider can serve `1-buffer` demander → direct match! Movement created.

If no non-storage demander exists, the general store's `2-use` provide hits the general storage fallback. Storage-to-storage fallback is blocked at ALL priorities (the filter checks `advertiserIsGeneralStorage && candidateIsGeneralStorage`), so the planks stay put until a non-storage consumer (transform, vehicle) or the watchdog notices the stalled exchange.

## Invariants

1. **Every alveolus computes `goodsRelations` independently** — there is no central planner, only the board.
2. **Priority is urgency, not entitlement** — higher priority means "act faster", not "take from lower".
3. **Buffer is a soft floor for provides, not a hard reservation** — `2-use` can always bypass it.
4. **Storage-to-storage via fallback is forbidden** — warehouses don't shuffle goods between each other.
5. **`0-store` providers don't use general storage fallback** — they're already surplus; another store doesn't help.
6. **Docked vehicles are first-class advertisers** — they can both provide and demand at their current line stop.
