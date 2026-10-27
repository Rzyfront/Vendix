# Voice consent verification and rollout gates (detail)

Design notes: `docs/agentic-voice-consent-G.md`.

- Run only exact created/modified specs, one process at a time, bounded heap and
  `test/agentic/jest.d1.config.json`. Core Lua tests use a synthetic Redis command
  model; integration G uses actual registry/consent/host/D1 on a SQL memory transport.
  Neither certifies real Redis Lua, PostgreSQL locks, bootstrap, providers or audio.
- Keep frozen A corpus unchanged. Cases47/48 baseline unsupported are NOT comparable
  measured completions after G. Synthetic receipts are not acoustic fixtures.
- CI/real Angular/NgRx and Playwright audio Happy/Sad/Brute remain mandatory live
  gates. Negative echo/noise/negation/replay/cross-scope must yield zero writes;
  >=95% explicit clean acceptance requires an agreed acoustic corpus, not unit tests.
- Measure STT/proposal/consent/ack separately from human reading. No provider spend
  or QA remote without approval.
- Billing close is post-success/deterministic-dedup but close→quota crash recovery
  is not exactly-once charging. Do not change economic policy to hide this gap.
- Rollback: stop Vex/Vexi through its general control and preserve evidence.
  Never replay a write because audio or transport was lost. No mandatory G migration.
