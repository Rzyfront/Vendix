import type {
  WorkflowRecordFieldDef,
  WorkflowRecordFieldType,
} from '../../../../../../shared/workflows/contract/workflow-contract';
import { DossierItemView } from '../../interfaces/workflow.interfaces';

export type RecordFieldDef = WorkflowRecordFieldDef;
export type RecordFieldType = WorkflowRecordFieldType;

/** Stored value of a record field (the API sends numbers, booleans and strings). */
export type RecordValue = string | number | boolean;
export type RecordValues = Record<string, RecordValue>;

export interface CollectionView {
  id: number;
  key: string;
  name: string;
  item_name: string;
  description: string | null;
  icon: string | null;
  fields: RecordFieldDef[];
  title_field: string | null;
  reference_prefix: string;
  is_archived: boolean;
  /** Only in the list. */
  records_count?: number;
  created_at: string;
  updated_at: string;
}

export interface CollectionBody {
  name: string;
  item_name: string;
  description?: string;
  icon?: string;
  fields: RecordFieldDef[];
  title_field?: string;
  reference_prefix?: string;
}

export interface CreateCollectionBody extends CollectionBody {
  key: string;
}

export interface RecordRow {
  id: number;
  collection_id: number;
  reference: string;
  title: string;
  values: RecordValues;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecordListQuery {
  collection_id: number;
  page?: number;
  limit?: number;
  search?: string;
  sort_by?: 'created_at' | 'updated_at' | 'title' | 'reference';
  sort_order?: 'asc' | 'desc';
}

export interface RecordInstanceView {
  id: number;
  reference: string;
  title: string;
  status: string;
  current_stage_key: string;
  definition_id: number;
  definition_name: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface RecordDetail extends RecordRow {
  collection: Pick<
    CollectionView,
    'id' | 'key' | 'name' | 'item_name' | 'icon' | 'fields' | 'title_field'
  >;
  dossier: { id: number; reference: string; items: DossierItemView[] } | null;
  instances: RecordInstanceView[];
  /** Published, switched-on flows of this collection ("Iniciar flujo"). */
  flows: { id: number; key: string; name: string }[];
}

export interface RecordUploadResult {
  file_id: number;
  item_id: number;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
}

export interface RecordStartResult {
  instance: { id: number; reference: string };
  replayed: boolean;
}
