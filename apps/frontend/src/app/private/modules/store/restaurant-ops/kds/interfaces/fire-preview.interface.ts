/**
 * Previsualización del envío a cocina — QUI-655.
 *
 * La produce `POST /store/kitchen-fire/preview`, que reutiliza el mismo seam que
 * el envío real (`prepareFireContext`), así que lo que el modal muestra y lo que
 * el fire consume nunca pueden discrepar.
 */
export interface FirePreviewComponent {
  component_product_id: number;
  name: string;
  sku: string | null;
  stock_unit: string | null;
  /** Cantidad total para esta línea: ya multiplicada por la cantidad del item. */
  quantity: number;
  /** Saltos en el árbol del BOM. 1 = hijo directo de la receta del plato. */
  depth: number;
  /**
   * Recetas atravesadas para llegar a esta línea, root-first. Es lo que permite
   * reconstruir el árbol y desmarcar un NODO de sub-receta completo ("sin salsa
   * criolla") en vez de obligar a desmarcar sus tres hojas.
   */
  path_recipe_ids: number[];
}

export interface FirePreviewItem {
  order_item_id: number;
  product_id: number | null;
  product_name: string;
  /**
   * CP-POLLO-ARABE-727 C.4 (QUI-736) — la variante vendida, leída DIRECTAMENTE
   * del `order_item` (`product_variant_id` / `variant_attributes`). El preview
   * corre PRE-fire sobre `prepareFireContext`: en ese punto del ciclo de vida
   * `variant_label` (columna de `kitchen_ticket_items`) todavía NO existe, así
   * que hay que leer la variante del `order_item`, nunca del ticket.
   */
  product_variant_id?: number | null;
  variant_attributes?: string | null;
  quantity: number;
  /**
   * Nota de texto libre dejada al TOMAR el pedido ("sin cebolla", "poca sal").
   * El cocinero la lee y desmarca en consecuencia: es el camino de captura que no
   * calza con un ingrediente exacto.
   */
  notes: string | null;
  /**
   * Un `prepared` sin receta activa aparece igual en el modal, con
   * `components: []`. No hay nada que desglosar pero el cocinero debe verlo y
   * poder enviarlo.
   */
  has_active_recipe: boolean;
  components: FirePreviewComponent[];
}

export interface FirePreview {
  order_id: number;
  items: FirePreviewItem[];
  skipped_item_ids: number[];
}

/** Exclusiones confirmadas, por item, tal como las consume el fire. */
export interface FireItemExclusion {
  order_item_id: number;
  component_product_ids: number[];
  /**
   * QUI-655 — a cuántas unidades de la línea aplica la exclusión.
   *
   * Omitido = toda la línea. Cuando es menor que la cantidad, el backend PARTE la
   * línea antes de consumir: 3 pollos con la excepción en 1 quedan como 2
   * completos + 1 sin el insumo, y el inventario refleja exactamente eso.
   */
  applies_to_units?: number;
  notes?: string;
}

export interface FireConfirmPayload {
  exclusions: FireItemExclusion[];
  item_notes?: Array<{ order_item_id: number; notes: string }>;
}

/**
 * Nodo del árbol que el modal renderiza. Se deriva de `path_recipe_ids`: las
 * líneas que comparten un recipe id en su ruta cuelgan del mismo agrupador.
 */
export interface FireTreeNode {
  /** `recipe:<id>` para un agrupador de sub-receta, `leaf:<productId>` para hoja. */
  key: string;
  kind: 'recipe' | 'leaf';
  label: string;
  /** Presente solo en hojas. */
  component?: FirePreviewComponent;
  children: FireTreeNode[];
  /** Ids de componente que cuelgan de este nodo, incluido todo su subárbol. */
  componentIds: number[];
}
