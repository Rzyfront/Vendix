# Router metrics (working set)


Span `router` (and event `ai.agent.router`) per inference: `round`, `tool_count`,
`definition_tokens`, `core_count`, `loaded_count`, `prefetch_hits`,
`retrieval_source` (vector|lexical_sql|lexical_local|full_catalog_fallback|none),
`unloaded_authorized_calls`, `free_discovery_rounds`. All allowlisted in
`redactTraceAttributes` (counts/enums only, never user text). Alerts:
`full_catalog_fallback` > 5 % of inferences (index health) and
unloaded_authorized_calls / tool calls > 10 % (prefetch recall).

```sql
SELECT date_trunc('day', started_at) dia, agent, count(*) inferencias,
       round(avg((attributes->>'tool_count')::int),1) tools_prom,
       round(avg((attributes->>'definition_tokens')::int)) tokens_def_prom,
       round(100.0*avg((attributes->>'retrieval_source'='full_catalog_fallback')::int),2) pct_full,
       sum((attributes->>'unloaded_authorized_calls')::int) regla_dura,
       sum((attributes->>'free_discovery_rounds')::int) rondas_gratis
FROM ai_agent_trace_spans
WHERE kind='router' AND started_at >= now() - interval '7 days'
GROUP BY 1,2 ORDER BY 1 DESC,2;
```


