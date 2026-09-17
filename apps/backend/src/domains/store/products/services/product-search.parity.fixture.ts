/**
 * CP-pos-smart-search · A.2 — Fixture de paridad B.2 (memoria) ⇄ C.3 (SQL).
 *
 * 4 queries (tildes / orden / guiones / mayúsculas) sobre un corpus fijo de 6
 * productos. Los órdenes esperados se derivan a mano de SEARCH_WEIGHTS (ver
 * notas por query); el spec de A.2 los fija y B.2/C.3 reutilizan este archivo
 * para probar que ambos flags devuelven el mismo orden.
 *
 * Corpus diseñado para ejercer: featured como desempate (P1 vs P3 vs P2 en
 * Q1), coverage como desempate (P6 vs P5 en Q3), sku-sobre-nombre (P6), tier
 * contains vía 'descafeinada' (P4) y variante-como-único-match (P5).
 */
import type { ProductSearchRow } from './product-search-relevance.util';

export interface ParityQuery {
  readonly label: 'tildes' | 'orden' | 'guiones' | 'mayusculas';
  readonly query: string;
}

export const POS_SMART_SEARCH_PARITY_QUERIES: readonly ParityQuery[] = [
  { label: 'tildes', query: 'café' },
  { label: 'orden', query: 'chocolate cafe' },
  { label: 'guiones', query: 'cafe-negro' },
  { label: 'mayusculas', query: 'CAFE NEGRO' },
];

export const POS_SMART_SEARCH_PARITY_CORPUS: readonly ProductSearchRow[] = [
  {
    id: 1,
    name: 'Café Negro Molido 500g',
    description: 'Tueste oscuro para espresso',
    sku: 'CAFE-001',
    barcode: null,
    is_featured: true,
    created_at: new Date('2026-01-10T00:00:00.000Z'),
    product_variants: [
      { id: 11, name: 'Molido fino', sku: 'MOL-001-F', barcode: null },
    ],
  },
  {
    id: 2,
    name: 'Chocolate con Café',
    description: 'Tableta 70% cacao',
    sku: 'CHOC-010',
    barcode: null,
    is_featured: false,
    created_at: new Date('2026-02-01T00:00:00.000Z'),
    product_variants: [],
  },
  {
    id: 3,
    name: 'Café con Leche',
    description: null,
    sku: 'CAFE-002',
    barcode: null,
    is_featured: false,
    created_at: new Date('2026-03-01T00:00:00.000Z'),
    product_variants: [],
  },
  {
    id: 4,
    name: 'Té Verde',
    description: 'Versión descafeinada suave',
    sku: 'TE-100',
    barcode: null,
    is_featured: false,
    created_at: new Date('2026-04-01T00:00:00.000Z'),
    product_variants: [],
  },
  {
    id: 5,
    name: 'Granizado de Chocolate',
    description: null,
    sku: 'GRA-100',
    barcode: null,
    is_featured: false,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    product_variants: [
      { id: 51, name: 'Extra shot de cafe', sku: 'GRA-100-S', barcode: null },
    ],
  },
  {
    id: 6,
    name: 'Azúcar Morena',
    description: null,
    sku: 'CAFE-999',
    barcode: null,
    is_featured: false,
    created_at: new Date('2026-06-01T00:00:00.000Z'),
    product_variants: [],
  },
];

/**
 * Órdenes esperados (ids), derivados a mano de SEARCH_WEIGHTS:
 *
 * - tildes ['cafe']: P1=P3=P2=80 (40+15+25) → featured P1, luego created_at
 *   P3>P2; P6=45 (sku word 30+15); P5=30 (variante, cov 0); P4=20 (desc
 *   contains 5+15).
 * - orden ['chocolate','cafe']: P2=120 (40+40+15+25); P5=70 (nombre 40 +
 *   variante 30); P1=P3=40 cov 1 → featured P1; P6=30; P4=5.
 * - guiones = mayusculas ['cafe','negro']: P1=120; P3=P2=40 cov 1 → created_at
 *   P3>P2; P6=30 cov 1 vs P5=30 cov 0 → coverage decide; P4=5.
 */
export const POS_SMART_SEARCH_PARITY_EXPECTED: Readonly<
  Record<ParityQuery['label'], readonly number[]>
> = {
  tildes: [1, 3, 2, 6, 5, 4],
  orden: [2, 5, 1, 3, 6, 4],
  guiones: [1, 3, 2, 6, 5, 4],
  mayusculas: [1, 3, 2, 6, 5, 4],
};
