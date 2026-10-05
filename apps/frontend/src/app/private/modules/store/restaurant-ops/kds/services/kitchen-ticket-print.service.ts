import { Injectable, computed, inject } from '@angular/core';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import {
  DocumentPrintService,
  type PrintTrigger,
} from '../../../../../../shared/services/print/document-print.service';

/**
 * Imprime la comanda (`kitchen_ticket`) en papel cuando la tienda opera con
 * cocina fisica (`restaurant.kitchen_mode === 'physical'`). En modo virtual
 * (ausente/null incluido) `printAfterFire` es un no-op: cero requests.
 *
 * Cola FIFO de una impresion a la vez y dedupe de 30 s por ticket id para la
 * impresion automatica (mismo patron que `DispatchTicketPrintService`).
 * Una falla de impresion nunca se relanza: el envio a cocina ya ocurrio.
 */
@Injectable({ providedIn: 'root' })
export class KitchenTicketPrintService {
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly documentPrint = inject(DocumentPrintService);
  private readonly toast = inject(ToastService);

  private static readonly AUTO_DEDUP_WINDOW_MS = 30_000;
  private readonly recentAutoPrints = new Map<number, number>();
  private printChain: Promise<void> = Promise.resolve();

  readonly isPhysicalKitchen = computed(
    () => this.settingsFacade.settings()?.restaurant?.kitchen_mode === 'physical',
  );

  /** Impresion automatica tras el envio a cocina. No-op si no es fisica. */
  printAfterFire(ticketIds: number[] | null | undefined): void {
    if (!this.isPhysicalKitchen() || !ticketIds?.length) return;
    const fresh = Array.from(new Set(ticketIds)).filter(
      (id) => !this.isDuplicateAutoPrint(id),
    );
    for (const id of fresh) this.enqueue(id, 'automatic');
  }

  /** Impresion manual (boton "Imprimir comanda"): siempre imprime. */
  printTickets(ticketIds: number[]): void {
    if (!ticketIds?.length) return;
    for (const id of Array.from(new Set(ticketIds))) this.enqueue(id, 'explicit');
  }

  private enqueue(ticketId: number, trigger: PrintTrigger): void {
    this.printChain = this.printChain
      .then(() => this.printOne(ticketId, trigger))
      .catch(() => undefined);
  }

  private async printOne(ticketId: number, trigger: PrintTrigger): Promise<void> {
    try {
      const result = await this.documentPrint.printViaGateway({
        formatType: 'kitchen_ticket',
        documentId: ticketId,
        title: `Comanda #${ticketId}`,
        trigger,
      });
      // `null` = el gateway fallo o el formato esta inactivo (sin fallback).
      // Un resultado con documents 0 en 'automatic' = el comercio no auto-imprime.
      if (result === null) {
        this.toast.error('No se pudo imprimir la comanda');
      }
    } catch (err) {
      console.error('[KitchenTicketPrint] fallo la impresion', { ticketId, err });
      this.toast.error('No se pudo imprimir la comanda');
    }
  }

  private isDuplicateAutoPrint(ticketId: number): boolean {
    const now = Date.now();
    const last = this.recentAutoPrints.get(ticketId);
    if (last !== undefined && now - last < KitchenTicketPrintService.AUTO_DEDUP_WINDOW_MS) {
      return true;
    }
    this.recentAutoPrints.set(ticketId, now);
    if (this.recentAutoPrints.size > 200) {
      const cutoff = now - KitchenTicketPrintService.AUTO_DEDUP_WINDOW_MS;
      for (const [k, t] of this.recentAutoPrints) {
        if (t < cutoff) this.recentAutoPrints.delete(k);
      }
    }
    return false;
  }
}
