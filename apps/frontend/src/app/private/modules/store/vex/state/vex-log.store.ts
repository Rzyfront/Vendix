import { Injectable, computed, signal } from '@angular/core';
import { VexLogCategory, VexLogEvent } from '../models/vex.models';

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function buildEvent(
  category: VexLogCategory,
  title: string,
  description: string,
  minutes: number,
  is_new: boolean,
): VexLogEvent {
  return {
    id: crypto.randomUUID(),
    category,
    title,
    description,
    created_at: minutesAgo(minutes),
    is_new,
  };
}

function buildSeed(): VexLogEvent[] {
  return [
    buildEvent('sale', 'Nueva venta POS', 'Orden #1042 por $185.000 COP pagada en efectivo.', 4, true),
    buildEvent('alert', 'Stock bajo: Café molido', 'Quedan 2 unidades, por debajo del mínimo de 10.', 18, true),
    buildEvent('agent', 'Vex generó un resumen', 'Resumen de ventas de la semana listo para revisar.', 35, true),
    buildEvent('sale', 'Venta online confirmada', 'Pedido #1041 por $92.500 COP pagado con tarjeta.', 62, false),
    buildEvent('inventory', 'Ingreso de inventario', 'Se recibieron 48 unidades de Leche entera.', 95, false),
    buildEvent('cash', 'Apertura de caja', 'Caja principal abierta con base de $300.000 COP.', 180, false),
    buildEvent('sale', 'Venta POS', 'Orden #1040 por $47.800 COP pagada con transferencia.', 210, false),
    buildEvent('alert', 'Orden pendiente de pago', 'La orden #1038 lleva más de 2 horas sin pago.', 260, false),
    buildEvent('agent', 'Vex sugirió reabastecer', 'Recomendó pedir Aceite 1L y Arroz 500g al proveedor.', 320, false),
    buildEvent('cash', 'Cierre de caja de ayer', 'Cierre cuadrado: $2.150.000 COP, diferencia $0.', 420, false),
  ];
}

@Injectable()
export class VexLogStore {
  private readonly _events = signal<VexLogEvent[]>(buildSeed());
  private readonly _active_filter = signal<VexLogCategory | 'all'>('all');

  readonly events = computed(() =>
    [...this._events()].sort(
      (a, b) => b.created_at.getTime() - a.created_at.getTime(),
    ),
  );
  readonly active_filter = this._active_filter.asReadonly();
  readonly filtered_events = computed(() => {
    const filter = this._active_filter();
    const all = this.events();
    return filter === 'all' ? all : all.filter((e) => e.category === filter);
  });
  readonly new_count = computed(
    () => this._events().filter((e) => e.is_new).length,
  );

  setFilter(f: VexLogCategory | 'all'): void {
    this._active_filter.set(f);
  }

  markAllSeen(): void {
    this._events.update((list) => list.map((e) => ({ ...e, is_new: false })));
  }
}
