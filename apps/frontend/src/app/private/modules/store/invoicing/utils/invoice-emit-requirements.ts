import { SaveRequirement } from '../../../../../shared/components/save-requirements-modal/save-requirements.interface';
import {
  EmitReadinessVerdict,
  InvoiceEmitReadinessFinding,
  InvoiceEmitReadinessIdentity,
} from '../services/invoice-emit-readiness.service';

/**
 * Ruta real de la pantalla donde vive una resolución de numeración. Declarada
 * en `invoicing.routes.ts` como pestaña del shell del módulo. Se escribe una
 * sola vez: un CTA que navega a una ruta inexistente deja al usuario en la
 * pantalla de "no encontrado" con el problema intacto.
 */
const ROUTE_RESOLUTIONS = '/admin/invoicing/resolutions';
/** Wizard de datos fiscales del emisor (`fiscal-gate.service.ts`). */
const ROUTE_FISCAL_WIZARD = '/admin/fiscal/wizard';
/** Configuración DIAN del módulo de facturación (`invoicing.routes.ts`, `dian-config`). */
const ROUTE_DIAN_CONFIG = '/admin/invoicing/dian-config';

/**
 * Información curada para traducir el `field` de un hallazgo a una fila
 * accionable del modal de requisitos.
 *
 * Lo que NO está aquí: el texto. `problem` y `fix` los redacta el validador del
 * backend, ya en español y nombrando el clic exacto ("Clientes → abre la ficha
 * del cliente → pestaña «Datos fiscales»"). Reescribirlos acá crearía una
 * segunda versión de la instrucción que se desactualiza sola. Este mapa sólo
 * aporta el TÍTULO corto de la fila y, cuando existe, el destino del botón.
 */
export interface InvoiceEmitRequirementInfo {
  /** Título corto de la fila (el `field` humanizado). */
  label: string;
  /**
   * Tipo de acción. Se OMITE a propósito cuando el arreglo no vive en esta
   * pantalla: un botón que enfoca un control inexistente es peor que ningún
   * botón, porque promete un camino que no existe.
   */
  actionKind?: 'focus' | 'scroll' | 'navigate';
  actionLabel?: string;
  /**
   * Para `focus`/`scroll`: el CONTROL NAME real del `FormGroup` de
   * `invoice-create.component.ts`. Para `navigate`: una ruta que existe.
   */
  actionTarget?: string;
}

/**
 * CATÁLOGO CURADO `field → fila`.
 *
 * Las claves son los `field` LITERALES que emiten los dos validadores del
 * backend:
 *  - `validators/customer-fiscal-identity.validator.ts` (identidad del adquiriente)
 *  - `validators/fiscal-document.validator.ts` (documento fiscal)
 *
 * Los campos indexados (`items[3].quantity`) se normalizan a `items[].quantity`
 * antes de buscar acá; el índice se reinyecta en el `target` para que el botón
 * lleve a ESA línea y no a la primera.
 *
 * Regla para decidir el CTA: sólo se emite `focus` cuando el `field` tiene un
 * control equivalente EN ESTE FORMULARIO, verificado leyendo
 * `invoice-create.component.ts`. Los hallazgos de resolución y clave técnica se
 * arreglan en otra pantalla, así que van con `navigate` a una ruta real. Los de
 * aritmética (`subtotal_amount`, `tax_amount`, `total_amount`) y los que el
 * backend calcula solo (`invoice_number`, `currency`) no tienen destino: el
 * servidor recomputa esas cifras y no hay campo que tocar.
 */
export const INVOICE_EMIT_REQUIREMENTS_MAP: Record<
  string,
  InvoiceEmitRequirementInfo
> = {
  // ── Identidad del adquiriente ──────────────────────────────
  document_type: {
    label: 'Tipo de identificación',
    actionKind: 'focus',
    actionLabel: 'Ir al tipo de identificación',
    actionTarget: 'customer_document_type',
  },
  document_number: {
    label: 'Número de documento',
    actionKind: 'focus',
    actionLabel: 'Ir al número de documento',
    actionTarget: 'customer_tax_id',
  },
  verification_digit: {
    label: 'Dígito de verificación',
    actionKind: 'focus',
    actionLabel: 'Ir al DV',
    actionTarget: 'customer_verification_digit',
  },
  legal_name: {
    label: 'Razón social del adquiriente',
    actionKind: 'focus',
    actionLabel: 'Ir al nombre',
    actionTarget: 'customer_name',
  },
  // El formulario captura UN solo campo de nombre. Los tres hallazgos de nombre
  // apuntan al mismo control porque es el único que hay que corregir aquí.
  first_name: {
    label: 'Nombres del adquiriente',
    actionKind: 'focus',
    actionLabel: 'Ir al nombre',
    actionTarget: 'customer_name',
  },
  last_name: {
    label: 'Apellidos del adquiriente',
    actionKind: 'focus',
    actionLabel: 'Ir al nombre',
    actionTarget: 'customer_name',
  },
  // El tipo de persona no se teclea: se deriva del tipo de documento, que SÍ es
  // un control de esta pantalla y es lo único que se puede cambiar para
  // resolver una contradicción entre los dos.
  person_type: {
    label: 'Tipo de persona',
    actionKind: 'focus',
    actionLabel: 'Ir al tipo de identificación',
    actionTarget: 'customer_document_type',
  },
  tax_regime: {
    label: 'Régimen tributario',
    actionKind: 'focus',
    actionLabel: 'Ir al régimen',
    actionTarget: 'customer_tax_regime',
  },
  // Es un `FormControl` real, pero se pinta como una rejilla de checkboxes sin
  // `formControlName` en el DOM. El destino es el `id` del `<fieldset>` que lo
  // envuelve: `scroll` (abrir la sección y desplazarse hasta ahí) es lo que de
  // verdad ocurre, y prometer `focus` sobre un fieldset sería prometer de más.
  tax_responsibilities: {
    label: 'Responsabilidades fiscales (RUT)',
    actionKind: 'scroll',
    actionLabel: 'Ir a responsabilidades',
    actionTarget: 'customer_fiscal_responsibilities',
  },
  email: {
    label: 'Correo del adquiriente',
    actionKind: 'focus',
    actionLabel: 'Ir al correo',
    actionTarget: 'customer_email',
  },
  address: {
    label: 'Dirección fiscal',
    actionKind: 'focus',
    actionLabel: 'Ir a la dirección',
    actionTarget: 'customer_address',
  },
  'address.address_line': {
    label: 'Dirección fiscal',
    actionKind: 'focus',
    actionLabel: 'Ir a la dirección',
    actionTarget: 'customer_address',
  },
  // El resto de la dirección (códigos DANE de municipio y departamento, país,
  // código postal) NO existe en esta pantalla: aquí la dirección es una sola
  // línea de texto. Viven en la ficha del cliente, que es exactamente adonde
  // apunta el `fix` del backend. Sin CTA: la fila informa, no miente.
  'address.city_code': { label: 'Código de municipio (DANE)' },
  'address.city_name': { label: 'Municipio del adquiriente' },
  'address.department_code': { label: 'Código de departamento (DANE)' },
  'address.department_name': { label: 'Departamento del adquiriente' },
  'address.country_code': { label: 'País del adquiriente' },
  'address.postal_code': { label: 'Código postal del adquiriente' },

  // ── Documento fiscal ───────────────────────────────────────
  issue_date: {
    label: 'Fecha de emisión',
    actionKind: 'focus',
    actionLabel: 'Ir a la fecha',
    actionTarget: 'issue_date',
  },
  operation_type: {
    label: 'Tipo de operación',
    actionKind: 'focus',
    actionLabel: 'Ir al tipo de operación',
    actionTarget: 'operation_type',
  },
  // La moneda legal la fija el backend en COP; el selector de divisa de esta
  // pantalla declara una CONVERSIÓN, que es otra cosa. Sin CTA para no mandar
  // al usuario a tocar el campo equivocado.
  currency: { label: 'Moneda del documento' },
  // El consecutivo lo asigna el generador contra la resolución. No hay campo.
  invoice_number: { label: 'Número del documento' },
  items: {
    label: 'Líneas del documento',
    actionKind: 'scroll',
    actionLabel: 'Ir a las líneas',
    actionTarget: 'items',
  },
  'items[].description': {
    label: 'Descripción de la línea',
    actionKind: 'focus',
    actionLabel: 'Ir a la línea',
    actionTarget: 'description',
  },
  'items[].quantity': {
    label: 'Cantidad de la línea',
    actionKind: 'focus',
    actionLabel: 'Ir a la línea',
    actionTarget: 'quantity',
  },
  'items[].unit_price': {
    label: 'Precio unitario de la línea',
    actionKind: 'focus',
    actionLabel: 'Ir a la línea',
    actionTarget: 'unit_price',
  },
  'items[].unit_code': {
    label: 'Unidad de medida de la línea',
    actionKind: 'focus',
    actionLabel: 'Ir a la línea',
    actionTarget: 'unit_code',
  },
  'items[].discount_amount': {
    label: 'Descuento de la línea',
    actionKind: 'focus',
    actionLabel: 'Ir a la línea',
    actionTarget: 'discount_amount',
  },
  // A.3 — el residuo no absorbible (`INVOICING_CALC_005`) nombra la línea cuyo
  // importe no cierra al centavo. El impuesto de la línea se declara en su
  // propio selector (`formControlName="taxes"` de la fila): el destino viaja
  // como `items.<i>.taxes`, la MISMA convención que `itemError()`, para que el
  // botón lleve a ESA línea y no a la primera ni al agregado de cabecera.
  'items[].tax_amount': {
    label: 'Impuesto de la línea',
    actionKind: 'focus',
    actionLabel: 'Ir a la línea',
    actionTarget: 'taxes',
  },
  // Los impuestos se declaran POR LÍNEA en esta pantalla; la sección
  // «Impuestos» enseña el agregado que el servidor va a recomputar. Ahí es
  // donde se ve el desglose que el hallazgo está discutiendo.
  //
  // El destino es `taxes_section` —el `id` de esa sección— y NO `taxes` a
  // secas: cada línea lleva un `formControlName="taxes"` y el selector del
  // consumidor encontraría PRIMERO el de la primera línea, desplazando al
  // sitio equivocado.
  taxes: {
    label: 'Impuestos del documento',
    actionKind: 'scroll',
    actionLabel: 'Ir a impuestos',
    actionTarget: 'taxes_section',
  },
  'taxes[]': {
    label: 'Fila de impuesto',
    actionKind: 'scroll',
    actionLabel: 'Ir a impuestos',
    actionTarget: 'taxes_section',
  },
  'taxes[].tax_rate': {
    label: 'Tarifa del impuesto',
    actionKind: 'scroll',
    actionLabel: 'Ir a impuestos',
    actionTarget: 'taxes_section',
  },
  'taxes[].tax_amount': {
    label: 'Importe del impuesto',
    actionKind: 'scroll',
    actionLabel: 'Ir a impuestos',
    actionTarget: 'taxes_section',
  },
  // Aritmética recomputada por el servidor: la fila es el diagnóstico, no un
  // campo. Enfocar un total que el usuario no teclea no arregla nada.
  subtotal_amount: { label: 'Base gravable declarada' },
  tax_amount: { label: 'Total de impuestos declarado' },
  total_amount: { label: 'Total del documento' },

  // ── Resolución de numeración y clave técnica ───────────────
  // Se arreglan en otra pantalla, y esa pantalla EXISTE: es la pestaña
  // «Resoluciones» del propio módulo de facturación.
  resolution: {
    label: 'Resolución de numeración',
    actionKind: 'navigate',
    actionLabel: 'Ir a Resoluciones',
    actionTarget: ROUTE_RESOLUTIONS,
  },
  'resolution.resolution_number': {
    label: 'Número de la resolución',
    actionKind: 'navigate',
    actionLabel: 'Ir a Resoluciones',
    actionTarget: ROUTE_RESOLUTIONS,
  },
  'resolution.prefix': {
    label: 'Prefijo de la resolución',
    actionKind: 'navigate',
    actionLabel: 'Ir a Resoluciones',
    actionTarget: ROUTE_RESOLUTIONS,
  },
  'resolution.is_active': {
    label: 'Resolución inactiva',
    actionKind: 'navigate',
    actionLabel: 'Ir a Resoluciones',
    actionTarget: ROUTE_RESOLUTIONS,
  },
  'resolution.current_number': {
    label: 'Consecutivo de la resolución',
    actionKind: 'navigate',
    actionLabel: 'Ir a Resoluciones',
    actionTarget: ROUTE_RESOLUTIONS,
  },
  'resolution.range_to': {
    label: 'Rango autorizado',
    actionKind: 'navigate',
    actionLabel: 'Ir a Resoluciones',
    actionTarget: ROUTE_RESOLUTIONS,
  },
  'resolution.valid_to': {
    label: 'Vigencia de la resolución',
    actionKind: 'navigate',
    actionLabel: 'Ir a Resoluciones',
    actionTarget: ROUTE_RESOLUTIONS,
  },
  'resolution.technical_key': {
    label: 'Clave técnica (ClTec)',
    actionKind: 'navigate',
    actionLabel: 'Ir a Resoluciones',
    actionTarget: ROUTE_RESOLUTIONS,
  },

  // ── Divisa, fechas y medio de pago ─────────────────────────
  exchange_rate: {
    label: 'Tasa de cambio',
    actionKind: 'focus',
    actionLabel: 'Ir a la tasa de cambio',
    actionTarget: 'exchange_rate',
  },
  due_date: {
    label: 'Fecha de vencimiento',
    actionKind: 'focus',
    actionLabel: 'Ir al vencimiento',
    actionTarget: 'due_date',
  },
  payment_means_code: {
    label: 'Medio de pago',
    actionKind: 'focus',
    actionLabel: 'Ir al medio de pago',
    actionTarget: 'payment_means_code',
  },
  aiu_contract_object: {
    label: 'Objeto del contrato AIU',
    actionKind: 'focus',
    actionLabel: 'Ir al objeto del contrato',
    actionTarget: 'aiu_contract_object',
  },
  'items[].aiu_component': {
    label: 'Componente AIU de la línea',
    actionKind: 'focus',
    actionLabel: 'Ir a la línea',
    actionTarget: 'aiu_component',
  },
  'items[].taxes': {
    label: 'Impuestos de la línea',
    actionKind: 'focus',
    actionLabel: 'Ir a la línea',
    actionTarget: 'taxes',
  },

  // ── Emisor y configuración DIAN (otra pantalla) ────────────
  // Comodines: `issuer.nit`, `issuer.tax_responsibilities`… caen aquí por
  // prefijo (ver `lookupInfo`).
  'issuer.*': {
    label: 'Datos fiscales del emisor',
    actionKind: 'navigate',
    actionLabel: 'Completar datos fiscales',
    actionTarget: ROUTE_FISCAL_WIZARD,
  },
  'dian_config.*': {
    label: 'Configuración DIAN',
    actionKind: 'navigate',
    actionLabel: 'Configurar DIAN',
    actionTarget: ROUTE_DIAN_CONFIG,
  },
};

/**
 * Busca la fila del catálogo: clave exacta y, si no hay, el comodín del
 * prefijo (`issuer.nit` → `issuer.*`).
 */
function lookupInfo(key: string): InvoiceEmitRequirementInfo | undefined {
  const exact = INVOICE_EMIT_REQUIREMENTS_MAP[key];
  if (exact) {
    return exact;
  }
  const dot = key.indexOf('.');
  if (dot > 0) {
    return INVOICE_EMIT_REQUIREMENTS_MAP[`${key.slice(0, dot)}.*`];
  }
  return undefined;
}

/** Etiqueta del botón según la ruta de configuración a la que lleva. */
export function configActionLabel(cta: string): string {
  if (cta.includes('/resolutions')) return 'Ir a Resoluciones';
  if (cta.includes('/fiscal/')) return 'Completar datos fiscales';
  if (cta.includes('/dian-config')) return 'Configurar DIAN';
  if (/\/(customers|clientes)/.test(cta)) return 'Editar ficha del cliente';
  return 'Ir a configuración';
}

/**
 * Traduce el veredicto de `emit-readiness` en filas del modal de requisitos.
 *
 * Reglas:
 *  - `blockers` → `severity: 'blocker'`; `warnings` → `severity: 'required'`.
 *    Un aviso no impide emitir: es una ausencia que hace al documento decir
 *    menos, no decir algo falso. Mezclarlos convertiría un "podrías mejorar"
 *    en un "no puedes emitir".
 *  - Se leen `blockers` y `warnings`, NO `findings`: `findings` es la unión de
 *    los dos y usarlo además duplicaría cada fila.
 *  - `fiscal_document === null` no aporta filas y NO es un problema: significa
 *    que ese tipo de documento no se emite a la DIAN.
 *  - El `id` combina origen + código + campo. Dos validadores pueden emitir el
 *    mismo `code`, y un mismo `code` puede repetirse en varias líneas; el modal
 *    itera con `track req.id`, así que un id repetido no es un detalle estético.
 *
 * Además de `identity` y `fiscal_document`, se recorren los `blockers` y
 * `warnings` de la RAÍZ del veredicto (origen `'document'`): ahí viajan los
 * hallazgos que no pertenecen a ninguno de los dos (proyección fallida, emisor,
 * recolectados). Sólo se añaden los que no estén ya en identity/fiscal, con
 * clave `code|field`.
 *
 * `readiness` se tipa como el NÚCLEO compartido (`EmitReadinessVerdict`), no
 * como `InvoiceEmitReadiness`: no necesita `invoice_id` ni `status`, así que sirve IGUAL para el veredicto de un documento ya
 * persistido (`GET /:id/emit-readiness`) y para el de un borrador que todavía
 * no existe (`POST /validate-draft`, `DraftEmitReadinessReport`) — ninguno de
 * los dos usos declara `invoice_id`/`invoice_number`/`status`.
 */
export function toEmitRequirements(
  readiness: EmitReadinessVerdict | null | undefined,
): SaveRequirement[] {
  if (!readiness) {
    return [];
  }

  const rows: SaveRequirement[] = [];
  const identity = identityReportOf(readiness);

  for (const finding of identity.blockers) {
    rows.push(toRequirement('identity', finding, 'blocker'));
  }
  for (const finding of identity.warnings) {
    rows.push(toRequirement('identity', finding, 'required'));
  }

  const fiscal = readiness.fiscal_document;
  if (fiscal) {
    for (const finding of fiscal.blockers) {
      rows.push(toRequirement('fiscal', finding, 'blocker'));
    }
    for (const finding of fiscal.warnings) {
      rows.push(toRequirement('fiscal', finding, 'required'));
    }
  }

  // Hallazgos que el backend publica SOLO en la raíz del veredicto: proyección
  // fallida del borrador, emisor (config DIAN, certificado, resolución, TRM) y
  // recolectados (DV, producto en línea, retenciones). Se añaden únicamente los
  // que identity/fiscal no trajeron ya: el veredicto persistido viejo aplana la
  // identidad en la raíz y, sin esta deduplicación, saldría cada fila dos veces.
  const seen = new Set<string>();
  const keyOf = (f: InvoiceEmitReadinessFinding): string =>
    `${f.code}|${f.field ?? ''}`;
  const collect = (list: InvoiceEmitReadinessFinding[] | undefined): void => {
    for (const f of list ?? []) {
      seen.add(keyOf(f));
    }
  };
  collect(identity.blockers);
  collect(identity.warnings);
  collect(fiscal?.blockers);
  collect(fiscal?.warnings);

  const rootRows = (
    list: unknown,
    severity: 'blocker' | 'required',
  ): void => {
    if (!Array.isArray(list)) {
      return;
    }
    for (const f of list as InvoiceEmitReadinessFinding[]) {
      const key = keyOf(f);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push(toRequirement('document', f, severity));
    }
  };
  rootRows(readiness.blockers, 'blocker');
  rootRows(readiness.warnings, 'required');

  return dedupeIds(rows);
}

/**
 * El informe de identidad inequívoco.
 *
 * El documento YA persistido (`GET /:id/emit-readiness`) publica la identidad
 * DOS veces: aplanada en la raíz (contrato heredado, `InvoiceEmitReadiness`
 * extiende `InvoiceEmitReadinessIdentity`) y completa en `identity`. Se
 * prefiere `identity`; la raíz aplanada es el respaldo por si un despliegue
 * viejo no la trae, porque quedarse sin hallazgos por elegir la copia
 * equivocada es justo el fallo silencioso que esta puerta viene a evitar.
 *
 * El borrador (`POST /validate-draft`, `DraftEmitReadinessReport`) NO aplana
 * nada en la raíz — por eso el parámetro se tipa `EmitReadinessVerdict` (el
 * núcleo que ambos comparten) y el respaldo se lee con un cast tolerante: si
 * `identity` no trae arreglos utilizables, la raíz puede o no tener `mode` /
 * `normalized`, y `?? `de abajo cubre ese hueco sin fingir un dato que nunca
 * llegó.
 */
function identityReportOf(
  readiness: EmitReadinessVerdict,
): InvoiceEmitReadinessIdentity {
  const identity = readiness.identity;
  const source: Partial<InvoiceEmitReadinessIdentity> =
    identity &&
    (Array.isArray(identity.blockers) || Array.isArray(identity.warnings))
      ? identity
      : readiness;

  return {
    emittable: source.emittable === true,
    mode: source.mode ?? 'nominative',
    findings: source.findings ?? [],
    blockers: source.blockers ?? [],
    warnings: source.warnings ?? [],
    normalized: source.normalized ?? null,
  };
}

/** Un hallazgo, ya convertido en fila del modal. */
function toRequirement(
  origin: 'identity' | 'fiscal' | 'document',
  finding: InvoiceEmitReadinessFinding,
  severity: 'blocker' | 'required',
): SaveRequirement {
  const field = finding.field ?? '';
  const key = normalizeFieldKey(field);
  const info = lookupInfo(key);
  const index = lineIndexOf(field);

  // El título nombra la línea concreta cuando el hallazgo la trae: "Cantidad de
  // la línea 3" localiza el problema sin abrir nada.
  const baseLabel = info?.label ?? humanizeField(field);
  const label =
    index === null ? baseLabel : `${baseLabel} ${index + 1}`;

  return {
    id: `${origin}:${finding.code}:${field}`,
    label,
    // `problem` (qué está mal) + `fix` (dónde se corrige), tal cual los redactó
    // el validador. Aquí NO se reescriben.
    reason: [finding.problem, finding.fix].filter(Boolean).join(' ').trim(),
    severity,
    action: buildAction(info, index, finding),
  };
}

/**
 * El CTA de la fila, o `undefined` cuando el arreglo no vive en esta pantalla.
 *
 * Para los campos de línea, el `target` viaja como `items.<i>.<control>`: es la
 * MISMA convención de ruta que ya usa `itemError()` en el formulario, así que
 * el consumidor no tiene que aprender un segundo formato.
 */
function buildAction(
  info: InvoiceEmitRequirementInfo | undefined,
  index: number | null,
  finding?: InvoiceEmitReadinessFinding,
): SaveRequirement['action'] {
  // El backend manda: un hallazgo de configuración con ruta navega ahí, aunque
  // el catálogo no conozca el `field`.
  if (finding?.target === 'config' && finding.cta) {
    return {
      label: configActionLabel(finding.cta),
      kind: 'navigate',
      target: finding.cta,
    };
  }
  if (!info?.actionKind || !info.actionTarget) {
    return undefined;
  }
  const target =
    index !== null && info.actionKind !== 'navigate'
      ? `items.${index}.${info.actionTarget}`
      : info.actionTarget;

  return {
    label: info.actionLabel ?? info.label,
    kind: info.actionKind,
    target,
  };
}

/**
 * Clave de búsqueda del mapa: `items[3].quantity` → `items[].quantity`. El
 * índice concreto no puede ser parte de la clave o el catálogo tendría que
 * enumerar las cien líneas posibles.
 */
function normalizeFieldKey(field: string): string {
  return field.replace(/\[\d+\]/g, '[]');
}

/** Índice de la fila que nombra el `field`, o `null` si no nombra ninguna. */
function lineIndexOf(field: string): number | null {
  const match = /\[(\d+)\]/.exec(field);
  if (!match) {
    return null;
  }
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/**
 * Último recurso para un `field` que el catálogo todavía no conoce: se muestra
 * legible en vez de descartarse. Un hallazgo sin fila es un bloqueante que el
 * usuario nunca ve, y eso es peor que un título imperfecto.
 */
function humanizeField(field: string): string {
  const clean = normalizeFieldKey(field).replace(/\[\]/g, '').trim();
  if (!clean) {
    return 'Dato del documento';
  }
  const readable = clean.replace(/[._]/g, ' ');
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

/**
 * Garantiza ids únicos.
 *
 * El modal itera con `track req.id`; dos filas con el mismo id rompen el `@for`
 * de Angular en tiempo de ejecución. La combinación origen+código+campo ya es
 * única en la práctica, pero un validador puede emitir dos hallazgos distintos
 * sobre el mismo campo con el mismo código, y esa posibilidad no puede
 * depender de la buena voluntad del backend.
 */
function dedupeIds(rows: SaveRequirement[]): SaveRequirement[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      return row;
    }
    let ordinal = 2;
    let candidate = `${row.id}#${ordinal}`;
    while (seen.has(candidate)) {
      ordinal += 1;
      candidate = `${row.id}#${ordinal}`;
    }
    seen.add(candidate);
    return { ...row, id: candidate };
  });
}

/**
 * Rango de sección de un destino de `focus`/`scroll`, en el orden de la
 * pantalla: Documento, Adquiriente, AIU, Líneas, Impuestos, Retenciones, Divisa.
 */
function sectionRank(target: string | undefined): number {
  const t = target ?? '';
  const control = /^items\.\d+\.(.+)$/.exec(t)?.[1] ?? t;
  if (t === 'taxes_section' || t === 'taxes') return 4;
  if (control === 'aiu_component' || t === 'aiu_contract_object') return 2;
  if (t.startsWith('customer_')) return 1;
  if (
    t === 'items' ||
    t.startsWith('items.') ||
    ['description', 'quantity', 'unit_code', 'discount_amount'].includes(t)
  ) {
    return 3;
  }
  if (t === 'manual_withholding' || t === 'withholding_amount') return 5;
  if (t === 'exchange_rate' || t === 'exchange_rate_date') return 6;
  // issue_date, due_date, payment_means_code, operation_type y lo desconocido.
  return 0;
}

/**
 * Ordena las filas: primero las que se arreglan en el formulario (por sección,
 * estable dentro de cada una), luego las que navegan a otra pantalla y al final
 * las informativas sin acción. No muta la entrada.
 */
export function sortRequirements(
  reqs: readonly SaveRequirement[],
): SaveRequirement[] {
  const group = (r: SaveRequirement): number => {
    const kind = r.action?.kind;
    if (kind === 'navigate') return 1;
    if (kind === 'focus' || kind === 'scroll') return 0;
    return 2;
  };
  return reqs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const g = group(a.r) - group(b.r);
      if (g !== 0) return g;
      if (group(a.r) === 0) {
        const s = sectionRank(a.r.action?.target) - sectionRank(b.r.action?.target);
        if (s !== 0) return s;
      }
      return a.i - b.i;
    })
    .map((x) => x.r);
}
