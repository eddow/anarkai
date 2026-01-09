# Refactoring TODOs

## Terminology
- [ ] **Rename `Character` to `Hippie`**
    - **Scope**:
        - Engine: `engines/ssh` (Class names, type definitions)
        - Shared: `packages/npcs` (Script execution context)
        - UI: `apps/browser-vue`, `apps/browser-pounce` (Component names, Labels)
    - **Reason**: Alignment with game narrative.

## UI/UX
- [ ] **Fix Icon mapping in InfoWidget.vue**
    - Current: Eye = GoTo, Pin = Pin
    - Desired: Verify if "Eye" implies "Look At/Go To" or "Watch/Pin". User suspects inversion.
