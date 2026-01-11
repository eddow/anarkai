# Save/Load Verification Scenarios

This document outlines the test coverage for the Save/Load system. Tests are implemented in `src/lib/game/save_load_verify.test.ts` and run in a headless environment (using `vitest` with mocks).

## 1. Scenarios to Test

### 1.1. Movement Persistence (Implemented)
*   **Situation**: A character is traveling from Point A to Point B.
*   **Verify**: 
    - Position is exact upon reload.
    - Destination target remains the same.
    - Path progress (`evolution`) matches.

### 1.2. Inventory Consistency (To Be Implemented)
*   **Situation**: A character is carrying a specific amount of a good (e.g., 5 Wood).
*   **Verify**:
    - Inventory contains exactly 5 Wood after load.
    - Other inventory slots remain empty/unchanged.

### 1.3. Task Continuity: Resource Gathering (To Be Implemented)
*   **Situation**: A character is mid-action "Cutting Tree" (or gathering resource).
*   **Verify**:
    - Character is still in `DurationStep` or `EatStep`.
    - Progress of the action (evolution) is preserved.
    - Stats change (e.g., fatigue accumulation) is preserved.

### 1.4. Task Continuity: Logistics (To Be Implemented)
*   **Situation**: A character is moving a good from an Alveolus to another (e.g., retrieving form storage).
*   **Verify**:
    - Character has the "Pickup" or "Drop" intent preserved (script stack).
    - If holding the good, they still have it.
    - If on way to pickup, they still target the source.

### 1.5. Population Consistency (Implemented)
*   **Verify**:
    - Total character count matches.
    - Character UIDs match.
    - Character names match.

### 1.6. World State Consistency (Implemented)
*   **Verify**:
    - Terrain seed/generation matches.
    - Projects/Buildings exist at correct locations.

## 2. Test Coverage Status

| Scenario | Status | Notes |
| :--- | :--- | :--- |
| Movement Persistence | ✅ Implemented | Tested in `should resume simulation exactly` |
| Inventory Consistency | ⬜ Pending | Needs `Carry` check |
| Resouce Gathering | ⬜ Pending | Needs `DurationStep` test |
| Logistics/Transport | ⬜ Pending | Needs `ScriptExecution` stack test |
| Population Roster | ✅ Implemented | Implicitly tested |
| World Generation | ✅ Implemented | Implicitly tested |

## 3. Implementation Details

Tests use a headless `Game` instance with mocked:
- `pixi.js` (Rendering bypassed)
- `global.fetch` (Asset loading bypassed)
- `localStorage`/`document` (Browser APIs mocked)
