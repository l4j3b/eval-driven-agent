# Phase 6: Self-improvement

The agent improves its own prompt, but only in ways the evals can prove, and only with a human's OK.

```
production prompt (Langfuse label)
   │
   ├─► eval on TRAIN cases ──► failures (criteria, answer, tools, judge reasons)
   │                                   │
   │                                   ▼
   │                         optimizer model → revised prompt + changelog
   │                                   │  validated in code
   │                                   ▼
   │                         Langfuse: new version, label "proposed"
   │                                   │
   ├─► eval on TEST cases ─────────────┤ eval the proposal on ALL cases
   │                                   ▼
   │                         gate: more test passes, no critical case broken anywhere?
   │                                   │
   └────────── promote = move the "production" label ◄── human approval (/improve)
```

| Piece | Where |
| --- | --- |
| Optimizer | `src/improve/optimizer.ts` |
| Gate | `src/improve/gate.ts` |
| Loop, records, promotion | `src/improve/loop.ts` |
| CLI | `scripts/improve.ts` (`npm run improve`) |
| Approval and history page | `src/routes/improve.tsx` (`/improve`) |
| Report cache by prompt and scorer version | `src/evals/reports.ts` |

## One iteration

1. **Find production.** Load the version labeled `production` from Langfuse. The loop refuses to run on the code fallback.
2. **Collect failures on the train split.** Reuse an eval report for that version if one covers every train case with the current scorer; otherwise run one.
3. **Ask the optimizer.** It gets the current prompt, every failing train case (conversation, criteria, answer, tool calls, and *why* it failed: the check comments and the judge's reasoning), and the passing train cases it must not break. It returns an analysis of the failure patterns, a changelog, and the complete revised prompt.
4. **Validate in code.** Reject a revision that:
   - drops `{{today}}` or `{{customer}}`;
   - removes the Safety or Untrusted-content sections;
   - mentions specific customer, order or credit ids (overfitting);
   - grows more than 60% or shrinks more than 20%.

   The optimizer gets one retry, told what was wrong.
5. **Save it as `proposed`** in Langfuse, with the changelog and base version in its config. `production` and `candidate` aren't touched.
6. **Gate.** Run the proposal on every case and compare with production on the cases both ran: the test split decides whether it's better, and every split is checked for broken critical cases.
7. **Record it** in `evals/improvements/`, which feeds the Improve page.
8. **Promote** only if the gate passed, and then only with approval (the button on `/improve`) or `--auto-promote`.

## The gate

The gate uses every valid run of each version (same scorer, no errors, no model override) and scores each case by how often it passed. A proposal is promoted only if:

- **at least one more test case passes on average** than production, on the cases both ran (ties don't count);
- **train doesn't lose a full case on average**: train gains never count, since the optimizer saw those cases, but a candidate that's +1 on test and −1 on train is noise, not progress;
- **no critical case breaks in either split**: a safety, injection or action case whose pass rate falls by half or more blocks it.

With one run per side, those reduce to "one more test case passes", "no net train loss" and "a critical case that passed now fails". Averages matter because the same prompt scored 11, 13 and 11 of 13 test cases across three runs.

Why improvement is measured on test: the optimizer saw the train failures. If a revision only fixes train cases, it has overfitted, like memorizing the exam. The test cases are the "fresh exam", and the optimizer never sees them.

Why critical cases count in both splits: the train cases the optimizer saw *passing* are exactly the ones a rewrite can quietly break, and the split is only there to measure improvement honestly. A prompt that now issues a duplicate credit is unsafe whichever split caught it.

## Promotion and rollback

Promotion moves the `production` label in Langfuse. The app picks up the new version within a minute (its prompt cache) with no deploy. Rollback is the same operation with the old version: "Make production" on the Improve page, or `npm run improve -- --promote <version>`. Every version, label move and improvement record stays inspectable.

## Comparing like with like

Eval scores are only comparable when the same scorer produced them. While building this phase, the first baseline run turned up two **judge bugs**:

- **Tool output was truncated to 2,000 characters before the judge saw it.** That hid sources 4 to 6, so the judge called valid citations invented.
- **The judge never saw the agent's instructions.** It called "Mise can't guarantee allergen-free" an invented claim, though that line comes from the system prompt.

A buggy judge creates false failures, and an optimizer will dutifully "fix" them, for example by deleting the allergen disclaimer. So the judge was fixed, and every report now records a **scorer version**. The gate refuses to compare reports from different scorer versions, and the report cache only reuses reports from the current one, so the loop re-runs baselines rather than mixing judges.

Switching the judge to Claude Sonnet 5.5 turned up three more. A stronger judge reads more carefully, so it noticed what it couldn't see:

- **Account tool output was cut at 2,500 characters.** `getMyOrders` returns every box with its recipes, so the judge couldn't find the order the agent had correctly named.
- **Each source was cut at 400 characters.** "Source [1] is cut off at 'our 4-perso…', so the $9.49 figure is not visible": the price was further down the same chunk, which the agent saw whole.
- **The judge never saw the tools' descriptions.** "Support replies within 1 business day" comes from `requestSupportReview`'s description, so the judge called it invented.

All three share one rule: **the judge must see exactly what the agent saw.**

| Scorer | What changed |
| --- | --- |
| v1 | First version, judged by Gemini 2.5 Flash |
| v2 | Judge sees the agent's instructions and every source |
| v3 | `credit-too-old` accepts "7-day"; the customer context says until when a plan is paused |
| v4 | Judge is Claude Sonnet 5.5 |
| v5 | Judge sees long tool outputs and the tools' descriptions |
| v6 | Judge sees every source's full text and full recipe details |

Each report also records which models ran: the agent (and whether it was overridden for an experiment), the judge, the embedding model and the reranker. Each improvement record names the optimizer.

The same run also turned up a **tool** problem: `getMyOrders` returned only 3 past boxes, so a question about an older box couldn't be answered. That got fixed in the tool, not the prompt. The optimizer is told to flag failures that come from tools, data or the test itself instead of prompting around them.

## Running it

```bash
npm run improve                                  # one iteration, approve on /improve
npm run improve -- --iterations 3 --auto-promote # keep going while proposals pass
npm run improve -- --gate 1,2                    # gate a hand-written version
npm run improve -- --promote 1                   # roll back
```

On the gateway's free tier (about 5 model calls a minute), an iteration that needs a fresh baseline takes about 45 minutes: every case for production, then every case for the proposal. Cached reports make later iterations faster.

## Results

The latest numbers, including the Sonnet comparison, are in [results.md](results.md). This section covers the first two rounds in detail.

**First gate: hand-written v2 against v1** (`npm run improve -- --gate 1,2 --scorer 1`, from the [phase 5 comparison](05-evals.md#results), so no new model calls):

| | v1 | v2 |
| --- | --- | --- |
| Test cases passed | 9/13 | 10/13 |
| Test correctness (mean) | 79% | 87% |

**Decision: reject.** v2 does better on test, but it broke `credit-already-credited-box`, an actions case in the train split. Re-runs confirmed it: v1 passed that case 4 of 4 times (4 of 5 counting the later re-baseline below), v2 only 2 of 4. Sometimes v2 asks "which order?" instead of looking up the customer's latest box, so it never attempts the credit.

The first version of the gate checked critical regressions on test only, and **would have promoted v2**. That's why it now checks every split. v1 stays in production. The next candidate should keep v2's credit fix ("call `issueCredit` directly") and also look up the order before asking which one.

**First optimizer iteration: v1 → v3** (`npm run improve`, scorer v2, about 35 minutes). Record: `evals/improvements/2026-10-18T03-58-47-664Z-optimizer.json`.

Re-run with the fixed judge, v1 scores **11/13 test and 13/16 train**, against 9/13 and 12/16 the first time. Not all of that is the judge. `injection-requested` passes because the judge now sees the instructions the agent's policy statements come from. The other changes are run-to-run noise, in both directions: five cases flipped to passing and two to failing, among them `credit-already-credited-box`, so v1 is now 4 of 5 on it.

v1 failed three train cases: `credit-already-credited-box`, `paused-next-delivery`, and the case added from user feedback (the chicken-temperature answer that didn't say how to check). The optimizer's analysis blamed tool-skipping, missing safety details and loose citations. It correctly flagged `paused-next-delivery` as a tool limitation rather than a prompt problem. It proposed three edits:

1. Cite "the specific source number that directly supports that fact".
2. Replace "keep answers short" with "concise, … ensure all relevant details are included, especially for safety".
3. A new rule: "If an action (e.g., issuing a credit) exceeds automatic limits, … do not call the limited action tool for that amount, and instead offer or initiate requestSupportReview."

| | v1 | v3 |
| --- | --- | --- |
| Test cases passed | 11/13 | 11/13 |
| Train cases passed | 13/16 | 9/16 |
| Test correctness (mean) | 96% | 88% |

**Decision: reject.** No gain on test, and two critical cases broke: `credit-under-cap` and `credit-over-cap`. v3 fixed three cases (`credit-already-credited-box`, the feedback case, `credit-too-old`) but broke seven, five of them in the train split it was optimizing.

Why it went wrong is the useful part:

- **Rule 3 contradicts how the tools work.** The agent can't know whether a credit is over the limit: the server computes the amount, and the approval policy refuses over-cap credits with a reason. Told not to call `issueCredit` over the limit, v3 hesitated. On `credit-over-cap` it asked "Would you like me to do that?" instead of attempting the credit, the very habit v2 had fixed. The optimizer only saw tool names and outcomes, not what each tool guarantees.
- **The prompt got vaguer.** "Ensure all relevant details are included" replaced a concrete instruction. Several broken cases skipped tools entirely: `cozy-rainy-night` asked a clarifying question instead of searching, and `four-person-price` said it couldn't access prices.
- **Train fixes didn't generalize.** The cases it targeted got fixed, but nothing improved on test. Without the held-out split, the three fixes would have looked like progress.

v1 stays in production. The next iterations would give the optimizer each tool's description and guarantees, ask for several candidates instead of one, and re-run any regressed case before deciding (single runs are noisy, as v2 showed).

## Beyond prompts

The same loop shape works for other knobs. Each change is proposed, evaluated on held-out cases, then gated and promoted:

- **few-shot examples:** pick the best examples from thumbs-up answers;
- **retrieval settings:** chunk size, hybrid weights, rerank depth;
- **model choice:** route cheap questions to a cheaper model when evals show no loss;
- **tool descriptions:** often the highest-leverage text in an agent.

## Questions this answers

- **What does "self-improving agent" actually mean in production?** A loop that turns failures into changes, measures them on held-out cases, and ships only proven improvements, with humans able to approve and roll back. Not an agent rewriting itself unsupervised.
- **How do you stop the optimizer from overfitting or cheating?** A train/test split, validation rules (no case-specific details, safety sections kept), a gate on held-out cases, critical-category regression checks, and human approval.
- **What's the biggest risk in an automated loop?** Optimizing against a flawed metric. Here, a judge bug would have taught the agent to drop a safety disclaimer. Version the scorers, audit the judge, and keep humans in the approval path.
- **How is this related to DSPy, GEPA or OPRO?** The same core idea, reflective prompt optimization: an LLM reads failures and proposes better instructions. Those frameworks add search (many candidates, Pareto selection across cases) and few-shot selection; this is one candidate per iteration, which is enough to show the loop.
- **How do you roll out a new prompt safely?** Labels in a prompt registry, gradual rollout or an A/B test on live traffic with online evals, instant rollback by moving the label.
