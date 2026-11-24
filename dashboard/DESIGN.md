---
name: Handoff review
description: Exact message text beside every judgment of it, cited by line and column.
colors:
  ground: "#fcfcfb"
  sunken: "#f3f3f0"
  raised: "#ffffff"
  ink: "#16181d"
  ink-2: "#464b55"
  ink-3: "#676d78"
  rule: "#e1e2e4"
  rule-2: "#c6c9ce"
  bar: "#16181d"
  hook: "#1f5fd1"
  hook-tint: "#e2ebfb"
  reviewer: "#b3127a"
  reviewer-tint: "#fbe1f0"
  score-4: "#2f7d52"
  score-3: "#77a35a"
  score-2: "#b07a0c"
  score-1: "#c2342b"
  unknown: "#9196a0"
  dark-ground: "#0f1319"
  dark-ink: "#e6e8ec"
  dark-hook: "#4f86ec"
  dark-reviewer: "#d9509f"
typography:
  hero:
    fontFamily: "Libre Franklin Variable, Libre Franklin, system-ui, sans-serif"
    fontSize: "3.25rem"
    fontWeight: 650
    lineHeight: 1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Libre Franklin Variable, Libre Franklin, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  heading:
    fontFamily: "Libre Franklin Variable, Libre Franklin, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 650
    lineHeight: 1.3
  body:
    fontFamily: "Libre Franklin Variable, Libre Franklin, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Libre Franklin Variable, Libre Franklin, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
  message:
    fontFamily: "Courier Prime, Courier New, ui-monospace, monospace"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.62
rounded:
  mark: "2px"
  control: "4px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "36px"
components:
  button:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "30px"
  segment-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.control}"
    height: "28px"
  top-bar:
    backgroundColor: "{colors.bar}"
    textColor: "{colors.ground}"
    height: "48px"
  citation-hook:
    backgroundColor: "{colors.hook-tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.mark}"
    height: "22px"
  citation-reviewer:
    backgroundColor: "{colors.reviewer-tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.mark}"
    height: "22px"
---

# Design System: Handoff review

## Overview

A working instrument for one reader who distrusts summaries. Every judgment on
screen (a reviewer's score, a hook check, a share of the corpus) sits next to
the exact text or the exact count it rests on. The world is a transcript of
record used for what it does, not how it looks: messages are set in a
typewriter face in numbered lines, every highlight is cited by line and column,
every message has a short docket number, and figures carry their numerator,
denominator and interval. There is no paper texture, legal wording or ornament.

Ink on a near-neutral ground, separated by hairlines. Colour is spent only on
meaning, and each meaning has exactly one colour in every view.

## Colors

Restrained strategy: neutrals plus four reserved meanings.

### Primary

- **Ink** (`#16181d`): text, the top bar, the selected state of segmented
  controls, focus rings. Interaction is shown with ink, never with a hue.

### Meaning colours

- **Hook blue** (`#1f5fd1`, dark `#4f86ec`): anything the hook measured or
  decided. Hook spans, block and warn chips, the hook series in charts, false
  positives.
- **Reviewer magenta** (`#b3127a`, dark `#d9509f`): anything a model reviewer
  quoted or judged bad. Quote highlights, the reviewer series, misses, issue
  bars, the rewrite size bar.
- **Score scale** (`#2f7d52` 4 Clean, `#77a35a` 3 Minor, `#b07a0c` 2 Costly,
  `#c2342b` 1 Broken): the rubric's scale and the verdict derived from it
  (send, revise, rewrite). Always paired with the number or word.
- **Unknown grey** (`#9196a0`): null scores, unknown models, missing data.

### Neutral

- **Ground** `#fcfcfb`, **sunken** `#f3f3f0` (empty months, evidence bodies,
  hover rows), **raised** `#ffffff` (controls and cells), **rules** `#e1e2e4`
  and `#c6c9ce`. Dark mode is a blue-black carbon ground `#0f1319` with its own
  steps, chosen and validated separately, not inverted.

### Named Rules

**The one-meaning rule.** A hue means one thing everywhere. Blue is never a
link colour, magenta is never a decoration, green is never "success" outside
the rubric scale.

**The denominator rule.** A share is never shown without `k/n` and its sample.

## Typography

Two faces, each with one job. Libre Franklin carries the interface, numbers in
tables use tabular figures, and the one hero figure per view uses proportional
figures. Courier Prime carries message text, quotes, rewrites, identifiers,
issue kinds, rule names and docket numbers: anything that is the record rather
than commentary on it. Equal-width characters make fused words and long runs
measurable at a glance.

### Hierarchy

- Hero 3.25rem/650, one per view (the headline share on Overview).
- Title 1.75rem/650 (page titles, docket numbers).
- Heading 1.125rem/650 (sections, panels).
- Body 0.9375rem, small 0.8125rem, label 0.75rem/600.
- Message 14.5px/1.62 Courier Prime, ligatures off, whitespace preserved,
  wrapping anywhere so a 2,000-letter run cannot overflow.

## Layout

A 1360px page with a 24px gutter. Overview and Hook vs reviewers use a 7:5
two-column grid that stacks below 1000px. Messages uses a 248px sticky filter
column beside the results. The reader uses a fluid message column beside a
400px sticky panel that scrolls on its own; it stacks below 1080px. Sections are
separated by a full-width hairline with 36px above it.

## Elevation & Depth

Flat. No shadows anywhere. Depth comes from one step of ground (sunken or
raised) and hairline borders. Sticky bars sit on the ground colour with a
bottom hairline.

## Shapes

Controls and cells use a 4px radius; marks, quote blocks and citation chips use
2–3px. Bars in charts end in a 2–4px radius and separate with 2px gaps.

## Components

### Buttons and segmented controls

30px buttons with a 1px rule border on raised ground; ghost buttons have no
border until hover. Segmented controls are the standard way to switch a sample,
criterion or grouping; the selected segment is solid ink.

### Highlights in message text

Hook span: hook tint with a 2px blue underline for a blocking check, 1px for a
warning. Reviewer quote: magenta tint. Both: magenta tint with the blue
underline. The active highlight gets a deeper tint and a 1.5px ink outline;
jumping to one flashes it once.

### Citations

`L<line>:<column>` chips in the typewriter face, tinted in the colour of their
source. Clicking one scrolls the message to the passage. `j` and `k` step
through all highlights in text order.

### Outcome table

The hook-against-reviewers table is a grid of raised cells with large counts.
Misses carry a 2px magenta border, false positives a 2px blue border, empty
cells a muted count. Every cell is a link to its messages.

### Navigation

An ink top bar with four views, the review progress and a reload control that
turns solid when new reviews have landed.

## Do's and Don'ts

### Do:

- Do show message text exactly as written, including blank lines and runs.
- Do cite every highlight by line and column, and make the citation jump.
- Do name the sample under every figure, and say when it is skewed.
- Do render hook checks from the report, whatever rules it contains.
- Do keep Unknown visible as its own row or value.

### Don't:

- Don't decorate with the transcript world: no paper texture, legal wording,
  seals or ruled lines.
- Don't use a meaning colour for anything else, including links or hover.
- Don't add shadows, gradients or glass.
- Don't use Unicode glyphs as icons; use the drawn icons in `Icon.svelte`.
- Don't combine the hook and the reviewers into one score.
