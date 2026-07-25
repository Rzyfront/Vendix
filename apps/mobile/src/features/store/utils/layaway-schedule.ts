/**
 * Layaway schedule helper — pure functions for installment preview + validation.
 *
 * Mirror of `LayawayConfigModalComponent.installments_preview` in the desktop POS
 * (`apps/frontend/src/app/private/modules/store/pos/components/layaway-config-modal/
 *  layaway-config-modal.component.ts:202-219`) and `isValid` (L221-226).
 *
 * ## Frequency semantics
 * - `weekly`   → 7 days between due dates
 * - `biweekly` → 14 days (desktop uses 14d for layaway; the backend credit-sale
 *               calculator uses 15d, but for layaway the backend accepts explicit
 *               `due_date` per installment and trusts the client — see
 *               `apps/backend/src/domains/store/layaway/dto/index.ts` and
 *               `apps/backend/src/domains/store/layaway/layaway.service.ts:69-76`).
 * - `monthly`  → 30 days (calendar-month rollover would require a backend
 *               contract change; out of scope for QUI-499).
 *
 * ## Backend invariant
 * The backend validates `sum(installments.amount) === total_amount - down_payment`
 * and rejects with `LAY_INSTALLMENT_001` otherwise. The `round2` helper plus the
 * "last installment absorbs the remainder" rule below guarantee the sum exactly.
 */

export type LayawayFrequency = 'weekly' | 'biweekly' | 'monthly';

export const FREQ_LABELS: Record<LayawayFrequency, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
};

export const FREQ_DAYS: Record<LayawayFrequency, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

export const MAX_INSTALLMENTS = 60;

export interface LayawayInstallmentPreview {
  /** 1-based, matches `layaway_installments.installment_number` */
  installment_number: number;
  /** Rounded to 2 decimals; last installment absorbs the rounding remainder. */
  amount: number;
  /** ISO `yyyy-MM-dd` (matches `LayawayInstallmentDto.due_date` IsDateString). */
  due_date: string;
}

export interface BuildLayawayScheduleInput {
  cartTotal: number;
  downPayment: number;
  numInstallments: number;
  frequency: LayawayFrequency;
  /**
   * Defaults to today. ISO `yyyy-MM-dd`. Per y0ner's decision (Q1) the mobile
   * modal does NOT capture this — it is computed from today + freq_days × i.
   * Kept as a parameter so the helper stays testable.
   */
  firstInstallmentDate?: string;
}

/**
 * Round to 2 decimal places using integer cents math.
 * Avoids floating-point artefacts like `0.30000000000000004`.
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseISODate(s: string): Date {
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, day ?? 1);
}

/**
 * Build a layaway installment preview.
 *
 * Algorithm (mirrors desktop `LayawayConfigModalComponent.installments_preview`):
 * 1. `remaining = round2(cartTotal - downPayment)`. If `<= 0`, return `[]`.
 * 2. `base = round2(remaining / n)`. The first `n - 1` installments use `base`.
 * 3. The last installment is `remaining - base * (n - 1)` so the sum equals
 *    `remaining` exactly (no `LAY_INSTALLMENT_001` from the backend).
 * 4. `due_date[i] = firstDate + freq_days × (i + 1)` (the i-th installment is
 *    one full interval after the previous; e.g. monthly→ +30d from firstDate).
 */
export function buildLayawaySchedule(
  input: BuildLayawayScheduleInput,
): LayawayInstallmentPreview[] {
  const { cartTotal, downPayment, numInstallments, frequency } = input;
  if (numInstallments <= 0) return [];

  const remaining = round2(cartTotal - downPayment);
  if (remaining <= 0) return [];

  const base = round2(remaining / numInstallments);
  const freqDays = FREQ_DAYS[frequency];
  const firstDate = input.firstInstallmentDate
    ? parseISODate(input.firstInstallmentDate)
    : new Date();

  return Array.from({ length: numInstallments }, (_, i) => {
    const due = new Date(firstDate);
    due.setDate(due.getDate() + freqDays * (i + 1));
    const amount = i === numInstallments - 1
      ? round2(remaining - base * (numInstallments - 1))
      : base;
    return {
      installment_number: i + 1,
      amount,
      due_date: toISODate(due),
    };
  });
}

/**
 * Mirrors desktop `LayawayConfigModalComponent.isValid`
 * (`layaway-config-modal.component.ts:221-226`).
 *
 * - `numInstallments > 0`
 * - `cartTotal - downPayment > 0`
 * - `0 <= downPayment < cartTotal`
 *
 * The `numInstallments <= MAX_INSTALLMENTS` cap is a UX guard (backend has no
 * hard cap) and is checked separately at the call site.
 */
export function isLayawayConfigValid(input: {
  cartTotal: number;
  downPayment: number;
  numInstallments: number;
}): boolean {
  const { cartTotal, downPayment, numInstallments } = input;
  return (
    numInstallments > 0 &&
    cartTotal - downPayment > 0 &&
    downPayment >= 0 &&
    downPayment < cartTotal
  );
}