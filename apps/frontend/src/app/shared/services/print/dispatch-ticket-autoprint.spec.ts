import {
  shouldAutoPrintDispatchTicket,
  type ShouldAutoPrintDispatchTicketContext,
} from './dispatch-ticket-autoprint';
import type { PrintTrigger } from './document-print.service';

/**
 * `shouldAutoPrintDispatchTicket` — predicado del tiquete de despacho.
 *
 * Contrato vigente (decisión del usuario, 2026-08-31):
 *
 *   - `counterEnabled === false` (camino por defecto, ADR-6): imprime
 *     solo para ventas con envío (`home_delivery` o `isShippingSale`).
 *     `direct_delivery`, `pickup`, `dine_in`, `other` → `false`.
 *
 *   - `counterEnabled === true` (enmienda): imprime además para
 *     `direct_delivery` y `pickup` (mostrador y para llevar; el cliente
 *     paga y espera, reclama con el tiquete).
 *     `dine_in` y `other` SIGUEN en `false` aunque el interruptor
 *     esté prendido — ese es el borde que se rompe si la condición
 *     queda al revés.
 *
 *   - Guard 1 (`print_dispatch_ticket_enabled`) y guard 2
 *     (`printDispatchTicketAuto` con `trigger === 'automatic'`) son
 *     ortogonales al contador y se prueban aparte.
 *
 * Matriz de 5 tipos de entrega × 2 estados del contador × 2 triggers
 * (donde aplica) = 22 casos canónicos.
 */

type DeliveryType =
  | 'direct_delivery'
  | 'pickup'
  | 'home_delivery'
  | 'dine_in'
  | 'other'
  | null
  | undefined;

function ctx(
  partial: Partial<ShouldAutoPrintDispatchTicketContext> & {
    deliveryType: DeliveryType;
    isShippingSale?: boolean;
    counterEnabled?: boolean;
  },
): ShouldAutoPrintDispatchTicketContext {
  return {
    printDispatchTicketEnabled: true,
    deliveryType: partial.deliveryType,
    isShippingSale: partial.isShippingSale,
    counterEnabled: partial.counterEnabled,
  };
}

describe('shouldAutoPrintDispatchTicket (predicado del tiquete de despacho)', () => {
  // ─── counterEnabled = false (camino por defecto, ADR-6) ──────────────
  // Comportamiento EXACTO de hoy (2026-08-31, pre-enmienda). Estos casos
  // son byte por byte lo que el código devolvía antes de la enmienda; si
  // alguno cambia, el commit es una regresión.
  describe('counterEnabled = false (camino por defecto)', () => {
    const OFF = false;

    const cases: ReadonlyArray<{
      name: string;
      deliveryType: DeliveryType;
      isShippingSale?: boolean;
      trigger: PrintTrigger;
      expected: boolean;
    }> = [
      { name: 'direct_delivery (mostrador) → false', deliveryType: 'direct_delivery', trigger: 'automatic', expected: false },
      { name: 'direct_delivery + isShippingSale → false', deliveryType: 'direct_delivery', isShippingSale: true, trigger: 'automatic', expected: false },
      { name: 'pickup (para llevar) → false', deliveryType: 'pickup', trigger: 'automatic', expected: false },
      { name: 'home_delivery → true', deliveryType: 'home_delivery', trigger: 'automatic', expected: true },
      { name: 'null + isShippingSale → true', deliveryType: null, isShippingSale: true, trigger: 'automatic', expected: true },
      { name: 'null sin shipping → false', deliveryType: null, trigger: 'automatic', expected: false },
      { name: 'dine_in → false', deliveryType: 'dine_in', trigger: 'automatic', expected: false },
      { name: 'other → false', deliveryType: 'other', trigger: 'automatic', expected: false },
    ];

    for (const c of cases) {
      it(c.name, () => {
        const context = ctx({
          deliveryType: c.deliveryType,
          isShippingSale: c.isShippingSale,
          counterEnabled: OFF,
        });
        expect(shouldAutoPrintDispatchTicket(c.trigger, context)).toBe(c.expected);
      });
    }
  });

  // ─── counterEnabled = true (enmienda 2026-08-31) ─────────────────────
  // Comportamiento NUEVO. El borde a defender: `dine_in` y `other` siguen
  // en false aunque el interruptor esté prendido.
  describe('counterEnabled = true (mostrador y para llevar)', () => {
    const ON = true;

    const cases: ReadonlyArray<{
      name: string;
      deliveryType: DeliveryType;
      isShippingSale?: boolean;
      trigger: PrintTrigger;
      expected: boolean;
    }> = [
      // ── nuevos: mostrador y para llevar imprimen ────────────────────
      { name: 'direct_delivery (mostrador) → true', deliveryType: 'direct_delivery', trigger: 'automatic', expected: true },
      { name: 'direct_delivery explicit → true', deliveryType: 'direct_delivery', trigger: 'explicit', expected: true },
      { name: 'pickup (para llevar) → true', deliveryType: 'pickup', trigger: 'automatic', expected: true },
      { name: 'pickup explicit → true', deliveryType: 'pickup', trigger: 'explicit', expected: true },
      { name: 'direct_delivery + isShippingSale → true', deliveryType: 'direct_delivery', isShippingSale: true, trigger: 'automatic', expected: true },

      // ── sin cambio: home_delivery e isShippingSale siguen pasando ─────
      { name: 'home_delivery → true', deliveryType: 'home_delivery', trigger: 'automatic', expected: true },
      { name: 'null + isShippingSale → true', deliveryType: null, isShippingSale: true, trigger: 'automatic', expected: true },

      // ── BORDE: dine_in y other siguen en false ──────────────────────
      { name: 'dine_in → false (BORDE)', deliveryType: 'dine_in', trigger: 'automatic', expected: false },
      { name: 'dine_in explicit → false (BORDE)', deliveryType: 'dine_in', trigger: 'explicit', expected: false },
      { name: 'other → false (BORDE)', deliveryType: 'other', trigger: 'automatic', expected: false },
      { name: 'other explicit → false (BORDE)', deliveryType: 'other', trigger: 'explicit', expected: false },
    ];

    for (const c of cases) {
      it(c.name, () => {
        const context = ctx({
          deliveryType: c.deliveryType,
          isShippingSale: c.isShippingSale,
          counterEnabled: ON,
        });
        expect(shouldAutoPrintDispatchTicket(c.trigger, context)).toBe(c.expected);
      });
    }
  });

  // ─── Guard 1: print_dispatch_ticket_enabled ─────────────────────────
  describe('guard 1: printDispatchTicketEnabled', () => {
    it('false mata todo (incluso con counterEnabled true)', () => {
      const context: ShouldAutoPrintDispatchTicketContext = {
        printDispatchTicketEnabled: false,
        deliveryType: 'home_delivery',
        counterEnabled: true,
      };
      expect(shouldAutoPrintDispatchTicket('automatic', context)).toBe(false);
      expect(shouldAutoPrintDispatchTicket('explicit', context)).toBe(false);
    });

    it('undefined cae al default true (compatibilidad con llamadas existentes)', () => {
      const context: ShouldAutoPrintDispatchTicketContext = {
        printDispatchTicketEnabled: undefined as unknown as boolean,
        deliveryType: 'home_delivery',
      };
      expect(shouldAutoPrintDispatchTicket('automatic', context)).toBe(true);
    });
  });

  // ─── Guard 2: printDispatchTicketAuto (solo con trigger automatic) ────
  describe('guard 2: printDispatchTicketAuto', () => {
    it('automatic sin auto → false', () => {
      const context: ShouldAutoPrintDispatchTicketContext = {
        printDispatchTicketEnabled: true,
        printDispatchTicketAuto: false,
        deliveryType: 'home_delivery',
      };
      expect(shouldAutoPrintDispatchTicket('automatic', context)).toBe(false);
    });

    it('automatic con auto + counterEnabled → true', () => {
      const context: ShouldAutoPrintDispatchTicketContext = {
        printDispatchTicketEnabled: true,
        printDispatchTicketAuto: true,
        deliveryType: 'direct_delivery',
        counterEnabled: true,
      };
      expect(shouldAutoPrintDispatchTicket('automatic', context)).toBe(true);
    });

    it('explicit sin auto → true (guard 2 no aplica)', () => {
      const context: ShouldAutoPrintDispatchTicketContext = {
        printDispatchTicketEnabled: true,
        printDispatchTicketAuto: false,
        deliveryType: 'home_delivery',
      };
      expect(shouldAutoPrintDispatchTicket('explicit', context)).toBe(true);
    });
  });

  // ─── Asimetría explícita: counterEnabled true + dine_in ─────────────
  // Caso trampa: si alguien refactoriza la condición a `deliveryType !==
  // 'home_delivery' && !isShippingSale` sin la rama del contador, este
  // test falla y la regresión aparece. Está duplicado bajo "BORDE" arriba;
  // se mantiene acá también como canario separado.
  it('CANARIO: counterEnabled true + dine_in → false', () => {
    const context: ShouldAutoPrintDispatchTicketContext = {
      printDispatchTicketEnabled: true,
      deliveryType: 'dine_in',
      counterEnabled: true,
    };
    expect(shouldAutoPrintDispatchTicket('automatic', context)).toBe(false);
    expect(shouldAutoPrintDispatchTicket('explicit', context)).toBe(false);
  });
});