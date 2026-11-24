# Sol resolves most ambiguous labels; the pathological sample is less stable

A blind second pass by **24 `gpt-6.1-sol` agents** reviewed all **559 ambiguous**
handoffs and seeded random samples of **100 normal** and **100 pathological**
handoffs. Every one of the 759 selected messages was read in full and has an
accepted record with its exact message hash. Delegate metadata confirms that
all 24 workers completed using the requested model.

## Previously ambiguous messages

| Sol judgment | Messages | Share of 559 |
| --- | ---: | ---: |
| Normal | 320 | 57.2% |
| Pathological | 176 | 31.5% |
| Still ambiguous | 63 | 11.3% |

Sol made a definite judgment on 496 of 559 bodies (88.7%). These are the raw
Sol-pass results, before conservative wrapper-family reconciliation. The pass
allowed ambiguity and did not require every example to become binary.

## Random gut-check samples

| Earlier label | Sample size | Sol: normal | Sol: pathological | Sol: ambiguous | Same-label agreement |
| --- | ---: | ---: | ---: | ---: | ---: |
| Normal | 100 | 95 | 4 | 1 | 95% |
| Pathological | 100 | 33 | 60 | 7 | 60% |

Normal labels are comparatively stable in this check. The pathological bucket
appears over-inclusive: Sol judged a third of that sample readable and normal.
That is an inference from model disagreement, not proof that every changed
label was an error. Sol is not human ground truth either.

The within-stratum Wilson intervals for same-label agreement are 88.8–97.9%
for normal and 50.2–69.1% for pathological. These binomial intervals do not
account for correlations between threads or wrapper-only variants. Treat them
as rough sampling context, not calibrated corpus accuracy. The two 100-message
samples have different population sizes and must not be pooled into a claim
about overall accuracy or pathological-message prevalence.

## Selection, blinding and validation

The original Luna-assisted ledger remains unchanged. Its SHA-256 is recorded
in both the frozen selection manifest and [the aggregate results](../data/triage-sol.json).
The selection is a census of the 559 ambiguous bodies plus simple random
samples without replacement from each definite-label stratum. Sampling uses
`random.Random(20261123)`, starting with message IDs sorted within normal and
then pathological strata. The samples therefore reproduce exactly.

The 759 bodies total 1,857,788 characters. They were balanced into 24 batches,
keeping wrapper-only variants in the same batch. Workers received complete
source text, hashes and character counts. They did not receive old labels,
heuristic predictions, guard decisions or sample-stratum tags. All workers
used the same readability definitions: readable technical prose, ordinary
fragments, code, paths and IDs can be normal; sustained fused prose or severe
compression can be pathological; uncertain borderline cases remain ambiguous.
Length alone was not treated as style pathology.

Workers recorded one complete page before opening the next. The recorder
requires exact page ID coverage and full-message review fields; files are
created exclusively and cannot silently overwrite a prior review. Final
validation checks page text against the original corpus, saved read receipts,
page hashes, unique IDs, character counts, model tags and all 759 decisions.
Read receipts demonstrate delivered text, not provable model comprehension.

## Preserved ledgers and conservative reconciliation

All per-message text and rationales remain local and Git-ignored in
`data/private/triage-sol-20261123/`:

- `manifest.json` and `selection.jsonl` freeze the sample and old-label strata.
- `inputs/`, `views/`, and `reviews/` retain full pages, read receipts and decisions.
- `worker-provenance.json` records the delegate IDs and verified executed models.
- `labels-sol.jsonl` is the raw independent Sol pass, covering 759 bodies.
- `labels-reconciled.jsonl` is a separate provisional ledger for all 3,464 bodies.
- `summary.json` contains aggregate transitions, sampling details and fingerprints.

The provisional ledger applies Sol's definite judgments to previously
ambiguous inputs. It retains ambiguity if Sol itself is uncertain, if the
random gut check disagrees with an earlier definite label, or if wrapper-only
variants would otherwise receive inconsistent labels. Nine wrapper families
(18 bodies) needed this last consistency check.

That provisional ledger has 2,366 normal, 981 pathological and 117 ambiguous
bodies. **It is a mixed-coverage ledger, not an all-Sol classification of the
corpus.** Most earlier definite labels were outside the random samples and
remain Luna judgments. In particular, the sample's 60% pathological agreement
makes a definitive corpus-wide bad-message count premature. Do not present
981 as a newly verified total or extrapolate that count to delivered handoffs.

The original [Luna-assisted baseline](triage.md), its 3,464 labels, and prior
reports remain intact. Neither hook policy nor global Codex configuration or
model catalogs changed in this pass.

## Reproduce and validate

The scripts use only Python's standard library. This dated run is immutable;
preparation and recording refuse to replace existing files.

```sh
# Already prepared for this run:
python3 scripts/review_sol.py prepare --batches 24 --sample-size 100 --seed 20261123
# Blind review and exact-ID recording:
python3 scripts/review_sol.py page BATCH PAGE
python3 scripts/review_sol.py record BATCH PAGE DECISIONS_FILE
# Revalidate and regenerate the aggregate report from accepted records:
python3 scripts/review_sol.py finalize --public-report data/triage-sol.json
python3 -m unittest discover -s tests -v
```
