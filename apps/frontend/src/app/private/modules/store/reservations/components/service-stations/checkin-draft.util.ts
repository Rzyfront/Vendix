/**
 * QUI-1059: decides whether «Nuevo ingreso» holds data the person captured, so
 * closing it (Esc, X or Cancelar) asks before discarding. Values the modal fills
 * by itself (prefilled deposit, default station/service/minutes) do not count;
 * changing those defaults does.
 */

/** Station, service and minutes the modal picks by itself when it opens. */
export interface CheckinDefaults {
  stationId: number | string | null;
  productId: number | string | null;
  durationMinutes: number | string | null;
}

export interface CheckinDraft {
  /** Free-text fields: vehicle, device, beauty, customer data and notes. */
  texts: ReadonlyArray<unknown>;
  hasCustomer: boolean;
  providerId: number | string | null;
  budgetAmount: number | string | null;
  lineCount: number;
  /** Answers of the intake form (Recolección de datos), keyed by field id. */
  intakeValues: Readonly<Record<number, unknown>>;
  current: CheckinDefaults;
  /** Snapshot taken when the modal opened; null if it never opened. */
  opened: CheckinDefaults | null;
}

/** Empty strings, blank text, null, undefined and empty arrays are not data. */
export function isCheckinValueFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Inputs may hand back "45" or 45 for the same choice; compare them as numbers. */
function sameChoice(a: number | string | null, b: number | string | null): boolean {
  const norm = (v: number | string | null) => (v === null || v === '' ? null : Number(v));
  return norm(a) === norm(b);
}

export function hasCheckinCapturedData(draft: CheckinDraft): boolean {
  if (draft.texts.some(isCheckinValueFilled)) return true;
  if (draft.hasCustomer) return true;
  if (isCheckinValueFilled(draft.providerId) || isCheckinValueFilled(draft.budgetAmount)) return true;
  if (draft.lineCount > 0) return true;
  if (Object.values(draft.intakeValues).some(isCheckinValueFilled)) return true;

  const { current, opened } = draft;
  if (!opened) return false;
  return (
    !sameChoice(current.stationId, opened.stationId) ||
    !sameChoice(current.productId, opened.productId) ||
    !sameChoice(current.durationMinutes, opened.durationMinutes)
  );
}
