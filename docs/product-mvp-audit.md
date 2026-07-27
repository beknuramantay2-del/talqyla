# Talqyla MVP logic audit

## Verdict

The MVP has a real product spine: structured argument building, adaptive opposition, a separate judge, and a next-skill recommendation. It is not a generic chat wrapper.

The previous UX hid that spine. The debate screen looked like a messenger, the judge result looked like a list of AI prose, and the dashboard mixed real progress with decorative numbers. That combination made a good underlying idea feel vibe-coded.

## Findings and decisions

### P0: The debate loop was visually a chat, not a round
**Problem:** bubbles plus a generic text input gave no sense of motion, roles, clock, phase, or tactical objective.

**Decision:** present the experience as an arena with four explicit states: Position, Cross-question, Counterpunch, Verdict. Every opponent turn has a visible question callout, and the composer says what the learner must do next.

### P0: The score contract was internally inconsistent
**Problem:** the backend stores `totalScore` as 0–50, while the old results screen displayed `/10`. That makes the judge look broken even when the model is fine.

**Decision:** show `totalScore / 50` and the calculated average skill score separately.

### P1: The MVP dashboard showed decorative metrics
**Problem:** hours, streaks, calendar and arbitrary progress numbers were not backed by the current API model.

**Decision:** dashboard surfaces only finished rounds, average score, weakest skill, recent round and the next action. Empty states explicitly explain what will appear after the first round.

### P1: The round had no learning contract
**Problem:** students were asked to “write an argument” without knowing what makes the next response good.

**Decision:** each phase has a micro-coach: answer the question, name the clash, provide a reason/example, explain the consequence. This is guidance, not an AI monologue.

### P1: Voice existed in the backend but not in the core loop
**Problem:** the product promised voice sparring, but the debate screen only exposed text.

**Decision:** add real browser recording and STT insertion into the composer. Do not fake full duplex voice until TTS playback, interruption, latency and retry states are properly designed.

### P2: “Judge” was too abstract
**Problem:** strengths, weaknesses and advice were stacked as generic lists.

**Decision:** results are a ballot: score breakdown, weakest skill, one next-round action, a short verdict, and two evidence-backed feedback blocks.

## Product rules for the round

1. A student always knows whose turn it is and what action is expected.
2. The opponent must respond to the student’s actual claim, warrant or impact, not generate a generic disagreement.
3. A round is complete after three meaningful exchanges, not after an arbitrary amount of chat.
4. The judge produces a score and a next drill, not only prose.
5. The weakest skill becomes the next round’s pressure point, but the student can still understand why.
6. No decorative metrics are shown unless the API can explain their source.
7. Voice is an input mode, not a promise of realtime conversation until the full audio loop is reliable.

## Residual MVP risks

- There is still no teacher-reviewed golden set, so score quality claims must remain modest.
- The opponent and judge are still model-driven and need live evals for consistency.
- TTS playback is not yet integrated into the redesigned arena, so the voice promise is currently STT-first.
- The round backend is still REST-sequential, not realtime. Position this as deliberate turn-based sparring, not natural interruption.
