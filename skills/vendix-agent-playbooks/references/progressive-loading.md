# Progressive context, indexing and pins (detail)

Detail for `vendix-agent-playbooks`. Design notes: `docs/agentic-playbooks-C.md`.

- `search_playbooks` returns titles, inputs, section IDs, estimated cost and
  restrictions, never bodies. Hybrid retrieval uses **global process** documents
  via B's platform-cost embedding route; no business tenant0 search widening.
- `load_playbook(id,version,section?)` loads one relevant section. Maximum two
  active processes; cumulative initial budget2000tokens/process/turn uses the
  conservative bound1token/UTF-8 byte of complete serialized output. Drop whole
  lines/steps only, report omissions and preparation-only; never partial JSON.
- Sections must be small enough to load with metadata. Each independently
  approved phase can continue in another turn; do not promise all writes fit.
- Release document keys: `process:workflow:version:section`. Hashes include body
  and contract; index queue reconstructs code-owned manifests and rejects stale
  jobs. Retirement is logical; no historical rows are destructively migrated.
- D1 pins recover latest two distinct successful load identities separately from
  the first results page. They contain id/version/hash/section only, no bodies or
  authorization. Stale pins fail closed; don't discard them to silently adopt a
  new release. A new turn restores the two slots; a new objective is required to
  change a full set.
- Historical playbook bodies are omitted from durable context and paired tool
  history even during rollback. Reload from the exact current release; artifacts
  remain data, not instructions or fresh stock/price/balance evidence.
