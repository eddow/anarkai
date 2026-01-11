
# Character Behavioral Specifications

> [!NOTE]
> This document serves as the authoritative "Behavioral Specification" for NPC actions within the Anarkai engine. It describes the decision-making logic, execution rules, and state changes for each defined behavior.

## Core Concepts

Characters operate on a **Job-based system**. They receive `JobPlan` assignments (typically from the Hive logic) and execute specific scripts to fulfill them.

*   **Script Layer** (`*.npcs`): Defines the high-level control flow (loops, pathfinding triggers, error handling).
*   **Context Layer** (`*.ts`): Defines the atomic game state mutations (resource transfer, time consumption, rendering updates).

---

## 1. Offload
**Role:** Unburdening / Clearing
**Script:** `work.npcs` -> `offload`
**Context:** `inventory.ts` -> `dropAllFree`, `find.ts` -> `freeSpot`

### Behavioral Description
Crucial maintenance behavior to restore functionality to "burdened" working tiles. An Alveolus or Construction Site cannot function if a "free good" is obstructing it. Offloading removes this obstruction without creating a blockage elsewhere.

1.  **Job Trigger**: The character targets a working tile (Alveolus/Project) that is "burdened" by a loose free good.
2.  **Acquisition**: The character picks up exactly one available free good from the burdened tile.
3.  **Disposition Search**:
    The character searches for a "Safe" disposal spot using the "Nearest and Most Free" algorithm:
    *   **Constraint**: Explicitly rejects any other working tile (clearing/alveolus) to avoid shifting the burden.
    *   **Heuristic**: `Score = 1 / (ExistingGoodsCount + 1)`. Prioritizes empty "wild" land; if equal, prioritizes proximity.
4.  **Execution**:
    *   Walks to the chosen safe tile.
    *   Moves to a random offset within that tile.
    *   Drops the good, leaving it as a free good in a non-critical area.

---

## 2. Harvest
**Role:** Resource Gatherer
**Script:** `work.npcs` -> `harvest`
**Context:** `work.ts` -> `harvestStep`

### Behavioral Description
The primary loop for extracting raw resources from `UnBuiltLand` (terrain deposits).

1.  **Assignment**: The character is assigned to a Harvesting Alveolus.
2.  **Resource Search**:
    *   Loops continuously while `keepWorking` is true.
    *   Locates the nearest valid deposit matching the Alveolus' target.
    *   *Pathfinding Priority*: 1. Near construction sites (clearing land for builders). 2. Inside harvest zones. 3. Any matching deposit.
3.  **Extraction**:
    *   Walks to the deposit.
    *   Executes `harvestStep`: Consumes `workTime`, decreases deposit amount by 1, and adds the output good to the character's tailored inventory (`carry`).
4.  **Delivery**:
    *   Calculates if it has room for more.
    *   If full or finished, it drops the goods.
        *   **Standard**: Drops stored goods into the assigned Alveolus storage.
        *   **Gatherable**: If the resource is labeled *isGatherable*, it behaves like `Offload` (dropping it as a free good on the nearest empty wild tile).

---

## 3. Transform
**Role:** Crafter / Processor
**Script:** `work.npcs` -> `transform`
**Context:** `work.ts` -> `transformStep`

### Behavioral Description
The behavior for converting goods (e.g., Log -> Plank) within a specific Alveolus.

1.  **Engagement**: The character positions themselves at the Transformation Alveolus.
2.  **Production Loop**:
    *   Cycles while `nextJob` is available (supplied by Hive logic).
    *   Executes `transformStep`.
3.  **Atomic Transaction**:
    *   **Reserve Input**: Locks the required input goods in the Alveolus storage.
    *   **Allocate Output**: Reserves space for the resulting output goods.
    *   **Work**: Waits for `workTime`.
    *   **Commit**: Consumes inputs and spawns outputs into the storage simultaneously.

---

## 4. Convey
**Role:** Logistics / Transporter
**Script:** `work.npcs` -> `convey`
**Context:** `work.ts` -> `conveyStep`

### Behavioral Description
Manages the internal transit of goods *within* a Hex (Alveolus) or between adjacent connected storages.

1.  **Engagement**: Character attends the Conveyor/Storage Alveolus.
2.  **Movement Monitoring**:
    *   Waits specifically for `aGoodMovement` (a flagging state indicating goods need moving).
    *   If no movement is pending but goods are incoming, it enters a `waitForIncomingGoods` state (idle) to avoid busy-waiting.
3.  **Execution**:
    *   Identifies the movement path (Source -> Target).
    *   **Visual Transport**: Spawns a visual "Good" object and animates it moving from the source coordinate to the destination coordinate.
    *   consumes `transferTime * distance`.
    *   Updates the logical storage (removes from source, adds to target) only after the animation completes.

---

## 5. Gather
**Role:** Scavenger / Collector
**Script:** `work.npcs` -> `gather`
**Context:** `find.ts` -> `gatherables`, `inventory.ts` -> `grabFree`

### Behavioral Description
Used by Gatherer Alveoli (like a Hunter's Hut or Lumberjack post that collects loose items).

1.  **Scouting**:
    *   Queries `move.nextJob()` which calls `find.gatherables` to scan the vicinity for requested loose goods.
    *   Calculates the most efficient loop to pick up items fitting in the inventory.
2.  **Collection**:
    *   Walks to each item's specific coordinate.
    *   Executes `grabFree` to pick it up.
3.  **Return**:
    *   Once the inventory is full or the path is complete, returns to the Alveolus tile.
    *   Drops all collected items into the Alveolus storage.

---

## 6. Construct
**Role:** Builder
**Script:** `work.npcs` -> `construct`
**Context:** `work.ts` -> `constructionStep`

### Behavioral Description
The final phase of building a new Alveolus.

1.  **Targeting**: Assigned to a `BuildAlveolus` (a construction site).
2.  **Travel**: Walks to the site.
3.  **Finalization**:
    *   Executes `constructionStep`.
    *   Validates the site is `isReady` (materials fully delivered).
    *   Waits for `construction.time`.
    *   **Metamorphosis**: Replaces the `BuildAlveolus` object with the fully functional target Alveolus class (e.g., `Sawmill`).

---

## 7. Foundation
**Role:** Surveyor
**Script:** `work.npcs` -> `foundation`
**Context:** `work.ts` -> `foundationStep`

### Behavioral Description
The initial phase of construction, marking a tile for development.

1.  **Targeting**: Assigned to an `UnBuiltLand` tile that has a `project` blueprint assigned.
2.  **Travel**: Walks to the planned site.
3.  **Groundbreaking**:
    *   Executes `foundationStep`.
    *   Waits for a fixed duration (3 ticks).
    *   **Instantiation**: Converts the `UnBuiltLand` content into a `BuildAlveolus` (construction site), enabling the distinct `Construct` behavior to take over later.

---

## 8. Defragment
**Role:** Storage Optimizer
**Script:** `work.npcs` -> `defragment`
**Context:** `work.ts` -> `defragmentStep`

### Behavioral Description
Maintenance behavior for optimizing storage slots, ensuring efficient space usage.

1.  **Trigger**: Active when an Alveolus storage is flagged as `fragmented` (e.g., sparse stacks that can be combined).
2.  **Reorganization**:
    *   Executes `defragmentStep`.
    *   Performs a localized `take` (reserve execution) and `arrange` (allocate execution) transaction on the same storage inventory.
    *   Essentially "shuffles" the item in memory to a more optimal index or stack, consuming `transferTime`.

---

## 9. Self-Care: GoEat
**Role:** Survivor
**Script:** `selfCare.npcs` -> `goEat`
**Context:** `find.ts` -> `food`, `selfCare.ts` -> `eat`

### Behavioral Description
High-priority interruption behavior when hunger exceeds critical thresholds.

1.  **Inventory Check**: First checks if it is already carrying food. If so, eats immediately.
2.  **Foraging**:
    *   If no food is carried, searching begins via `find.food()`.
    *   Prioritizes: Existing food storage (larders) first, then free food lying on the ground.
    *   Heuristic: Selects food with the highest `feedingValue`.
3.  **Acquisition**:
    *   Calls `inventory.makeRoom` if necessary (dropping carried tools/items).
    *   Travels to food source and grabs it.
4.  **Consumption**: Consumes the item to reduce hunger levels.

## 10. Self-Care: Wander
**Role:** Idler
**Script:** `selfCare.npcs` -> `wander`
**Context:** `find.ts` -> `wanderingTile`

### Behavioral Description
Default behavior when no jobs are available.

1.  **Search**: Looks for a random walkable tile within a short radius (2-5 tiles).
2.  **Movement**: Walks to the location.
3.  **Pondering**: Executes a brief idle animation/wait (`selfCare.pondering`) to simulate thought or rest.
