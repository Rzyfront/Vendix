# C.3 â Static privacy and offline review

- `ServiceSessionAccessService.getPublicProgress` selects only session status, the latest budget, the current verified proposal snapshot and progress events with non-null public text from an allowlisted event set. It does not project internal notes, customer identity, contact email or another session's events.
- Token resolution binds to the session/store and returns the same unavailable response for malformed, expired, revoked, wrong-store and terminal-session credentials.
- The storefront shows an unavailable-link message for HTTP 404/410 and for the SSE `link_expired` frame.
- The progress view tracks browser online/offline events, marks the snapshot stale on disconnect, blocks proposal decisions until refresh succeeds, refreshes when connectivity returns and displays the current proposal version.
- Verification is static source review only. Cross-store tokens, successive proposal updates, offline/reconnect behavior and assistive technology remain in D.1 browser/API verification.