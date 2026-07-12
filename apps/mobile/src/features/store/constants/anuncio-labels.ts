/**
 * Labels y constantes del módulo Marketing — Anuncios.
 *
 * Mirror verbatim del web (`apps/frontend/src/app/private/modules/store/marketing/anuncios/`).
 * Single source of truth para mobile — los strings NUNCA se localizan al vuelo.
 *
 * Mantén sincronizado este archivo con el reporte de paridad
 * `docs/parity-audit-anuncios.md` §14 (Toast & feedback copy).
 */

import type {
  AdCreativeFormat,
  AdCreativeStatus,
} from '@/features/store/types/anuncios.types';

export const ANUNCIO_LABELS = {
  // Header / titles
  title: 'Anuncios',
  titleSingular: 'Anuncio',
  pluralLabel: 'Anuncios',

  // Sticky header wizard
  wizardTitle: 'Crear anuncio',
  wizardSubtitle: 'Crea una imagen y un post listo para publicar.',
  wizardStepCreate: 'Crear',
  wizardStepResult: 'Resultado',

  // CTAs / botones
  ctaNew: 'Nuevo anuncio',
  ctaCreate: 'Crear anuncio',
  ctaGenerate: 'Generar anuncio',
  ctaRegenerate: 'Regenerar',
  ctaRegenerateWithCorrection: 'Regenerar con correccion',
  ctaCreateAnother: 'Crear otro',
  ctaViewLibrary: 'Ver biblioteca',
  ctaEdit: 'Editar',
  ctaCancel: 'Cancelar',
  ctaOpenStore: 'Abrir tienda',
  ctaListo: 'Listo',
  ctaCopy: 'Copiar',
  ctaDownload: 'Descargar',
  ctaShare: 'Compartir',
  ctaClose: 'Cerrar',
  ctaAgregar: 'Agregar',
  ctaSuggest: 'Sugerir',
  ctaGaleria: 'Galeria',
  ctaProductos: 'Productos',
  ctaSearch: 'Buscar anuncios...',
  ctaSearchProducts: 'Buscar productos o servicios...',
  ctaRefresh: 'Actualizar',
  ctaClearFilters: 'Limpiar filtros',

  // Sections / cards
  sectionResumen: 'Resumen',
  sectionProductos: 'Productos',
  sectionRecursos: 'Recursos seleccionados',
  sectionIdentidad: 'Identidad',
  sectionFormato: 'Formato',
  sectionVigencia: 'Vigencia',
  sectionPost: 'Post sugerido',
  sectionProductosElegibles: 'Productos',
  formatLabel: 'Formato',

  // Form fields
  fieldFormat: 'Formato',
  fieldPrompt: 'Idea o instrucciones',
  fieldTitle: 'Titulo',
  fieldDescription: 'Descripcion',
  fieldCorrection: 'Que quieres corregir?',

  // Stats
  statsTotal: 'Anuncios',
  statsTotalSmall: 'Creatividades creadas',
  statsCompleted: 'Listos',
  statsCompletedSmall: 'Disponibles para publicar',
  statsProcessing: 'Procesando',
  statsProcessingSmall: 'Generaciones activas',
  statsFailed: 'Fallidos',
  statsFailedSmall: 'Requieren reintento',

  // States table
  stateDraft: 'Borrador',
  stateProcessing: 'Procesando',
  stateCompleted: 'Listo',
  stateFailed: 'Fallido',

  // Formats table
  formatSquare: 'Feed cuadrado',
  formatStory: 'Historia vertical',
  formatLandscape: 'Banner horizontal',
  // Formats wizard
  formatSquareShort: '1:1 Feed',
  formatStoryShort: '9:16 Story',
  formatLandscapeShort: '16:9 Banner',

  // Status select
  statusAll: 'Todos',
  statusDraft: 'Borrador',
  statusProcessing: 'Procesando',
  statusCompleted: 'Listos',
  statusFailed: 'Fallidos',

  // Empty / loading
  loading: 'Cargando anuncios...',
  loadingProducts: 'Cargando productos...',
  emptyTitle: 'No se encontraron anuncios',
  emptyDescription: 'Comienza creando un nuevo anuncio.',
  emptyNoAnuncios: 'Aun no tienes anuncios',
  emptyNoAnunciosDesc:
    'Selecciona productos, agrega una idea y deja que la IA genere una pieza visual lista para compartir.',
  emptyNoAnunciosForFilters: 'Sin anuncios para estos filtros',
  emptyNoAnunciosForFiltersDesc:
    'Ajusta la busqueda o limpia los filtros para ver otros anuncios.',
  emptyNoAnunciosLoad: 'No se pudieron cargar los anuncios',
  emptyNoProducts: 'Sin resultados',
  emptyNoProductsDesc: 'Prueba con otro nombre o SKU.',
  emptyNoProductsLoad: 'No se pudieron cargar productos',
  emptyNoResources: 'Aun no hay recursos disponibles',
  emptyNoResourcesDesc:
    'Agrega productos o sube recursos para verlos aqui.',
  emptyNoResourcesSelected: 'Aun no has elegido fotos, logos o QR.',
  emptyNoProductsSelected: 'Aun no has agregado productos.',
  emptyImagenNo: 'Este anuncio aun no tiene imagen generada.',

  // Wizard hero / sidebar
  wizardHeroTitle: 'Que quieres comunicar?',
  wizardHeroHelper:
    'Elige el formato, describe tu idea, agrega imagenes, productos o un QR, y genera el anuncio con Vendix IA.',
  qrSelectedNotice:
    'El QR seleccionado se insertara identico en la imagen final, con buen contraste y sin tapar el diseno.',
  qrExactIncluded: 'QR exacto incluido',
  selected: 'seleccionados',
  chosen: 'elegidos',
  referenceVisual: 'Referencia visual',
  qrExact: 'QR exacto',
  productPhoto: 'Foto de producto',

  // Modal titles
  modalGenerationTitle: 'Generando anuncio',
  modalPreviewTitleFallback: 'Anuncio',
  modalCorrectionTitle: 'Regenerar con correccion',
  modalCorrectionSubtitle:
    'Describe que debe ajustar la IA y se generara sobre el mismo anuncio.',
  modalProductsTitle: 'Agregar productos',
  modalProductsSubtitle: 'Elige solo lo que debe influir en el anuncio.',
  modalGalleryTitle: 'Galeria de recursos disponibles',
  modalGallerySubtitle:
    'Logo, QR, sliders, fotos propias y las imagenes de tus productos para guiar la pieza visual.',
  modalProductsAndServices: 'Productos y servicios',

  // Result stage
  resultStageGenerating: 'Generando tu anuncio',
  resultStageReady: 'Tu anuncio esta listo',
  resultReadySubtitle: 'Copia el post o vuelve a la biblioteca.',
  postReady: 'Post listo',
  postForPublish: 'Post para publicar',
  postSuggested: 'Post sugerido',
  postPending: 'Redactando post...',
  postPendingHint:
    'El texto del post se genera cuando la imagen este lista.',
  postErrorHint: 'Sin post aun: se genera tras una imagen exitosa.',
  resultPanelTitle: 'Resultado',
  resultPanelGenerating: 'Anuncio listo',

  // Generation messages
  generationPreparing: 'Preparando recursos...',
  generationReception: 'Recibiendo vista previa...',
  generationReady: 'Anuncio listo.',

  // Dialogs
  dialogDeleteTitle: 'Eliminar anuncio',
  dialogDeleteMessageTemplate: 'Se eliminara "{title}".',
  dialogDeleteConfirm: 'Eliminar',
  dialogDeleteDeny: 'Cancelar',

  // Filter sections
  filterState: 'Estado',
  filterAll: 'Todos',
  filterClear: 'Limpiar filtros',

  // Acciones por fila
  rowView: 'Ver',
  rowCopy: 'Copiar',
  rowDownload: 'Descargar',
  rowShare: 'Compartir',
  rowDelete: 'Eliminar',

  // Toasts (success)
  toastDeleted: 'Anuncio eliminado.',
  toastImageDownloaded: 'Imagen descargada.',
  toastImageCopied: 'Imagen copiada.',
  toastLinkCopied: 'Enlace copiado.',
  toastLinkCopiedForShare: 'Enlace copiado para compartir.',
  toastPostCopied: 'Post copiado.',

  // Toasts (error)
  toastErrGenerate: 'No se pudo generar la imagen.',
  toastErrConnectStream: 'No se pudo conectar con la generacion.',
  toastErrDownload: 'No se pudo descargar la imagen.',
  toastErrShare: 'No se pudo compartir la imagen.',
  toastErrCopy: 'No se pudo copiar la imagen.',
  toastErrReadStream: 'No se pudo leer el stream de generacion.',
  toastErrLostStream: 'Se perdio la conexion con el stream.',
  toastErrSuggest: 'No se pudo sugerir el anuncio.',
  toastErrCreate: 'Error al crear anuncio',
  toastErrUpdate: 'Error al actualizar anuncio',
  toastErrDelete: 'Error al eliminar anuncio',
  toastErrLoad: 'Error al cargar anuncios',
  toastErrSummary: 'Error al cargar resumen',
  toastErrEcommerce: 'No hay dominio ecommerce activo.',
  toastErrDefault: 'Ocurrio un error. Intente de nuevo.',

  // Defaults
  defaultTitleDate: (when: string) => `Anuncio ${when}`,
  defaultDescription: (when: string) => `Creado desde Anuncios el ${when}.`,
} as const;

export const ANUNCIO_STATE_LABEL: Record<AdCreativeStatus, string> = {
  draft: ANUNCIO_LABELS.stateDraft,
  processing: ANUNCIO_LABELS.stateProcessing,
  completed: ANUNCIO_LABELS.stateCompleted,
  failed: ANUNCIO_LABELS.stateFailed,
};

export const ANUNCIO_FORMAT_LABEL: Record<AdCreativeFormat, string> = {
  square: ANUNCIO_LABELS.formatSquare,
  story: ANUNCIO_LABELS.formatStory,
  landscape: ANUNCIO_LABELS.formatLandscape,
};

export const ANUNCIO_FORMAT_SHORT_LABEL: Record<AdCreativeFormat, string> = {
  square: ANUNCIO_LABELS.formatSquareShort,
  story: ANUNCIO_LABELS.formatStoryShort,
  landscape: ANUNCIO_LABELS.formatLandscapeShort,
};

/**
 * colorMap mirrors the web badge custom colors
 * (`apps/frontend/.../anuncios.component.ts:472-477`) so the mobile Badge
 * component renders the exact same visual treatment.
 */
export const ANUNCIO_STATE_BADGE_COLOR: Record<
  AdCreativeStatus,
  { fg: string; bg: string }
> = {
  draft: { fg: '#6b7280', bg: '#f3f4f6' },
  processing: { fg: '#f59e0b', bg: '#fef3c7' },
  completed: { fg: '#22c55e', bg: '#dcfce7' },
  failed: { fg: '#ef4444', bg: '#fee2e2' },
};

export const ANUNCIO_STATS_COLOR: Record<
  'total' | 'completed' | 'processing' | 'failed',
  { fg: string; bg: string }
> = {
  total: { fg: '#0284c7', bg: '#e0f2fe' },
  completed: { fg: '#059669', bg: '#d1fae5' },
  processing: { fg: '#d97706', bg: '#fef3c7' },
  failed: { fg: '#dc2626', bg: '#fee2e2' },
};

export const ANUNCIO_FORMAT_OPTIONS: ReadonlyArray<{
  value: AdCreativeFormat;
  label: string;
  icon: string;
}> = [
  { value: 'square', label: ANUNCIO_FORMAT_SHORT_LABEL.square, icon: 'layout-grid' },
  { value: 'story', label: ANUNCIO_FORMAT_SHORT_LABEL.story, icon: 'smartphone' },
  { value: 'landscape', label: ANUNCIO_FORMAT_SHORT_LABEL.landscape, icon: 'monitor' },
];

export const ANUNCIO_INTENT_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
  icon: string;
}> = [
  { value: 'highlight_store', label: 'Tienda', icon: 'store' },
  { value: 'highlight_product', label: 'Producto/servicio', icon: 'package' },
  { value: 'announcement', label: 'Novedad', icon: 'megaphone' },
  { value: 'contact', label: 'Contacto', icon: 'message-square' },
  { value: 'promotion', label: 'Promocion', icon: 'tag' },
  { value: 'qr', label: 'QR', icon: 'barcode' },
];

export type AnuncioIntent = (typeof ANUNCIO_INTENT_OPTIONS)[number]['value'];
