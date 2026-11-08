import {
  WORKFLOW_LIMITS,
  WORKFLOW_STAGE_TYPES,
  WorkflowStageType,
} from '../../../../../../shared/workflows/contract/workflow-contract';
import { STAGE_TYPE_LABEL } from '../../editor/workflow-editor.utils';

export type HelpGroupId =
  | 'start'
  | 'design'
  | 'stages'
  | 'forms'
  | 'documents'
  | 'integrations'
  | 'ai'
  | 'limits'
  | 'permissions'
  | 'export';

/** Lists the page reads from the system itself instead of frozen text. */
export type HelpLiveKind =
  | 'stage_types'
  | 'events'
  | 'actions'
  | 'connectors'
  | 'ai_tasks'
  | 'hooks'
  | 'limits';

export interface HelpLink {
  label: string;
  /** Absolute path of a screen registered under `/admin/workflows`. */
  path: string;
}

export interface HelpEntry {
  id: string;
  group: HelpGroupId;
  question: string;
  paragraphs: string[];
  links: HelpLink[];
  live?: HelpLiveKind;
  /** Extra words a search may match that the text does not contain. */
  keywords?: string[];
}

export const HELP_GROUPS: { id: HelpGroupId; title: string }[] = [
  { id: 'start', title: 'Empezar' },
  { id: 'design', title: 'Diseñar un flujo' },
  { id: 'stages', title: 'Etapas y tareas' },
  { id: 'forms', title: 'Formularios y enlaces públicos' },
  { id: 'documents', title: 'Documentos y firmas' },
  { id: 'integrations', title: 'Integraciones' },
  { id: 'ai', title: 'IA' },
  { id: 'limits', title: 'Límites del plan' },
  { id: 'permissions', title: 'Permisos y auditoría' },
  { id: 'export', title: 'Exportación' },
];

const BASE = '/admin/workflows';
const L = {
  flows: { label: 'Flujos', path: BASE },
  inbox: { label: 'Mis tareas', path: `${BASE}/inbox` },
  board: { label: 'Tablero general', path: `${BASE}/board` },
  templates: { label: 'Plantillas', path: `${BASE}/templates` },
  insights: { label: 'Analítica IA', path: `${BASE}/insights` },
  integrations: { label: 'Integraciones', path: `${BASE}/integrations` },
  connectors: { label: 'Conectores', path: `${BASE}/connectors` },
  records: { label: 'Registros', path: `${BASE}/records` },
  usage: { label: 'Uso del plan', path: `${BASE}/usage` },
  audit: { label: 'Auditoría', path: `${BASE}/audit` },
  exports: { label: 'Exportación', path: `${BASE}/exports` },
  help: { label: 'Ayuda', path: `${BASE}/help` },
} satisfies Record<string, HelpLink>;

/** What each stage type does, written from the contract. */
const STAGE_TYPE_DESCRIPTION: Record<WorkflowStageType, string> = {
  form: 'Una persona llena un formulario y lo envía. Su único resultado es «Enviar».',
  approval: 'Una persona decide: aprueba o rechaza. Puede pedir el voto de varias personas.',
  review:
    'Una persona revisa y decide entre aprobar, rechazar o devolver la solicitud.',
  automatic:
    'Vendix ejecuta las acciones de la etapa sin que nadie tenga que intervenir y sigue por su resultado «Automática».',
  ai: 'Un paso de IA clasifica, extrae, resume, redacta o decide la rama, siempre con una salida estructurada y validada. Sin revisión sigue solo; con revisión, una persona aprueba o rechaza.',
  parallel:
    'Abre varias ramas a la vez y las une cuando se cumple la regla elegida: todas, cualquiera o N de M.',
  subflow:
    'Lanza uno o varios flujos hijos y espera, o no, a que cierren. Si un hijo es rechazado, cancelado o falla, la etapa sale por «Rechazada».',
  wait: 'Pausa la solicitud y la reanuda sola: por duración, fecha fija, fecha de un campo, días hábiles (calendario de Colombia) o día del mes.',
  loop: `Repite mientras se cumpla una condición. El límite de vueltas es obligatorio y no puede pasar de ${WORKFLOW_LIMITS.maxLoopIterations}.`,
  end: 'Cierra la solicitud con un resultado: completada, rechazada o cancelada.',
};

const STAGE_TYPE_ENTRIES: HelpEntry[] = WORKFLOW_STAGE_TYPES.map((type) => ({
  id: `stage-${type}`,
  group: 'stages',
  question: `¿Cómo funciona la etapa «${STAGE_TYPE_LABEL[type]}»?`,
  paragraphs: [STAGE_TYPE_DESCRIPTION[type]],
  links: [L.flows],
}));

export const HELP_ENTRIES: HelpEntry[] = [
  {
    id: 'what-is',
    group: 'start',
    question: '¿Qué es Flujos?',
    paragraphs: [
      'Flujos te permite diseñar procesos con etapas, responsables, aprobaciones y expedientes, y ver cada solicitud avanzar con su línea de tiempo.',
      'El acceso al módulo lo da la industria Administración de tu tienda. Los planes se diferencian por la IA y sus tokens.',
    ],
    links: [L.flows],
  },
  {
    id: 'first-flow',
    group: 'start',
    question: '¿Cómo creo mi primer flujo?',
    paragraphs: [
      'Puedes empezar desde cero en Flujos o activar una plantilla lista de la galería de Administración, que queda publicada y puedes ajustar después.',
    ],
    links: [L.templates, L.flows],
  },
  {
    id: 'my-tasks',
    group: 'start',
    question: '¿Dónde veo lo que me toca hacer?',
    paragraphs: [
      'En «Mis tareas» aparece lo que espera tu atención. El «Tablero general» muestra las solicitudes de todos los flujos, filtradas por rol y sede.',
    ],
    links: [L.inbox, L.board],
  },
  {
    id: 'help-search',
    group: 'start',
    question: '¿Cómo encuentro una respuesta en esta ayuda?',
    paragraphs: [
      'Escribe una palabra en el buscador. La búsqueda no distingue mayúsculas ni tildes: «firma» encuentra «Firma» y «firmas».',
    ],
    links: [L.help],
  },

  {
    id: 'editor',
    group: 'design',
    question: '¿Qué puedo definir en el editor de un flujo?',
    paragraphs: [
      'Las etapas, sus responsables, los formularios, las transiciones con condiciones, los requisitos y las acciones. También puedes simular el recorrido y probar una acción antes de publicar.',
      'El editor se abre desde la lista de Flujos.',
    ],
    links: [L.flows],
  },
  {
    id: 'versions',
    group: 'design',
    question: '¿Qué pasa con las solicitudes en curso cuando publico un cambio?',
    paragraphs: [
      'Las versiones publicadas son inmutables: cada cambio publicado crea una versión nueva. Las solicitudes vivas pueden pasar a la versión nueva con un mapa de etapa a etapa y una vista previa, sin perder su historia.',
    ],
    links: [L.flows],
  },
  {
    id: 'variables',
    group: 'design',
    question: '¿Puedo calcular campos o escribir código en un flujo?',
    paragraphs: [
      'Puedes usar variables y campos calculados con aritmética, fechas y texto, de un catálogo cerrado y seguro. No hay código arbitrario.',
    ],
    links: [L.flows],
  },

  {
    id: 'stage-types',
    group: 'stages',
    question: '¿Qué tipos de etapa hay?',
    paragraphs: ['Estos son los tipos de etapa que el editor ofrece hoy:'],
    links: [L.flows],
    live: 'stage_types',
  },
  ...STAGE_TYPE_ENTRIES,
  {
    id: 'due-dates',
    group: 'stages',
    question: '¿Qué pasa cuando una tarea vence?',
    paragraphs: [
      'Una tarea con vencimiento envía un recordatorio y, si sigue sin atenderse, sube al rol de escalamiento definido en la etapa.',
    ],
    links: [L.inbox],
  },
  {
    id: 'hooks',
    group: 'stages',
    question: '¿En qué momentos de una etapa pueden correr acciones?',
    paragraphs: ['Cada etapa puede ejecutar acciones en estos puntos:'],
    links: [L.flows],
    live: 'hooks',
  },

  {
    id: 'public-form',
    group: 'forms',
    question: '¿Puede alguien sin cuenta iniciar una solicitud?',
    paragraphs: [
      'Sí, con un enlace público del flujo. El enlace puede tener código QR (necesita un dominio público activo en tu tienda), fecha de vencimiento y captcha, y se puede desactivar. Los archivos grandes se suben por partes.',
      'Cuando tu plan llega a su límite de solicitudes, el formulario público muestra un mensaje neutro, sin detalles de tu plan.',
    ],
    links: [L.flows],
    keywords: ['qr', 'captcha', 'enlace'],
  },
  {
    id: 'tracking',
    group: 'forms',
    question: '¿Cómo sigue su solicitud una persona externa?',
    paragraphs: [
      'Con un enlace de seguimiento puede ver el estado de su solicitud y responder lo que se le pida.',
    ],
    links: [L.flows],
  },
  {
    id: 'records',
    group: 'forms',
    question: '¿Cómo gestiono procesos sobre cosas que Vendix no tiene?',
    paragraphs: [
      'En «Registros» defines colecciones con tus propios campos (contratos, activos, pólizas, trámites), con lista, detalle y expediente, y puedes crear flujos sobre ellas.',
    ],
    links: [L.records],
  },

  {
    id: 'issued-documents',
    group: 'documents',
    question: '¿Cómo genero un documento desde una solicitud?',
    paragraphs: [
      'Con una plantilla de documento, Vendix emite un PDF con los datos reales de la solicitud y lo guarda en su expediente.',
    ],
    links: [L.inbox, L.flows],
    keywords: ['pdf', 'contrato'],
  },
  {
    id: 'signature',
    group: 'documents',
    question: '¿Cómo funciona la firma electrónica?',
    paragraphs: [
      'Desde la solicitud puedes enviar un documento a firmar. La persona recibe un enlace y un código por correo o por WhatsApp, firma con su trazo, y el expediente guarda el PDF sellado con su hoja de evidencia (dirección IP, hora, huella del documento y código validado).',
      'Es una firma electrónica simple, no una firma digital certificada.',
    ],
    links: [L.inbox, L.flows],
    keywords: ['firma', 'firmas', 'firmar', 'otp'],
  },
  {
    id: 'ocr',
    group: 'documents',
    question: '¿Puede la IA leer un documento y llenar el formulario?',
    paragraphs: [
      'Sí, la lectura con IA propone los valores del formulario a partir del archivo subido y marca lo de baja confianza para que lo revises. Consume tokens del cupo de IA de tu plan.',
    ],
    links: [L.insights],
  },
  {
    id: 'dossier',
    group: 'documents',
    question: '¿Dónde quedan los archivos de una solicitud?',
    paragraphs: [
      'En el expediente de la solicitud. El almacenamiento que usan cuenta contra el límite de tu plan.',
    ],
    links: [L.usage, L.inbox],
  },

  {
    id: 'events',
    group: 'integrations',
    question: '¿Qué eventos de Vendix pueden iniciar un flujo?',
    paragraphs: ['Esta es la lista de eventos de negocio que el editor ofrece hoy, por módulo:'],
    links: [L.flows],
    live: 'events',
  },
  {
    id: 'actions',
    group: 'integrations',
    question: '¿Qué acciones puede ejecutar un flujo en Vendix?',
    paragraphs: [
      'Cada acción pasa por el mismo servicio que usa la pantalla correspondiente, con sus mismas reglas, y exige que quien publica el flujo tenga el permiso de esa acción. Estas son las acciones disponibles hoy, por módulo:',
    ],
    links: [L.flows],
    live: 'actions',
  },
  {
    id: 'connectors',
    group: 'integrations',
    question: '¿Con qué sistemas externos se conecta Flujos?',
    paragraphs: [
      'Estos son los conectores registrados. Cada uno tiene su estado de conexión en la pantalla de Conectores.',
    ],
    links: [L.connectors],
    live: 'connectors',
  },
  {
    id: 'inbound',
    group: 'integrations',
    question: '¿Cómo inicia un flujo otro sistema?',
    paragraphs: [
      'Con una llamada firmada (HMAC) a la URL del flujo. Una llamada sin firma válida se rechaza. Las claves de API, los webhooks salientes y los secretos para llamadas HTTP se gestionan en Integraciones; los secretos nunca se guardan dentro del JSON del flujo.',
    ],
    links: [L.integrations, L.connectors],
    keywords: ['webhook', 'api', 'secreto'],
  },

  {
    id: 'ai-step',
    group: 'ai',
    question: '¿Qué puede hacer un paso de IA?',
    paragraphs: [
      'Un paso de IA trabaja sobre los campos de la solicitud y devuelve una salida estructurada y validada. Estas son sus tareas:',
    ],
    links: [L.flows],
    live: 'ai_tasks',
  },
  {
    id: 'ai-usage',
    group: 'ai',
    question: '¿Dónde veo cuántos tokens de IA consumen mis flujos?',
    paragraphs: [
      'En «Analítica IA»: el consumo del mes frente al cupo de tu plan, por flujo y por uso, y el resumen semanal de lo que se traba.',
    ],
    links: [L.insights, L.usage],
  },

  {
    id: 'plan-limit',
    group: 'limits',
    question: '¿Qué pasa si llego al límite del plan?',
    paragraphs: [
      'Se abre la pantalla para mejorar el plan («Mejorar plan»), no un error. Según el origen de la solicitud:',
      'Las aprobaciones de los candados y los subflujos hijos nunca se detienen: cuentan en el uso, pero no se frenan, para no trabar procesos en curso.',
      'Los inicios automáticos (por evento, programados, por correo o por fecha de registro) no se inician y se avisa al dueño una vez al mes.',
      'Un formulario público o un webhook de entrada rechaza la solicitud con un mensaje neutro.',
      'Tu uso actual frente a lo que incluye el plan:',
    ],
    links: [L.usage],
    live: 'limits',
    keywords: ['paywall', 'plan', 'cupo'],
  },
  {
    id: 'plan-metrics',
    group: 'limits',
    question: '¿Qué límites tiene mi plan en Flujos?',
    paragraphs: [
      'Se miden las solicitudes del mes, las llamadas HTTP del mes, el almacenamiento y los tokens de IA. La barra se pone amarilla desde el 80 % y roja al 100 %. Los contadores mensuales usan meses UTC.',
    ],
    links: [L.usage],
  },

  {
    id: 'access',
    group: 'permissions',
    question: '¿Cómo limito quién ve o diseña un flujo?',
    paragraphs: [
      'Cada flujo puede definir qué roles o personas lo diseñan y lo ven, y quién actúa en cada etapa. Quien no tiene acceso no ve el flujo en ninguna lista; si entra por la dirección, recibe «No encontrado». Sin permisos configurados todo sigue abierto como siempre.',
      'El dueño, el superadmin y quien tenga el permiso de administrar flujos pasan siempre, y cada participante sigue viendo su propia solicitud.',
    ],
    links: [L.flows],
  },
  {
    id: 'audit',
    group: 'permissions',
    question: '¿Quién cambió un flujo o tocó un documento?',
    paragraphs: [
      'En «Auditoría» hay un registro de cambios en definiciones, decisiones, accesos a documentos y secretos. Nadie puede editarlo ni borrarlo, y puedes verificar su integridad y exportarlo para un auditor externo. Nunca muestra el valor de un secreto.',
    ],
    links: [L.audit],
    keywords: ['auditoria', 'registro'],
  },

  {
    id: 'export',
    group: 'export',
    question: '¿Cómo me llevo mi información de Flujos?',
    paragraphs: [
      'En «Exportación» generas un ZIP con tus flujos, solicitudes, expedientes con sus archivos, registros, documentos y la auditoría. Se prepara en segundo plano, vence a los 7 días y no incluye valores de secretos ni tokens. Solo puede haber una exportación en curso a la vez.',
    ],
    links: [L.exports],
    keywords: ['zip', 'descargar', 'exportar'],
  },
];

/** Honest limits of the module: what Flujos does not do. */
export interface NotDoingItem {
  title: string;
  text: string;
}

export const NOT_DOING: NotDoingItem[] = [
  {
    title: 'No ejecuta código arbitrario',
    text: 'No hay nodos de JavaScript ni de Python. Las expresiones usan un catálogo cerrado y las llamadas HTTP solo salen a direcciones públicas.',
  },
  {
    title: 'No es un motor BPMN completo',
    text: 'No incluye BPMN 2.0 completo: no hay compensación ni mensajes entre pools.',
  },
  {
    title: 'La firma electrónica es simple',
    text: 'No es una firma digital certificada con un proveedor de certificación digital.',
  },
  {
    title: 'No se conecta con Google Sheets ni Google Drive',
    text: 'Estos conectores no existen hoy. Los conectores disponibles son los de la pantalla de Conectores.',
  },
  {
    title: 'No hay aplicación móvil nativa de Flujos',
    text: 'Puedes usar Flujos desde el navegador del celular, pero no existe una aplicación móvil propia para este módulo.',
  },
  {
    title: 'No reemplaza los procesos fiscales, de nómina ni contables',
    text: 'Los gobierna con un candado de aprobación y los invoca con acciones, pero la facturación electrónica, la nómina y la contabilidad siguen siendo módulos propios de Vendix.',
  },
];
