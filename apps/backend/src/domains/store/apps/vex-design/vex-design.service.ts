import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@common/redis/redis.module';
import { DomainConfigService } from '@common/config/domain.config';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  APP_HERO_FIELDS,
  APP_PAGE_BLOCKS,
  APP_PAGE_SCHEMA_VERSION,
  APP_THEME_FIELDS,
  AppPageBlock,
  AppPageDocument,
  FieldSpec,
  MAX_APP_PAGE_BLOCKS,
  SINGLE_APP_PAGE_BLOCKS,
  readAppPage,
  validateAppPage,
} from '../shared/app-page.contract';
import {
  THEME_TOKEN_LABELS,
  blockLabel,
  buildDesignChatPromptContext,
} from './vex-design.catalog';
import { findPresetForApp, listPresetsForApp } from './vex-design.presets';
import {
  DesignChatAppKind,
  VEX_DESIGN_MAX_HISTORY,
  VexDesignAddBlockOp,
  VexDesignApplyPresetOp,
  VexDesignChangeEntry,
  VexDesignDiscardResult,
  VexDesignGalleryMediaSummary,
  VexDesignOperation,
  VexDesignPatchResult,
  VexDesignReadResult,
  VexDesignRemoveBlockOp,
  VexDesignReorderBlocksOp,
  VexDesignResetResult,
  VexDesignSession,
  VexDesignSetBlockMediaOp,
  VexDesignSetBlockPropOp,
  VexDesignSetThemeOp,
  isDesignChatAppKind,
} from './vex-design.types';

/** TTL de la sesión de borrador en Redis (2 horas). */
const SESSION_TTL_SECONDS = 7200;

const BLOCK_ID_SAFE_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Propiedades de URL prohibidas en `set_block_prop` para evitar URLs externas. */
const URL_PROP_KINDS = new Set<FieldSpec['kind']>(['url', 'url_list']);

function cloneDoc(doc: AppPageDocument): AppPageDocument {
  return JSON.parse(JSON.stringify(doc)) as AppPageDocument;
}

function emptyDraft(): AppPageDocument {
  return { schema_version: APP_PAGE_SCHEMA_VERSION, blocks: [] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Apps F4 — servicio del chat de diseño con Vex.
 *
 * Mantiene la pila de borradores por conversación (tope de 20 cambios) en
 * Redis con respaldo en memoria, valida cada parche con `validateAppPage`
 * antes de aceptarlo, y jamás escribe ni publica en `store_apps`: solo el
 * dueño desde el editor guarda o publica.
 */
@Injectable()
export class VexDesignService {
  private readonly logger = new Logger(VexDesignService.name);
  private readonly memorySessions = new Map<string, VexDesignSession>();

  constructor(
    private readonly prisma: StorePrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  /**
   * Inicializa o sincroniza la sesión del borrador para `(storeId, conversationId)`.
   * Valida que la app admita chat (excluye `store_home`) y que el borrador
   * entrante cumpla `app-page.contract.ts`.
   */
  async initOrSyncSession(params: {
    storeId: number;
    userId: number;
    conversationId: number;
    appKind: string;
    draft?: unknown;
    mediaBaseUrl?: string;
  }): Promise<VexDesignSession> {
    if (!isDesignChatAppKind(params.appKind)) {
      throw new Error(
        `La app "${params.appKind}" no admite el chat de diseño con Vex.`,
      );
    }

    const appKind = params.appKind;
    const incomingDraft = await this.resolveValidatedDraft(
      params.storeId,
      appKind,
      params.draft,
    );

    const existing = await this.loadSession(
      params.storeId,
      params.conversationId,
    );

    if (existing) {
      if (existing.app_kind !== appKind) {
        throw new Error(
          `Esta conversación pertenece a "${existing.app_kind}" y no puede editar "${appKind}".`,
        );
      }
      if (existing.user_id !== params.userId) {
        throw new Error(
          'Esta conversación pertenece a otro usuario de la tienda.',
        );
      }
      const next: VexDesignSession = {
        ...existing,
        current_document: incomingDraft,
        media_base_url: params.mediaBaseUrl ?? existing.media_base_url,
        updated_at: new Date().toISOString(),
      };
      await this.saveSession(next);
      return next;
    }

    const created: VexDesignSession = {
      store_id: params.storeId,
      user_id: params.userId,
      conversation_id: params.conversationId,
      app_kind: appKind,
      initial_document: cloneDoc(incomingDraft),
      current_document: cloneDoc(incomingDraft),
      history: [],
      media_base_url: params.mediaBaseUrl,
      updated_at: new Date().toISOString(),
    };
    await this.saveSession(created);
    return created;
  }

  /** Devuelve el resumen del borrador actual y fotos de galería disponibles. */
  async readDraft(
    storeId: number,
    conversationId: number,
    expectedAppKind?: DesignChatAppKind,
  ): Promise<VexDesignReadResult | null> {
    const session = await this.loadSession(storeId, conversationId);
    if (!session) return null;
    if (expectedAppKind && session.app_kind !== expectedAppKind) return null;

    const galleryImages = await this.listStoreGalleryImages(storeId);
    return {
      app_kind: session.app_kind,
      theme: session.current_document.theme ?? {},
      hero: session.current_document.hero ?? null,
      blocks: session.current_document.blocks.map((b) => ({
        id: b.id,
        type: b.type,
        enabled: b.enabled,
        props: b.props,
      })),
      history_depth: session.history.length,
      can_discard: session.history.length > 0,
      gallery_images: galleryImages,
    };
  }

  /** Construye el contexto completo de diseño para el prompt del turno de Vex. */
  async buildPromptContext(
    storeId: number,
    conversationId: number,
  ): Promise<string | null> {
    const session = await this.loadSession(storeId, conversationId);
    if (!session) return null;
    const galleryImages = await this.listStoreGalleryImages(storeId);
    return buildDesignChatPromptContext({
      appKind: session.app_kind,
      draft: session.current_document,
      galleryImages,
    });
  }

  /** Devuelve el último cambio registrado en la sesión (para emitir frames SSE). */
  async getLatestState(
    storeId: number,
    conversationId: number,
    expectedAppKind?: DesignChatAppKind,
  ): Promise<{
    app_kind: DesignChatAppKind;
    document: AppPageDocument;
    initial_document: AppPageDocument;
    latest_change: VexDesignChangeEntry | null;
    history_depth: number;
    can_discard: boolean;
  } | null> {
    const session = await this.loadSession(storeId, conversationId);
    if (!session) return null;
    if (expectedAppKind && session.app_kind !== expectedAppKind) return null;

    return {
      app_kind: session.app_kind,
      document: cloneDoc(session.current_document),
      initial_document: cloneDoc(session.initial_document),
      latest_change:
        session.history.length > 0
          ? session.history[session.history.length - 1]
          : null,
      history_depth: session.history.length,
      can_discard: session.history.length > 0,
    };
  }

  /**
   * Aplica UNA operación acotada al borrador de la conversación.
   * Si la validación del contrato falla, devuelve error legible y deja el
   * borrador y la pila completamente intactos.
   */
  async patchDraft(
    storeId: number,
    conversationId: number,
    operation: VexDesignOperation,
    expectedAppKind?: DesignChatAppKind,
  ): Promise<VexDesignPatchResult> {
    const session = await this.loadSession(storeId, conversationId);
    if (!session) {
      return {
        ok: false,
        error:
          'No hay un borrador abierto para esta conversación. Abre el editor de la app e inténtalo de nuevo.',
      };
    }
    if (expectedAppKind && session.app_kind !== expectedAppKind) {
      return {
        ok: false,
        error: `La conversación está asociada a "${session.app_kind}" y no a "${expectedAppKind}".`,
      };
    }

    const previous = cloneDoc(session.current_document);
    const draft = cloneDoc(session.current_document);

    let summary = '';
    let touchedBlockId: string | null = null;

    switch (operation.op) {
      case 'set_theme': {
        const res = this.applySetTheme(draft, operation);
        if (!res.ok) return res;
        summary = res.summary;
        touchedBlockId = null;
        break;
      }
      case 'set_block_prop': {
        const res = this.applySetBlockProp(session.app_kind, draft, operation);
        if (!res.ok) return res;
        summary = res.summary;
        touchedBlockId = res.touchedBlockId;
        break;
      }
      case 'set_block_media': {
        const res = await this.applySetBlockMedia(
          session,
          draft,
          operation,
        );
        if (!res.ok) return res;
        summary = res.summary;
        touchedBlockId = res.touchedBlockId;
        break;
      }
      case 'add_block': {
        const res = this.applyAddBlock(session.app_kind, draft, operation);
        if (!res.ok) return res;
        summary = res.summary;
        touchedBlockId = res.touchedBlockId;
        break;
      }
      case 'remove_block': {
        const res = this.applyRemoveBlock(draft, operation);
        if (!res.ok) return res;
        summary = res.summary;
        touchedBlockId = res.touchedBlockId;
        break;
      }
      case 'reorder_blocks': {
        const res = this.applyReorderBlocks(draft, operation);
        if (!res.ok) return res;
        summary = res.summary;
        touchedBlockId = res.touchedBlockId;
        break;
      }
      case 'apply_preset': {
        const res = this.applyPreset(session.app_kind, draft, operation);
        if (!res.ok) return res;
        summary = res.summary;
        touchedBlockId = null;
        break;
      }
      default:
        return {
          ok: false,
          error: `Operación "${String((operation as { op?: unknown }).op)}" no permitida.`,
        };
    }

    // Validación obligatoria con el mismo parser del contrato (`app-page.contract.ts`).
    const validation = validateAppPage(session.app_kind, draft);
    if (!validation.valid || !validation.value) {
      return {
        ok: false,
        error: `El cambio no cumple el contrato de la app: ${validation.errors.slice(0, 4).join(' ')}`,
      };
    }

    const nextDoc = validation.value;
    const entry: VexDesignChangeEntry = {
      previous,
      document: cloneDoc(nextDoc),
      summary,
      touched_block_id: touchedBlockId,
      op: operation.op,
      created_at: new Date().toISOString(),
    };

    const nextHistory = [...session.history, entry];
    // Tope de 20 elementos en la pila de historial del borrador.
    while (nextHistory.length > VEX_DESIGN_MAX_HISTORY) {
      nextHistory.shift();
    }

    const updatedSession: VexDesignSession = {
      ...session,
      current_document: cloneDoc(nextDoc),
      history: nextHistory,
      updated_at: new Date().toISOString(),
    };
    await this.saveSession(updatedSession);

    return {
      ok: true,
      app_kind: session.app_kind,
      op: operation.op,
      document: nextDoc,
      summary,
      touched_block_id: touchedBlockId,
      history_depth: nextHistory.length,
      can_discard: nextHistory.length > 0,
    };
  }

  /** Descarta el último cambio aplicado al borrador (undo del borrador, no del publicado). */
  async discardLast(
    storeId: number,
    conversationId: number,
    expectedAppKind?: DesignChatAppKind,
  ): Promise<VexDesignDiscardResult> {
    const session = await this.loadSession(storeId, conversationId);
    if (!session) {
      return {
        ok: false,
        error: 'No hay una sesión de diseño activa para esta conversación.',
      };
    }
    if (expectedAppKind && session.app_kind !== expectedAppKind) {
      return {
        ok: false,
        error: `La conversación pertenece a "${session.app_kind}" y no a "${expectedAppKind}".`,
      };
    }
    if (session.history.length === 0) {
      return {
        ok: false,
        error: 'No hay cambios recientes en el borrador para descartar.',
      };
    }

    const nextHistory = [...session.history];
    const popped = nextHistory.pop()!;
    const restored = cloneDoc(popped.previous);

    const updatedSession: VexDesignSession = {
      ...session,
      current_document: restored,
      history: nextHistory,
      updated_at: new Date().toISOString(),
    };
    await this.saveSession(updatedSession);

    return {
      ok: true,
      app_kind: session.app_kind,
      document: cloneDoc(restored),
      discarded_summary: popped.summary,
      touched_block_id: popped.touched_block_id,
      history_depth: nextHistory.length,
      can_discard: nextHistory.length > 0,
    };
  }

  /** Revierte el borrador al documento previo al inicio de la conversación. */
  async resetToInitial(
    storeId: number,
    conversationId: number,
    expectedAppKind?: DesignChatAppKind,
  ): Promise<VexDesignResetResult> {
    const session = await this.loadSession(storeId, conversationId);
    if (!session) {
      return {
        ok: false,
        error: 'No hay una sesión de diseño activa para esta conversación.',
      };
    }
    if (expectedAppKind && session.app_kind !== expectedAppKind) {
      return {
        ok: false,
        error: `La conversación pertenece a "${session.app_kind}" y no a "${expectedAppKind}".`,
      };
    }

    const restored = cloneDoc(session.initial_document);
    const updatedSession: VexDesignSession = {
      ...session,
      current_document: restored,
      history: [],
      updated_at: new Date().toISOString(),
    };
    await this.saveSession(updatedSession);

    return {
      ok: true,
      app_kind: session.app_kind,
      document: cloneDoc(restored),
      history_depth: 0,
      can_discard: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Operaciones acotadas
  // ---------------------------------------------------------------------------

  private applySetTheme(
    draft: AppPageDocument,
    op: VexDesignSetThemeOp,
  ): { ok: true; summary: string } | { ok: false; error: string } {
    if (!isPlainObject(op.tokens) || Object.keys(op.tokens).length === 0) {
      return {
        ok: false,
        error: 'Debes indicar al menos un token de tema en "tokens".',
      };
    }

    const nextTheme: Record<string, unknown> = { ...(draft.theme ?? {}) };
    const changedLabels: string[] = [];

    for (const [key, value] of Object.entries(op.tokens)) {
      if (!(key in APP_THEME_FIELDS)) {
        return {
          ok: false,
          error: `El token de tema "${key}" no existe en el catálogo permitido.`,
        };
      }
      if (value === null || value === '') {
        delete nextTheme[key];
        changedLabels.push(`${THEME_TOKEN_LABELS[key] ?? key} restaurado`);
      } else {
        nextTheme[key] = value;
        changedLabels.push(
          `${THEME_TOKEN_LABELS[key] ?? key}: ${String(value)}`,
        );
      }
    }

    if (Object.keys(nextTheme).length > 0) {
      draft.theme = nextTheme as AppPageDocument['theme'];
    } else {
      delete draft.theme;
    }

    return {
      ok: true,
      summary: `Tema: ${changedLabels.join('; ')}`,
    };
  }

  private applySetBlockProp(
    appKind: DesignChatAppKind,
    draft: AppPageDocument,
    op: VexDesignSetBlockPropOp,
  ):
    | { ok: true; summary: string; touchedBlockId: string }
    | { ok: false; error: string } {
    const blockId = typeof op.block_id === 'string' ? op.block_id.trim() : '';
    const prop = typeof op.prop === 'string' ? op.prop.trim() : '';
    if (!blockId || !prop) {
      return {
        ok: false,
        error: 'Debes indicar "block_id" y "prop" para modificar una propiedad.',
      };
    }

    // Caso 1: portada virtual (`hero`).
    if (blockId === 'hero') {
      const fieldSpec = APP_HERO_FIELDS[prop];
      if (!fieldSpec) {
        return {
          ok: false,
          error: `La propiedad "${prop}" no existe en el catálogo de la portada (hero).`,
        };
      }
      // Las imágenes deben ir por `set_block_media` (nunca URLs externas libres).
      if (URL_PROP_KINDS.has(fieldSpec.kind) && op.value !== null && op.value !== '') {
        return {
          ok: false,
          error: `Para cambiar la imagen "${prop}" usa la operación "set_block_media" con un media_id de la galería de la tienda, nunca una URL directa.`,
        };
      }
      const nextHero: Record<string, unknown> = { ...(draft.hero ?? {}) };
      if (op.value === null || op.value === '') {
        delete nextHero[prop];
      } else {
        nextHero[prop] = op.value;
      }
      if (Object.keys(nextHero).length > 0) {
        draft.hero = nextHero as AppPageDocument['hero'];
      } else {
        delete draft.hero;
      }
      return {
        ok: true,
        touchedBlockId: 'hero',
        summary: `Portada: ${this.describePropChange(prop, op.value)}`,
      };
    }

    // Caso 2: bloque dentro de `blocks[]`.
    const block = draft.blocks.find((b) => b.id === blockId);
    if (!block) {
      return {
        ok: false,
        error: `No existe ningún bloque con id "${blockId}" en el borrador.`,
      };
    }

    if (prop === 'enabled') {
      if (typeof op.value !== 'boolean') {
        return {
          ok: false,
          error: 'La propiedad "enabled" debe ser verdadero o falso.',
        };
      }
      block.enabled = op.value;
      return {
        ok: true,
        touchedBlockId: block.id,
        summary: `${blockLabel(block.type)}: ${op.value ? 'visible' : 'oculto'}`,
      };
    }

    const blockSpec = APP_PAGE_BLOCKS[appKind][block.type];
    const fieldSpec = blockSpec?.[prop];
    if (!fieldSpec) {
      return {
        ok: false,
        error: `La propiedad "${prop}" no existe en el catálogo del bloque "${block.type}".`,
      };
    }

    if (
      URL_PROP_KINDS.has(fieldSpec.kind) &&
      op.value !== null &&
      op.value !== '' &&
      !(Array.isArray(op.value) && op.value.length === 0)
    ) {
      return {
        ok: false,
        error: `Para asignar imágenes en "${prop}" usa la operación "set_block_media" con un media_id de la galería de la tienda.`,
      };
    }

    // Si es lista de ítems con campos `url` (ej. `highlights.items[].image_url` o `team.items[].photo_url`),
    // impedimos inyectar URLs externas por esta vía.
    if (fieldSpec.kind === 'list' && Array.isArray(op.value)) {
      const urlKeys = Object.entries(fieldSpec.item)
        .filter(([, sub]) => sub.kind === 'url')
        .map(([k]) => k);
      if (urlKeys.length > 0) {
        for (const item of op.value) {
          if (!isPlainObject(item)) continue;
          for (const key of urlKeys) {
            if (typeof item[key] === 'string' && item[key].trim()) {
              return {
                ok: false,
                error: `Las imágenes de "${prop}.${key}" solo pueden asignarse desde la galería con "set_block_media".`,
              };
            }
          }
        }
      }
    }

    const nextProps: Record<string, unknown> = { ...block.props };
    if (op.value === null || op.value === '') {
      delete nextProps[prop];
    } else {
      nextProps[prop] = op.value;
    }
    block.props = nextProps;

    return {
      ok: true,
      touchedBlockId: block.id,
      summary: `${blockLabel(block.type)}: ${this.describePropChange(prop, op.value)}`,
    };
  }

  private async applySetBlockMedia(
    session: VexDesignSession,
    draft: AppPageDocument,
    op: VexDesignSetBlockMediaOp,
  ): Promise<
    | { ok: true; summary: string; touchedBlockId: string }
    | { ok: false; error: string }
  > {
    if (op.url !== undefined) {
      return {
        ok: false,
        error:
          'No se permiten URLs externas. Usa únicamente un "media_id" de la galería de la tienda.',
      };
    }

    if (
      typeof op.media_id !== 'number' ||
      !Number.isInteger(op.media_id) ||
      op.media_id < 1
    ) {
      return {
        ok: false,
        error:
          'Debes indicar un "media_id" entero positivo de la galería de la tienda (nunca una URL externa).',
      };
    }

    const blockId = typeof op.block_id === 'string' ? op.block_id.trim() : '';
    if (!blockId) {
      return {
        ok: false,
        error: 'Debes indicar el "block_id" donde se colocará la imagen.',
      };
    }

    // Validación estricta de tenant: solo imágenes activas de ESTA tienda.
    const media = await this.prisma.store_app_media.findFirst({
      where: {
        id: op.media_id,
        store_id: session.store_id,
        kind: 'image',
        deleted_at: null,
      },
      select: { id: true, public_token: true, alt: true },
    });

    if (!media) {
      return {
        ok: false,
        error: `No encontré la imagen #${op.media_id} en la galería de esta tienda.`,
      };
    }

    const stableUrl = this.buildStableMediaUrl(
      media.public_token,
      session.media_base_url,
    );
    const imageLabel = media.alt ? `imagen «${media.alt}»` : `imagen de la galería (#${media.id})`;

    // Portada (`hero`)
    if (blockId === 'hero') {
      const targetProp = op.prop?.trim() || 'image_url';
      if (targetProp !== 'image_url' && targetProp !== 'background_image_url') {
        return {
          ok: false,
          error: `La portada solo admite imágenes en "image_url" o "background_image_url", no en "${targetProp}".`,
        };
      }
      draft.hero = {
        ...(draft.hero ?? {}),
        [targetProp]: stableUrl,
      };
      return {
        ok: true,
        touchedBlockId: 'hero',
        summary:
          targetProp === 'background_image_url'
            ? `Portada: fondo con ${imageLabel}`
            : `Portada: ${imageLabel}`,
      };
    }

    const block = draft.blocks.find((b) => b.id === blockId);
    if (!block) {
      return {
        ok: false,
        error: `No existe ningún bloque con id "${blockId}" en el borrador.`,
      };
    }

    const blockSpec = APP_PAGE_BLOCKS[session.app_kind][block.type];
    const targetProp =
      op.prop?.trim() ||
      (block.type === 'gallery'
        ? 'image_urls'
        : blockSpec?.['image_url']
          ? 'image_url'
          : 'background_image_url');

    // Caso 1: `gallery.image_urls`
    if (targetProp === 'image_urls') {
      const field = blockSpec?.['image_urls'];
      if (!field || field.kind !== 'url_list') {
        return {
          ok: false,
          error: `El bloque "${block.type}" no admite una lista de imágenes en "image_urls".`,
        };
      }
      const current = Array.isArray(block.props['image_urls'])
        ? [...(block.props['image_urls'] as string[])]
        : [];
      if (
        typeof op.item_index === 'number' &&
        Number.isInteger(op.item_index) &&
        op.item_index >= 0 &&
        op.item_index < current.length
      ) {
        current[op.item_index] = stableUrl;
      } else {
        if (current.length >= field.max) {
          return {
            ok: false,
            error: `La galería ya alcanzó el máximo de ${field.max} imágenes.`,
          };
        }
        current.push(stableUrl);
      }
      block.props = { ...block.props, image_urls: current };
      return {
        ok: true,
        touchedBlockId: block.id,
        summary: `${blockLabel(block.type)}: ${imageLabel}`,
      };
    }

    // Caso 2: imagen dentro de `items[item_index]` (ej. `highlights.items[].image_url` o `team.items[].photo_url`)
    if (
      (targetProp === 'items.image_url' || targetProp === 'items.photo_url') &&
      blockSpec?.['items']?.kind === 'list'
    ) {
      const subKey = targetProp.split('.')[1];
      const listSpec = blockSpec['items'];
      if (listSpec.item[subKey]?.kind !== 'url') {
        return {
          ok: false,
          error: `El bloque "${block.type}" no admite imágenes en "${targetProp}".`,
        };
      }
      const items = Array.isArray(block.props['items'])
        ? [...(block.props['items'] as Array<Record<string, unknown>>)]
        : [];
      const index = op.item_index ?? 0;
      if (!Number.isInteger(index) || index < 0 || index >= items.length) {
        return {
          ok: false,
          error: `El elemento ${index} no existe en "${block.id}.items".`,
        };
      }
      items[index] = { ...items[index], [subKey]: stableUrl };
      block.props = { ...block.props, items };
      return {
        ok: true,
        touchedBlockId: block.id,
        summary: `${blockLabel(block.type)} (elemento ${index + 1}): ${imageLabel}`,
      };
    }

    // Caso 3: campo escalar `url` del catálogo (`image_url`, `background_image_url`)
    const scalarSpec = blockSpec?.[targetProp];
    if (!scalarSpec || scalarSpec.kind !== 'url' || targetProp === 'map_url') {
      return {
        ok: false,
        error: `La propiedad "${targetProp}" del bloque "${block.type}" no acepta imágenes de la galería.`,
      };
    }

    block.props = { ...block.props, [targetProp]: stableUrl };
    return {
      ok: true,
      touchedBlockId: block.id,
      summary: `${blockLabel(block.type)}: ${imageLabel}`,
    };
  }

  private applyAddBlock(
    appKind: DesignChatAppKind,
    draft: AppPageDocument,
    op: VexDesignAddBlockOp,
  ):
    | { ok: true; summary: string; touchedBlockId: string }
    | { ok: false; error: string } {
    const blockType =
      typeof op.block_type === 'string' ? op.block_type.trim() : '';
    const catalog = APP_PAGE_BLOCKS[appKind];
    if (!blockType || !(blockType in catalog)) {
      return {
        ok: false,
        error: `El tipo de bloque "${blockType}" no está disponible en ${appKind}.`,
      };
    }

    if (draft.blocks.length >= MAX_APP_PAGE_BLOCKS) {
      return {
        ok: false,
        error: `La página ya tiene el máximo permitido de ${MAX_APP_PAGE_BLOCKS} secciones.`,
      };
    }

    if (
      SINGLE_APP_PAGE_BLOCKS[appKind].includes(blockType) &&
      draft.blocks.some((b) => b.type === blockType)
    ) {
      return {
        ok: false,
        error: `La sección "${blockLabel(blockType)}" solo puede aparecer una vez en esta app.`,
      };
    }

    const props = isPlainObject(op.props) ? { ...op.props } : {};
    const spec = catalog[blockType];
    for (const [key, val] of Object.entries(props)) {
      const fieldSpec = spec[key];
      if (!fieldSpec) {
        return {
          ok: false,
          error: `La propiedad "${key}" no existe en el catálogo del bloque "${blockType}".`,
        };
      }
      if (URL_PROP_KINDS.has(fieldSpec.kind) && val !== null && val !== '') {
        return {
          ok: false,
          error: `Para agregar imágenes al bloque usa "set_block_media" después de crearlo.`,
        };
      }
    }

    const id = this.generateBlockId(draft.blocks, blockType, op.id);
    if (!id) {
      return {
        ok: false,
        error: `El identificador "${String(op.id)}" no es válido o ya existe.`,
      };
    }

    const newBlock: AppPageBlock = {
      id,
      type: blockType,
      enabled: op.enabled !== false,
      props,
    };

    const position =
      typeof op.position === 'number' && Number.isInteger(op.position)
        ? Math.max(0, Math.min(draft.blocks.length, op.position))
        : draft.blocks.length;

    draft.blocks.splice(position, 0, newBlock);

    return {
      ok: true,
      touchedBlockId: id,
      summary: `Sección agregada: ${blockLabel(blockType)}`,
    };
  }

  private applyRemoveBlock(
    draft: AppPageDocument,
    op: VexDesignRemoveBlockOp,
  ):
    | { ok: true; summary: string; touchedBlockId: string | null }
    | { ok: false; error: string } {
    const blockId = typeof op.block_id === 'string' ? op.block_id.trim() : '';
    if (!blockId) {
      return { ok: false, error: 'Debes indicar el "block_id" a eliminar.' };
    }
    if (blockId === 'hero') {
      return {
        ok: false,
        error:
          'La portada (hero) no se puede eliminar; puedes ajustar sus campos o limpiarla.',
      };
    }
    const index = draft.blocks.findIndex((b) => b.id === blockId);
    if (index < 0) {
      return {
        ok: false,
        error: `No existe ningún bloque con id "${blockId}" en el borrador.`,
      };
    }
    const [removed] = draft.blocks.splice(index, 1);
    return {
      ok: true,
      touchedBlockId: null,
      summary: `Sección eliminada: ${blockLabel(removed.type)}`,
    };
  }

  private applyReorderBlocks(
    draft: AppPageDocument,
    op: VexDesignReorderBlocksOp,
  ):
    | { ok: true; summary: string; touchedBlockId: string | null }
    | { ok: false; error: string } {
    if (!Array.isArray(op.block_ids) || op.block_ids.length === 0) {
      return {
        ok: false,
        error: 'Debes indicar el nuevo orden completo en "block_ids".',
      };
    }

    const byId = new Map(draft.blocks.map((b) => [b.id, b]));
    const requested = op.block_ids.filter(
      (id): id is string => typeof id === 'string' && id !== 'hero',
    );
    const unique = new Set(requested);

    if (
      unique.size !== draft.blocks.length ||
      requested.length !== draft.blocks.length ||
      requested.some((id) => !byId.has(id))
    ) {
      return {
        ok: false,
        error:
          'El nuevo orden debe incluir exactamente los mismos ids de bloques actuales sin duplicados ni faltantes.',
      };
    }

    draft.blocks = requested.map((id) => byId.get(id)!);
    return {
      ok: true,
      touchedBlockId: draft.blocks[0]?.id ?? null,
      summary: `Secciones reordenadas (${draft.blocks.map((b) => blockLabel(b.type)).join(' → ')})`,
    };
  }

  private applyPreset(
    appKind: DesignChatAppKind,
    draft: AppPageDocument,
    op: VexDesignApplyPresetOp,
  ): { ok: true; summary: string } | { ok: false; error: string } {
    const presetId =
      typeof op.preset_id === 'string' ? op.preset_id.trim() : '';
    const preset = findPresetForApp(appKind, presetId);
    if (!preset) {
      const available = listPresetsForApp(appKind)
        .map((p) => p.id)
        .join(', ');
      return {
        ok: false,
        error: `El preset "${presetId}" no existe para esta app. Disponibles: ${available}.`,
      };
    }

    draft.theme = { ...preset.theme };
    if (preset.hero_defaults) {
      draft.hero = {
        ...(draft.hero ?? {}),
        ...preset.hero_defaults,
      };
    }

    return {
      ok: true,
      summary: `Estilo aplicado: ${preset.name} (${preset.industry})`,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

  private async resolveValidatedDraft(
    storeId: number,
    appKind: DesignChatAppKind,
    draft?: unknown,
  ): Promise<AppPageDocument> {
    if (draft !== undefined && draft !== null) {
      const check = validateAppPage(appKind, draft);
      if (!check.valid || !check.value) {
        throw new Error(
          `El borrador inicial no es válido: ${check.errors.slice(0, 4).join(' ')}`,
        );
      }
      return check.value;
    }

    const row = await this.prisma.store_apps.findFirst({
      where: { store_id: storeId, kind: appKind },
      select: { config: true },
    });
    return readAppPage(appKind, row?.config) ?? emptyDraft();
  }

  private async listStoreGalleryImages(
    storeId: number,
  ): Promise<VexDesignGalleryMediaSummary[]> {
    try {
      const rows = await this.prisma.store_app_media.findMany({
        where: {
          store_id: storeId,
          kind: 'image',
          deleted_at: null,
        },
        orderBy: { id: 'desc' },
        take: 20,
        select: { id: true, alt: true, app_kind: true },
      });
      return rows.map((row) => ({
        id: row.id,
        alt: row.alt,
        app_kind: row.app_kind,
      }));
    } catch {
      return [];
    }
  }

  private buildStableMediaUrl(publicToken: string, baseUrl?: string): string {
    const cleanBase =
      (baseUrl && baseUrl.startsWith('https://')
        ? baseUrl
        : process.env.PUBLIC_API_URL ||
          `https://api.${DomainConfigService.getBaseDomain()}/api`
      ).replace(/\/+$/, '');
    return `${cleanBase}/public/apps/media/${publicToken}`;
  }

  private generateBlockId(
    existing: readonly AppPageBlock[],
    blockType: string,
    requestedId?: string,
  ): string | null {
    const existingIds = new Set(existing.map((b) => b.id));
    if (requestedId !== undefined) {
      const clean = requestedId.trim().toLowerCase();
      if (
        !BLOCK_ID_SAFE_RE.test(clean) ||
        clean === 'hero' ||
        existingIds.has(clean)
      ) {
        return null;
      }
      return clean;
    }
    const base = blockType.replace(/_/g, '-');
    if (!existingIds.has(base)) return base;
    for (let i = 2; i <= 50; i++) {
      const candidate = `${base}-${i}`;
      if (!existingIds.has(candidate)) return candidate;
    }
    return null;
  }

  private describePropChange(prop: string, value: unknown): string {
    if (value === null || value === '') return `${prop} limpiado`;
    if (prop === 'background_color') return `fondo ${String(value)}`;
    if (prop === 'variant') return `diseño ${String(value)}`;
    if (prop === 'title') return `título «${String(value).slice(0, 40)}»`;
    if (prop === 'subtitle') return `subtítulo actualizado`;
    if (prop === 'overlay_opacity') return `velo ${String(value)} %`;
    return `${prop} actualizado`;
  }

  private sessionKey(storeId: number, conversationId: number): string {
    return `vex:design-session:${storeId}:${conversationId}`;
  }

  private async loadSession(
    storeId: number,
    conversationId: number,
  ): Promise<VexDesignSession | null> {
    const key = this.sessionKey(storeId, conversationId);
    if (this.redis) {
      try {
        const raw = await this.redis.get(key);
        if (raw) {
          const parsed = JSON.parse(raw) as VexDesignSession;
          if (parsed.store_id === storeId) {
            this.memorySessions.set(key, parsed);
            return parsed;
          }
          return null;
        }
      } catch (err) {
        this.logger.warn(
          `Redis read fallback for ${key}: ${(err as Error).message}`,
        );
      }
    }
    const cached = this.memorySessions.get(key) ?? null;
    return cached && cached.store_id === storeId ? cached : null;
  }

  private async saveSession(session: VexDesignSession): Promise<void> {
    const key = this.sessionKey(session.store_id, session.conversation_id);
    this.memorySessions.set(key, session);
    if (this.redis) {
      try {
        await this.redis.set(
          key,
          JSON.stringify(session),
          'EX',
          SESSION_TTL_SECONDS,
        );
      } catch (err) {
        this.logger.warn(
          `Redis write fallback for ${key}: ${(err as Error).message}`,
        );
      }
    }
  }
}
