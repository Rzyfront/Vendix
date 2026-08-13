/**
 * QUI-657 — qué documentos de identidad exige un trámite de certificado de
 * firma, y por qué el juego depende de `person_type`.
 *
 * Vive en su propio archivo, separado del servicio, porque es una REGLA y no
 * un procedimiento: se puede probar sin base de datos, sin S3 y sin contexto de
 * tenant, y es lo único que hay que leer para saber qué se le pide a quién.
 */

/** Tipos de documento que la entidad emisora acepta hoy. */
export const DIAN_IDENTITY_DOCUMENT_TYPES = [
  'rut',
  'id',
  'certificate_of_existence',
] as const;

export type DianIdentityDocumentType =
  (typeof DIAN_IDENTITY_DOCUMENT_TYPES)[number];

/**
 * `organizations.person_type` es `String?` en el schema, no un enum, así que
 * llega cualquier cosa —incluido `null`—. Se normaliza acá y en un solo sitio.
 *
 * NULL se trata como `juridica`: es el juego de documentos MÁS EXIGENTE. Si el
 * dato falta, pedir de más y que el humano descarte es recuperable; pedir de
 * menos deja el trámite incompleto ante la entidad emisora y el tenant se
 * entera semanas después, cuando el cert no llega.
 */
export function normalizePersonType(
  person_type: string | null | undefined,
): 'natural' | 'juridica' {
  const value = (person_type ?? '').trim().toLowerCase();
  if (value === 'natural' || value === 'persona_natural') return 'natural';
  return 'juridica';
}

/**
 * Documentos OBLIGATORIOS para tramitar el certificado.
 *
 * - Persona natural: RUT + documento de identidad.
 * - Persona jurídica: lo anterior + certificado de existencia y representación
 *   legal, que es lo que acredita quién puede firmar por la sociedad.
 */
export function requiredIdentityDocuments(
  person_type: string | null | undefined,
): DianIdentityDocumentType[] {
  return normalizePersonType(person_type) === 'natural'
    ? ['rut', 'id']
    : ['rut', 'id', 'certificate_of_existence'];
}

/**
 * Documentos ADMITIDOS. Para persona natural el certificado de existencia no
 * es "opcional", es *inaplicable*: una persona natural no tiene certificado de
 * existencia y representación legal porque no es una sociedad. Aceptarlo
 * ensuciaría el expediente con un documento que la entidad emisora va a
 * rechazar, así que se rechaza acá con 400 en vez de más adelante y en silencio.
 */
export function allowedIdentityDocuments(
  person_type: string | null | undefined,
): DianIdentityDocumentType[] {
  return requiredIdentityDocuments(person_type);
}

/** Qué falta para poder enviar el trámite. Vacío ⇒ se puede enviar. */
export function missingIdentityDocuments(
  person_type: string | null | undefined,
  uploaded_types: readonly string[],
): DianIdentityDocumentType[] {
  const present = new Set(uploaded_types);
  return requiredIdentityDocuments(person_type).filter((t) => !present.has(t));
}

/** Etiquetas en español para los mensajes de error que ve el tenant. */
export const DIAN_IDENTITY_DOCUMENT_LABELS: Record<
  DianIdentityDocumentType,
  string
> = {
  rut: 'RUT',
  id: 'Documento de identidad',
  certificate_of_existence: 'Certificado de existencia y representación legal',
};

/**
 * MIME types admitidos. Lista blanca y no negra: un `.p12`, un `.exe` o un
 * `.svg` (que ejecuta script al abrirse en un navegador) no tienen por qué
 * llegar nunca a este bucket, y enumerar lo prohibido siempre se queda corto.
 */
export const DIAN_IDENTITY_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** Tope por archivo. Un RUT escaneado no pesa 10 MB ni por accidente. */
export const DIAN_IDENTITY_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Vida de la URL firmada con la que el superadmin abre un documento. */
export const DIAN_IDENTITY_DOCUMENT_URL_TTL_SECONDS = 300;
