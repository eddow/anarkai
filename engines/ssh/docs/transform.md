# Transform Alveoli

Transform alveoli convert goods through an internal process buffer. The sawmill is the reference example: it consumes wood and produces planks.

## Vocabulary

A transform alveolus has two material states:

- **Ordinary storage** holds whole goods that can participate in hive transport.
- **Process buffers** hold the alveolus' internal work-in-progress material.

Use **process buffer** in code and UI-facing docs. It is short, neutral, and works for both consumed and produced goods.

A process buffer is not public storage. Convey movements cannot pick goods up from it, and it does not directly count as stock. It records the fractional state of each good currently inside the transformation process.

## Specification

A transform action is a per-good rate map:

```ts
{
  type: 'transform',
  rates: {
    wood: -0.2,
    planks: 0.2,
  },
}
```

Rates are expressed in units per second.

- Negative rates consume a good from its process buffer.
- Positive rates produce a good into its process buffer.
- Every good in `rates` has one process buffer.
- Each process buffer is continuous and clamped to `[0, 1]`.

The sawmill drains `0.2` wood per second from its wood process buffer and fills `0.2` planks per second into its planks process buffer.

## Storage

Ordinary transform storage is a `SpecificStorage` for every good in `rates`.

Capacity is based on the rate direction:

- negative-rate goods use the transform input buffer size,
- positive-rate goods use the transform output buffer size.

Ordinary storage only changes at whole-unit boundaries. Fractional progress stays in process buffers.

## Process Buffers

Consumed goods start empty. When a consumed good's process buffer is `0`, the transformer can load one unit from ordinary storage. Loading removes one stored unit and sets that process buffer to `1`.

Produced goods fill during processing. When a produced good's process buffer reaches `1`, the transformer can unload one unit into ordinary storage. Unloading adds one stored unit and sets that process buffer to `0`.

The process can advance while consumed buffers have material and produced buffers have room to keep moving. If a required load or unload cannot happen, the transform pauses at that boundary without losing fractional progress.

## Work Eligibility

A transform alveolus can propose transform work when it is enabled and the current buffer boundary can move.

Consumed goods allow work when their process buffer is greater than `0`, or when ordinary storage has one available unit to load.

Produced goods allow work when their process buffer is below `1`, and ordinary storage has room for the next unloaded unit. A produced buffer at `1` requires unload room before processing continues.

## Worker Steps

Transform workers do not run a generic `prepare.transform` wait. Work starts with the current process boundary.

Each worker transform step is one of:

- **Load**: a `0.5s` boundary step for one consumed good whose process buffer is `0`.
- **Process**: a continuous step that advances every process buffer by `rate * dt` until the next buffer boundary.
- **Unload**: a `0.5s` boundary step for one produced good whose process buffer is `1`.

Load steps reserve one stored input unit when the step is created. On completion, the reservation is fulfilled and the process buffer is set to `1`. Cancellation releases the reservation and leaves the process buffer unchanged.

Unload steps allocate one output storage slot when the step is created. On completion, the allocation is fulfilled and the process buffer is set to `0`. Cancellation releases the allocation and leaves the process buffer unchanged.

When several boundary steps are possible, the implementation chooses a deterministic good. Completed output boundaries are unloaded before new input is loaded, so finished goods become ordinary storage as soon as possible.

## Advertisements

Transform alveoli demand negative-rate goods through ordinary hive advertisements while stored plus allocated stock is below the input buffer target.

Transform alveoli provide positive-rate goods only from ordinary storage. Produced material does not become available to convey until it has been unloaded from the process buffer.

## Save Data

Transform save data includes `processBuffers` alongside ordinary stored goods. Loading restores process buffers after the alveolus is created, before advertisements are invalidated.

## Presentation

The properties widget shows process buffers separately from stored goods.

Each process buffer is displayed as one normalized progress bar from `0` to `1`.

- For consumed goods, `1` means a full unit is loaded into the process and `0` means the input boundary is empty.
- For produced goods, `0` means no partial output is present and `1` means one finished unit is ready to unload.

Process bars are process state, not stock counts.
