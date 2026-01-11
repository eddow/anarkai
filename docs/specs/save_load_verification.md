
## 5. Verification Test Specification: Deterministic Resume

This section defines the rigorous test procedure to ensure that saving and loading preserves the exact simulation state and future trajectory of characters.

### 5.1. Test Scenario Data

*   **Setup**:
    *   **Map**: 12x12 Flat terrain (Seed: `1234`).
    *   **Entities**:
        *   `Character A` at `(0, 0)`.
        *   `Alveolus B` (Storage) at `(5, 5)`.
        *   `Character A` has `MoveTo(5, 5)` script active.
    *   **Simulation Step**: `dt = 0.1` seconds.

### 5.2. Test Procedure

1.  **Phase 1: Initial Run**
    *   Initialize Game with **Setup**.
    *   Run simulation for `Time = 2.0` seconds (20 ticks).
    *   **Action**: Serialize Game State to memory (`SaveState 1`).
    *   *Note*: Character should be roughly at `(1, 1)` moving towards `(5, 5)`.

2.  **Phase 2: Control Run**
    *   Continue simulation for another `Time = 2.0` seconds (Total `Time = 4.0`).
    *   **Action**: Record "Control State" (Position, Hunger, Fatigue, current Step evolution).

3.  **Phase 3: Experimental Run (Reload)**
    *   **Action**: Clear current Game instance.
    *   **Action**: Initialize new Game instance.
    *   **Action**: Load `SaveState 1` into the new Game.
    *   *Verify*: Character Position should be identical to state at `Time = 2.0` from Phase 1.
    *   Run simulation for `Time = 2.0` seconds.
    *   **Action**: Record "Experimental State".

4.  **Phase 4: Comparison & Assertion**
    *   **Compare**: "Control State" vs "Experimental State".
    *   **Assertions**:
        *   `Control.Position` === `Experimental.Position` (Tolerance: `0.0001`).
        *   `Control.Hunger` === `Experimental.Hunger` (Tolerance: `0.0001`).
        *   `Control.Step.Evolution` === `Experimental.Step.Evolution` (Tolerance: `0.0001`).
        *   `Control.ScriptStack` length === `Experimental.ScriptStack` length.

### 5.3. Expected Outcome
The simulation must be **deterministic**. The character in Phase 3 must end up at the exact same location and state as the character in Phase 2, proving that the interrupt/resume cycle introduced no drift or state loss.
