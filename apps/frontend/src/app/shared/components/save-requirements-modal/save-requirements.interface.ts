export type SaveRequirementSeverity = 'required' | 'blocker';

/**
 * Tipos de accion (CTA) que puede disparar una fila de requisito.
 * - `focus` / `scroll`: enfocar o desplazar hasta un campo del formulario de
 *   producto (`target` = control name o id del elemento).
 * - `release-reservations`: accion especifica de productos (liberar reservas).
 * - `navigate`: navegar a un paso del wizard fiscal (o a una ruta). `target` es
 *   el id del paso o la ruta destino.
 */
export type SaveRequirementActionKind =
  | 'focus'
  | 'scroll'
  | 'release-reservations'
  | 'navigate';

export interface SaveRequirementAction {
  label: string;
  kind: SaveRequirementActionKind;
  /**
   * Destino de la accion. Para `focus`/`scroll` es el control name u otro
   * identificador del campo; para `navigate` es la ruta o el id de paso.
   */
  target?: string;
}

export interface SaveRequirement {
  id: string;
  label: string; // p.ej. "Nombre del producto"
  reason: string; // motivo humano: que debe hacer el cliente
  severity: SaveRequirementSeverity;
  action?: SaveRequirementAction;
}
