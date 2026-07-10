# Dataset Lifecycle

The package separates capture review from training acceptance.

## Lifecycle states

- `captured`: recorded but not reviewed enough for training candidacy
- `archived`: retained but not active for training
- `training_candidate`: usable as a candidate sample, still subject to rights,
  quality, alignment, and review gates
- `training_accepted`: reserved for samples that pass all required downstream
  gates
- `needs_review`: human review is required before further use
- `rejected`: rejected by review or quality gates
- `quarantined`: retained for investigation only

The current application maps keeper takes to `training_candidate`, not
`training_accepted`. Estimated browser/G2P alignment, unresolved rights, or
quality review needs keep `review_required` true.

## Best take policy

Legacy `review.bestTake` remains in review artifacts for compatibility, but the
v1 contract does not use it as training acceptance. Forge consumers must read the
sample lifecycle and readiness reports instead.

## Split policy

Samples are exported with `split.assignment = "unassigned"`. Group ids are
provided for later split assignment:

- speaker
- session
- prompt
- normalized text
- corpus version
- environment
- room tone
- device
- capture day

This prevents accidental leakage from assigning train/validation/test splits
without respecting related samples.
