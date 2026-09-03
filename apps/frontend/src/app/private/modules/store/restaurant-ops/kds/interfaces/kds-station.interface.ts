/**
 * Estaciones de preparación y sus turnos — QUI-651.
 *
 * El KDS dejó de ser implícito: antes existía un solo tablero por tienda y
 * `kitchen_tickets` no apuntaba a ninguna estación, así que en un restaurante con
 * barra + cocina caliente + postres todo caía en el mismo tablero y el personal
 * filtraba a mano.
 */
export interface KdsStation {
  id: number;
  store_id: number;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
  /**
   * La estación a la que caen los platos que no declaran `kds_id`. Exactamente
   * una por tienda — lo refuerza un índice único parcial en la DB, no solo el
   * servicio. No se puede degradar ni desactivar sin promover otra antes.
   */
  is_default: boolean;
  location_id: number | null;
  _count?: { sessions: number; products: number };
}

export type KdsSessionStatus = 'open' | 'closed';

export interface KdsSessionUserRef {
  id: number;
  first_name: string;
  last_name: string;
}

/**
 * Turno de estación. NO maneja montos: la sesión de caja custodia dinero, esta
 * custodia RESPONSABILIDAD SOBRE EL CONSUMO DE INSUMOS. En el KDS se consume
 * inventario real y se genera COGS, así que el movimiento queda atado al turno y
 * no solo a quien pidió el fire.
 */
export interface KdsSession {
  id: number;
  kds_id: number;
  store_id: number;
  opened_by: number;
  closed_by: number | null;
  status: KdsSessionStatus;
  opened_at: string;
  closed_at: string | null;
  closing_notes: string | null;
  /** Snapshot inmutable del turno, persistido AL CERRAR. Null mientras está abierto. */
  summary: KdsConsumptionSummary | null;
  kds?: Pick<KdsStation, 'id' | 'name' | 'code'>;
  opened_by_user?: KdsSessionUserRef;
  closed_by_user?: KdsSessionUserRef | null;
  /** QUI-XXX: último momento en que este turno tuvo actividad. La UI lo usa
   *  para mostrar "vencida en Xs" y el operador decide abrir otro o esperar.
   *  Null si el backend aún no actualizó el heartbeat en esta sesión. */
  last_seen_at?: string | null;
  /** QUI-XXX: usuario que tomó esta estación por la fuerza (cierre explícito
   *  por owner/admin). Solo poblado en sesiones CERRADAS por toma forzada —
   *  la sesión abierta de turno nunca lleva esta marca. */
  force_taken_by_user_id?: number | null;
  force_taken_by_user?: KdsSessionUserRef | null;
}

/**
 * Una fila del RESUMEN: un insumo, colapsando todos los pedidos del turno.
 *
 * ADR-10: el KDS nunca muestra dinero — en cocina solo cantidades de insumos.
 * Sin `total_cost`: el costo no viaja a esta superficie.
 */
export interface KdsConsumptionIngredient {
  product_id: number;
  name: string;
  sku: string | null;
  quantity: number;
}

export interface KdsConsumptionSummary {
  movement_count: number;
  distinct_ingredients: number;
  ingredients: KdsConsumptionIngredient[];
}

/**
 * Una fila del HISTORIAL: un insumo POR PEDIDO. El par historial/resumen es el
 * mismo que caja tiene entre movimientos y summary — 20 pedidos que consumieron
 * pollo son 20 líneas en el historial y una sola en el resumen.
 */
export interface KdsConsumptionHistoryRow {
  transaction_id: number;
  consumed_at: string;
  quantity: number;
  ingredient: { id: number; name: string; sku: string | null } | null;
  /** Plato preparado que originó el consumo. */
  dish_name: string | null;
  order_id: number | null;
  order_number: string | null;
}

/**
 * Movimiento de consumo SIN sesión atribuida (QUI-760).
 *
 * Aparece cuando el fire se ejecutó mientras ninguna estación tenía turno
 * abierto. Antes del backfill estos movimientos quedaban huérfanos para
 * siempre; ahora se imputan retroactivamente al abrir sesión, pero los
 * **previos a la primera sesión abierta de la tienda** siguen sin dueño y se
 * exponen acá. Mismo payload que el historial del turno: una fila por
 * insumo POR PEDIDO. ADR-10 — sin dinero en el payload.
 */
export interface KdsUnattributedConsumptionRow {
  transaction_id: number;
  consumed_at: string;
  quantity: number;
  ingredient: { id: number; name: string; sku: string | null } | null;
}

export interface KdsUnattributedConsumption {
  movement_count: number;
  movements: KdsUnattributedConsumptionRow[];
}
