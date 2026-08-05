import { dian_operation_mode_enum } from '@prisma/client';

/**
 * Composition of the DIAN enablement test set, per mode of operation.
 *
 * WHY THIS EXISTS — the defect it closes:
 *
 * `dian-test.service.ts` hardcoded `TEST_SET_SIZE = 50` and generated
 * 30 invoices + 10 debit notes + 10 credit notes. That is the **legacy 2019**
 * habilitación composition and matches NEITHER mode in force under
 * Resolución 000165 de 2023:
 *
 * - Software propio / adquirido (art. 28): **2 FV + 1 NC + 1 ND**
 * - Proveedor tecnológico (art. 55):       **6 FV + 2 NC + 2 ND**
 *
 * Two consequences followed. The DIAN may not accept the `testSetId` when it
 * validates against the exact composition of the declared mode; and every run
 * burned 50 consecutives out of the resolution — real production numbering if the
 * caller passed a production resolution.
 *
 * @see docs/facturacion-electronica-dian-software-propio.md §4.3, §20.7
 */
export interface DianTestSetComposition {
  /** Facturas electrónicas de venta. */
  invoices: number;
  /** Notas débito. */
  debit_notes: number;
  /** Notas crédito. */
  credit_notes: number;
}

export const DIAN_TEST_SET_COMPOSITIONS: Record<
  dian_operation_mode_enum,
  DianTestSetComposition
> = {
  // Art. 28 — each NIT enables its own software: 2 FV + 1 NC + 1 ND.
  own_software: { invoices: 2, debit_notes: 1, credit_notes: 1 },
  // Art. 55 — the provider enables once for all its clients: 6 FV + 2 NC + 2 ND.
  technological_provider: { invoices: 6, debit_notes: 2, credit_notes: 2 },
};

/** Total consecutives a run consumes for the given mode. */
export function testSetSize(composition: DianTestSetComposition): number {
  return (
    composition.invoices + composition.debit_notes + composition.credit_notes
  );
}

/**
 * Resolves the composition for a configuration's operation mode, falling back to
 * `own_software` — the conservative choice, since it consumes the fewest
 * consecutives and is the mode every Vendix tenant uses today.
 */
export function resolveTestSetComposition(
  operation_mode: dian_operation_mode_enum | null | undefined,
): DianTestSetComposition {
  return (
    DIAN_TEST_SET_COMPOSITIONS[operation_mode ?? 'own_software'] ??
    DIAN_TEST_SET_COMPOSITIONS.own_software
  );
}

/**
 * Composition as the clients need it: counts, total and a rendered label.
 *
 * WHY IT LEAVES THE BACKEND: the composition was only ever used inside
 * `runTestSet`, so both UIs printed a hardcoded "50 documentos" — the legacy 2019
 * number. That text misinformed about the one thing that matters here, how many
 * consecutives of the resolution a run burns. A number the client cannot derive
 * is a number the client will hardcode and let drift.
 */
export interface DianTestSetCompositionView extends DianTestSetComposition {
  /** Consecutives the run consumes. */
  total: number;
  /** e.g. "2 facturas + 1 nota crédito + 1 nota débito". */
  label: string;
}

export function buildTestSetCompositionView(
  operation_mode: dian_operation_mode_enum | null | undefined,
): DianTestSetCompositionView {
  const composition = resolveTestSetComposition(operation_mode);
  return {
    ...composition,
    total: testSetSize(composition),
    label: describeComposition(composition),
  };
}

/**
 * Human-readable composition, for error messages and audit evidence.
 * e.g. "2 facturas + 1 nota crédito + 1 nota débito".
 */
export function describeComposition(
  composition: DianTestSetComposition,
): string {
  return [
    `${composition.invoices} factura${composition.invoices === 1 ? '' : 's'}`,
    `${composition.credit_notes} nota${composition.credit_notes === 1 ? '' : 's'} crédito`,
    `${composition.debit_notes} nota${composition.debit_notes === 1 ? '' : 's'} débito`,
  ].join(' + ');
}
