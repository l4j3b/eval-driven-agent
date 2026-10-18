# Results

What the evals measured, version by version, and what each round taught. Every number here comes from a report in [`evals/results/`](../evals/results), which the Evals and Improve pages also show. How the evals and the gate work is in [phase 5](05-evals.md) and [phase 6](06-self-improvement.md).

## Where it stands

Scorer v6 (Claude Sonnet 5.5 judging), 29 cases, every version run three times. The numbers are average cases passed per run.

| Version | Agent model | All | Test (13) | Train (16) | Runs |
| --- | --- | --- | --- | --- | --- |
| v1, the seed prompt | Gemini 2.5 Flash | 25.3 | 11.7 | 13.7 | 25, 26, 25 |
| v4, hand-tuned from the failure analysis | Gemini 2.5 Flash | 25.3 | 12.7 | 12.7 | 26, 25, 25 |
| v5, v4's text on Sonnet (production) | Claude Sonnet 5.5 | 29 | 13 | 16 | 29, 29 |

v5's third run hit the gateway budget halfway through, so it has 16 errored cases. Errored runs aren't measurements, and the gate and the Improve page ignore them.

| Gate | Decision | Why |
| --- | --- | --- |
| v1 → v4 | rejected | +1 test case on average, −1 train case: even overall |
| v4 → v5 | rejected | test 12.7 → 13, less than one full case (v5's train gain doesn't count by design) |
| v1 → v5 | **passes** | test 11.7 → 13, train 13.7 → 16, nothing critical broken |

v5 is the first version to pass the gate, and it was approved on the Improve page, so **production now runs v5 on Sonnet**. The trade-off: answers are about 50% slower (7.7 s against 5.2 s per eval case) and cost more per turn than on Gemini Flash. Rolling back is `npm run improve -- --promote 1`.

## What we learned

**The model mattered more than the prompt.** On Gemini Flash, v4 fixed exactly the behaviors it targeted:

| Case | v1 | v4 |
| --- | --- | --- |
| `credit-over-cap` (attempt the credit instead of asking) | 1/3 | 3/3 |
| `satay-with-allergy` (search for a safe version) | 1/3 | 3/3 |
| `cozy-rainy-night` (search instead of a clarifying question) | 1/3 | 3/3 |
| the feedback case (say how to check the temperature) | 2/3 | 0/3 |

Flash ignored the new food-safety rule and slipped on a few other cases, so v4 came out even with v1. The same text on Sonnet passed every case in both completed runs.

**Flash sometimes invents actions.** One v1 run told the customer a support case was opened without calling `requestSupportReview`. One v4 run, under scorer v5, said a credit was applied with no tool calls at all. Prompts reduce this but don't eliminate it, which is why the guardrails live in code: the server computes amounts, checks policy, and requires the customer's approval.

**Judges have bugs, and a stronger judge finds them.** It took six scorer versions to get here. Every bug made the judge see less than the agent: truncated sources, truncated account data, no system prompt, no tool descriptions. Each one turned correct answers into failures, and an optimizer would have learned to "fix" them. The full list is in [phase 6](06-self-improvement.md#comparing-like-with-like).

**Single runs are too noisy to decide.** The same prompt scored 11, 13 and 11 of 13 test cases across three runs. So the gate now averages over every valid run, and requires a full case of improvement on test without losing a full case on train. The train rule was added after the v1 → v4 result above showed +1/−1 is noise.

**Some failures were the test's fault.** `credit-too-old` demanded the exact phrase "7 days" and failed a correct "7-day window". `paused-next-delivery` failed under every prompt because the customer context said "paused" without a date. Both are fixed in the test and the context, not by prompting around them.

## Earlier rounds

These used earlier, buggier judges, so they're only comparable within each round.

| Round | Judge | Versions | Result |
| --- | --- | --- | --- |
| Hand-tuned v2 | scorer v1 (Gemini Flash) | v1 9/13 test, 12/16 train → v2 10/13, 13/16 | **rejected**: it broke `credit-already-credited-box` (v1 passed it 4 of 5 runs, v2 2 of 4) |
| Optimizer v3 | scorer v2 (Gemini Flash) | v1 11/13, 13/16 → v3 11/13, 9/16 | **rejected**: no test gain, two credit cases broke |

The optimizer round is worth reading in full ([phase 6](06-self-improvement.md#results)). Its proposal added a rule that contradicts how the credit tool works ("don't call the tool if the credit exceeds the limit", when only the tool knows the amount), and it made the agent hesitate. The optimizer only saw tool names and outcomes, not what each tool guarantees.

## Next

- Run the optimizer again with Sonnet (it now uses Sonnet by default), from production, and show it the tools' descriptions.
- Calibrate the judge: hand-grade about 30 answers and measure agreement.
- Try cheaper models on the Sonnet prompt (Haiku 5.5), since routing simple questions to a cheaper model is the obvious cost lever.
