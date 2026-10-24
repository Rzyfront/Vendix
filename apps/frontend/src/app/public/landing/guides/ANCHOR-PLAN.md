## Context
Local browser QA reproduced guide→home#guias returning to the top rather than the cards (cards top11682px on mobile). The user authorized continuing fixes and PRs. Guides remain disabled in production.

## General Objective
Return guide readers to the requested landing section after rendering.

## Specific Objectives
1. Scroll to guias or precios-section after landing DOM exists.
2. Ignore unknown fragments and disabled guides.
3. Preserve metadata restoration and production publication gate.

## Approach Chosen
Local afterRenderEffect in the landing, reacting to ActivatedRoute.fragment through toSignal. Reuse ViewportScroller; no global routing change or timers.

## Alternatives Considered
- Global anchorScrolling: rejected because it changes private and tenant navigation.
- Delayed timer: rejected because render timing differs by device and API latency.

## Critical Files
- apps/frontend/src/app/public/landing/vendix-landing/vendix-landing.component.ts
- apps/frontend/src/app/public/landing/guides/ANCHOR-PLAN.md

## Reusable Assets
- Angular ActivatedRoute,toSignal,afterRenderEffect,ViewportScroller.
- Existing section IDs guias and precios-section; existing publication flag.

## Steps
1. Add landing-scoped fragment handling.
   Skills: how-to-dev,vendix-frontend,vendix-zoneless-signals,vendix-frontend-routing.
   Resources: Playwright browser_run_code_unsafe on https://vendix.com:8443; rg -n 'guias|precios-section' apps/frontend/src/app/public/landing.
   Business decision: Only recognized landing anchors scroll; disabled guides stay disabled.
   Why: Reader navigation completes before its target DOM exists.
   Output: Render-aware scrolling on return and fragment changes.
   Verification: Mobile/desktop guide→cards,guide→pricing; invalid fragment does not throw; SSR build in CI, no local one-shot build.
2. Review and deliver PR.
   Skills: git-workflow,pr-code-review,buildcheck-dev,how-to-test.
   Resources: gh pr create --base develop; gh pr checks; node --test apps/frontend/src/app/public/landing/guides/sector-guides.test.cjs.
   Business decision: Rafa reviews/publishes; no automatic deployment.
   Why: Preserve the original gated guide delivery.
   Output: Reviewed correction and evidence.
   Verification: Independent diff review, existing guide tests and CI; restore temporary local overlay with hashes.

## End-to-End Verification
Local real backend through temporary loopback nginx8443. Playwright with local certificate exception. Existing exact guide source files temporarily integrated into the running watcher, preserving pre-existing user edits. Exercise cards→restaurant→wholesale→preparation→cards,pricing return,TOC,mobile,unknown query/fragment. Production gate checked by source/tests; no production writes or abuse probes.

## Knowledge Gaps
Local watcher baseline differs from develop; CI compiles the actual PR branch separately. No runtime Engram identity; no attributed writes. Full public publication/indexability remain outside this fix.

## Approval Request
Execution authorized by the user's standing instruction to develop pending fixes and submit PRs. Plan checklist complete; publication remains reserved for review.
