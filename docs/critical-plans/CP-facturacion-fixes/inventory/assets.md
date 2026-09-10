# Reusable Assets

<!-- [MANDATORY] From Reuse Discovery — one line per asset: `path` — what it provides, or `none — <reason>` if empty. -->

`invoice-number-generator.ts:generateNextNumber` — consecutive under resolution lock; reuse at send time (A.1).
`invoice-flow.service.ts:validateTransition` — state machine making send idempotent; reuse, do not copy (A.3).
`order-flow.service.ts:1320-1367` — method↔rate coherence + activeness checks; reuse for A.2 charge gate.
`pos-fiscal-emission.service.ts:registerFailure` — single failure-registry pattern; mirror for web flag (A.3).
`ORD_SHIP_REQUIRED_001` — existing code/message; mirror wording for the new charge-time code (A.2).
`InvoiceRetryQueueService` — absorbs transient DIAN failures; reuse for web auto-send (A.3).
`pos-fiscal-status` endpoint — parity model for web failure surfacing (A.3).
