# Prop Firm practice workflow

This document records the public FXReplay workflow used as a product reference and the smaller, explicit contract implemented in `foundation_v2`. It is a simulator workflow: it does not connect a broker, issue a real prop-firm account, or create a certificate that belongs to a firm.

## Evidence boundary

The FXReplay Help Center guide, updated 26 June 2026, describes this sequence:

1. Choose **Prop Firm Session** while creating a session.
2. Configure a profit target, maximum daily loss and maximum total loss to match the challenge being practised.
3. Enter the chart and move forward through live-style data. The guide explicitly says the price-skip replay control is unavailable for this mode.
4. Open **Prop Firm Rules** from the bottom of the chart (the guide also mentions the Tab key) to inspect current distance to each rule.
5. If a limit is breached, the challenge fails. The guide says a failed challenge can be retried or sent to Analytics.
6. If the objectives are satisfied, show the result and the simulator's progress certificate/share flow.

The official walkthrough also describes the feature as a simulation of a `$100K FTMO` challenge using real market data. That is product positioning, not proof that a result is accepted by FTMO or another prop firm.

Public material does **not** establish every firm's news, weekend, instrument, leverage, consistency or payout rule. Those are profile-specific additions and remain out of the generic profile until their semantics and data requirements are implemented.

Sources:

- [FXReplay Help Center: Prop Firm Simulator](https://support.fxreplay.com/articles/prop-firm-simulator)
- [FXReplay official walkthrough](https://www.youtube.com/watch?v=tv99Vbtr-xw)
- [FXReplay official simulator walkthrough](https://www.youtube.com/watch?v=iPi1S-vzSOI)

## Implemented product contract

The local product keeps the same user-facing order but makes the state and provenance explicit:

```text
create session bundle
  -> ready
  -> start
  -> running (forward-only chart clock)
  -> pause / resume
  -> phase_passed or terminal pass/fail/expired
  -> analytics/report
  -> clean retry with parent_attempt_id
```

The shared session dialog now follows the public FXReplay setup shape: profit target
is entered as a percentage of initial capital, while daily and total loss limits show
the account currency. The selected dataset list, strategy revision and optional end
of-period are carried into the persisted setup metadata used to open the replay chart.
After the Prop handoff is submitted, the challenge bundle is created once and the
forward-only chart opens automatically; the Prop workspace remains the authoritative
owner of the challenge contract and lifecycle.

- A Prop attempt is simulation-only and carries an immutable profile hash, dataset artifact hash, cost-model version and execution-engine version.
- Replay is the only clock. The Prop evaluator consumes canonical replay `price_mark` events; it does not manufacture prices or fills.
- The chart ignores copied cursor/cutoff parameters in Prop mode and only permits forward progression. Multi-step controls are reduced to one bar so a breach cannot be crossed by a batch.
- The first execution initialization persists a replay binding (`replay_session_id`, branch, dataset hash and last replay event sequence) through the revisioned resume API. Later feed events advance that binding and the Prop revision together.
- Rule values are calculated from the backend objective snapshot. The UI displays balance/equity, profit target, daily loss, total drawdown, qualifying days and terminal reason without deriving a competing result locally.
- A terminal attempt locks forward movement. Retry creates a new clean attempt linked to the terminal parent; a hindsight replay branch is a different, explicitly exploratory operation.
- Analytics links include the Prop session and attempt identifiers so a report cannot silently switch to another challenge.

The initial UI profile intentionally exposes one immutable bar execution pin (`replay-fixture-cost-v1` + `replay-v1`). Tick and margin engines can be added only when their initialization, cost snapshot and Prop binding are wired as one verified contract.

## Known limits and next additions

- Generic practice currently models profit target, daily loss, static overall drawdown, minimum qualifying days and a calendar limit.
- News/weekend restrictions, consistency rules, leverage caps and firm-specific phases need separate profile fields, evaluator tests and dataset evidence before being advertised.
- Certificate rendering is a local progress artifact. It must remain labelled as simulator output until an external firm verification contract exists.
