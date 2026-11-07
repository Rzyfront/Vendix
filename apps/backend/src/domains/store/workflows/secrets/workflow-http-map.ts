import {
  WORKFLOW_SECRET_INPUTS,
  WORKFLOW_TOKEN_PATTERN,
  WorkflowTokenContext,
  resolveTokens,
} from '@common/workflows/contract';

const SECRET_PATH = /^secrets\.[A-Z][A-Z0-9_]{0,59}$/;

/**
 * Resolves the `map` of a `vendix.http.request` action against the instance
 * data for the outbox (or against sample data for "Probar esta acción").
 *
 * - `{{secrets.NAME}}` survives untouched in the inputs that may carry it
 *   (`WORKFLOW_SECRET_INPUTS`): it is replaced only when the call runs, so no
 *   secret value ever reaches the outbox, the history or the timeline.
 * - A resolved `{{fields.*}}` / `{{instance.*}}` value can never inject a
 *   secret token (its braces are broken) nor a new header line (CR/LF are
 *   replaced by spaces in `headers`).
 */
export function resolveHttpActionMap(
  map: Record<string, unknown> | undefined,
  ctx: WorkflowTokenContext,
): Record<string, string> {
  const secretInputs = WORKFLOW_SECRET_INPUTS['vendix.http.request'] ?? [];
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map ?? {})) {
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value);
      continue;
    }
    if (typeof value !== 'string') continue;
    if (!secretInputs.includes(key)) {
      out[key] = resolveTokens(value, ctx);
      continue;
    }
    out[key] = value.replace(
      new RegExp(WORKFLOW_TOKEN_PATTERN.source, 'g'),
      (token: string, path: string) => {
        if (SECRET_PATH.test(path)) return `{{${path}}}`;
        let resolved = resolveTokens(token, ctx).replace(/\{\{/g, '{​{');
        if (key === 'headers') resolved = resolved.replace(/[\r\n]+/g, ' ');
        return resolved;
      },
    );
  }
  return out;
}
