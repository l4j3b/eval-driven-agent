# Phase 4: Feedback and the data flywheel

Users rate answers; bad answers become eval cases; every future prompt is tested against them. The same loop exists in every serious LLM product, whatever the tool (Langfuse, Braintrust, LangSmith).

```
answer ──👍/👎──► Langfuse score on the answer's trace
                       │
            Feedback page (review queue)
                       │  "what would a good answer do?"
                       ▼
          dataset item in mise-agent-evals ──► phase 5: replayed on every candidate prompt
```

| Piece | Where |
| --- | --- |
| One trace per turn, trace id sent to the browser | `src/routes/api/chat.ts` (`startActiveObservation`, `messageMetadata`) |
| Thumbs up/down under answers | `src/components/chat/feedback.tsx` |
| Scores, review queue, dataset items | `src/server/feedback.server.ts` |
| Review page | `src/routes/feedback.tsx` (`/feedback`) |
| Eval case shape | `src/lib/evals.ts` |

## Linking an answer to its trace

Feedback is only useful if it lands on the trace that produced the answer.

- Each turn runs inside a root span, `chat-turn`. Everything the AI SDK emits nests under it: the agent loop, each step, each tool, and the embedding and rerank calls inside `searchKnowledge`. That gives one trace per turn, tagged with the customer (`userId`) and the chat (`sessionId`).
- The root span's trace id is sent to the browser as **message metadata** on the stream's `start` event, and saved with the message.
- The span is ended in `onEnd`, not when the handler returns (`endOnExit: false`), because the answer is still streaming at that point.
- Message metadata is *merged* on save, so a later update to the same message (an approval continuing the turn) doesn't wipe a vote.

## Scores

A vote calls `submitFeedback`, which:

1. checks the chat belongs to the signed-in customer;
2. reads the trace id **from the stored message**, so a client can't attach scores to arbitrary traces;
3. writes a Langfuse score: `user-feedback`, boolean, with the optional note as its comment;
4. stores the vote on the message, so the thumbs state survives a reload.

Voting again updates the same score (same `id` and timestamp) instead of adding another. In Langfuse, filter traces by `user-feedback = 0` to see every disliked answer, or chart the average by prompt version.

## The flywheel

The **Feedback** page lists every rated answer: the question, the answer, the user's note, and a link to its trace. For a bad answer, "Add to eval dataset" asks a reviewer one question: *what would a good answer do?* That sentence becomes the grading criteria.

The dataset item in `mise-agent-evals` holds:

```json
{
  "input": { "customerId": "cus_001", "transcript": [{ "role": "user", "text": "What temperature should chicken be cooked to?" }] },
  "expectedOutput": { "criteria": "States 165°F (74°C), cited, and says to check with an instant-read thermometer in the thickest part." },
  "sourceTraceId": "7c01e382…",
  "metadata": { "source": "user-feedback", "comment": "…", "flaggedAnswer": "…" }
}
```

- **The input is replayable:** who was signed in, plus the conversation up to the question. It's text only: earlier tool results aren't replayed, so the agent has to look things up again, as it would live.
- **The expected output is criteria, not an exact answer.** Free-text answers can't be string-matched; a judge (phase 5) grades against the criteria. An example answer is optional.
- **`sourceTraceId`** links the case back to the trace where the problem happened, which is useful when the case later fails again.
- The item id is derived from the message, so adding the same answer twice updates the case instead of duplicating it.

Langfuse's UI can also add any trace to a dataset directly. The in-app page exists because the reviewer's sentence ("what should it have done?") is the valuable part, and it should be asked at the moment of review.

## Verified

1. Asked "What temperature should chicken be cooked to?" as Ava. The trace showed `chat-turn` → agent → step 1 (`searchKnowledge` → embedding, rerank) → step 2.
2. Thumbs-down with a note. The score appeared on that trace in Langfuse (`user-feedback`, 0, with the note).
3. Feedback page → "Add to eval dataset" with criteria. The dataset item appeared in `mise-agent-evals`, linked to the trace.

## Interview questions this prepares you for

- **How do you collect feedback on an LLM product?** Explicit (thumbs, notes) attached to the exact trace, plus implicit signals (retries, abandoned chats, escalations). Keep feedback tied to the prompt version so you can compare versions.
- **How do production failures turn into tests?** A review queue: a human confirms the failure and writes what good looks like; the case joins the eval dataset and gates every future change.
- **Why criteria instead of reference answers?** Many correct answers exist for one question; criteria capture what matters (facts, tool use, safety) and an LLM judge can apply them.
- **What can go wrong with thumbs-down data?** It's sparse and biased (angry users vote), and a vote alone doesn't say what was wrong. That's why the note and the reviewer's criteria matter more than the vote.
- **Why one trace per turn?** Feedback, cost and latency are per answer; a root span gives every answer one id that ties together its model calls, tools and retrieval.
