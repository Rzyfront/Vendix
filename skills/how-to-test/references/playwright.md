# Playwright MCP — setup, recipe and fallback

## Setup

The repo's `.mcp.json` already registers `@playwright/mcp@latest --ignore-https-errors --isolated`.
If `mcp__playwright__browser_*` tools are missing (other agent/config), register it with the same args
and restart the agent:

```bash
claude mcp add playwright --scope user -- npx @playwright/mcp@latest --ignore-https-errors
npx playwright install chrome   # one-time
```

Gemini CLI: same `npx` command + args under `.gemini/settings.json` → `mcpServers.playwright`.

`--ignore-https-errors` is context-level: it covers the page **and** every subresource fetch,
including `GET /api/public/domains/resolve/{hostname}`. Without it that fetch dies in the TLS handshake
and the frontend silently falls back to `AppType.VENDIX_LANDING` (`route-manager.service.ts`), so a
store subdomain renders the platform landing. Local only; prod (`www.vendix.online`) has a valid cert.
Headed by default — no extra flag.

## E2E recipe

```ts
browser_navigate({ url: "https://vendix.com" })
browser_snapshot()                                   // a11y tree with ref ids
browser_fill_form({ fields: [ /* email, password, organization_slug */ ] })
browser_click({ element: "submit button", ref: "e14" })
browser_wait_for({ text: "Dashboard" })              // assert what the person sees
browser_network_requests()                           // resolve/{hostname} = 200 + API calls fired
browser_console_messages()                           // zoneless/signals JS errors
browser_take_screenshot({ filename: "after-login.png" })
browser_close()
```

- Click by `ref` from a fresh snapshot; re-snapshot after any navigation/DOM change (refs go stale).
- The snapshot may elide accessible names; confirm with `browser_evaluate` if it matters.
- Scope large trees with `target` / `depth` or dump to `filename`.

## Fallback — agent-browser

Only for what Playwright MCP does not do: wait on an arbitrary CSS selector
(`agent_browser_wait_for_selector`), explicit manual scroll (lazy-load, sticky header),
page-as-markdown read, or environments without Node. Needs both cert flags locally:
`--headed --ignore-certificate-errors --ignore-https-errors`.
Install: `brew install agent-browser && agent-browser install && claude mcp add agent-browser --scope user -- agent-browser mcp`.
