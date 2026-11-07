import { DossierItemView } from '../../workflows/interfaces/workflow.interfaces';

export interface DossierRow {
  id: number;
  reference: string;
  title: string | null;
  workflow_instance_id: number | null;
  created_at: string;
  /** Active (not superseded) items, computed by the backend list. */
  items_count: number;
}

export interface DossierDetail {
  id: number;
  reference: string;
  title?: string | null;
  workflow_instance_id?: number | null;
  items: DossierItemView[];
}
