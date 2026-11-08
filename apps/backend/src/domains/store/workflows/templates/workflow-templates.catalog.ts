import {
  WORKFLOW_SCHEMA_V1,
  WorkflowAssigneeDef,
  WorkflowDefinitionV1,
  WorkflowEndOutcome,
  WorkflowFieldDef,
  WorkflowStageDef,
} from '@common/workflows/contract';

/**
 * Ready-made Administration flows (P5.4). Every definition is a complete
 * `vendix.workflow/v1` document that publishes in any store: assignees are the
 * initiator or system roles that exist everywhere, and no step needs secrets,
 * connectors or store-specific records.
 */
export interface WorkflowTemplate {
  key: string;
  name: string;
  category: string;
  description: string;
  /** Registered Lucide icon name. */
  icon: string;
  definition: WorkflowDefinitionV1;
}

const INITIATOR: WorkflowAssigneeDef = { kind: 'initiator' };
const role = (role_key: 'owner' | 'admin' | 'manager' | 'employee'): WorkflowAssigneeDef => ({
  kind: 'role',
  role_key,
});

function form(
  key: string,
  name: string,
  fields: string[],
  to: string,
  opts: { start?: boolean; assignee?: WorkflowAssigneeDef; dueHours?: number } = {},
): WorkflowStageDef {
  return {
    key,
    name,
    type: 'form',
    ...(opts.start ? { start: true } : {}),
    assignee: opts.assignee ?? INITIATOR,
    form: { fields },
    ...(opts.dueHours ? { due: { hours: opts.dueHours, on_overdue: { remind_every_hours: 12 } } } : {}),
    transitions: [{ on: 'submit', to }],
  };
}

function approval(
  key: string,
  name: string,
  assignee: WorkflowAssigneeDef,
  approveTo: string,
  rejectTo: string,
  opts: { dueHours?: number; escalateTo?: WorkflowAssigneeDef; extra?: WorkflowStageDef['transitions'] } = {},
): WorkflowStageDef {
  return {
    key,
    name,
    type: 'approval',
    assignee,
    ...(opts.dueHours
      ? {
          due: {
            hours: opts.dueHours,
            on_overdue: {
              remind_every_hours: 8,
              ...(opts.escalateTo ? { escalate_to: opts.escalateTo } : {}),
            },
          },
        }
      : {}),
    transitions: [
      ...(opts.extra ?? []),
      { on: 'approve', to: approveTo },
      { on: 'reject', to: rejectTo, require_comment: true },
    ],
  };
}

function review(
  key: string,
  name: string,
  assignee: WorkflowAssigneeDef,
  approveTo: string,
  rejectTo: string,
  returnTo: string,
  dueHours?: number,
): WorkflowStageDef {
  return {
    key,
    name,
    type: 'review',
    assignee,
    ...(dueHours ? { due: { hours: dueHours, on_overdue: { remind_every_hours: 12 } } } : {}),
    transitions: [
      { on: 'approve', to: approveTo },
      { on: 'return', to: returnTo, require_comment: true },
      { on: 'reject', to: rejectTo, require_comment: true },
    ],
  };
}

function end(
  key: string,
  name: string,
  outcome: WorkflowEndOutcome,
  message?: string,
): WorkflowStageDef {
  return {
    key,
    name,
    type: 'end',
    outcome,
    ...(message ? { on_enter: [{ action: 'notify' as const, to: INITIATOR, message }] } : {}),
  };
}

const text = (key: string, label: string, required = false): WorkflowFieldDef => ({
  key,
  type: 'text',
  label,
  ...(required ? { required } : {}),
});
const textarea = (key: string, label: string, required = false): WorkflowFieldDef => ({
  key,
  type: 'textarea',
  label,
  ...(required ? { required } : {}),
});
const money = (key: string, label: string, required = false): WorkflowFieldDef => ({
  key,
  type: 'money',
  label,
  ...(required ? { required } : {}),
});
const date = (key: string, label: string, required = false): WorkflowFieldDef => ({
  key,
  type: 'date',
  label,
  ...(required ? { required } : {}),
});
const file = (key: string, label: string, required = false): WorkflowFieldDef => ({
  key,
  type: 'file',
  label,
  accept: ['application/pdf', 'image/*'],
  max_size_mb: 10,
  ...(required ? { required } : {}),
});
/** Option value derived from its Spanish label (accents stripped). */
const slug = (label: string) =>
  label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
const select = (
  key: string,
  label: string,
  options: string[],
  required = false,
): WorkflowFieldDef => ({
  key,
  type: 'select',
  label,
  options: options.map((o) => ({ value: slug(o), label: o })),
  ...(required ? { required } : {}),
});

function definition(
  key: string,
  name: string,
  description: string,
  fields: WorkflowFieldDef[],
  stages: WorkflowStageDef[],
): WorkflowDefinitionV1 {
  return {
    schema: WORKFLOW_SCHEMA_V1,
    key,
    name,
    description,
    fields,
    stages,
    triggers: [{ kind: 'manual' }],
  };
}

const PURCHASE: WorkflowTemplate = {
  key: 'compras-aprobacion-monto',
  name: 'Compras con aprobación por monto',
  category: 'Compras',
  description:
    'Solicitud de compra que aprueba el jefe y, si supera los 2.000.000, también la gerencia.',
  icon: 'shopping-cart',
  definition: definition(
    'compras-aprobacion-monto',
    'Compras con aprobación por monto',
    'Solicitud de compra que aprueba el jefe y, si supera los 2.000.000, también la gerencia.',
    [
      money('monto', 'Monto estimado', true),
      text('proveedor', 'Proveedor sugerido'),
      textarea('descripcion', 'Qué se necesita comprar', true),
      file('cotizacion', 'Cotización'),
    ],
    [
      form('solicitud', 'Solicitud de compra', ['monto', 'proveedor', 'descripcion', 'cotizacion'], 'jefe', {
        start: true,
      }),
      approval('jefe', 'Aprobación del jefe', role('manager'), 'aprobada', 'rechazada', {
        dueHours: 24,
        escalateTo: role('admin'),
        extra: [
          {
            on: 'approve',
            to: 'gerencia',
            when: { all: [{ field: 'monto', op: 'gt', value: 2000000 }] },
          },
        ],
      }),
      approval('gerencia', 'Aprobación de gerencia', role('owner'), 'aprobada', 'rechazada', {
        dueHours: 48,
      }),
      end('aprobada', 'Compra aprobada', 'completed', 'Tu solicitud de compra fue aprobada.'),
      end('rechazada', 'Compra rechazada', 'rejected', 'Tu solicitud de compra fue rechazada.'),
    ],
  ),
};

const EXPENSES: WorkflowTemplate = {
  key: 'gastos-reembolsos',
  name: 'Gastos y reembolsos',
  category: 'Finanzas',
  description:
    'Reembolso de gastos con soporte: aprueba el jefe, revisa administración los montos altos y se registra el pago.',
  icon: 'receipt',
  definition: definition(
    'gastos-reembolsos',
    'Gastos y reembolsos',
    'Reembolso de gastos con soporte: aprueba el jefe, revisa administración los montos altos y se registra el pago.',
    [
      text('concepto', 'Concepto del gasto', true),
      money('monto', 'Valor a reembolsar', true),
      date('fecha_gasto', 'Fecha del gasto', true),
      file('soporte', 'Factura o soporte', true),
      date('fecha_pago', 'Fecha de pago'),
      text('referencia_pago', 'Referencia del pago'),
    ],
    [
      form('solicitud', 'Solicitud de reembolso', ['concepto', 'monto', 'fecha_gasto', 'soporte'], 'jefe', {
        start: true,
      }),
      approval('jefe', 'Aprobación del jefe', role('manager'), 'pago', 'rechazado', {
        dueHours: 24,
        extra: [
          {
            on: 'approve',
            to: 'revision',
            when: { all: [{ field: 'monto', op: 'gt', value: 500000 }] },
          },
        ],
      }),
      review('revision', 'Revisión de administración', role('admin'), 'pago', 'rechazado', 'solicitud', 48),
      form('pago', 'Registro del pago', ['fecha_pago', 'referencia_pago'], 'pagado', {
        assignee: role('admin'),
        dueHours: 72,
      }),
      end('pagado', 'Reembolso pagado', 'completed', 'Tu reembolso fue pagado.'),
      end('rechazado', 'Reembolso rechazado', 'rejected', 'Tu solicitud de reembolso fue rechazada.'),
    ],
  ),
};

const ADVANCES: WorkflowTemplate = {
  key: 'anticipos',
  name: 'Anticipos',
  category: 'Finanzas',
  description:
    'Anticipo de dinero con aprobación del jefe y de administración, y registro del desembolso.',
  icon: 'wallet',
  definition: definition(
    'anticipos',
    'Anticipos',
    'Anticipo de dinero con aprobación del jefe y de administración, y registro del desembolso.',
    [
      money('monto', 'Valor del anticipo', true),
      textarea('motivo', 'Motivo del anticipo', true),
      date('fecha_requerida', 'Fecha en que lo necesitas', true),
      date('fecha_desembolso', 'Fecha del desembolso'),
      text('referencia_desembolso', 'Referencia del desembolso'),
    ],
    [
      form('solicitud', 'Solicitud de anticipo', ['monto', 'motivo', 'fecha_requerida'], 'jefe', {
        start: true,
      }),
      approval('jefe', 'Aprobación del jefe', role('manager'), 'tesoreria', 'rechazado', {
        dueHours: 24,
        escalateTo: role('admin'),
      }),
      approval('tesoreria', 'Aprobación de administración', role('admin'), 'desembolso', 'rechazado', {
        dueHours: 48,
      }),
      form('desembolso', 'Registro del desembolso', ['fecha_desembolso', 'referencia_desembolso'], 'entregado', {
        assignee: role('admin'),
        dueHours: 48,
      }),
      end('entregado', 'Anticipo entregado', 'completed', 'Tu anticipo fue desembolsado.'),
      end('rechazado', 'Anticipo rechazado', 'rejected', 'Tu solicitud de anticipo fue rechazada.'),
    ],
  ),
};

const LEAVE_TYPES = ['Vacaciones', 'Permiso remunerado', 'Permiso no remunerado', 'Licencia'];

const LEAVE: WorkflowTemplate = {
  key: 'vacaciones-permisos',
  name: 'Vacaciones y permisos',
  category: 'Talento humano',
  description:
    'Solicitud de vacaciones o permisos: aprueba el jefe, registra talento humano y se avisa al solicitante.',
  icon: 'calendar-days',
  definition: definition(
    'vacaciones-permisos',
    'Vacaciones y permisos',
    'Solicitud de vacaciones o permisos: aprueba el jefe, registra talento humano y se avisa al solicitante.',
    [
      select('tipo', 'Tipo de solicitud', LEAVE_TYPES, true),
      date('fecha_inicio', 'Desde', true),
      date('fecha_fin', 'Hasta', true),
      textarea('motivo', 'Motivo o comentarios'),
    ],
    [
      form('solicitud', 'Solicitud', ['tipo', 'fecha_inicio', 'fecha_fin', 'motivo'], 'jefe', {
        start: true,
      }),
      approval('jefe', 'Aprobación del jefe', role('manager'), 'talento', 'rechazada', {
        dueHours: 48,
        escalateTo: role('admin'),
      }),
      review('talento', 'Registro de talento humano', role('admin'), 'aviso', 'rechazada', 'solicitud', 48),
      {
        key: 'aviso',
        name: 'Avisar al solicitante',
        type: 'automatic',
        on_enter: [
          {
            action: 'notify',
            to: INITIATOR,
            message: 'Tu solicitud de vacaciones o permiso fue aprobada y registrada.',
          },
        ],
        transitions: [{ on: 'auto', to: 'aprobada' }],
      },
      end('aprobada', 'Solicitud aprobada', 'completed'),
      end('rechazada', 'Solicitud rechazada', 'rejected', 'Tu solicitud de vacaciones o permiso fue rechazada.'),
    ],
  ),
};

const HIRING: WorkflowTemplate = {
  key: 'contratacion',
  name: 'Contratación',
  category: 'Talento humano',
  description:
    'Aprobación de una nueva contratación y alistamiento en paralelo de tecnología, nómina y dotación.',
  icon: 'user-plus',
  definition: definition(
    'contratacion',
    'Contratación',
    'Aprobación de una nueva contratación y alistamiento en paralelo de tecnología, nómina y dotación.',
    [
      text('candidato', 'Nombre del candidato', true),
      text('cargo', 'Cargo', true),
      money('salario', 'Salario mensual', true),
      date('fecha_ingreso', 'Fecha de ingreso', true),
      textarea('observaciones', 'Observaciones'),
    ],
    [
      form('solicitud', 'Solicitud de contratación', ['candidato', 'cargo', 'salario', 'fecha_ingreso', 'observaciones'], 'aprobacion', {
        start: true,
      }),
      approval('aprobacion', 'Aprobación de gerencia', role('owner'), 'alistamiento', 'rechazada', {
        dueHours: 48,
      }),
      {
        key: 'alistamiento',
        name: 'Alistamiento del nuevo colaborador',
        type: 'parallel',
        parallel: {
          join: 'all',
          branches: [
            { key: 'tecnologia', name: 'Tecnología: equipo y accesos', assignee: role('admin') },
            { key: 'nomina', name: 'Nómina: afiliaciones y contrato', assignee: role('admin') },
            { key: 'dotacion', name: 'Dotación y puesto de trabajo', assignee: role('manager') },
          ],
        },
        transitions: [{ on: 'joined', to: 'bienvenida' }],
      },
      end('bienvenida', 'Colaborador listo para ingresar', 'completed', 'La contratación quedó lista para el ingreso.'),
      end('rechazada', 'Contratación rechazada', 'rejected', 'La solicitud de contratación fue rechazada.'),
    ],
  ),
};

const OFFBOARDING: WorkflowTemplate = {
  key: 'retiro-empleado',
  name: 'Retiro de empleado',
  category: 'Talento humano',
  description:
    'Retiro de un colaborador: aprobación del jefe y paz y salvo en paralelo de activos, accesos y liquidación.',
  icon: 'user-minus',
  definition: definition(
    'retiro-empleado',
    'Retiro de empleado',
    'Retiro de un colaborador: aprobación del jefe y paz y salvo en paralelo de activos, accesos y liquidación.',
    [
      text('colaborador', 'Nombre del colaborador', true),
      text('cargo', 'Cargo', true),
      date('fecha_retiro', 'Fecha de retiro', true),
      select('motivo', 'Motivo del retiro', ['Renuncia', 'Terminación de contrato', 'Mutuo acuerdo', 'Otro'], true),
      textarea('observaciones', 'Observaciones'),
    ],
    [
      form('solicitud', 'Aviso de retiro', ['colaborador', 'cargo', 'fecha_retiro', 'motivo', 'observaciones'], 'jefe', {
        start: true,
      }),
      approval('jefe', 'Aprobación del jefe', role('manager'), 'paz_y_salvo', 'cancelado', {
        dueHours: 48,
      }),
      {
        key: 'paz_y_salvo',
        name: 'Paz y salvo',
        type: 'parallel',
        parallel: {
          join: 'all',
          branches: [
            { key: 'activos', name: 'Devolución de activos y dotación', assignee: role('manager') },
            { key: 'accesos', name: 'Cierre de cuentas y accesos', assignee: role('admin') },
            { key: 'liquidacion', name: 'Liquidación y pagos finales', assignee: role('admin') },
          ],
        },
        transitions: [{ on: 'joined', to: 'cerrado' }],
      },
      end('cerrado', 'Retiro completado', 'completed'),
      end('cancelado', 'Retiro no aprobado', 'cancelled'),
    ],
  ),
};

const SUPPLIER: WorkflowTemplate = {
  key: 'alta-proveedor',
  name: 'Alta de proveedor',
  category: 'Compras',
  description:
    'Registro de un proveedor nuevo con documentos, revisión de administración y aprobación final.',
  icon: 'truck',
  definition: definition(
    'alta-proveedor',
    'Alta de proveedor',
    'Registro de un proveedor nuevo con documentos, revisión de administración y aprobación final.',
    [
      text('razon_social', 'Razón social', true),
      text('nit', 'NIT', true),
      { key: 'correo', type: 'email', label: 'Correo de contacto', required: true },
      { key: 'telefono', type: 'phone', label: 'Teléfono' },
      file('rut', 'RUT', true),
      file('certificacion_bancaria', 'Certificación bancaria', true),
    ],
    [
      form('solicitud', 'Datos del proveedor', ['razon_social', 'nit', 'correo', 'telefono', 'rut', 'certificacion_bancaria'], 'revision', {
        start: true,
      }),
      review('revision', 'Revisión de documentos', role('admin'), 'aprobacion', 'rechazada', 'solicitud', 48),
      approval('aprobacion', 'Aprobación final', role('manager'), 'activo', 'rechazada', { dueHours: 48 }),
      end('activo', 'Proveedor aprobado', 'completed', 'El proveedor fue aprobado y puede usarse.'),
      end('rechazada', 'Proveedor rechazado', 'rejected', 'La solicitud de alta del proveedor fue rechazada.'),
    ],
  ),
};

const CONTRACTS: WorkflowTemplate = {
  key: 'renovacion-contratos',
  name: 'Renovación de contratos',
  category: 'Legal',
  description:
    'Registra un contrato, espera hasta 30 días antes de su vencimiento y pide decidir si se renueva.',
  icon: 'file-signature',
  definition: definition(
    'renovacion-contratos',
    'Renovación de contratos',
    'Registra un contrato, espera hasta 30 días antes de su vencimiento y pide decidir si se renueva.',
    [
      text('contrato', 'Contrato', true),
      text('contraparte', 'Contraparte', true),
      date('fecha_vencimiento', 'Fecha de vencimiento', true),
      money('valor', 'Valor del contrato'),
      textarea('condiciones', 'Condiciones a renegociar'),
      date('nueva_vigencia', 'Nueva fecha de vencimiento'),
    ],
    [
      form('registro', 'Registro del contrato', ['contrato', 'contraparte', 'fecha_vencimiento', 'valor', 'condiciones'], 'espera', {
        start: true,
      }),
      {
        key: 'espera',
        name: 'Esperar al aviso de vencimiento',
        type: 'wait',
        wait: { kind: 'field', field: 'fecha_vencimiento', offset_days: -30 },
        transitions: [{ on: 'elapsed', to: 'decision' }],
      },
      approval('decision', 'Decidir la renovación', role('manager'), 'renovacion', 'no_renovado', {
        dueHours: 120,
        escalateTo: role('owner'),
      }),
      form('renovacion', 'Registrar la nueva vigencia', ['nueva_vigencia'], 'renovado', {
        assignee: role('admin'),
        dueHours: 120,
      }),
      end('renovado', 'Contrato renovado', 'completed'),
      end('no_renovado', 'Contrato no renovado', 'rejected'),
    ],
  ),
};

const PQR_TYPES = ['Petición', 'Queja', 'Reclamo'];

const PQR: WorkflowTemplate = {
  key: 'pqr',
  name: 'PQR',
  category: 'Servicio al cliente',
  description:
    'Peticiones, quejas y reclamos: clasificación, respuesta al cliente y revisión antes de cerrar.',
  icon: 'life-buoy',
  definition: definition(
    'pqr',
    'PQR',
    'Peticiones, quejas y reclamos: clasificación, respuesta al cliente y revisión antes de cerrar.',
    [
      select('tipo', 'Tipo', PQR_TYPES, true),
      text('cliente', 'Nombre del cliente', true),
      { key: 'correo', type: 'email', label: 'Correo del cliente' },
      text('asunto', 'Asunto', true),
      textarea('detalle', 'Detalle del caso', true),
      textarea('respuesta', 'Respuesta al cliente'),
    ],
    [
      form('radicacion', 'Radicación', ['cliente', 'correo', 'asunto', 'detalle'], 'clasificar', {
        start: true,
      }),
      {
        key: 'clasificar',
        name: 'Clasificar con IA',
        type: 'ai',
        ai: {
          task: 'classify',
          instructions:
            'Clasifica el caso del cliente como Petición, Queja o Reclamo según su asunto y detalle. Una petición solicita información o un servicio; una queja expresa inconformidad con la atención; un reclamo exige corregir un error o cumplir algo pendiente.',
          inputs: ['asunto', 'detalle'],
          outputs: ['tipo'],
        },
        transitions: [{ on: 'auto', to: 'redactar' }],
      },
      {
        key: 'redactar',
        name: 'Redactar respuesta con IA',
        type: 'ai',
        ai: {
          task: 'draft',
          instructions:
            'Redacta una respuesta cordial, clara y breve para el cliente, en español, según el tipo y el detalle del caso. No prometas plazos ni compensaciones que no consten en el caso.',
          inputs: ['tipo', 'cliente', 'asunto', 'detalle'],
          outputs: ['respuesta'],
          review: true,
        },
        assignee: role('employee'),
        due: { hours: 72, on_overdue: { remind_every_hours: 12 } },
        transitions: [
          { on: 'approve', to: 'revision' },
          { on: 'reject', to: 'cerrada_sin_respuesta', require_comment: true },
        ],
      },
      review('revision', 'Revisión de la respuesta', role('manager'), 'cerrada', 'cerrada_sin_respuesta', 'redactar', 24),
      end('cerrada', 'Caso respondido', 'completed', 'Tu caso fue respondido y cerrado.'),
      end('cerrada_sin_respuesta', 'Caso descartado', 'rejected'),
    ],
  ),
};

const CASH: WorkflowTemplate = {
  key: 'cierre-caja',
  name: 'Cierre de caja',
  category: 'Finanzas',
  description:
    'Cierre diario de caja con cálculo de la diferencia; si hay descuadre lo revisa el jefe.',
  icon: 'calculator',
  definition: definition(
    'cierre-caja',
    'Cierre de caja',
    'Cierre diario de caja con cálculo de la diferencia; si hay descuadre lo revisa el jefe.',
    [
      text('caja', 'Caja', true),
      date('fecha', 'Fecha del cierre', true),
      money('efectivo_sistema', 'Efectivo según el sistema', true),
      money('efectivo_contado', 'Efectivo contado', true),
      {
        key: 'diferencia',
        type: 'money',
        label: 'Diferencia',
        compute: 'efectivo_contado - efectivo_sistema',
      },
      textarea('observaciones', 'Observaciones'),
    ],
    [
      form('cierre', 'Conteo y cierre', ['caja', 'fecha', 'efectivo_sistema', 'efectivo_contado', 'diferencia', 'observaciones'], 'revision', {
        start: true,
      }),
      {
        key: 'revision',
        name: 'Revisión del descuadre',
        type: 'approval',
        assignee: role('manager'),
        due: { hours: 24, on_overdue: { remind_every_hours: 8 } },
        transitions: [
          { on: 'approve', to: 'cerrada' },
          { on: 'reject', to: 'objetada', require_comment: true },
        ],
      },
      end('cerrada', 'Caja cerrada', 'completed'),
      end('objetada', 'Cierre objetado', 'rejected', 'El cierre de caja fue objetado; revisa el conteo.'),
    ],
  ),
};

const RECONCILIATION: WorkflowTemplate = {
  key: 'conciliacion-mensual',
  name: 'Conciliación mensual',
  category: 'Finanzas',
  description:
    'Conciliación bancaria del mes: preparación, revisión del jefe y aprobación final de gerencia.',
  icon: 'landmark',
  definition: definition(
    'conciliacion-mensual',
    'Conciliación mensual',
    'Conciliación bancaria del mes: preparación, revisión del jefe y aprobación final de gerencia.',
    [
      text('periodo', 'Periodo (mes y año)', true),
      text('banco', 'Banco o cuenta', true),
      money('saldo_libros', 'Saldo según libros', true),
      money('saldo_banco', 'Saldo según extracto', true),
      {
        key: 'diferencia',
        type: 'money',
        label: 'Diferencia por conciliar',
        compute: 'saldo_banco - saldo_libros',
      },
      file('extracto', 'Extracto bancario', true),
      textarea('partidas', 'Partidas conciliatorias'),
    ],
    [
      form('preparacion', 'Preparación de la conciliación', ['periodo', 'banco', 'saldo_libros', 'saldo_banco', 'diferencia', 'extracto', 'partidas'], 'revision', {
        start: true,
        assignee: role('admin'),
        dueHours: 120,
      }),
      review('revision', 'Revisión del jefe', role('manager'), 'aprobacion', 'cerrada_objetada', 'preparacion', 48),
      approval('aprobacion', 'Aprobación de gerencia', role('owner'), 'conciliada', 'cerrada_objetada', {
        dueHours: 48,
      }),
      end('conciliada', 'Mes conciliado', 'completed'),
      end('cerrada_objetada', 'Conciliación objetada', 'rejected'),
    ],
  ),
};

const PAYMENT: WorkflowTemplate = {
  key: 'solicitud-pago',
  name: 'Solicitud de pago',
  category: 'Finanzas',
  description:
    'Pago a un tercero con factura: aprueba el jefe, gerencia los montos altos y administración registra el pago.',
  icon: 'credit-card',
  definition: definition(
    'solicitud-pago',
    'Solicitud de pago',
    'Pago a un tercero con factura: aprueba el jefe, gerencia los montos altos y administración registra el pago.',
    [
      text('beneficiario', 'Beneficiario', true),
      textarea('concepto', 'Concepto del pago', true),
      money('monto', 'Valor a pagar', true),
      date('fecha_limite', 'Fecha límite de pago', true),
      file('factura', 'Factura o cuenta de cobro', true),
      date('fecha_pago', 'Fecha de pago'),
      text('referencia_pago', 'Referencia del pago'),
    ],
    [
      form('solicitud', 'Solicitud de pago', ['beneficiario', 'concepto', 'monto', 'fecha_limite', 'factura'], 'jefe', {
        start: true,
      }),
      approval('jefe', 'Aprobación del jefe', role('manager'), 'pago', 'rechazada', {
        dueHours: 24,
        escalateTo: role('admin'),
        extra: [
          {
            on: 'approve',
            to: 'gerencia',
            when: { all: [{ field: 'monto', op: 'gt', value: 5000000 }] },
          },
        ],
      }),
      approval('gerencia', 'Aprobación de gerencia', role('owner'), 'pago', 'rechazada', { dueHours: 48 }),
      form('pago', 'Registro del pago', ['fecha_pago', 'referencia_pago'], 'pagada', {
        assignee: role('admin'),
        dueHours: 48,
      }),
      end('pagada', 'Pago realizado', 'completed', 'Tu solicitud de pago fue pagada.'),
      end('rechazada', 'Pago rechazado', 'rejected', 'Tu solicitud de pago fue rechazada.'),
    ],
  ),
};

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  PURCHASE,
  EXPENSES,
  ADVANCES,
  LEAVE,
  HIRING,
  OFFBOARDING,
  SUPPLIER,
  CONTRACTS,
  PQR,
  CASH,
  RECONCILIATION,
  PAYMENT,
];

export const WORKFLOW_TEMPLATE_CATEGORIES: readonly string[] = [
  ...new Set(WORKFLOW_TEMPLATES.map((t) => t.category)),
];
