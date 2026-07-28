# ДебатоТренер

**Talqyla is a structured debate coach for school students, not another AI chat.** A student builds a Claim → Warrant → Impact case, faces a focused sparring opponent, then receives a coach-grade ballot and a concrete next drill.

The first wedge is Russian/Kazakh-ready school debate practice for grades 7–11: short, repeatable rounds that work without a partner and build a visible skill graph over time.

## Product loop

`Motion → Case → Cross-question → Counterpunch → Ballot → Next drill`

The product is deliberately turn-based in the MVP. We do not pretend a REST round is realtime conversation. Voice is an input mode today; realtime interruption is a later format upgrade, not marketing fiction.

## Why it is not a wrapper

- Fixed debate methodology, not open chat.
- Separate opponent and judge roles.
- Weakest skill becomes the next round's pressure point.
- Feedback must cite the student's words and end with an actionable drill.
- Progress is measured across rounds, not by decorative usage counters.

## MVP scope

- Structured Claim / Warrant / Impact builder.
- Three-exchange Debate Arena with visible phases.
- Voice-to-text input, with typed fallback.
- Ballot scoring across Structure, Content, Refutation, Logic, and Delivery.
- Parent consent, transcript retention, export and deletion controls.
- Daily spend caps, schema-validated model output, judge eval harness and security release gate.

## Positioning details

See [`docs/product-positioning.md`](docs/product-positioning.md) for the wedge, buyer, north-star metrics and roadmap rules.
