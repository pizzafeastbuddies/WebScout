# WebScout benchmark

36 questions in `questions.jsonl`. Each has accepted answers. An empty accepted answer (`""`) means the question cannot be answered, and the right result is an empty answer.

Scoring uses `normalize.ts`: uppercase, remove all whitespace, remove `- . · _`. This is the rule from the Match 2 and 3 briefs. The Match 4 brief is not public, so this is an assumption.

```
npm run eval                                     # live run -> eval/results/latest.json
EVAL_PACE_MS=5000 EVAL_OUT=my-run npm run eval   # spaced out, named report
EVAL_IDS=n01,d01 npm run eval                    # only some questions
```

On Windows PowerShell set variables first: `$env:EVAL_PACE_MS="5000"`.

Wikipedia search answers HTTP 429 after about 9 quick requests. Use `EVAL_PACE_MS=5000` to measure extraction. Live pages change, so compare runs made on the same day.

## Baselines (engine unchanged, 2026-11-27)

| Report | Answerable | Unanswerable | Confident wrong |
|---|---|---|---|
| `results/baseline-raw-2026-11-27.json` (no pacing, rate-limited) | 1/33 | 3/3 | 13 |
| `results/baseline-paced-2026-11-27.json` (5 s pacing) | 2/33 | 3/3 | 20 |
| `results/after-cpu-fixes3-2026-11-27.json` (CPU fixes, no model) | 6/33 | 2/3 | 19 |

The CPU fixes: search retry on HTTP 429, keyword search query, large pages truncated instead of refused, 400 candidates per page, citation-mark removal, year-only answers. Confidence does not separate right from wrong answers (correct: 0.66 to 0.94, wrong: 0.58 to 0.78), so a confidence cutoff does not help. A tried change that treated prose differences as no conflict scored worse (5/33) and broke an existing test, so it was reverted.
