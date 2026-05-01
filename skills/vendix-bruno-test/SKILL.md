---
name: vendix-bruno-test
description: >
  Bruno API testing patterns for Vendix collections, request files, auth inheritance,
  DTO-aligned payloads, post_response scripting, and pragmatic assertions. Trigger: When
  creating API tests, editing .bru files, or verifying endpoints.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Creating API tests (Bruno)"
---

# Vendix Bruno Test

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
