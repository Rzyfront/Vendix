/**
 * Stack de productos seleccionados (QUI-567).
 *
 * Es el "carrito" de la edición masiva: el usuario va apilando productos
 * buscando y filtrando en el panel izquierdo, y aquí ve exactamente cuáles
 * llevan la carga.
 *
 * ## Por qué necesita hidratación
 *
 * La selección es un `Set<number>` de ids, no una lista de productos. Cuando el
 * usuario pulsa "seleccionar los N del filtro", los ids llegan de
 * `GET /store/products/ids` y la gran mayoría NO están en la página cargada:
 * sin hidratar, el stack mostraría "#412" en vez de un nombre. La página
 * completa las fichas que falten con `GET /store/products?ids=…` y las va
 * pasando aquí; mientras llegan, se pinta el id crudo en vez de un hueco.
 *
 * ## Por qué avisa de los lotes
 *
 * El backend tapa cada request a 100 ids. Con 250 seleccionados no hay una
 * escritura sino tres, y un operador que no lo sabe interpreta una barra de
 * progreso a saltos como que la app se colgó. Se dice antes de empezar.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import {
  ButtonComponent,
  CardComponent,
  IconComponent,
} from '../../../../../shared/components/index';
import type { Product } from '../interfaces';
import { MAX_BULK_EDIT_IDS } from './bulk-edit.interface';

/** Fila del stack. Puede estar sin hidratar (solo id). */
export interface BulkSelectedEntry {
  id: number;
  name: string;
  sku: string | null;
  /** `false` mientras la ficha completa no ha llegado del backend. */
  hydrated: boolean;
  product?: Product;
}

@Component({
  selector: 'app-bulk-selected-stack',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardComponent, ButtonComponent, IconComponent],
  templateUrl: './bulk-selected-stack.component.html',
})
export class BulkSelectedStackComponent {
  /** Filas del stack, en el orden en que la página las resuelve. */
  readonly entries = input<BulkSelectedEntry[]>([]);
  /** `true` mientras se completan fichas que faltaban. */
  readonly hydrating = input<boolean>(false);

  readonly removeRequested = output<number>();
  readonly clearRequested = output<void>();

  readonly count = computed<number>(() => this.entries().length);

  /** Cuántos requests hará la operación. El backend tapa a 100 ids por lote. */
  readonly batchCount = computed<number>(() =>
    Math.ceil(this.count() / MAX_BULK_EDIT_IDS),
  );

  readonly batchSize = MAX_BULK_EDIT_IDS;
}
