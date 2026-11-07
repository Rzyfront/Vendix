/** Plantillas de documentos (P4.1/P4.5) y documentos emitidos desde ellas. */

export type TemplateKind = 'blocks' | 'base_pdf';
export type TemplateStatus = 'draft' | 'published' | 'archived';
export type BlockAlign = 'left' | 'center' | 'right' | 'justify';
export type PageSizeName = 'A4' | 'LETTER';

export interface TemplateVersionRef {
  id: number;
  version: number;
  published_at: string;
}

export interface TemplateRow {
  id: number;
  key: string;
  name: string;
  category: string;
  kind: TemplateKind;
  status: TemplateStatus;
  base_file_id: number | null;
  published_version: TemplateVersionRef | null;
  created_at: string;
  updated_at: string;
}

export interface SignatureSlot {
  key: string;
  role_label: string;
}

export type TemplateBlock =
  | { type: 'heading'; text: string; level: 1 | 2 | 3; align?: BlockAlign }
  | { type: 'paragraph'; text: string; align?: BlockAlign }
  | { type: 'fields'; rows: Array<{ label: string; value: string }> }
  | { type: 'table'; source: string; columns: Array<{ header: string; value: string }> }
  | { type: 'image'; source: 'store.logo'; width?: number }
  | { type: 'spacer'; height: number }
  | { type: 'page_break' }
  | { type: 'signature'; slot_key: string };

export interface BlocksBody {
  page: { size: PageSizeName; margin?: number };
  header?: { show_logo?: boolean; text?: string };
  footer?: { text?: string; page_numbers?: boolean };
  blocks: TemplateBlock[];
  signature_slots?: SignatureSlot[];
}

/** Coordinates in PDF points, from the top-left corner of the page. */
export interface BasePdfBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BasePdfField extends BasePdfBox {
  value: string;
  font_size?: number;
  align?: BlockAlign;
}

export interface BasePdfSlot extends BasePdfBox, SignatureSlot {}

export interface BasePdfBody {
  fields: BasePdfField[];
  signature_slots: BasePdfSlot[];
}

export interface TemplateDetail extends TemplateRow {
  body: BlocksBody | BasePdfBody;
}

export interface BasePdfPage {
  page: number;
  width_pt: number;
  height_pt: number;
  /** `data:image/jpeg;base64,...` */
  image: string;
}

export interface TemplateVersionRow {
  id: number;
  version: number;
  kind: TemplateKind;
  body_hash: string;
  token_schema: Array<{ path: string; required: boolean }>;
  base_file_id: number | null;
  published_by_user_id: number;
  published_at: string;
}

export interface PublishResult {
  created: boolean;
  version: number;
  version_id: number;
  body_hash: string;
}

export type IssuedDocumentStatus =
  | 'rendering'
  | 'issued'
  | 'pending_signature'
  | 'signed'
  | 'voided'
  | 'superseded'
  | 'failed';

export interface IssuedDocument {
  id: number;
  reference: string;
  title: string;
  status: IssuedDocumentStatus;
  error: string | null;
  template: { id: number; key: string; name: string };
  template_version: number;
  requirement_key: string | null;
  stage_key: string | null;
  workflow_instance_id: number | null;
  dossier_id: number | null;
  file_id: number | null;
  supersedes_id: number | null;
  void_reason: string | null;
  issued_at: string | null;
  created_at: string;
}
