export type SaveRequirementSeverity = 'required' | 'blocker';
export type SaveRequirementActionKind = 'focus' | 'scroll' | 'release-reservations';

export interface SaveRequirementAction {
  label: string;
  kind: SaveRequirementActionKind;
  /** control name (focus/scroll) u otro identificador de destino */
  target?: string;
}

export interface SaveRequirement {
  id: string;
  label: string; // p.ej. "Nombre del producto"
  reason: string; // motivo humano: qué debe hacer el cliente
  severity: SaveRequirementSeverity;
  action?: SaveRequirementAction;
}
