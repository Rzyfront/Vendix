import type { AppPageDocument, AppPageTheme } from '../shared/app-page.contract';

/**
 * Apps F4 — tipos del chat de diseño con Vex en el constructor de apps.
 *
 * Alcance: todas las apps con editor de página EXCEPTO Tienda en línea
 * (`store_home`), que queda intocada.
 */
export const DESIGN_CHAT_APP_KINDS = [
  'product_page',
  'service_page',
  'booking',
] as const;

export type DesignChatAppKind = (typeof DESIGN_CHAT_APP_KINDS)[number];

export function isDesignChatAppKind(kind: unknown): kind is DesignChatAppKind {
  return (
    typeof kind === 'string' &&
    (DESIGN_CHAT_APP_KINDS as readonly string[]).includes(kind)
  );
}

/** Tope de cambios en la pila de historial del borrador por conversación. */
export const VEX_DESIGN_MAX_HISTORY = 20;

export const VEX_DESIGN_OPERATIONS = [
  'set_theme',
  'set_block_prop',
  'set_block_media',
  'add_block',
  'remove_block',
  'reorder_blocks',
  'apply_preset',
] as const;

export type VexDesignOpName = (typeof VEX_DESIGN_OPERATIONS)[number];

export interface VexDesignSetThemeOp {
  op: 'set_theme';
  tokens: Record<string, unknown>;
}

export interface VexDesignSetBlockPropOp {
  op: 'set_block_prop';
  block_id: string;
  prop: string;
  value: unknown;
}

export interface VexDesignSetBlockMediaOp {
  op: 'set_block_media';
  block_id: string;
  media_id: number;
  prop?: string;
  item_index?: number;
  /** Campo prohibido: solo existe para detectar y rechazar URLs externas explícitamente. */
  url?: unknown;
}

export interface VexDesignAddBlockOp {
  op: 'add_block';
  block_type: string;
  position?: number;
  id?: string;
  enabled?: boolean;
  props?: Record<string, unknown>;
}

export interface VexDesignRemoveBlockOp {
  op: 'remove_block';
  block_id: string;
}

export interface VexDesignReorderBlocksOp {
  op: 'reorder_blocks';
  block_ids: string[];
}

export interface VexDesignApplyPresetOp {
  op: 'apply_preset';
  preset_id: string;
}

export type VexDesignOperation =
  | VexDesignSetThemeOp
  | VexDesignSetBlockPropOp
  | VexDesignSetBlockMediaOp
  | VexDesignAddBlockOp
  | VexDesignRemoveBlockOp
  | VexDesignReorderBlocksOp
  | VexDesignApplyPresetOp;

export interface VexDesignChangeEntry {
  previous: AppPageDocument;
  document: AppPageDocument;
  summary: string;
  touched_block_id: string | null;
  op: VexDesignOpName;
  created_at: string;
}

export interface VexDesignSession {
  store_id: number;
  user_id: number;
  conversation_id: number;
  app_kind: DesignChatAppKind;
  initial_document: AppPageDocument;
  current_document: AppPageDocument;
  history: VexDesignChangeEntry[];
  media_base_url?: string;
  updated_at: string;
}

export interface VexDesignGalleryMediaSummary {
  id: number;
  alt: string | null;
  app_kind: string | null;
}

export interface VexDesignReadResult {
  app_kind: DesignChatAppKind;
  theme: AppPageTheme;
  hero: AppPageDocument['hero'] | null;
  blocks: Array<{
    id: string;
    type: string;
    enabled: boolean;
    props: Record<string, unknown>;
  }>;
  history_depth: number;
  can_discard: boolean;
  gallery_images: VexDesignGalleryMediaSummary[];
}

export interface VexDesignPatchSuccess {
  ok: true;
  app_kind: DesignChatAppKind;
  op: VexDesignOpName;
  document: AppPageDocument;
  summary: string;
  touched_block_id: string | null;
  history_depth: number;
  can_discard: boolean;
}

export interface VexDesignErrorResult {
  ok: false;
  error: string;
}

export type VexDesignPatchResult = VexDesignPatchSuccess | VexDesignErrorResult;

export interface VexDesignDiscardSuccess {
  ok: true;
  app_kind: DesignChatAppKind;
  document: AppPageDocument;
  discarded_summary: string;
  touched_block_id: string | null;
  history_depth: number;
  can_discard: boolean;
}

export type VexDesignDiscardResult =
  | VexDesignDiscardSuccess
  | VexDesignErrorResult;

export interface VexDesignResetSuccess {
  ok: true;
  app_kind: DesignChatAppKind;
  document: AppPageDocument;
  history_depth: 0;
  can_discard: false;
}

export type VexDesignResetResult = VexDesignResetSuccess | VexDesignErrorResult;

/** Contexto inyectado por el servidor en el stream-intent de Vex para el editor de apps. */
export interface VexDesignTurnContext {
  app_kind: DesignChatAppKind;
  prompt_context: string;
  allowed_tools: string[];
}
