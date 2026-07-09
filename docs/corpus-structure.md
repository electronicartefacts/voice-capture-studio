# Corpus Structure

The corpus is repository data. It is versioned and shipped with the application.

Each corpus manifest contains:

1. `id`: stable corpus identity.
2. `version`: semantic version.
3. `languages`: supported language codes.
4. `scenarios`: stable scenario definitions.

Each scenario contains stable prompt identifiers and performance metadata such as intention, tone,
pace, energy, direction, prosody, phonetic targets, quality gates, and tags. Prompts are written as
directed capture units, not generic reading material.

Each prompt should contain:

1. Exact text and optional spoken normalization.
2. Structured intention: primary, secondary, use case, emotion values, and labels.
3. Delivery targets: pace, energy, articulation, projection, smile, breathiness, pause style.
4. Director context: imaginary situation, note, pause instruction, emphasis, avoid-list.
5. Prosody target: pitch, variation, phrase attack, sentence ending, intimacy.
6. Phonetic profile: human-readable focus labels, machine-readable coverage targets, and difficulty.
7. QA bounds: expected duration and hard rejection reasons.

The canonical corpus currently targets French and English. The seed base is intentionally balanced
between languages, with 50 prompts per language, and grouped into seven scenario families per
language:

1. Directed assistant: practical support, status, advice, interruption, and workflow prompts.
2. Subtle signature: hesitation, fatigue boundaries, self-correction, smile, and identity anchors.
3. Phonetic balance: language-specific sounds such as French nasals and liaisons, or English th,
   rhotic vowels, weak forms, and number readouts.
4. Dialogue and controlled emotion: welcome, critique, redirection, surprise, narration, and soft
   encouragement.
5. Structured readouts: codes, dates, measures, amounts, names, menus, and yes/no/maybe contrasts.
6. Longform narration: longer breath groups for pacing, quiet presence, vulnerability, and natural
   segmentation.
7. Expressive contrast: cautious questions, disagreement, approval, firm quality boundaries,
   relaxation coaching, and precise positive direction.

Phonetic `coverage` values are stable data tokens, not UI copy. They let session planning prefer
prompts that add missing sounds before repeating already-covered patterns. UI labels can format
these tokens for display, but corpus authors should keep the token names short, language-prefixed,
and specific enough to be useful in later forced-alignment and ML reports.

Compatibility rules:

1. Adding prompts or scenarios is a minor version change.
2. Fixing spelling or metadata without changing recording meaning is a patch change.
3. Changing the intended meaning of an existing prompt is a major version change unless a new prompt identifier is created.
4. Removing a prompt requires a tombstone so existing workspaces can still explain historical progress.
5. Workspaces never store corpus copies.

Current seed corpus lives in `src/domains/corpus/data/canonicalCorpus.ts`.

Recommended capture levels:

1. Calibration: 50-100 keeper prompts per language, enough to verify microphone, room, transcript
   accuracy, and the first phonetic gaps.
2. MVP serious: 20-30 clean minutes, 150-250 prompts, one language, neutral plus conversational
   explanation.
3. Production: 60-90 clean minutes, 500-900 prompts, 8-12 intentions, controlled phonetic coverage.
4. Premium: 2-4 clean hours, 1500+ keeper takes, several days, subtle emotion, dialogue, A/B takes.
5. Advanced signature: noble voice habits such as starts, micro-pauses, breath, smile, controlled
   hesitation, word emphasis, and conclusion style.
