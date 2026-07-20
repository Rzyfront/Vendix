/* eslint-disable no-console */
/**
 * QA Saneado 2026-07-20 — Remediación orden 548 + Backfill COGS append-only
 * =========================================================================
 *
 * Script one-off, APPEND-ONLY e IDEMPOTENTE. Corre DOS fases:
 *
 *   FASE A — Remediar la orden 548 (store 10) vía código real:
 *     Llama `OrderFlowService.reconcileOrderFromDispatch(548, 10)`. La orden
 *     está en `shipped` con su ÚNICA remisión (#169) anulada (voided) y saldo
 *     0 → el fix la revierte a `processing`. Best-effort, no toca stock.
 *
 *   FASE B — Backfill de COGS de remisiones entregadas ligadas a órdenes que
 *     quedaron SIN asiento contable. Postea por la ruta de producción exacta
 *     `AutoEntryService.onDispatchNoteDelivered(...)` (DR 6135 Costo de ventas
 *     / CR 1435 Inventario), idempotente por el dedup de `createAutoEntry`
 *     sobre (organization_id, source_type='dispatch_note.delivered', source_id
 *     = note_id, accounting_entity_id).
 *
 * El COGS de cada nota se RECOMPUTA aquí con la fórmula de valuación
 * (inventory_valuation_snapshots.unit_cost × ABS(inventory_transactions
 * .quantity_change) de los stock_out del pedido) y se CONTRASTA con el valor
 * esperado; si difieren > 1 COP el script ABORTA (no postea nada).
 *
 * Modos:
 *   - DRY-RUN (DEFAULT): no escribe nada. Imprime la tabla de candidatos,
 *     COGS recomputado vs esperado, líneas contables previstas, cuáles ya
 *     están posteadas y los totales. NO llama reconcile ni onDispatchNoteDelivered.
 *   - REAL (EXECUTE=1 ó --execute): ejecuta Fase A + Fase B y verifica balance.
 *     Re-ejecutarlo debe ser NO-OP (dedup) → demuestra idempotencia.
 *
 * Uso:
 *   docker exec vendix_backend sh -lc 'cd /app && npx ts-node -r tsconfig-paths/register --transpile-only scripts/qa-saneado-2026-07-20.ts'
 *   docker exec vendix_backend sh -lc 'cd /app && EXECUTE=1 npx ts-node -r tsconfig-paths/register --transpile-only scripts/qa-saneado-2026-07-20.ts'
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { OrderFlowService } from '../src/domains/store/orders/order-flow/order-flow.service';
import { AutoEntryService } from '../src/domains/store/accounting/auto-entries/auto-entry.service';
import { AccountMappingService } from '../src/domains/store/accounting/account-mappings/account-mapping.service';
import { StorePrismaService } from '../src/prisma/services/store-prisma.service';
import {
  RequestContextService,
  RequestContext,
} from '../src/common/context/request-context.service';

// ---------------------------------------------------------------------------
// Constantes de negocio (todos los candidatos son org 6 / store 10 / julio-26)
// ---------------------------------------------------------------------------
const ORG_ID = 6;
const STORE_ID = 10;
// Backfill originado por sistema (no hay usuario humano detrás). createAutoEntry
// persiste created_by_user_id/posted_by_user_id como `user_id || null`.
const SYSTEM_USER_ID: number | undefined = undefined;

const RECONCILE_ORDER_ID = 548;

const COST_TOLERANCE_COP = 1; // aborta si |recomputado - esperado| > 1 COP

const EXECUTE =
  process.env.EXECUTE === '1' || process.argv.includes('--execute');

// Contexto de request que replica EXACTAMENTE el que existe en producción
// cuando se entrega una remisión (StorePrismaService exige RequestContext o
// lanza UnauthorizedException; los modelos contables se scopean por la entidad
// fiscal resuelta desde este contexto). is_super_admin/is_owner evitan filtros
// de rol; org+store resuelven la accounting_entity de la tienda 10.
const CTX: RequestContext = {
  organization_id: ORG_ID,
  store_id: STORE_ID,
  is_super_admin: true,
  is_owner: true,
  user_id: SYSTEM_USER_ID,
};

interface Candidate {
  note_id: number;
  order_id: number;
  expected_cogs: number;
  group: 'pickup' | 'home_delivery';
}

// Candidatos EXACTOS provistos (note_id → order_id → COGS esperado en COP).
const CANDIDATES: Candidate[] = [
  // pickup
  { note_id: 148, order_id: 353, expected_cogs: 15420000, group: 'pickup' },
  { note_id: 142, order_id: 354, expected_cogs: 12960000, group: 'pickup' },
  { note_id: 147, order_id: 360, expected_cogs: 1380000, group: 'pickup' },
  { note_id: 146, order_id: 361, expected_cogs: 790000, group: 'pickup' },
  { note_id: 132, order_id: 518, expected_cogs: 18125, group: 'pickup' },
  { note_id: 133, order_id: 519, expected_cogs: 18125, group: 'pickup' },
  { note_id: 134, order_id: 520, expected_cogs: 18125, group: 'pickup' },
  { note_id: 135, order_id: 521, expected_cogs: 18125, group: 'pickup' },
  { note_id: 136, order_id: 522, expected_cogs: 18125, group: 'pickup' },
  { note_id: 137, order_id: 523, expected_cogs: 18125, group: 'pickup' },
  { note_id: 138, order_id: 524, expected_cogs: 18125, group: 'pickup' },
  { note_id: 139, order_id: 525, expected_cogs: 18125, group: 'pickup' },
  { note_id: 140, order_id: 526, expected_cogs: 18125, group: 'pickup' },
  // home_delivery
  { note_id: 116, order_id: 357, expected_cogs: 2090000, group: 'home_delivery' },
  { note_id: 115, order_id: 359, expected_cogs: 4300000, group: 'home_delivery' },
  { note_id: 143, order_id: 434, expected_cogs: 24000, group: 'home_delivery' },
  { note_id: 144, order_id: 528, expected_cogs: 18125, group: 'home_delivery' },
  { note_id: 149, order_id: 538, expected_cogs: 18125, group: 'home_delivery' },
];

// EXCLUIDO explícitamente: 0 transacciones stock_out → costo no reconstruible.
const EXCLUDED = [
  {
    note_id: 117,
    order_id: 443,
    reason:
      'SKIPPED-anomalía: sin stock_out, costo no reconstruible por snapshots, requiere costo manual',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recomputa el COGS de una nota con la MISMA fórmula de valuación que produjo
 * los valores esperados: Σ unit_cost × |quantity_change| de los stock_out del
 * pedido de la nota. Devuelve 0 si no hay stock_out (anomalía).
 */
async function recomputeCogs(base: any, note_id: number): Promise<number> {
  const rows: Array<{ cogs: any }> = await base.$queryRaw`
    SELECT COALESCE(SUM(ivs.unit_cost * ABS(it.quantity_change)), 0) AS cogs
    FROM dispatch_notes dn
    JOIN order_items oi ON oi.order_id = dn.order_id
    JOIN inventory_transactions it ON it.order_item_id = oi.id
    JOIN inventory_valuation_snapshots ivs
      ON ivs.source_type = 'stock_out' AND ivs.source_id = it.id
    WHERE dn.id = ${note_id}
  `;
  return rows.length ? Number(rows[0].cogs) : 0;
}

/** Lee cabecera de la nota (dispatch_number, delivered_at, status, order_id). */
async function loadNote(base: any, note_id: number) {
  return base.dispatch_notes.findFirst({
    where: { id: note_id, store_id: STORE_ID },
    select: {
      id: true,
      dispatch_number: true,
      delivered_at: true,
      status: true,
      order_id: true,
      subtype: true,
    },
  });
}

/**
 * ¿Ya existe un asiento 'dispatch_note.delivered' para esta nota? (dedup de
 * createAutoEntry). Se consulta cross-scope (base client) filtrando por org.
 */
async function findExistingEntry(base: any, note_id: number) {
  return base.accounting_entries.findFirst({
    where: {
      organization_id: ORG_ID,
      source_type: 'dispatch_note.delivered',
      source_id: note_id,
    },
    select: {
      id: true,
      entry_number: true,
      entry_date: true,
      total_debit: true,
      total_credit: true,
      accounting_entity_id: true,
    },
  });
}

/** Verifica el balance y las líneas (DR 6135 / CR 1435) de un asiento. */
async function verifyEntry(base: any, entry_id: number) {
  const rows: Array<{
    entry_number: string;
    total_debit: any;
    total_credit: any;
    code: string;
    debit_amount: any;
    credit_amount: any;
  }> = await base.$queryRaw`
    SELECT ae.entry_number, ae.total_debit, ae.total_credit,
           coa.code, ael.debit_amount, ael.credit_amount
    FROM accounting_entries ae
    JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
    JOIN chart_of_accounts coa ON coa.id = ael.account_id
    WHERE ae.id = ${entry_id}
    ORDER BY ael.id
  `;
  if (!rows.length) return { ok: false, detail: 'sin líneas', rows };
  const totalDebit = Number(rows[0].total_debit);
  const totalCredit = Number(rows[0].total_credit);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.001;
  const drCogs = rows.find(
    (r) => r.code.startsWith('6135') && Number(r.debit_amount) > 0,
  );
  const crInv = rows.find(
    (r) => r.code.startsWith('1435') && Number(r.credit_amount) > 0,
  );
  return {
    ok: balanced && !!drCogs && !!crInv,
    balanced,
    totalDebit,
    totalCredit,
    drCogs: drCogs ? `${drCogs.code}=${Number(drCogs.debit_amount)}` : 'FALTA',
    crInv: crInv ? `${crInv.code}=${Number(crInv.credit_amount)}` : 'FALTA',
    entry_number: rows[0].entry_number,
    rows,
  };
}

function money(n: number): string {
  return n.toLocaleString('es-CO');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('='.repeat(78));
  console.log(
    `QA Saneado 2026-07-20 — modo: ${EXECUTE ? 'REAL (ESCRITURA)' : 'DRY-RUN (solo lectura)'}`,
  );
  console.log(`org=${ORG_ID} store=${STORE_ID}`);
  console.log('='.repeat(78));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
    abortOnError: false,
  });

  try {
    const orderFlow = app.get(OrderFlowService, { strict: false });
    const autoEntry = app.get(AutoEntryService, { strict: false });
    const mappingService = app.get(AccountMappingService, { strict: false });
    const storePrisma = app.get(StorePrismaService, { strict: false });
    const base = storePrisma.withoutScope() as any;

    // Códigos contables previstos (defaults: 6135 / 1435). Se resuelven vía la
    // MISMA cascada de producción (store override → org → default).
    const [cogsMap, invMap] = await RequestContextService.run(CTX, async () => [
      await mappingService.getMapping(
        ORG_ID,
        'dispatch_note.delivered.cogs',
        STORE_ID,
      ),
      await mappingService.getMapping(
        ORG_ID,
        'dispatch_note.delivered.inventory',
        STORE_ID,
      ),
    ]);
    const drCode = cogsMap?.account_code ?? '6135';
    const crCode = invMap?.account_code ?? '1435';
    console.log(
      `\nCuentas resueltas: DR ${drCode} (COGS, source=${cogsMap?.source ?? 'default'}) / CR ${crCode} (Inventario, source=${invMap?.source ?? 'default'})`,
    );

    // ===================================================================
    // FASE A — Remediar orden 548
    // ===================================================================
    console.log('\n' + '-'.repeat(78));
    console.log('FASE A — Remediar orden 548 (reconcileOrderFromDispatch)');
    console.log('-'.repeat(78));

    const before548 = await base.orders.findFirst({
      where: { id: RECONCILE_ORDER_ID, store_id: STORE_ID },
      select: { id: true, state: true, remaining_balance: true },
    });
    console.log(
      `ANTES: order ${RECONCILE_ORDER_ID} → state=${before548?.state}, remaining_balance=${before548?.remaining_balance}`,
    );

    if (EXECUTE) {
      await RequestContextService.run(CTX, () =>
        orderFlow.reconcileOrderFromDispatch(RECONCILE_ORDER_ID, STORE_ID),
      );
      const after548 = await base.orders.findFirst({
        where: { id: RECONCILE_ORDER_ID, store_id: STORE_ID },
        select: { id: true, state: true, remaining_balance: true },
      });
      console.log(
        `DESPUÉS: order ${RECONCILE_ORDER_ID} → state=${after548?.state}, remaining_balance=${after548?.remaining_balance}`,
      );
    } else {
      console.log(
        `[DRY-RUN] would reconcile order ${RECONCILE_ORDER_ID} (esperado shipped→processing; saldo 0, única remisión #169 voided)`,
      );
    }

    // ===================================================================
    // FASE B — Backfill COGS (append-only, idempotente)
    // ===================================================================
    console.log('\n' + '-'.repeat(78));
    console.log('FASE B — Backfill COGS de remisiones entregadas sin asiento');
    console.log('-'.repeat(78));

    const tableRows: any[] = [];
    const discrepancies: string[] = [];
    let totalToPost = 0;
    let countToPost = 0;
    let countAlready = 0;
    const toPost: Array<{ cand: Candidate; note: any; cogs: number }> = [];

    for (const cand of CANDIDATES) {
      const note = await loadNote(base, cand.note_id);
      if (!note) {
        discrepancies.push(
          `note ${cand.note_id}: NO EXISTE en store ${STORE_ID}`,
        );
        continue;
      }
      const cogs = await recomputeCogs(base, cand.note_id);
      const delta = Math.abs(cogs - cand.expected_cogs);
      if (delta > COST_TOLERANCE_COP) {
        discrepancies.push(
          `note ${cand.note_id} (order ${cand.order_id}): COGS recomputado=${money(cogs)} vs esperado=${money(cand.expected_cogs)} (Δ=${money(delta)} > ${COST_TOLERANCE_COP} COP)`,
        );
      }
      const existing = await findExistingEntry(base, cand.note_id);
      const already = !!existing;
      if (already) countAlready++;
      else {
        countToPost++;
        totalToPost += cogs;
        toPost.push({ cand, note, cogs });
      }

      tableRows.push({
        note: cand.note_id,
        order: cand.order_id,
        grp: cand.group,
        dispatch_number: note.dispatch_number,
        status: note.status,
        delivered_at: note.delivered_at
          ? new Date(note.delivered_at).toISOString()
          : null,
        cogs_recomputado: money(cogs),
        cogs_esperado: money(cand.expected_cogs),
        match: delta <= COST_TOLERANCE_COP ? 'OK' : 'DISCREPANCIA',
        estado: already
          ? `YA POSTEADO (#${existing!.id})`
          : 'se postearía',
        lineas_previstas: `DR ${drCode}=${money(cogs)} / CR ${crCode}=${money(cogs)}`,
      });
    }

    console.table(tableRows);

    // entry_date: onDispatchNoteDelivered NO acepta entry_date → createAutoEntry
    // la deriva de resolveEntryDate(store) = hoy (2026-07-20) medianoche en la
    // zona horaria de la tienda. Todos los candidatos son julio (período
    // ABIERTO) → aceptable. Se documenta explícitamente.
    console.log(
      '\nNOTA entry_date: onDispatchNoteDelivered() NO acepta/propaga entry_date;',
    );
    console.log(
      '  createAutoEntry la resuelve como HOY (medianoche zona tienda). Los asientos',
    );
    console.log(
      '  quedarán fechados en julio-2026 (período abierto), NO en delivered_at real.',
    );

    console.log('\nEXCLUIDOS:');
    for (const ex of EXCLUDED) {
      console.log(
        `  note ${ex.note_id} (order ${ex.order_id}) — ${ex.reason}`,
      );
    }

    console.log('\nRESUMEN Fase B:');
    console.log(`  candidatos totales      : ${CANDIDATES.length}`);
    console.log(`  ya posteados (se saltan): ${countAlready}`);
    console.log(`  a postear                : ${countToPost}`);
    console.log(`  COGS total a postear     : ${money(totalToPost)} COP`);
    console.log(`  excluidos (anomalía)     : ${EXCLUDED.length}`);

    if (discrepancies.length > 0) {
      console.error('\n*** DISCREPANCIAS DETECTADAS — abortando escritura ***');
      discrepancies.forEach((d) => console.error(`  - ${d}`));
      if (EXECUTE) {
        throw new Error(
          `Abortado: ${discrepancies.length} discrepancia(s) de costo/nota. No se posteó nada.`,
        );
      } else {
        console.error(
          '  (DRY-RUN: no se aborta el proceso, pero en modo REAL abortaría.)',
        );
      }
    } else {
      console.log('\nSin discrepancias de costo: recomputado == esperado en todos.');
    }

    if (!EXECUTE) {
      console.log(
        '\n[DRY-RUN] No se llamó onDispatchNoteDelivered ni reconcile. Usa EXECUTE=1 para ejecutar.',
      );
      return;
    }

    // ---- MODO REAL: postear ----
    console.log('\n' + '-'.repeat(78));
    console.log('MODO REAL — posteando COGS pendientes');
    console.log('-'.repeat(78));

    let posted = 0;
    let skippedDedup = 0;
    const verifyFailures: string[] = [];

    for (const { cand, note, cogs } of toPost) {
      const result = await RequestContextService.run(CTX, () =>
        autoEntry.onDispatchNoteDelivered({
          dispatch_note_id: cand.note_id,
          dispatch_number: note.dispatch_number,
          organization_id: ORG_ID,
          store_id: STORE_ID,
          total_cost: cogs,
          user_id: SYSTEM_USER_ID,
        }),
      );

      if (!result) {
        console.log(
          `  note ${cand.note_id}: onDispatchNoteDelivered devolvió null (total<=0 o área contable inactiva) — revisar`,
        );
        continue;
      }

      const v = await verifyEntry(base, (result as any).id);
      if (v.ok) {
        posted++;
        console.log(
          `  note ${cand.note_id} → asiento ${v.entry_number} (#${(result as any).id}) OK | ${v.drCogs} | ${v.crInv} | balance ${v.totalDebit}==${v.totalCredit}`,
        );
      } else {
        verifyFailures.push(
          `note ${cand.note_id} (#${(result as any).id}): ${JSON.stringify(v)}`,
        );
        console.error(
          `  note ${cand.note_id} → VERIFICACIÓN FALLÓ: ${JSON.stringify(v)}`,
        );
      }
    }

    console.log('\nRESUMEN REAL:');
    console.log(`  asientos posteados y verificados: ${posted}`);
    console.log(`  saltados por dedup previo        : ${countAlready}`);
    console.log(`  fallos de verificación           : ${verifyFailures.length}`);
    if (verifyFailures.length > 0) {
      verifyFailures.forEach((f) => console.error(`  - ${f}`));
    }
    console.log(
      '\nIdempotencia: re-ejecutar este script en modo real debe reportar 0 posteados',
    );
    console.log(
      `  y ${CANDIDATES.length} "ya posteados" (dedup por source_type+source_id).`,
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => {
    console.log('\nFIN.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nERROR FATAL:', error);
    process.exit(1);
  });
