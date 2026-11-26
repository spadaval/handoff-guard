# What the handoff corpus shows

Findings as of 2026-11-24, from 3,464 messages that coding agents sent each
other. Model reviewers read a fair sample of 86 against
[the rubric](../communication-rubric.md), and the guard's mechanical checks ran
on all 3,464.

- [report.html](report.html) has the charts and every breakdown. Open the file
  in a browser; it needs no server or network.
- [methodology.md](methodology.md) says how the messages were collected,
  cleaned, sampled and judged, and how this report was stripped of identifying
  detail.

Project, mission and thread names are replaced by letters and numbers. The
only message text here is the set of fragments the rubric already quotes, with
names, numbers and hashes replaced.

## The findings

**1. Two in three handoffs need work.** 56 of the 86 sampled handoffs (65%, 95%
interval 55 to 74%) score Broken or Costly on at least one question. 15 are
Broken, meaning the recipient cannot reliably recover the meaning. 41 are
Costly, meaning the recipient has to guess or reconstruct. 15 need a small fix
and 15 are clean.

**2. The problem is how they are written, not what they ask.** Of the 56 that
need work, 53 score Broken or Costly on presentation, 28 on content and 3 on
intent; a handoff can fail on more than one. Senders nearly always say what
they want: intent is Clean or Minor in 83 of 86. Only 3 handoffs have Minor or
Clean presentation and still need work.

| Question | 1 Broken | 2 Costly | 3 Minor | 4 Clean |
| --- | ---: | ---: | ---: | ---: |
| Intent: does it say what the sender wants? | 0 | 3 | 24 | 59 |
| Content: does it carry what the recipient needs? | 1 | 27 | 30 | 28 |
| Presentation: can it be read in one pass? | 15 | 38 | 14 | 19 |

**3. Four defects account for most of it.** Reviewers marked fused words in 46
of 86 handoffs, a label or code whose meaning lives outside the message in 45,
a hash or number glued to a word in 36, and a count with no stated meaning in
24. This is what the scale looks like:

| Presentation | Fragment |
| --- | --- |
| 4 Clean | `Please review the parser change and report any failing test by name.` |
| 3 Minor | `lifecycle commit after7c1e9d2f0). Status in review round1` |
| 2 Costly | `PASS1840 (52.10s, pinned8-15),31focusedPASS` |
| 1 Broken | `NewUSER<=20min two300s16CPUbreakerOFF/ONperformancewindowreserved` |

**4. It is concentrated in one sender model's recent traffic.** Among handoffs
with a model recorded at send time, the hook blocks 383 of 415 from
`gpt-6.1-sol` and 0 of 446 from `gpt-5.5`. Reviewers found 13 of 13 need work
in the first group and 0 of 7 in the second. All 56 handoffs that need work
come from threads set to `gpt-6.1-sol`. Nothing sent in May or June 2026 is
blocked (0 of 448). The corpus cannot say the model is the cause, because
model, project, month and delivery tool all change together.

**5. A sender's writing gets worse as its thread goes on.** Cut each sender
thread's handoffs into fifths in the order they were sent. Across the 15
threads with 30 or more handoffs, the hook blocks 52% of the first fifth (260
of 501) and 90% of the last (440 of 491). The rate rises by 10 points or more
in 13 of the 15 threads and falls in none; the other two start at 97% or
above. The reviewers' figures move the same way on small counts: 5 of 11
unreadable in the first fifth, 11 of 11 in the last.

| Fifth of the sender's thread | First | Second | Third | Fourth | Last |
| --- | ---: | ---: | ---: | ---: | ---: |
| Blocked by the hook | 52% | 69% | 77% | 84% | 90% |

**6. Longer handoffs are worse.** The hook blocks 37% of handoffs under 500
characters and 96% of those between 5,000 and 12,000. Reviewers found 6 of 17
need work in the shortest group and 12 of 13 in the longest reviewed group.

**7. The hook catches nearly all of what it can see.** On the fair sample it
blocks 52 of the 53 handoffs with Broken or Costly presentation and allows 25
of the 33 that are Minor or Clean. The 8 Minor handoffs it blocks each have a
hash glued to a word. It blocks 2,090 of the 3,464 handoffs in the corpus
(60%). It cannot see the 3 handoffs that need work with Minor or Clean
presentation.

**8. Two model reviewers agree on what needs work.** Gemini Neon scored 37 of
the same handoffs independently and agreed with Claude Opus on needs work in
35 of 36. They agree less on content (27 of 36 exact) and on whether an
unreadable handoff is Broken or only Costly.

**9. The shorthand saves about a quarter of the characters, and loses
meaning.** The reviewer's plain-English rewrite is 37% longer than the text it
replaces at the median, across 53 rewrites. In 22 of those 53 the reviewer
could not decode at least one passage and had to mark it unclear.

## How far to trust this

- Both judges are models. No person has labelled a handoff.
- The corpus is narrow: 84% of handoffs are from November 2026, 88% from one
  project and 63% from one mission.
- There is no untouched test set. The hook's thresholds were set against this
  corpus, and its glued-values check was designed from the reviewed sample it
  is scored on. Expect its figures to shrink on new traffic.
- 86 reviewed handoffs support the headline, and most breakdowns rest on far
  fewer. Intervals treat messages as independent although they cluster by
  mission, so the real uncertainty is wider.
- Nothing here measures whether a recipient acted wrongly on a bad handoff, or
  what a sender does after a block.

## Keeping this current

This is a dated snapshot, written by hand from the review dashboard. The
dashboard and the SQLite database stay authoritative. When the figures move
enough to matter, replace the JSON block in `report.html` and the numbers
here, following [the publishing steps](methodology.md#publishing-these-findings).
