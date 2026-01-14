# Design Principles & Anti-Patterns

## Component Interaction

### DO NOT Override Internal Logic with `onClick`
**Anti-Pattern**: Using `onClick` (or similar raw event handlers) on a high-level component to manually force state changes that the component's internal bindings should handle.

**Example**:
```tsx
// ❌ WRONG
<RadioButton 
    value="" 
    group={mode} 
    el={{ onClick: () => mode = '' }} // Manually forcing the update
/>

// ✅ RIGHT
<RadioButton 
    value="" 
    group={mode} // The component should handle the update internally
/>
```

**Why it's bad**:
1.  **Duplicate Logic**: The component already has logic to handle clicks and update state. Adding another handler often results in running logic twice or fighting race conditions.
2.  **Maintenance**: If the component's internal behavior changes (e.g., adds validation or disable states), your manual override might bypass these checks.
3.  **Readability**: It obscures the declarative nature of the binding. It implies the binding is broken (which should be fixed in the component) rather than using the component as designed.

**Solution**: If a binding isn't working (e.g., empty string values not propagating), fix the root cause in the component or the data flow, rather than patching it with an imperative override.
