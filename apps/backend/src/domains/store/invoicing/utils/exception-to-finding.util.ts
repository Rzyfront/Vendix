import { VendixHttpException } from '../../../../common/errors';
import type { EmitReadinessFinding } from '../invoice-flow/emit-readiness.contract';

/**
 * De EXCEPCIÓN de la puerta de datos a HALLAZGO de la puerta de emisión.
 *
 * `validate-draft` es el motor único de prevalidación: la pantalla tiene que
 * recibir TODO lo que falta como una lista de hallazgos con `field`, `target` y
 * `cta`, y no como un 4xx que la deja con un toast. Pero las puertas de datos de
 * `InvoicingService` (aritmética, AIU, perfil, período cerrado, cliente de otro
 * tenant...) ya existen y lanzan `VendixHttpException` con el texto real que el
 * usuario leería al crear. Esta función NO reescribe esos mensajes: toma el
 * `message` de la excepción como `problem` y sólo añade lo que la excepción no
 * trae —a qué campo apunta, si se corrige en el formulario o en la
 * configuración, y a qué ruta ir—.
 *
 * Los errores que no están en la tabla devuelven `null`: el llamador los
 * relanza. Convertir un error desconocido en un hallazgo escondería un 500 real
 * detrás de una lista de requisitos.
 */

/** Rutas REALES del frontend (`apps/frontend/.../store/**.routes.ts`). */
export const EMIT_READINESS_CTA = {
  resolutions: '/admin/invoicing/resolutions',
  dian_config: '/admin/invoicing/dian-config',
  fiscal_wizard: '/admin/fiscal/wizard',
  profiles: '/admin/invoicing/profiles',
  customer: (customer_id: number | string) =>
    `/admin/customers/${customer_id}`,
} as const;

/** Contexto opcional: sólo lo que la excepción no puede saber por sí sola. */
export interface ExceptionToFindingContext {
  /** Id de la ficha del adquiriente, cuando la factura la trae. */
  customer_id?: number | null;
}

interface FindingTemplate {
  /** Campo cuando la excepción no trae `details.line_index` ni `details.field`. */
  field?: string;
  /** Campo de línea: se antepone `items[<line_index>].` cuando hay índice. */
  line_field?: string;
  target: 'form' | 'config';
  cta?: string;
  fix: string;
}

const TEMPLATES: Record<string, FindingTemplate> = {
  INVOICING_CALC_001: {
    field: 'taxes',
    line_field: 'taxes',
    target: 'form',
    fix: 'Agrega el impuesto con su tarifa (por ejemplo IVA 19%) en la línea indicada, o deja el importe del impuesto en cero.',
  },
  INVOICING_CALC_002: {
    field: 'items',
    line_field: 'taxes',
    target: 'form',
    fix: 'Selecciona el impuesto desde el catálogo de la tienda: la tarifa que enviaste no existe o es de otra tienda.',
  },
  INVOICING_CALC_003: {
    field: 'items',
    line_field: 'product_id',
    target: 'form',
    fix: 'Selecciona el producto desde el buscador, o deja la línea sin producto si es un ítem libre.',
  },
  INVOICING_CALC_004: {
    field: 'customer_id',
    target: 'form',
    fix: 'Selecciona el cliente desde el buscador de clientes, o créalo antes de facturar.',
  },
  INVOICING_CALC_005: {
    field: 'items',
    line_field: 'unit_price',
    target: 'form',
    fix: 'Ajusta el precio o el descuento de la línea para que base más impuestos igualen el total cobrado.',
  },
  INVOICING_CALC_006: {
    field: 'items',
    line_field: 'unit_price',
    target: 'form',
    fix: 'Corrige la línea indicada: trae un valor numérico inválido (precio, cantidad, descuento o tarifa).',
  },
  INVOICING_AIU_001: {
    field: 'items',
    target: 'form',
    fix: 'Sube el valor del AIU hasta el mínimo legal del 10% del contrato, o cambia la base gravable del AIU en la configuración de facturación.',
  },
  INVOICING_AIU_002: {
    field: 'aiu_contract_object',
    target: 'form',
    fix: 'Describe el objeto del contrato AIU (entre 20 y 5000 caracteres) en el campo «Objeto del contrato».',
  },
  INVOICING_AIU_003: {
    field: 'items',
    line_field: 'aiu_component',
    target: 'form',
    fix: 'Cambia el tipo de operación a AIU o quita la marca de componente AIU de la línea.',
  },
  INVOICING_AIU_004: {
    field: 'items',
    line_field: 'taxes',
    target: 'form',
    fix: 'Declara el impuesto de la línea con su tarifa (usa tarifa 0 si es exento o excluido).',
  },
  INVOICING_AIU_007: {
    field: 'items',
    line_field: 'aiu_component',
    target: 'form',
    fix: 'Usa sólo líneas «contrato» o sólo líneas por componente (administración, imprevistos, utilidad), nunca ambas.',
  },
  INVOICING_PROFILE_006: {
    field: 'profile_id',
    target: 'form',
    fix: 'Elige otro perfil de facturación o activa este perfil en Facturación → Perfiles.',
  },
  INVOICING_PROFILE_008: {
    field: 'operation_type',
    target: 'form',
    fix: 'Cambia el tipo de operación de la factura o elige un perfil del mismo tipo de operación.',
  },
  INVOICING_PROFILE_009: {
    field: 'profile_id',
    target: 'config',
    cta: EMIT_READINESS_CTA.profiles,
    fix: 'Abre el perfil de facturación y guárdalo una vez para que tenga una versión.',
  },
  FISCAL_ACCOUNTING_BLOCKED: {
    field: 'issue_date',
    target: 'form',
    fix: 'El período fiscal de esa fecha está cerrado. Usa una fecha de emisión dentro de un período abierto.',
  },
  SYS_VALIDATION_001: {
    field: 'due_date',
    target: 'form',
    fix: 'Corrige la fecha de vencimiento: es obligatoria en ventas a crédito y no puede ser anterior a la fecha de emisión.',
  },
  FISCAL_RESOLUTION_MISSING: {
    field: 'resolution',
    target: 'config',
    cta: EMIT_READINESS_CTA.resolutions,
    fix: 'Crea o activa una resolución de numeración vigente para este tipo de documento.',
  },
  FISCAL_RESOLUTION_EXHAUSTED: {
    field: 'resolution.range_to',
    target: 'config',
    cta: EMIT_READINESS_CTA.resolutions,
    fix: 'El rango autorizado se agotó: solicita y registra una nueva resolución de numeración.',
  },
  INVOICING_RESOLUTION_009: {
    field: 'resolution.range_from',
    target: 'config',
    cta: EMIT_READINESS_CTA.resolutions,
    fix: 'Corrige el rango autorizado de la resolución (desde y hasta).',
  },
  INVOICING_RESOLUTION_010: {
    field: 'resolution.valid_to',
    target: 'config',
    cta: EMIT_READINESS_CTA.resolutions,
    fix: 'Corrige las fechas de vigencia de la resolución: la final debe ser posterior a la inicial.',
  },
  INVOICING_RESOLUTION_011: {
    field: 'resolution.technical_key',
    target: 'config',
    cta: EMIT_READINESS_CTA.resolutions,
    fix: 'Corrige la clave técnica de la resolución: debe tener 40 o 64 caracteres hexadecimales, tal como la entrega la DIAN.',
  },
  INVOICING_AREA_001: {
    field: 'dian_config.area',
    target: 'config',
    cta: EMIT_READINESS_CTA.dian_config,
    fix: 'Activa el área de facturación electrónica en la configuración fiscal.',
  },
  INVOICING_ENABLEMENT_001: {
    field: 'dian_config.enablement_status',
    target: 'config',
    cta: EMIT_READINESS_CTA.dian_config,
    fix: 'Completa la habilitación DIAN (producción y habilitado) en Facturación → Configuración DIAN.',
  },
  DIAN_PROVIDER_OWN_SOFTWARE_REQUIRED: {
    field: 'dian_config.operation_mode',
    target: 'config',
    cta: EMIT_READINESS_CTA.dian_config,
    fix: 'Configura la facturación con software propio en Facturación → Configuración DIAN.',
  },
  DIAN_CERT_003: {
    field: 'dian_config.certificate_expiry',
    target: 'config',
    cta: EMIT_READINESS_CTA.dian_config,
    fix: 'El certificado digital está vencido: carga uno vigente en Facturación → Configuración DIAN.',
  },
  DIAN_CERT_004: {
    field: 'dian_config.certificate_nit',
    target: 'config',
    cta: EMIT_READINESS_CTA.dian_config,
    fix: 'El NIT del certificado no coincide con el NIT fiscal: carga el certificado emitido a nombre del NIT correcto.',
  },
  DIAN_ENABLEMENT_001: {
    field: 'dian_config.enablement_status',
    target: 'config',
    cta: EMIT_READINESS_CTA.dian_config,
    fix: 'Completa los requisitos pendientes de la habilitación DIAN en Facturación → Configuración DIAN.',
  },
  FISCAL_IDENTITY_INCOMPLETE: {
    field: 'issuer.identity',
    target: 'config',
    cta: EMIT_READINESS_CTA.fiscal_wizard,
    fix: 'Completa la identidad fiscal del emisor (razón social, municipio y departamento) en el asistente fiscal.',
  },
  INVOICING_TRM_001: {
    field: 'exchange_rate',
    target: 'form',
    fix: 'Escribe la tasa de cambio (pesos por una unidad de la divisa) o cambia la moneda a COP.',
  },
  INVOICING_WITHHOLDING_002: {
    field: 'withholdings',
    target: 'form',
    fix: 'Elige conceptos de retención que existan y estén activos en Contabilidad → Retenciones.',
  },
  INVOICING_WITHHOLDING_003: {
    field: 'withholdings',
    target: 'form',
    fix: 'Corrige el valor, la base o la tarifa de la retención: el valor declarado no coincide con base por tarifa.',
  },
};

const FISCAL_CONFIG_INCOMPLETE = 'FISCAL_CONFIG_INCOMPLETE';
const CUSTOMER_NIT_DV_MISMATCH = 'CUSTOMER_NIT_DV_MISMATCH';

function readBody(err: VendixHttpException): {
  message: string;
  details: Record<string, any>;
} {
  const body = err.getResponse() as any;
  const message =
    typeof body === 'string'
      ? body
      : typeof body?.message === 'string'
        ? body.message
        : String(err.message ?? err.errorCode);
  const details =
    body && typeof body === 'object' && body.details ? body.details : {};
  return { message, details };
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function build(
  code: string,
  template: FindingTemplate,
  message: string,
  details: Record<string, any>,
  overrides?: Partial<EmitReadinessFinding>,
): EmitReadinessFinding {
  let field = template.field;
  if (isIndex(details.line_index) && template.line_field) {
    field = `items[${details.line_index}].${template.line_field}`;
  } else if (isIndex(details.tax_index) && template.line_field === 'taxes') {
    field = `taxes[${details.tax_index}]`;
  }
  if (typeof details.field === 'string' && details.field) {
    field = details.field;
  }

  const finding: EmitReadinessFinding = {
    code,
    severity: 'blocker',
    field,
    problem: message,
    fix: template.fix,
    target: template.target,
    ...(template.cta ? { cta: template.cta } : {}),
    ...(Object.keys(details).length ? { details } : {}),
    ...overrides,
  };
  return finding;
}

export function exceptionToFinding(
  err: unknown,
  ctx?: ExceptionToFindingContext,
): EmitReadinessFinding | null {
  if (!(err instanceof VendixHttpException)) return null;
  const code = err.errorCode;
  const { message, details } = readBody(err);

  // Dos códigos cuyo destino depende de DÓNDE se originó el error.
  if (code === FISCAL_CONFIG_INCOMPLETE) {
    // Falta un dato de la resolución (`resolveInvoiceControl`).
    if (
      details.missing_field === 'resolution_number' ||
      details.missing_field === 'prefix'
    ) {
      return build(
        code,
        {
          target: 'config',
          cta: EMIT_READINESS_CTA.resolutions,
          fix:
            details.missing_field === 'prefix'
              ? 'Escribe el prefijo de la resolución de numeración.'
              : 'Escribe el número de autorización de la resolución de numeración.',
        },
        message,
        details,
        {
          field:
            details.missing_field === 'prefix'
              ? 'resolution.prefix'
              : 'resolution.resolution_number',
        },
      );
    }
    // Documento soporte sin proveedor o proveedor sin NIT.
    if (details.supplier_id !== undefined || !('configuration_type' in details)) {
      return build(
        code,
        {
          field: 'supplier_id',
          target: 'form',
          fix: 'Selecciona un proveedor que tenga número de identificación (NIT o cédula) registrado.',
        },
        message,
        details,
      );
    }
    // No hay configuración DIAN de software propio para el tipo de documento.
    return build(
      code,
      {
        field: 'dian_config.configuration',
        target: 'config',
        cta: EMIT_READINESS_CTA.dian_config,
        fix: 'Configura y habilita la facturación electrónica con software propio en Facturación → Configuración DIAN.',
      },
      message,
      details,
    );
  }

  if (code === 'FISCAL_IDENTITY_INCOMPLETE') {
    const missing: string[] = Array.isArray(details.missing)
      ? details.missing
      : details.missing_field
        ? [details.missing_field]
        : [];
    return build(
      code,
      {
        field: 'issuer.identity',
        target: 'config',
        cta:
          typeof details.cta === 'string'
            ? details.cta
            : EMIT_READINESS_CTA.fiscal_wizard,
        fix: `Completa la identidad fiscal del emisor en el asistente fiscal${
          missing.length ? ` (falta: ${missing.join(', ')})` : ''
        }.`,
      },
      message,
      details,
      {
        field: `issuer.${details.missing_field ?? 'identity'}`,
      },
    );
  }

  if (code === CUSTOMER_NIT_DV_MISMATCH) {
    const field = 'customer_verification_digit';
    const fix =
      'Corrige el dígito de verificación del NIT del cliente, o separa el NIT del DV (el número va sin DV).';
    // Con ficha vinculada, el NIT se corrige en la ficha.
    if (ctx?.customer_id != null) {
      return build(
        code,
        {
          field,
          target: 'config',
          cta: EMIT_READINESS_CTA.customer(ctx.customer_id),
          fix,
        },
        message,
        { ...details, customer_id: ctx.customer_id },
      );
    }
    return build(code, { field, target: 'form', fix }, message, details);
  }

  const template = TEMPLATES[code];
  if (!template) return null;
  return build(code, template, message, details);
}
