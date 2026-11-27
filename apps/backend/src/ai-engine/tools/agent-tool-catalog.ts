/**
 * Closed tool catalogs per agent (Vexi público, F1).
 *
 * For an ordinary agent (Vex) the row's `ai_agents.allowed_tools` is an
 * optional narrowing: empty means "no filter", so the catalog is whatever the
 * caller's permissions allow. That default is exactly wrong for an agent that
 * faces the public: a visitor's role must never decide what it can touch.
 *
 * An agent listed here has a CLOSED catalog instead:
 *
 * - Its tools are this code-owned list ∩ the row's `allowed_tools` (− the
 *   row's `denied_tools`, as always). An empty `allowed_tools` means NOTHING,
 *   not everything. The row can narrow the catalog, never widen it, so no
 *   superadmin edit or a missing/blank column can reopen the internal tools.
 * - Membership is by exact canonical tool name. Domain names never match
 *   here, so a new tool added to an existing domain is never inherited.
 * - The registry enforces it twice: when building the turn catalog
 *   (`getAgentDefinitions`) and when executing (`executeTool*` with
 *   `agentKey`). A tool the model names outside the catalog is refused with
 *   `AI_AGENT_004` before any lookup, handler or suggestion runs, and the
 *   attempt is logged and emitted as {@link AGENT_TOOL_DENIED_EVENT}.
 *
 * Vexi's catalog names the public capabilities the plan defines (order,
 * booking, request). None of the existing staff tools (`create_order`,
 * `manage_bookings`) serve an end customer — they require staff permissions,
 * take staff-supplied prices or `customer_id`s and write through admin
 * services — so the catalog names the public wrappers that F2 registers.
 * Until those exist Vexi gets no tools at all, which is the intended F1 state.
 */
export const VEXI_AGENT_KEY = 'vexi';

/** Public capabilities of Vexi: propose only; the visitor's browser writes. */
export const VEXI_PUBLIC_TOOL_CATALOG: readonly string[] = Object.freeze([
  'storefront_propose_order',
  'storefront_propose_booking',
  'storefront_propose_request',
]);

/**
 * Seed value of `ai_agents.denied_tools` for Vexi: a second, data-level fence
 * on top of the closed catalog (which alone already excludes all of this).
 * Entries are tool names or domain names (`getAgentDefinitions` matches
 * both). Public storefront tools must live in their own `storefront` domain,
 * which is deliberately absent here.
 */
export const VEXI_INTERNAL_DENIED_TOOLS: readonly string[] = Object.freeze([
  // Bridge and scaffolding that forward the caller's bearer or run code.
  'call_endpoint',
  'write_endpoint',
  'run_code',
  'run_readonly_script',
  'run_analysis',
  'bulk_prepare',
  'propose_write_batch',
  'search_tools',
  // Every internal domain of the staff catalog (ui_* included).
  'accounting',
  'ai-toolbox',
  'api-bridge',
  'business',
  'capabilities',
  'capability_requests',
  'cash-register',
  'compute',
  'customers',
  'discovery',
  'dispatch',
  'documents',
  'ecommerce-support',
  'expenses',
  'finance-ops',
  'fiscal',
  'followups',
  'help',
  'inventory',
  'invoicing',
  'kitchen',
  'lodging',
  'marketing',
  'memberships',
  'memory',
  'menus',
  'notifications',
  'orders',
  'payments',
  'payroll',
  'planning',
  'playbooks',
  'pricing',
  'procedural_memory',
  'products',
  'purchasing',
  'quotations',
  'receivables-payables',
  'reminders',
  'reporting',
  'reports',
  'reservations',
  'returns',
  'sales',
  'sandbox',
  'search',
  'settings-admin',
  'shipping',
  'skills',
  'store-users',
  'subscriptions',
  'suppliers',
  'support',
  'tables',
  'tasks',
  'turn',
  'ui',
  'vex_batches',
  'vex_blocks',
  'vex_design',
  'withholding',
  'workflows',
]);

const CLOSED_CATALOG_AGENTS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    [VEXI_AGENT_KEY]: VEXI_PUBLIC_TOOL_CATALOG,
  });

/** Emitted (and logged) every time a closed-catalog agent asks for a tool outside its catalog. */
export const AGENT_TOOL_DENIED_EVENT = 'ai.agent.tool_denied';

export interface AgentToolDeniedEvent {
  agent_key: string;
  /** The name exactly as the model sent it. */
  tool: string;
  /**
   * `turn`: the agent loop refused it (not in the turn's authority/offer).
   * `execute`: the registry gate refused it (direct or out-of-loop call).
   */
  stage: 'turn' | 'execute';
  store_id?: number;
  organization_id?: number;
  user_id?: number;
  occurred_at: string;
}

/** The closed catalog of `agentKey`, or `null` when the agent is open (filtered only by permissions and its row). */
export function closedToolCatalog(
  agentKey?: string | null,
): ReadonlySet<string> | null {
  if (!agentKey) return null;
  const catalog = Object.prototype.hasOwnProperty.call(
    CLOSED_CATALOG_AGENTS,
    agentKey,
  )
    ? CLOSED_CATALOG_AGENTS[agentKey]
    : undefined;
  return catalog ? new Set(catalog) : null;
}

export function hasClosedToolCatalog(agentKey?: string | null): boolean {
  return closedToolCatalog(agentKey) !== null;
}
