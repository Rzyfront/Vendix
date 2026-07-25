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
 * - `cartTotal - downPayment > 0` (remaining balance strictly positive)
 * - `0 <= downPayment < cartTotal`
 * - finite and safe-integer numeric inputs (defends the schedule invariant)
 * - the remaining balance in cents is at least `numInstallments` so each
 *   installment clears the backend `LayawayInstallmentDto.amount @Min(0.01)`
 *   guard and never collapses a cent into a zero or negative amount.
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
  if (!Number.isFinite(cartTotal) || !Number.isFinite(downPayment)) return false;
  if (!Number.isFinite(numInstallments)) return false;
  if (!Number.isSafeInteger(numInstallments) || numInstallments <= 0) return false;
  if (downPayment < 0 || downPayment >= cartTotal) return false;
  const remaining = round2(cartTotal - downPayment);
  if (remaining <= 0) return false;
  // remaining (in cents) must be >= numInstallments so every installment can be
  // at least 0.01. Backend DTO: LayawayInstallmentDto.amount @Min(0.01).
  const remainingCents = Math.round(remaining * 100);
  if (remainingCents < numInstallments) return false;
  return true;
}

/**
 * Allocate a cart-level discount across line items, proportional to each
 * line's `unitPrice × quantity`, with the rounding remainder absorbed into
 * the LAST item so `Σ allocations === totalDiscount` exactly (no fractional
 * cents lost).
 *
 * Used by `PosLayawayConfigModal` to populate per-item `discount_amount` on
 * the POST /store/layaway payload; otherwise the backend
 * (`apps/backend/src/domains/store/layaway/layaway.service.ts:47-75`)
 * reconstructs the plan total without any discount and rejects with
 * `LAY_INSTALLMENT_001`.
 *
 * - Returns an empty array when `items` is empty or `totalDiscount <= 0`.
 * - Each per-item allocation is capped at `unitPrice × quantity` of that line
 *   (so a discount greater than one line's gross is still represented — the
 *   remaining unallocated cents will fall into the last item, capped).
 *   In practice a cart-level discount is rarely larger than one line, but the
 *   cap protects against pathological inputs without throwing.
 */
export function allocateCartDiscounts(
  items: ReadonlyArray<{ unitPrice: number; quantity: number }>,
  totalDiscount: number,
): number[] {
  if (items.length === 0) return [];
  if (!Number.isFinite(totalDiscount) || totalDiscount <= 0) {
    return items.map(() => 0);
  }

  const weights = items.map((i) =>
    Math.max(0, Number(i.unitPrice) || 0) * Math.max(0, Number(i.quantity) || 0),
  );
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  if (totalWeight <= 0) {
    // All lines have zero weight (free/zero-priced). Put the discount on the
    // last line, capped at zero — effectively the discount cannot be applied.
    return items.map(() => 0);
  }

  const allocations = items.map(() => 0);
  let allocated = 0;
  for (let i = 0; i < items.length - 1; i++) {
    const share = round2((totalDiscount * weights[i]) / totalWeight);
    const cap = round2(weights[i]);
    const value = Math.min(share, cap);
    allocations[i] = value;
    allocated += value;
  }
  // Last item absorbs the remainder (with cap to its own line gross).
  const remainder = round2(totalDiscount - allocated);
  const lastCap = round2(weights[weights.length - 1]);
  allocations[items.length - 1] = Math.max(0, Math.min(remainder, lastCap));
  // If the cap clipped the last item, push the leftover into earlier items
  // (greedy back-fill) so the total still reconciles.
  let leftover = round2(totalDiscount - allocations.reduce((s, a) => s + a, 0));
  if (leftover > 0) {
    for (let i = items.length - 2; i >= 0 && leftover > 0.005; i--) {
      const cap = round2(weights[i] - allocations[i]);
      const add = Math.min(cap, leftover);
      if (add > 0) {
        allocations[i] = round2(allocations[i] + add);
        leftover = round2(leftover - add);
      }
    }
  }
  return allocations;
}