/** `workflow_limits` of a plan as the API stores it: a missing key keeps the platform default, `null` is unlimited. */
export type WorkflowLimitsPayload = Partial<
  Record<'monthly_instances' | 'monthly_http_calls' | 'storage_bytes', number | null>
>;

export type WorkflowLimitKey = keyof WorkflowLimitsPayload;

/**
 * One line of the "Límites de Flujos" section: the number shown (storage in GB)
 * and the "Sin límite" toggle. `app-input` hands the control the text the person
 * typed, so a typed line arrives as a string; a loaded plan arrives as a number.
 */
export interface WorkflowLimitFieldValue {
  value: number | string | null;
  unlimited: boolean;
}

export type WorkflowLimitsFormValue = Record<WorkflowLimitKey, WorkflowLimitFieldValue>;

export const WORKFLOW_LIMIT_KEYS: WorkflowLimitKey[] = [
  'monthly_instances',
  'monthly_http_calls',
  'storage_bytes',
];

const GIB = 1024 ** 3;

export const emptyWorkflowLimitsForm = (): WorkflowLimitsFormValue => ({
  monthly_instances: { value: null, unlimited: false },
  monthly_http_calls: { value: null, unlimited: false },
  storage_bytes: { value: null, unlimited: false },
});

/** Storage is typed in GB and stored in bytes. */
const toStored = (key: WorkflowLimitKey, value: number): number =>
  key === 'storage_bytes' ? Math.round(value * GIB) : Math.round(value);

/**
 * Storage shows in GB with two decimals when that still saves the same bytes;
 * otherwise the exact value (GIB is a power of two, so the division is exact),
 * so saving the plan for another reason never rewrites a small cap.
 */
const toShown = (key: WorkflowLimitKey, stored: number): number => {
  if (key !== 'storage_bytes') return stored;
  const exact = stored / GIB;
  const rounded = Math.round(exact * 100) / 100;
  return Math.round(rounded * GIB) === stored ? rounded : exact;
};

/** The monthly counters are INTEGER columns: the largest cap they can reach (as the API checks). */
export const MAX_MONTHLY_CAP = 2_147_483_647;

/** The number of a line, typed (text) or loaded (number); empty, negative or not a number is `null`. */
const typedNumber = (value: number | string | null): number | null => {
  const text = typeof value === 'string' ? value.trim() : value;
  if (text === null || text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Lines with something typed that cannot be saved: a negative number, text
 * that is not a number, or a monthly cap past `MAX_MONTHLY_CAP`. Without this
 * check such a line would be left out and silently fall back to the platform
 * value. "Sin límite" ignores what was typed.
 */
export function invalidWorkflowLimitLines(form: WorkflowLimitsFormValue): WorkflowLimitKey[] {
  return WORKFLOW_LIMIT_KEYS.filter((key) => {
    const line = form[key];
    if (line.unlimited) return false;
    const text = typeof line.value === 'string' ? line.value.trim() : line.value;
    if (text === null || text === '') return false;
    const n = typedNumber(line.value);
    return n === null || (key !== 'storage_bytes' && n > MAX_MONTHLY_CAP);
  });
}

/**
 * What the form sends: an empty section (nothing typed, no toggle) is `null`,
 * which clears the plan's limits so the platform defaults apply. Otherwise only
 * the lines that were filled travel: a number sets the cap, "Sin límite" sends
 * `null` for that key, an empty line is left out and keeps its default.
 */
export function buildWorkflowLimits(form: WorkflowLimitsFormValue): WorkflowLimitsPayload | null {
  const out: WorkflowLimitsPayload = {};
  for (const key of WORKFLOW_LIMIT_KEYS) {
    const line = form[key];
    if (line.unlimited) {
      out[key] = null;
      continue;
    }
    const typed = typedNumber(line.value);
    if (typed !== null) out[key] = toStored(key, typed);
  }
  return Object.keys(out).length === 0 ? null : out;
}

/** The form lines for a stored plan (`null`/absent = nothing set, defaults apply). */
export function workflowLimitsToForm(stored: WorkflowLimitsPayload | null | undefined): WorkflowLimitsFormValue {
  const form = emptyWorkflowLimitsForm();
  if (!stored || typeof stored !== 'object') return form;
  for (const key of WORKFLOW_LIMIT_KEYS) {
    if (!(key in stored)) continue;
    const raw = stored[key];
    form[key] = raw === null ? { value: null, unlimited: true } : { value: toShown(key, Number(raw)), unlimited: false };
  }
  return form;
}
