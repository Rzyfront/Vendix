import {
    AiuBucket,
    InvoiceProfileConfig,
} from '../../../../../core/utils/invoice-profile-config.contract';

/**
 * Contratos del recurso «perfil de facturación».
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTAS INTERFACES SE ESCRIBIERON CONTRA LA RESPUESTA VIVA, NO CONTRA EL DTO
 * ═══════════════════════════════════════════════════════════════════════════
 * Un DTO declara lo que el servidor ACEPTA; una respuesta es lo que el
 * servidor MANDA, y no son la misma forma. `tsc` no puede notar la diferencia:
 * una interfaz que diga `created_at: Date` compila perfectamente contra un
 * servidor que manda `"2026-08-22T12:08:21.797Z"` y revienta en el primer
 * `.getTime()`. Cada campo de aquí abajo se verificó con `curl` +
 * `type(v).__name__` sobre `roku`, y los tipos son los observados.
 *
 * En particular:
 * - Las fechas son `string` ISO. El backend serializa `DateTime` a JSON, así
 *   que nunca llegan como `Date`.
 * - Los porcentajes y los importes del `config` son `string`, no `number`:
 *   viajan como decimales con escala fija para que el redondeo del navegador
 *   no toque una cifra fiscal.
 * - `created_by` es nullable en la base (`Int?`), así que aquí es
 *   `number | null` aunque hoy toda fila tenga autor.
 *
 * El CONFIG no se redefine: se importa `InvoiceProfileConfig` del espejo
 * (`core/utils/invoice-profile-config.contract.ts`), que ya es byte a byte el
 * del backend y tiene su propio candado de igualdad de fuentes. Volver a
 * declararlo aquí crearía la tercera fuente de verdad de una forma fiscal.
 */

/**
 * `invoice_profile_state_enum`. Espejo de `INVOICE_PROFILE_STATES` del backend
 * (`profiles/dto/invoice-profile.constants.ts`).
 *
 * No hay `archived`: un perfil no se archiva, se desactiva — porque las
 * facturas timbradas referencian su VERSIÓN, no su estado, y la FK compuesta
 * hacia `invoice_profile_versions` es `ON DELETE RESTRICT`.
 */
export type InvoiceProfileState = 'active' | 'inactive';

export const INVOICE_PROFILE_STATES: readonly InvoiceProfileState[] = [
    'active',
    'inactive',
] as const;

/**
 * Tipo de operación DIAN del perfil (`sts:CustomizationID`).
 *
 * Se tipa como `string` y NO como unión de literales a propósito: el catálogo
 * vive en `DIAN_INVOICE_OPERATION_TYPES` del backend y crece cuando la DIAN
 * añade una operación. Una unión cerrada aquí convertiría un valor nuevo y
 * válido —mandatos, transporte— en un error de compilación del frontend, que
 * es exactamente al revés de lo que debe pasar: el frontend tiene que
 * PINTARLO, aunque no sepa etiquetarlo.
 *
 * `INVOICE_PROFILE_OPERATION_LABELS` traduce los que conocemos; para el resto
 * se muestra el código, que es información verdadera y no una mentira bonita.
 */
export type InvoiceProfileOperationType = string;

export const INVOICE_PROFILE_OPERATION_LABELS: Readonly<Record<string, string>> = {
    '10': 'Estándar',
    '09': 'AIU',
    '11': 'Mandatos',
    '12': 'Transporte',
    '13': 'Cambiario',
};

/** Etiqueta legible del tipo de operación, o el código crudo si no se conoce. */
export function operationTypeLabel(code: string): string {
    return INVOICE_PROFILE_OPERATION_LABELS[code] ?? code;
}

/**
 * Fila del listado — `GET /store/invoicing/profiles`.
 *
 * Deliberadamente SIN `config`: el listado no lo trae, y declararlo opcional
 * invitaría a leerlo desde la tabla y a mostrar un desglose vacío como si el
 * perfil no tuviera reglas.
 */
export interface InvoiceProfile {
    id: number;
    organization_id: number;
    store_id: number;
    name: string;
    operation_type: InvoiceProfileOperationType;
    state: InvoiceProfileState;
    is_default: boolean;
    /** Número de la versión vigente. Contiguo desde 1. */
    current_version: number;
    cloned_from_profile_id: number | null;
    cloned_from_version: number | null;
    created_by: number | null;
    /** ISO 8601 con `Z`. Nunca es un `Date`. */
    created_at: string;
    updated_at: string;
}

/** Autor de una versión, tal como lo incrusta el backend. */
export interface InvoiceProfileVersionCreator {
    id: number;
    first_name: string;
    last_name: string;
}

/**
 * Fila del historial — `GET /store/invoicing/profiles/:id/versions`.
 *
 * `id` es el PK de `invoice_profile_versions`, NO el del perfil: la v1 del
 * perfil 8 tiene `id: 5`. Confundirlos hace que el detalle de una versión pida
 * el perfil equivocado, así que el nombre del campo no basta — está anotado.
 *
 * El listado NO trae `config`. Es a propósito: un historial de 40 versiones
 * con el snapshot completo de cada una son cientos de KB para pintar una
 * tabla de fechas.
 */
export interface InvoiceProfileVersionSummary {
    /** PK de la fila de versión, no del perfil. */
    id: number;
    version: number;
    created_at: string;
    created_by: number | null;
    creator: InvoiceProfileVersionCreator | null;
}

/**
 * Una versión con su snapshot — `GET …/versions/:version`.
 * Es la única forma que trae `config`, y es la que alimenta el diff.
 */
export interface InvoiceProfileVersion extends InvoiceProfileVersionSummary {
    config: InvoiceProfileConfig;
}

/**
 * Detalle — `GET /store/invoicing/profiles/:id`.
 *
 * Trae DOS caminos al mismo snapshot: `version` (la fila completa, con autor y
 * fecha) y `current_config` (el atajo al `config` de esa fila). Se declaran
 * los dos porque el backend manda los dos, pero **la vista lee
 * `current_config`**: es la que existe también cuando el perfil se sirve desde
 * el catálogo en caché.
 *
 * `current_config` es `null` cuando la versión vigente no se pudo resolver, y
 * eso NO es un caso decorativo: significa que el historial perdió la fila que
 * las facturas referencian. La vista tiene que tratarlo como error, no como
 * «perfil sin configuración» — el backend responde
 * `INVOICING_PROFILE_VERSION_001` en los caminos donde puede.
 */
export interface InvoiceProfileDetail extends InvoiceProfile {
    version: InvoiceProfileVersion | null;
    current_config: InvoiceProfileConfig | null;
}

/** Cuerpo de `POST /store/invoicing/profiles`. */
export interface CreateInvoiceProfilePayload {
    name: string;
    operation_type: InvoiceProfileOperationType;
    state?: InvoiceProfileState;
    is_default?: boolean;
    config: InvoiceProfileConfig;
}

/**
 * Cuerpo de `PATCH /store/invoicing/profiles/:id`.
 *
 * Todo opcional, pero con una regla que no se ve en el tipo: **mandar `config`
 * crea una versión nueva; mandar sólo `name` no.** Enviar el config sin
 * cambios infla el historial con versiones idénticas, así que el editor debe
 * omitirlo cuando el usuario sólo renombró.
 *
 * `is_default` NO viaja por aquí: tiene su propia ruta y su propio permiso
 * (`invoicing:profiles:set_default`), porque cambiar el perfil por defecto
 * cambia lo que se timbra por omisión y no es una edición cualquiera.
 */
export interface UpdateInvoiceProfilePayload {
    name?: string;
    operation_type?: InvoiceProfileOperationType;
    state?: InvoiceProfileState;
    config?: InvoiceProfileConfig;
}

/** Cuerpo de `POST /store/invoicing/profiles/:id/clone`. */
export interface CloneInvoiceProfilePayload {
    name: string;
    /** Versión de origen; por omisión, la vigente. */
    source_version?: number;
}

/** Filtros del listado. Espejo de `QueryInvoiceProfilesDto`. */
export interface InvoiceProfileQuery {
    search?: string;
    operation_type?: string;
    state?: InvoiceProfileState;
    page?: number;
    limit?: number;
}

/** `meta` de paginación del envelope estándar. */
export interface InvoiceProfilePageMeta {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
}

// ─────────────────────────── previsualización (D) ───────────────────────────

/** Severidad de una validación del anexo. */
export type PreviewValidationSeverity = 'blocker' | 'warning' | 'info';

/**
 * Una regla del Anexo Técnico evaluada sobre el XML proyectado.
 *
 * `code` es el código de la compuerta REAL que rechazaría la emisión
 * (`INVOICING_XSD_002`, `INVOICING_AIU_001`…), o `null` si la regla es
 * informativa. Se pinta junto al mensaje a propósito: el aviso de la pantalla
 * y el error de la emisión tienen que ser el mismo hecho con el mismo
 * identificador, o el operador no puede relacionarlos.
 */
export interface ProfilePreviewValidation {
    rule: string;
    passed: boolean;
    severity: PreviewValidationSeverity;
    code: string | null;
    message: string;
    details?: Record<string, unknown>;
}

/** Una línea del desglose proyectado. */
export interface ProfilePreviewLine {
    index: number;
    bucket: AiuBucket;
    description: string;
    unit_code: string;
    quantity: string;
    unit_price: string;
    discount_amount: string;
    line_extension_amount: string;
    /** `true` si la línea NO aporta a la base gravable. */
    omit_tax_total: boolean;
    tax_amount: string;
    note: string | null;
}

/**
 * Los cinco totales, **leídos del XML emitido** y no recalculados.
 *
 * En AIU los tres primeros son cifras DISTINTAS y confundirlas es el defecto
 * que este contrato existe para evitar:
 * - `line_extension_amount` = valor del contrato (100 M)
 * - `tax_exclusive_amount`  = base gravable (10 M)
 * - `tax_inclusive_amount`  = contrato + impuesto, **no** base + impuesto
 */
export interface ProfilePreviewTotals {
    line_extension_amount: string;
    discount_amount: string;
    tax_exclusive_amount: string;
    tax_amount: string;
    tax_inclusive_amount: string;
    payable_amount: string;
}

/** Resumen AIU del preview. Ausente en un perfil no AIU. */
export interface ProfilePreviewAiuSummary {
    regime: string;
    contract_value: string;
    aiu_value: string;
    taxable_base: string;
    minimum_base: string;
    note: string | null;
}

/**
 * Lo que la previsualización NO hizo. Se pinta en la UI, no se asume.
 *
 * Un XML que se parece a una factura y no lo es, es peligroso justo por
 * parecerlo: el operador tiene que ver enunciado que no se reservó numeración
 * ni se transmitió nada.
 */
export interface ProfilePreviewNotPerformed {
    numbering_reserved: boolean;
    signed: boolean;
    transmitted: boolean;
    persisted: boolean;
}

/** Respuesta de `POST /store/invoicing/profiles/:id/preview`. */
export interface ProfilePreviewResult {
    profile: {
        id: number;
        name: string;
        operation_type: string;
        version: number;
    };
    not_performed: ProfilePreviewNotPerformed;
    xml: string;
    breakdown: {
        lines: ProfilePreviewLine[];
        totals: ProfilePreviewTotals;
    };
    aiu_summary: ProfilePreviewAiuSummary | null;
    validations: ProfilePreviewValidation[];
}

/** Línea de muestra que el editor manda al preview. */
export interface PreviewProfileLinePayload {
    bucket: AiuBucket;
    description?: string;
    quantity: number;
    unit_price: number;
    discount_amount?: number;
    unit_code?: string;
}

/** Cuerpo del preview. Sin `invoice_number`, sin `resolution_id`, sin `cufe`. */
export interface PreviewProfilePayload {
    contract_value?: number;
    aiu_value?: number;
    contract_object?: string;
    issue_date?: string;
    lines?: PreviewProfileLinePayload[];
    customer?: {
        legal_name?: string;
        document_number?: string;
        document_type?: string;
    };
}
