## Context
Legal terms render after JavaScript despite HTTP 404; privacy returns no active document. Both inherit the homepage title and canonical. The user authorized development and PRs on October 16, reserving review and publication for Rafa. This change affects client metadata only, not legal text or hosting.

## General Objective
Keep marketing legal metadata accurate for loaded and unavailable documents.

## Specific Objectives
1. Set a document-specific title and description on exact marketing hosts.
2. Remove inherited homepage canonical while loading or unavailable; use a clean legal canonical on success.
3. Restore prior metadata without overwriting a subsequent owner's changes.
4. Preserve tenant metadata and legal content; keep legal pages noindex until HTTP hosting is corrected.

## Approach Chosen
Small metadata lifecycle helper used by the existing signal-driven viewer, with browser DOM tests. No new document source or global SEO service.

## Alternatives Considered
- Publish a replacement policy: rejected because existing approved content must be located first.
- Global SPA 404-to-200: rejected because it would hide unknown routes and cross tenant boundaries.

## Critical Files
- apps/frontend/src/app/public/legal/document-viewer/legal-document-viewer.component.ts
- apps/frontend/src/app/public/legal/document-viewer/legal-document-metadata.ts
- apps/frontend/src/app/public/legal/document-viewer/legal-document-metadata.spec.ts
- .github/workflows/ci.yml
- docs/plans/seo-legal-metadata.md

## Reusable Assets
- PublicLegalService and LegalDocument: existing active document contract.
- Angular Title, Meta, DOCUMENT: existing frontend metadata APIs.
- SectorGuideComponent: lifecycle reference; restoration refined with ownership checks.
- Shared markdown/date utilities: unchanged. No relevant backend or libs primitive needed.

## Steps
1. Implement scoped metadata lifecycle.
   Skills: how-to-dev, vendix-frontend, vendix-zoneless-signals, vendix-frontend-component.
   Resources: rg -n 'canonical|Title|Meta' apps/frontend/src/app/public; Playwright browser_navigate and browser_evaluate.
   Business decision: Only marketing hosts mutate metadata; no policy text is invented; noindex remains until HTTP 200 is validated.
   Why: Existing documents and empty states currently masquerade as the homepage.
   Output: Helper plus viewer effect and destroy cleanup.
   Verification: DOM tests for loading, success, absence, tenant host, and ownership restoration; git diff --check.
2. Verify and open separate PR.
   Skills: git-workflow, pr-code-review, buildcheck-dev, how-to-test, vendix-monorepo-workspaces.
   Resources: GitHub Actions frontend Karma include; gh pr create; gh pr checks; node scripts are not compilation substitutes.
   Business decision: CI and independent review precede publication; Rafa owns publication.
   Why: Metadata changes require regression evidence without exhausting local memory.
   Output: PR and documented outstanding HTTP/content dependencies.
   Verification: AOT and focused Karma in CI; independent diff review. No local one-shot build.

## End-to-End Verification
Playwright on local vendix.com: legal success, empty, back to home, query/hash stripping and mobile navigation. Runtime dev currently blocked by host/backend access and low memory; keep PR draft until actual browser verification, do not claim E2E complete. Production read-only evidence distinguishes initial HTTP 404 from client rendering. Defensive invalid-host cases run in DOM tests only, no production abuse probes.

## Knowledge Gaps
Actual CloudFront legal route handling requires infrastructure confirmation by Rafa. Existing approved privacy document must be located by the user. Engram attribution unavailable; no attributed writes. No claims of legal compliance or production indexing fix.

## Approval Request
The user's explicit instruction to continue developing corrections and send PRs supplies execution authorization. Review and publication remain with Rafa. Plan checklist checked: all required sections and per-step fields present, scope and verification mechanisms explicit.
