# PROTOTYPE — cross-device Current Weekly Plan state

This throwaway logic prototype asks: **what must the client show and permit while
the authoritative Current Weekly Plan is loading, confirmed empty, current,
stale, mutation-pending, live-updating, or unavailable?** It tests a state
machine in which a cached plan is only a visibly stale snapshot, Realtime events
invalidate rather than replace authoritative state, mutation responses confirm
the initiating device, and initial generation is possible only after the server
has explicitly confirmed that no Current Weekly Plan exists.

Run it with:

```sh
npm.cmd run prototype:cross-device-sync
```

Drive the two-device story one event at a time. The frame always shows the
complete client state, the user-facing presentation, and the actions currently
permitted. The most useful sequences are:

- `f`, then try `g`: a failed first load must not offer or start generation.
- `e g t y s`: an initial generation with an unknown transport outcome retries
  the same command instead of starting another generation.
- `p d v`: a disconnected or invalidated snapshot stays visible but becomes
  read-only until a successful reload.
- `p n o v u`: the old plan remains visible while a Next Weekly Plan is pending;
  a later refresh replaces it with the authoritative successor.
- `p r t y s`: a Meal Reroll keeps its Meal Slot pending and retries the same
  command after an unknown outcome.

This directory is intentionally named and scoped as a prototype. It is not
production client code.

## Validated verdict

The human-in-the-loop review selected the stale-snapshot behavior on
2026-07-23: when authority cannot be confirmed, keep the last known Weekly Plan
visible with an explicit stale warning, but make it read-only until a successful
refetch confirms the authoritative Current Weekly Plan.
