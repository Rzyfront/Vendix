import { AI_SCAN_KIND_LABELS } from '../ai-scan-jobs/ai-scan-sources';
import { stripApiPrefix } from './platform-alert-policy';

/**
 * CATÁLOGO DE PROCESOS DEL BOT DE MONITOREO (QUI-1031).
 *
 * Traduce lo que vio el bot (cola + trabajo + `data`, o método + ruta HTTP) a
 * lo que entiende una persona: el módulo de Vendix, la acción que se estaba
 * haciendo y el registro afectado. Una cola nueva necesita su entrada aquí:
 * `platform-alert-catalog.spec.ts` lee los `registerQueue` del código y falla
 * si alguna falta.
 */

/** Registros que la alerta sabe nombrar. */
export type AlertEntityType =
  | 'product'
  | 'customer'
  | 'order'
  | 'supplier'
  | 'expense'
  | 'purchase_order'
  | 'received_document'
  | 'subscription_invoice'
  | 'accounting_entry_failure'
  | 'bulk_upload'
  | 'dian_config'
  | 'tra_submission'
  | 'crm_message'
  | 'reception_sync_run'
  | 'agent_task';

export const ENTITY_LABELS: Record<AlertEntityType, string> = {
  product: 'producto',
  customer: 'cliente',
  order: 'orden',
  supplier: 'proveedor',
  expense: 'gasto',
  purchase_order: 'orden de compra',
  received_document: 'documento recibido',
  subscription_invoice: 'factura de suscripción',
  accounting_entry_failure: 'asiento automático fallido',
  bulk_upload: 'carga masiva',
  dian_config: 'configuración DIAN',
  tra_submission: 'registro TRA',
  crm_message: 'mensaje de WhatsApp',
  reception_sync_run: 'sincronización de documentos',
  agent_task: 'tarea de Vexi',
};

export interface AlertEntityRef {
  type: AlertEntityType;
  id: number;
}

export interface ProcessDescription {
  /** Módulo de Vendix («Productos», «Compras»…). */
  module: string;
  /** Lo que se estaba haciendo, en minúscula («indexar el producto…»). */
  action: string;
  entity: AlertEntityRef | null;
  /**
   * Funcionalidad de IA cuyo cupo consume (`FEATURE_QUOTA_CONFIG`), para
   * decir qué cupo se agotó en una alerta «Límite de plan».
   */
  aiFeature: string | null;
}

type JobData = Record<string, unknown>;

interface JobEntry {
  module?: string;
  action: string;
  aiFeature?: string;
}

interface QueueEntry {
  module: string;
  action: string;
  aiFeature?: string;
  /** Acción por nombre de trabajo, cuando la cola tiene varios. */
  jobs?: Record<string, JobEntry>;
  /** Acción según el `data` (gana a `jobs`). */
  describe?: (jobName: string, data: JobData) => Partial<JobEntry> | null;
  entity?: (data: JobData) => AlertEntityRef | null;
}

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Lee el primer id válido de `keys` en `data` (o en `data.context`). */
function entityFrom(type: AlertEntityType, ...keys: string[]) {
  return (data: JobData): AlertEntityRef | null => {
    const context =
      data.context && typeof data.context === 'object'
        ? (data.context as JobData)
        : {};
    for (const key of keys) {
      const id = positiveId(data[key]) ?? positiveId(context[key]);
      if (id) return { type, id };
    }
    return null;
  };
}

/** Lo que se indexa para la búsqueda con IA (`entity_type` de `ai-embedding`). */
const EMBEDDING_ENTITIES: Record<
  string,
  { type: AlertEntityType; module: string; noun: string }
> = {
  product: { type: 'product', module: 'Productos', noun: 'el producto' },
  customer: { type: 'customer', module: 'Clientes', noun: 'el cliente' },
  order: { type: 'order', module: 'Ventas', noun: 'la orden' },
  supplier: { type: 'supplier', module: 'Proveedores', noun: 'el proveedor' },
  expense: { type: 'expense', module: 'Gastos', noun: 'el gasto' },
};

const SUBSCRIPTION_EMAILS: Record<string, string> = {
  'trial.ending.email': 'avisar que la prueba gratis está por terminar',
  'subscription.payment-method-expiring.email':
    'avisar que el medio de pago está por vencer',
  'subscription.payment-method-expired.email': 'avisar que el medio de pago venció',
  'subscription.payment-method-invalidated-failures.email':
    'avisar que el medio de pago se invalidó por cobros fallidos',
  'subscription.archived-plan-ending.email':
    'avisar que el plan archivado está por terminar',
  'dunning.soft.email': 'enviar el recordatorio de pago pendiente',
  'dunning.hard.email': 'enviar el aviso de mora',
  'subscription.suspended.email': 'avisar la suspensión de la suscripción',
  'subscription.billing.renewal-failed.email': 'avisar que falló la renovación',
  'subscription.billing.no-credential.email':
    'avisar que no hay medio de pago para renovar',
  'subscription.billing.auto-renew-rearmed.email':
    'avisar que la renovación automática se reactivó',
  'payment.confirmed.email': 'confirmar el pago de la suscripción',
  'subscription.welcome.email': 'dar la bienvenida a la suscripción',
  'subscription.cancellation.email': 'confirmar la cancelación de la suscripción',
  'subscription.reactivation.email': 'confirmar la reactivación de la suscripción',
};

const subscriptionInvoice = entityFrom('subscription_invoice', 'invoiceId', 'invoice_id');

/** Una entrada por cola registrada (nombre de `registerQueue`). */
export const QUEUE_CATALOG: Readonly<Record<string, QueueEntry>> = {
  'ai-embedding': {
    module: 'Búsqueda con IA',
    action: 'indexar contenido para la búsqueda con IA',
    // Sin `aiFeature`: la indexación ya no consume cupo de IA (2026-11-24), así
    // que sus alertas no deben hablar de un plan agotado.
    describe: (jobName, data) => {
      if (jobName === 'index-knowledge') {
        return {
          module: 'Vexi',
          action: 'indexar el catálogo de herramientas y procesos del agente',
        };
      }
      const target = EMBEDDING_ENTITIES[String(data.entity_type ?? '')];
      if (!target) return null;
      return {
        module: target.module,
        action:
          jobName === 'delete-embedding'
            ? `quitar ${target.noun} del índice de búsqueda con IA`
            : `indexar ${target.noun} para la búsqueda con IA`,
      };
    },
    entity: (data) => {
      const target = EMBEDDING_ENTITIES[String(data.entity_type ?? '')];
      const id = positiveId(data.entity_id);
      return target && id ? { type: target.type, id } : null;
    },
  },
  'ai-generation': {
    module: 'Motor de IA',
    action: 'ejecutar una generación de IA en segundo plano',
    aiFeature: 'async_queue',
  },
  'ai-agent': {
    module: 'Vexi',
    action: 'ejecutar una tarea del agente en segundo plano',
    aiFeature: 'tool_agents',
    entity: entityFrom('agent_task', 'task_id'),
  },
  'ai-recipe-miner': {
    module: 'Vexi',
    action: 'aprender un proceso del agente (memoria procedimental)',
    jobs: {
      'mine-recipe': { action: 'aprender un proceso del agente (memoria procedimental)' },
      'index-recipe': { action: 'indexar un proceso aprendido del agente' },
    },
  },
  'ai-scan': {
    module: 'Escaneo con IA',
    action: 'procesar un archivo con IA',
    describe: (jobName, data) => {
      const kind = String(data.kind ?? jobName);
      const label = AI_SCAN_KIND_LABELS[kind as keyof typeof AI_SCAN_KIND_LABELS];
      return label ? { action: label } : null;
    },
  },
  'invoice-scan': {
    module: 'Compras',
    action: 'escanear con IA la factura de compra',
  },
  'invoice-revalidate': {
    module: 'Compras',
    action: 'revalidar con IA la factura de compra',
  },
  'payment-receipt-scan': {
    module: 'Compras',
    action: 'escanear con IA el comprobante de pago de la orden de compra',
  },
  'purchase-order-receive': {
    module: 'Compras',
    action: 'recibir la mercancía de la orden de compra',
    entity: entityFrom('purchase_order', 'purchase_order_id'),
  },
  'expense-scan': {
    module: 'Gastos',
    action: 'escanear con IA el recibo del gasto',
  },
  'receipt-scan': {
    module: 'Remisiones',
    action: 'escanear con IA el comprobante de la remisión',
  },
  'received-document-scan': {
    module: 'Documentos recibidos',
    action: 'leer con IA el documento electrónico recibido',
    entity: entityFrom('received_document', 'document_id'),
  },
  'document-reception-sync': {
    module: 'Documentos recibidos',
    action: 'sincronizar la recepción de documentos con el proveedor',
    entity: entityFrom('reception_sync_run', 'run_id'),
  },
  'crm-landing': {
    module: 'CRM',
    action: 'generar con IA la página de aterrizaje',
  },
  'crm-inbound': {
    module: 'CRM (WhatsApp)',
    action: 'procesar un mensaje entrante de WhatsApp',
  },
  'crm-outbound': {
    module: 'CRM (WhatsApp)',
    action: 'enviar un mensaje de WhatsApp',
    entity: entityFrom('crm_message', 'message_id'),
  },
  'bulk-upload-jobs': {
    module: 'Cargas masivas',
    action: 'ejecutar la carga masiva',
    describe: (_jobName, data) =>
      typeof data.upload_type === 'string' && data.upload_type
        ? { action: `ejecutar la carga masiva de ${data.upload_type.replace(/[_-]+/g, ' ')}` }
        : null,
    entity: entityFrom('bulk_upload', 'log_id'),
  },
  'dian-test-set': {
    module: 'Facturación electrónica DIAN',
    action: 'ejecutar el set de pruebas de habilitación DIAN',
    entity: entityFrom('dian_config', 'config_id'),
  },
  'accounting-entry-retry': {
    module: 'Contabilidad',
    action: 'reintentar un asiento contable automático',
    entity: entityFrom('accounting_entry_failure', 'failure_id'),
  },
  'lodging-tra': {
    module: 'Hotelería',
    action: 'enviar el registro de huéspedes al TRA',
    entity: entityFrom('tra_submission', 'submission_id'),
  },
  'subscription-payment-retry': {
    module: 'Suscripción',
    action: 'reintentar el cobro de la factura de suscripción',
    jobs: {
      'manual-retry': {
        action: 'reintentar a mano el cobro de la factura de suscripción',
      },
    },
    entity: subscriptionInvoice,
  },
  'commission-accrual': {
    module: 'Suscripción (aliados)',
    action: 'causar la comisión del aliado por la factura',
    entity: subscriptionInvoice,
  },
  'billing-warning': {
    module: 'Suscripción',
    action: 'avisar a la tienda que falló la renovación',
    entity: subscriptionInvoice,
  },
  'email-notifications': {
    module: 'Correos de suscripción',
    action: 'enviar un correo de suscripción',
    describe: (jobName) => ({
      action: SUBSCRIPTION_EMAILS[jobName] ?? `enviar el correo «${jobName}»`,
    }),
    entity: subscriptionInvoice,
  },
};

/**
 * Módulo, acción y registro de un trabajo. Una cola sin entrada sigue siendo
 * legible: «Cola <nombre>» y «ejecutar el trabajo <nombre>».
 */
export function describeJob(
  queue: string,
  jobName: string,
  data: unknown,
): ProcessDescription {
  const record =
    data && typeof data === 'object' ? (data as JobData) : ({} as JobData);
  const entry = QUEUE_CATALOG[queue];
  if (!entry) {
    return {
      module: `Cola ${queue}`,
      action: `ejecutar el trabajo ${jobName}`,
      entity: null,
      aiFeature: null,
    };
  }
  const byJob = entry.jobs?.[jobName];
  const byData = entry.describe?.(jobName, record) ?? null;
  return {
    module: byData?.module ?? byJob?.module ?? entry.module,
    action: byData?.action ?? byJob?.action ?? entry.action,
    entity: entry.entity?.(record) ?? null,
    aiFeature: byData?.aiFeature ?? byJob?.aiFeature ?? entry.aiFeature ?? null,
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** Primer segmento de alcance que no es el módulo. */
const SCOPE_SEGMENTS: ReadonlySet<string> = new Set([
  'store',
  'organization',
  'superadmin',
  'super-admin',
  'ecommerce',
  'public',
  'platform',
  'admin',
  'v1',
]);

const SCOPE_LABELS: Record<string, string> = {
  superadmin: 'Superadmin',
  'super-admin': 'Superadmin',
  ecommerce: 'Tienda en línea',
  public: 'Público',
  organization: 'Organización',
  v1: 'API pública',
};

/** Segmento de ruta → módulo de Vendix. Lo que no esté se muestra tal cual. */
export const ROUTE_MODULE_LABELS: Readonly<Record<string, string>> = {
  orders: 'Ventas',
  pos: 'Punto de venta',
  'cash-registers': 'Caja',
  layaway: 'Separados',
  'scheduled-orders': 'Pedidos programados',
  quotations: 'Cotizaciones',
  checkout: 'Checkout',
  cart: 'Carrito',
  products: 'Productos',
  categories: 'Categorías',
  brands: 'Marcas',
  'price-tiers': 'Listas de precios',
  promotions: 'Promociones',
  coupons: 'Cupones',
  inventory: 'Inventario',
  'stock-transfers': 'Traslados de inventario',
  uom: 'Unidades de medida',
  recipes: 'Recetas',
  'production-orders': 'Producción',
  manufacturing: 'Producción',
  customers: 'Clientes',
  suppliers: 'Proveedores',
  'purchase-orders': 'Compras',
  expenses: 'Gastos',
  'dispatch-notes': 'Remisiones',
  'dispatch-routes': 'Rutas de despacho',
  shipping: 'Envíos',
  'shipping-methods': 'Envíos',
  'shipping-zones': 'Envíos',
  payments: 'Pagos',
  'payment-methods': 'Medios de pago',
  'payment-links': 'Links de pago',
  'payment-requests': 'Solicitudes de pago',
  wallets: 'Billeteras',
  invoicing: 'Facturación electrónica',
  'invoice-data-requests': 'Datos de facturación',
  'received-documents': 'Documentos recibidos',
  fiscal: 'Fiscal',
  taxes: 'Impuestos',
  'withholding-tax': 'Retenciones',
  exogenous: 'Exógena',
  accounting: 'Contabilidad',
  'accounts-receivable': 'Cuentas por cobrar',
  'accounts-payable': 'Cuentas por pagar',
  payroll: 'Nómina',
  subscriptions: 'Suscripción',
  plans: 'Planes',
  commissions: 'Comisiones',
  reseller: 'Aliados',
  analytics: 'Analíticas',
  reports: 'Reportes',
  dashboard: 'Tablero',
  settings: 'Configuración',
  stores: 'Tiendas',
  organizations: 'Organizaciones',
  users: 'Usuarios',
  roles: 'Roles y permisos',
  auth: 'Inicio de sesión',
  crm: 'CRM',
  messaging: 'Mensajería',
  marketing: 'Marketing',
  vexi: 'Vexi',
  vex: 'Vex',
  'ai-chat': 'Vexi',
  'ai-engine': 'Motor de IA',
  'ai-scan-jobs': 'Escaneo con IA',
  workflows: 'Flujos',
  'bulk-uploads': 'Cargas masivas',
  hospitality: 'Hotelería',
  reservations: 'Reservas',
  memberships: 'Membresías',
  tables: 'Mesas',
  'table-sessions': 'Mesas',
  kds: 'Cocina (KDS)',
  menus: 'Cartas',
  documents: 'Documentos',
  support: 'Soporte',
  notifications: 'Notificaciones',
  webhooks: 'Webhooks',
  integrations: 'Integraciones',
  monitoring: 'Monitoreo',
  upload: 'Archivos',
};

/** Último segmento que ya es la acción. */
const VERB_SEGMENTS: Readonly<Record<string, string>> = {
  cancel: 'cancelar',
  void: 'anular',
  refund: 'reembolsar',
  pay: 'pagar',
  confirm: 'confirmar',
  approve: 'aprobar',
  reject: 'rechazar',
  close: 'cerrar',
  open: 'abrir',
  send: 'enviar',
  resend: 'reenviar',
  receive: 'recibir',
  scan: 'escanear',
  validate: 'validar',
  revalidate: 'revalidar',
  export: 'exportar',
  import: 'importar',
  upload: 'subir',
  download: 'descargar',
  print: 'imprimir',
  preview: 'previsualizar',
  search: 'buscar',
  retry: 'reintentar',
  sync: 'sincronizar',
  emit: 'emitir',
  issue: 'emitir',
  dispatch: 'despachar',
  deliver: 'entregar',
  finish: 'finalizar',
  complete: 'completar',
  duplicate: 'duplicar',
  restore: 'restaurar',
  archive: 'archivar',
  activate: 'activar',
  deactivate: 'desactivar',
  login: 'iniciar sesión',
  logout: 'cerrar sesión',
  register: 'registrarse',
};

const QUALIFIER_LABELS: Readonly<Record<string, string>> = {
  payments: 'pagos',
  items: 'ítems',
  stats: 'estadísticas',
  summary: 'resumen',
  status: 'estado',
  pdf: 'PDF',
  notes: 'notas',
  bulk: 'en lote',
  variants: 'variantes',
  images: 'imágenes',
  settings: 'configuración',
};

const METHOD_VERBS: Readonly<Record<string, string>> = {
  GET: 'consultar',
  HEAD: 'consultar',
  POST: 'crear',
  PUT: 'actualizar',
  PATCH: 'actualizar',
  DELETE: 'eliminar',
};

function humanize(segment: string): string {
  const text = segment.replace(/[-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Módulo y acción de una petición, deducidos de la ruta sin valores y del
 * método: `POST /store/orders/:id/payments` → «Ventas» · «crear pagos».
 */
export function describeHttpRoute(method: string, route: string): ProcessDescription {
  const verb = METHOD_VERBS[method.toUpperCase()] ?? method.toLowerCase();
  const segments = stripApiPrefix(route).split('/').filter(Boolean);
  const scope = SCOPE_SEGMENTS.has(segments[0] ?? '') ? segments.shift()! : null;
  const statics = segments.filter((s) => !s.startsWith(':') && !s.startsWith('*'));
  const resource = statics[0];
  if (!resource) {
    return {
      module: (scope && SCOPE_LABELS[scope]) || 'API',
      action: verb,
      entity: null,
      aiFeature: null,
    };
  }
  const baseModule = ROUTE_MODULE_LABELS[resource] ?? humanize(resource);
  const module =
    scope && SCOPE_LABELS[scope] && scope !== 'organization'
      ? `${SCOPE_LABELS[scope]} · ${baseModule}`
      : baseModule;
  const last = statics.length > 1 ? statics[statics.length - 1] : null;
  const hasId = segments.some((s) => s.startsWith(':'));
  let action: string;
  if (last && VERB_SEGMENTS[last]) {
    action = VERB_SEGMENTS[last];
  } else if (last) {
    action = `${verb} ${QUALIFIER_LABELS[last] ?? last.replace(/[-_]+/g, ' ')}`;
  } else if (method.toUpperCase() === 'GET') {
    action = hasId ? 'consultar un registro' : 'listar';
  } else {
    action = verb;
  }
  return { module, action, entity: null, aiFeature: null };
}
