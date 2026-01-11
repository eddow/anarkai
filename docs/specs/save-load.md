# Save/Load System Specification

## 1. Overview
The goal is to achieve complete persistence of the game state, allowing a player to save the game, exit, and reload to the exact same state (functional logic), preserving the simulation continuity.

## 2. Serialization Scope

### 2.1. World State
*Refines existing `Game.saveGameData`*
- **Tiles**: Terrain type, coordinates.
- **Deposits**: Type and amount.
- **Projects**: Active projects on tiles.
- **Zones**: Harvest and Residential zone designations.
- **Free Goods**: Loose items on the ground.

### 2.2. Economy
*Refines existing `Game.saveGameData`*
- **Hives**: Name and list of alveoli.
- **Alveoli**: Type, coordinates, and **Storage** (stock).

### 2.3. Population (New Requirement)
*To be implemented in `Population` class*
- **Roster**: List of all active living characters.
- **Generators**: `characterGen` RNG state (to ensure subsequent IDs are unique/deterministic).

### 2.4. Character State (New Requirement)
*To be implemented in `Character` class*
- **Identity**: `uid`, `name`.
- **Physical**: `position` (Axial coordinates).
- **Stats**:
    - `hunger`
    - `tiredness`
    - `fatigue`
- **Social/Job**:
    - `assignedAlveolus`: Reference to the home alveolus (serialize as Coordinate or Alveolus ID).
- **Inventory/Vehicle**:
    - `vehicle` type (e.g., 'by-hands').
    - `carry` (Storage): List of goods and quantities held by the character.

### 2.5. Global State (New Requirement)
- **Time**: Current game time/tick count (if tracked globally).
- **RNG**: Main `gameSeed` LCG state (to preserve procedural generation consistency).

## 3. Serialization Strategy

### 3.1. Execution State Persistence (UPDATED)
To ensure precise simulation continuity, we must serialize the exact execution state of characters, including their script stack and current action progress.

#### 3.1.1. Running Scripts
Each character maintains a stack of `ScriptExecution` objects (`runningScripts`).
- **Data to Save**: Array of `ScriptExecutionData`.
    - `scriptName`: The fully qualified name of the script (e.g., `work.goWork`).
    - `state`: The inner `ExecutionState` object from the `npc-script` engine. This captures the instruction pointer and locals.
- **On Load**:
    1.  Re-instantiate `ScriptExecution` with the original `GameScript` (looked up by name).
    2.  Inject the saved `state`.

#### 3.1.2. Active Step (`stepExecutor`)
The leaf-node action currently being ticked (e.g., moving, waiting).
- **Data to Save**: `StepData`.
    - `type`: Class name of the step (e.g., `MoveToStep`, `EatStep`).
    - `state`: Simple object capturing the step's progress properties:
        - `evolution` (0-1 progress).
        - `duration`.
        - `passed` (for `QueueStep`).
        - `from`/`to` (for Lerp steps).
        - `movements` (for `MultiMoveStep`).
- **On Load**: Factory method to reconstruct the specific `ASingleStep` subclass and hydrate its properties.

### 3.2. Data Structure Schema
The `GamePatches` interface will be wrapped in a `SaveState` interface:

```typescript
interface SaveState {
  version: number;
  timestamp: number;
  seed: number;
  world: GamePatches;
  population: CharacterData[];
}

interface CharacterData {
  uid: string;
  name: string;
  pos: { q: number, r: number };
  stats: {
    hunger: number;
    fatigue: number;
    tiredness: number;
  };
  assignedAlveolus?: { q: number, r: number };
  inventory: Record<GoodType, number>;
  // NEW: Deep Execution State
  runningScripts: Array<{
      scriptName: string;
      state: any; // Opaque ExecutionState object
  }>;
  stepExecutor?: {
      type: string;
      props: any; // Evolution, from/to, etc.
  };
}
```

## 4. Implementation Checklist
1.  [ ] **Refactor `Game.saveGameData`**: Return `SaveState` instead of `GamePatches`.
2.  [ ] **Update `Population`**: Add `serialize()` returning `CharacterData[]` and `deserialize(data: CharacterData[])`.
3.  [ ] **Update `Character`**: Add `serialize()` and static `deserialize()` factory.
4.  [ ] **Update `Storage`**: Verify export/import of goods maps.
5.  [ ] **Global RNG**: Expose method to get/set LCG state.
