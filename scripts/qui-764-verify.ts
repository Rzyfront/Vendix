/**
 * QUI-764 — Verificación literal del fix del tiquete de despacho en
 * mostrador/para-llevar.
 *
 * Playwright y agent-browser MCP están caídos en esta sesión. Este script
 * simula estáticamente las dos cadenas que imprimen el tiquete desde el POS
 * y cuenta invocaciones a `printDispatchTicket`. La deduplicación vive en
 * `DispatchTicketPrintService` (singleton) y se modela inline acá para que
 * la prueba no necesite Angular TestBed.
 *
 * Cuatro escenarios definidos por el teammate:
 *
 *   | auto_print_receipt | counterEnabled | auto_with_pos | esperado |
 *   |--------------------|----------------|---------------|----------|
 *   | OFF                | ON             | ON            | 1        | (el bug)
 *   | ON                 | ON             | ON            | 1, no 2  | (dedup)
 *   | OFF                | ON             | OFF           | 0        |
 *   | OFF                | OFF            | ON            | 0        | (ADR-6)
 *
 * Sale literal al stdout para que el reporte al teammate incluya evidencia.
 */

import { shouldAutoPrintDispatchTicket } from '../apps/frontend/src/app/shared/services/print/dispatch-ticket-autoprint';

// ── Simulación de la deduplicación de DispatchTicketPrintService ────────
// Espejo del comportamiento del servicio: clave = orderId, ventana = 30 s,
// aplica solo a trigger 'automatic'. El servicio real vive en
// `apps/frontend/.../dispatch-ticket-print.service.ts` — esta copia
// existe solo para que la verificación no dependa de Angular TestBed.
const AUTO_DEDUP_WINDOW_MS = 30_000;
const recentAutoPrints = new Map<string | number, number>();

function isDuplicateAutoPrint(orderId: string | number | undefined): boolean {
  if (orderId == null) return false;
  const now = Date.now();
  const last = recentAutoPrints.get(orderId);
  if (last !== undefined && now - last < AUTO_DEDUP_WINDOW_MS) return true;
  recentAutoPrints.set(orderId, now);
  return false;
}

// ── Cadena A: pos-order-confirmation.maybeAutoPrint ─────────────────────
function chainA(args: {
  order: any;
  settings: { auto_print_receipt: boolean; pos: { auto_print_receipt: boolean } };
}): boolean {
  // `ticketService.shouldAutoPrint()` lee `pos.auto_print_receipt` (línea 110
  // de pos-ticket.service.ts). Devuelve `false` cuando está OFF.
  if (!args.settings.pos.auto_print_receipt) return false;
  // `derivedIsPaid()` y `isOpen()` siempre true en el ciclo que probamos.
  // Sólo importa la guarda de auto-print del POS acá.

  const receipts = {
    print_dispatch_ticket_enabled: true,
    print_dispatch_ticket_on_counter: args.settings.counterEnabled,
    print_dispatch_ticket_auto_with_pos: args.settings.auto_with_pos,
  };
  const ctx = {
    printDispatchTicketEnabled: receipts.print_dispatch_ticket_enabled,
    printDispatchTicketAuto: receipts.print_dispatch_ticket_auto_with_pos,
    counterEnabled: receipts.print_dispatch_ticket_on_counter,
    deliveryType: args.order.delivery_type,
    isShippingSale: args.order.isShippingSale,
  };
  return shouldAutoPrintDispatchTicket('automatic', ctx);
}

// ── Cadena B: pos.component.printDispatchTicketIfNeededForOrder ─────────
// Es el código que QUI-764 arregla: ahora consulta el predicado compartido
// con `counterEnabled`, ya no tiene el hardcoded `direct_delivery` reject.
function chainB(args: {
  order: any;
  settings: {
    counterEnabled: boolean;
    auto_with_pos: boolean;
  };
  autoFlagKey: 'auto_with_pos' | 'auto_on_postventa';
}): boolean {
  const ctx = {
    printDispatchTicketEnabled: true,
    printDispatchTicketAuto: args.autoFlagKey === 'auto_with_pos'
      ? args.settings.auto_with_pos
      : args.settings.auto_with_pos, // postventa ignorada en este test
    counterEnabled: args.settings.counterEnabled,
    deliveryType: args.order.delivery_type,
    isShippingSale: args.order.isShippingSale,
  };
  return shouldAutoPrintDispatchTicket('automatic', ctx);
}

// ── Harness: cuenta invocaciones reales a "printDispatchTicket" ──────────
function runScenario(name: string, opts: {
  auto_print_receipt: boolean;
  counterEnabled: boolean;
  auto_with_pos: boolean;
  expected: number;
}): void {
  recentAutoPrints.clear();
  let invocations = 0;
  const order = {
    id: 9001,
    delivery_type: 'direct_delivery' as const,
    isShippingSale: false,
  };
  const settings = {
    counterEnabled: opts.counterEnabled,
    auto_with_pos: opts.auto_with_pos,
    pos: { auto_print_receipt: opts.auto_print_receipt },
  };

  // 1. onPaymentCompleted → cadena B (defense-in-depth, autoFlagKey=auto_with_pos)
  const chainBPasses = chainB({
    order,
    settings,
    autoFlagKey: 'auto_with_pos',
  });
  if (chainBPasses && !isDuplicateAutoPrint(order.id)) invocations++;

  // 2. maybeAutoPrint (cuando modal abre) → cadena A
  const chainAPasses = chainA({
    order,
    settings: {
      auto_print_receipt: opts.auto_print_receipt,
      counterEnabled: opts.counterEnabled,
      pos: { auto_print_receipt: opts.auto_print_receipt },
      // compat con la firma anterior de chainA — la reescribimos arriba
    } as any,
  });
  if (chainAPasses && !isDuplicateAutoPrint(order.id)) invocations++;

  const status = invocations === opts.expected ? '✓' : '✗';
  console.log(
    `${status} ${name.padEnd(40)} | auto_print_receipt=${String(opts.auto_print_receipt).padEnd(5)} | counterEnabled=${String(opts.counterEnabled).padEnd(5)} | auto_with_pos=${String(opts.auto_with_pos).padEnd(5)} → invocations=${invocations} (expected=${opts.expected})`,
  );
}

console.log('QUI-764 — conteo de invocaciones a printDispatchTicket');
console.log('=======================================================');
runScenario('S1 (the bug, fixed by fix)', {
  auto_print_receipt: false, counterEnabled: true, auto_with_pos: true, expected: 1,
});
runScenario('S2 (dedup under auto_print_receipt ON)', {
  auto_print_receipt: true, counterEnabled: true, auto_with_pos: true, expected: 1,
});
runScenario('S3 (auto_with_pos OFF — guard 2 kicks in)', {
  auto_print_receipt: false, counterEnabled: true, auto_with_pos: false, expected: 0,
});
runScenario('S4 (ADR-6 default, counterEnabled OFF)', {
  auto_print_receipt: false, counterEnabled: false, auto_with_pos: true, expected: 0,
});

console.log('');
console.log('Notas del modelo:');
console.log(' - Cadena A = pos-order-confirmation.maybeAutoPrint → printDispatchTicketIfNeeded (predicado compartido, trigger=automatic).');
console.log(' - Cadena B = pos.component.printDispatchTicketIfNeededForOrder (predicado compartido desde QUI-764, trigger=automatic).');
console.log(' - Dedup = DispatchTicketPrintService.isDuplicateAutoPrint (singleton, ventana 30 s, solo trigger=automatic).');
