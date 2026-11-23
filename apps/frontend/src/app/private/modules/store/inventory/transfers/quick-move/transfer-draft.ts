import { Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * Modelo compartido del movimiento de inventario entre bodegas, usado por las
 * dos superficies (tienda y organización): el modal rápido y la vista
 * avanzada (`/admin/inventory/transfers/new`).
 *
 * Una línea es un PAR producto + variante. Dos variantes del mismo producto
 * son dos líneas; el mismo par nunca se repite.
 */

/** Stock de una bodega como lo devuelve el picker del backend. */
export interface TransferPickerStock {
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
}

/**
 * Fila del picker (`GET .../search-products` de tienda y de organización):
 * una por producto sin variantes o una por variante con stock en el origen.
 */
export interface TransferPickerRow {
  /** Id del producto (contrato histórico del endpoint de tienda). */
  id: number;
  product_id?: number;
  product_variant_id?: number | null;
  name: string;
  variant_name?: string | null;
  sku: string | null;
  stock_at_origin: TransferPickerStock;
  stock_at_destination: TransferPickerStock;
}

export interface TransferDraftLine {
  key: string;
  product_id: number;
  product_variant_id: number | null;
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  available_at_origin: number;
  available_at_destination: number;
  quantity: number;
}

/** Lo que el modal le pasa a la vista avanzada. */
export interface TransferDraft {
  from_location_id: number | null;
  to_location_id: number | null;
  /** Etiquetas ya resueltas: la vista avanzada no vuelve a pedir las bodegas. */
  from_location_name?: string;
  to_location_name?: string;
  notes: string;
  lines: TransferDraftLine[];
}

/** Payload aceptado por `POST` de tienda y de organización (crear o mover). */
export interface TransferPayload {
  from_location_id: number;
  to_location_id: number;
  expected_date?: string;
  notes?: string;
  items: Array<{
    product_id: number;
    product_variant_id?: number;
    quantity: number;
  }>;
}

/** Búsqueda que cada superficie inyecta en el picker compartido. */
export type TransferProductSearchFn = (
  term: string,
  fromLocationId: number,
  toLocationId: number,
) => Observable<TransferPickerRow[]>;

export function transferLineKey(
  productId: number,
  variantId: number | null | undefined,
): string {
  return `${productId}:${variantId ?? 'base'}`;
}

export function pickerRowKey(row: TransferPickerRow): string {
  return transferLineKey(row.product_id ?? row.id, row.product_variant_id);
}

export function pickerRowToLine(row: TransferPickerRow): TransferDraftLine {
  return {
    key: pickerRowKey(row),
    product_id: row.product_id ?? row.id,
    product_variant_id: row.product_variant_id ?? null,
    product_name: row.name,
    variant_name: row.variant_name ?? null,
    sku: row.sku ?? null,
    available_at_origin: Number(row.stock_at_origin?.quantity_available ?? 0),
    available_at_destination: Number(
      row.stock_at_destination?.quantity_available ?? 0,
    ),
    quantity: 1,
  };
}

/**
 * Agrega filas del picker a las líneas sin duplicar producto + variante y sin
 * filas sin disponible en origen. Devuelve las líneas nuevas y cuántas se
 * omitieron por repetidas o sin stock.
 */
export function mergePickerRows(
  lines: TransferDraftLine[],
  rows: TransferPickerRow[],
): { lines: TransferDraftLine[]; added: number; skipped: number } {
  const keys = new Set(lines.map((l) => l.key));
  const next = [...lines];
  let added = 0;
  let skipped = 0;
  for (const row of rows) {
    const key = pickerRowKey(row);
    if (keys.has(key) || Number(row.stock_at_origin?.quantity_available ?? 0) <= 0) {
      skipped++;
      continue;
    }
    keys.add(key);
    next.push(pickerRowToLine(row));
    added++;
  }
  return { lines: next, added, skipped };
}

export function lineHasValidQuantity(line: TransferDraftLine): boolean {
  return (
    Number.isInteger(line.quantity) &&
    line.quantity > 0 &&
    line.quantity <= line.available_at_origin
  );
}

export function totalUnits(lines: TransferDraftLine[]): number {
  return lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
}

/** `null` si falta origen/destino, son iguales, no hay líneas o alguna es inválida. */
export function buildTransferPayload(draft: {
  from_location_id: number | null;
  to_location_id: number | null;
  notes?: string;
  expected_date?: string;
  lines: TransferDraftLine[];
}): TransferPayload | null {
  const from = draft.from_location_id;
  const to = draft.to_location_id;
  if (!from || !to || from === to) return null;
  if (draft.lines.length === 0 || !draft.lines.every(lineHasValidQuantity)) {
    return null;
  }
  const notes = draft.notes?.trim();
  return {
    from_location_id: from,
    to_location_id: to,
    ...(draft.expected_date ? { expected_date: draft.expected_date } : {}),
    ...(notes ? { notes } : {}),
    items: draft.lines.map((line) => ({
      product_id: line.product_id,
      ...(line.product_variant_id != null
        ? { product_variant_id: line.product_variant_id }
        : {}),
      quantity: line.quantity,
    })),
  };
}

/**
 * Traspaso del modal rápido a la vista avanzada. El estado de navegación de
 * Angular se pierde con un recargo; este servicio guarda el borrador en
 * memoria y la vista lo consume una sola vez al entrar.
 */
@Injectable({ providedIn: 'root' })
export class TransferDraftHandoffService {
  private readonly draft = signal<TransferDraft | null>(null);

  set(draft: TransferDraft): void {
    this.draft.set({
      ...draft,
      lines: draft.lines.map((l) => ({ ...l })),
    });
  }

  /** Devuelve el borrador pendiente (si hay) y lo limpia. */
  consume(): TransferDraft | null {
    const value = this.draft();
    this.draft.set(null);
    return value;
  }
}
