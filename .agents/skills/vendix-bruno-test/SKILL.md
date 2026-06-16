---
name: vendix-bruno-test
description: >
  Opt-in Bruno API testing template for Vendix collections: request files, auth inheritance,
  DTO-aligned payloads, post_response scripting, and pragmatic assertions. NOT an agent
  verification mechanism — agents verify endpoints with curl (see how-to-dev / how-to-plan).
  Trigger: ONLY when a developer explicitly asks to write or edit a Bruno (.bru) test.
license: MIT
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
---

# Vendix Bruno Test

> **Opt-in only.** Bruno is NOT a verification mechanism for agents. Agents must verify
> endpoints with `curl` (authenticating via a seed owner account or credentials supplied by
> the user) — see `how-to-dev` and `how-to-plan`. Use this skill **exclusively** when a
> developer deliberately asks to author or edit a Bruno `.bru` test; never auto-invoke it as
> part of a plan's verification.

## Source of Truth

- `bruno/Vendix/collection.bru`
- Existing request files under `bruno/Vendix/**`
- Backend DTOs/controllers for payload alignment

## Rules

- Organize requests by domain/resource/action under the existing collection structure.
- Default to `auth: inherit` unless the endpoint is intentionally public/login.
- Align request bodies with backend DTO field names and types exactly.
- Reuse the collection/environment variables already present in the repo.

## Assertions

Add assertions when they add value, but do not force a `tests` block in every request. Current repo usage mixes assertions with `post_response` scripts and variable capture.

## Variable Capture

Current collection patterns commonly use:

```bru
post_response {
  bru.setVar("created_id", res.body.data.id)
}
```

Do not document only one legacy `vars:post-response` style.

## URL Reality

Existing requests use a mix of `{{url}}`, `{{baseUrl}}`, and `http://{{url}}/...`. Match the collection conventions already in the target folder instead of introducing a different variable pattern casually.

## Related Skills

- `vendix-backend-api`
- `vendix-validation`
- `vendix-error-handling`
