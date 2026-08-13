/**
 * QUI-679 — Reutilización de cert de firma entre configs DIAN.
 *
 * Las cuatro habilitaciones (facturación, documento soporte, nómina, documento
 * equivalente) cuelgan de la misma `accounting_entity_id` y comparten UN ÚNICO
 * certificado expedido por la DIAN. Subir el mismo `.p12` tres veces era
 * fricción sin valor, así que `create()` lo copia de la fila hermana más
 * antigua que lo tenga.
 *
 * Decisión: COPIAR, NO REFERENCIAR. Tres razones:
 *   1. `enablement_status` es POR FILA — la DIAN autoriza cada habilitación por
 *      separado; un cert puede servir una y no servir otra.
 *   2. La rotación manual debe AISLARSE — rotar el cert SOLO de soporte no debe
 *      tocar las otras filas.
 *   3. `certificate_password_encrypted` va cifrado — compartir el mismo
 *      ciphertext entre filas es señal de un bug latente.
 *
 * La pista de la herencia vive en DOS sitios:
 *   - la respuesta de `create()` lleva `inherited_certificate` + `inherited_from`
 *     para que la UI muestre el banner en el MISMO render.
 *   - la fila nueva persiste `inherited_from_dian_configuration_id` (self-FK,
 *     ver migración `20260813140000_dian_config_inherited_from`) para que un
 *     audit query posterior pueda distinguir "el cert lo subió el usuario" de
 *     "el cert lo copiamos de la fila hermana", sin tocar `certificate_source_enum`.
 *
 * Por qué existe como módulo aparte: el espejo org-tienda. `OrgDianConfigService`
 * y `DianConfigService` crean filas en la MISMA tabla con el MISMO predicado
 * `accounting_entity_id`, así que la búsqueda tiene que ser IDÉNTICA — no un
 * casi-copia donde uno filtre un subconjunto distinto. Cualquier cambio de
 * reglas de herencia vive aquí y se propaga gratis.
 *
 * Por qué el helper recibe el cliente Prisma y no usa uno inyectado: la
 * búsqueda cruza filas de varios stores o de la organización completa
 * (dependiendo del alcance fiscal), y `withoutScope()` se usa a propósito
 * —la frontera del scope fiscal es `accounting_entity_id`, no
 * `store_id` ni `organization_id`. Filtrar por cualquiera de los dos
 * excluiría filas válidas y daría falsos negativos.
 */
import type { Logger } from '@nestjs/common';
import { certificateNitMatches } from './nit-match.util';

/**
 * Habilitaciones válidas para una fila fuente desde la que se hereda.
 *
 * `suspended` y `expired` se EXCLUYEN a propósito: una config que la DIAN
 * suspendió (por ejemplo por factura rechazada reiterada) o cuyo cert
 * venció no puede seguir alimentando a las demás filas — su cert ya no
 * sirve para firmar y heredarlo propagaría la invalidez. Sin esta guarda
 * el problema se manifestaba al rotar: la fuente quedaba en `suspended`
 * y todas las herederas firmaban con un cert rechazado por la DIAN.
 *
 * `not_started` también se queda fuera: una fila sin cert cargado no
 * puede ser fuente (el predicado ya exige `certificate_s3_key` no nulo,
 * pero `enablement_status = not_started` es la otra cara de "todavía
 * sin producción"; ser estricto evita arrastrar filas fantasma).
 */
const SOURCE_ENABLEMENT_STATUSES: ReadonlyArray<string> = [
  'enabled',
  'testing',
  'test_set_passed',
];

export type InheritableCertificate = {
  source: {
    id: number;
    configuration_type: string;
    certificate_expiry: Date | null;
    certificate_uploaded_at: Date | null;
  };
  fields: {
    certificate_s3_key: string;
    certificate_password_encrypted: string;
    certificate_kms_key_id: string | null;
    certificate_expiry: Date | null;
    certificate_fingerprint: string | null;
    certificate_subject: string | null;
    certificate_issuer: string | null;
    certificate_serial_number: string | null;
    certificate_nit: string | null;
    certificate_source: string;
    certificate_uploaded_at: Date | null;
  };
};

/**
 * Busca una fila hermana de `dian_configurations` que ya tenga cert de firma
 * asociado, para el mismo `accounting_entity_id`. Devuelve `null` si no hay
 * cert heredable (caso normal al crear la primera config) — `create()`
 * sigue su camino y deja que el usuario suba el cert después.
 *
 * `created_at ASC` hace determinista la elección cuando hay varias filas
 * con cert: la más antigua gana. En la práctica es la fila `invoicing` —
 * casi siempre la primera que se crea.
 *
 * REGLAS DE INHERITANCE (cada una documentada por separado):
 *
 * (a) Filtro `where`:
 *   - `accounting_entity_id` es la ÚNICA frontera del scope acá (ver header).
 *   - `certificate_s3_key NOT NULL`: descarta filas sin cert.
 *   - `certificate_password_encrypted NOT NULL`: si la contraseña está vacía
 *     el cert no se puede usar para firmar (verificamos en `where` y NO
 *     después — si el más viejo no tiene password, seguimos con el
 *     siguiente, ver revisión #2).
 *   - `enablement_status IN (enabled, testing, test_set_passed)`: la fuente
 *     debe estar VIVA ante la DIAN. `suspended` y `expired` quedan fuera
 *     (ver revisión #4).
 *   - `certificate_expiry IS NULL OR > now()`: cert sin fecha de expiración
 *     o todavía vigente. Cert vencido NO se hereda — quedaría firmando con
 *     algo que la DIAN ya no acepta.
 *
 * (b) Guardia de NIT:
 *   - Si el cert hermano fue expedido con un NIT distinto al de la config
 *     nueva, NO se hereda — publicaría un cert de un NIT ajeno.
 *   - Se hace sobre la lista YA FILTRADA por SQL, en orden `created_at ASC`,
 *     así que si la fuente más vieja tiene NIT distinto pero una posterior
 *     lo tiene correcto, se usa la correcta. Esto es la revisión #2: antes
 *     `findFirst` devolvía solo la más vieja y, si fallaba el NIT, se
 *     descartaba TODO aunque otra hermana tuviera cert válido.
 *   - Se hace `warn + return null` (no throw) para no romper una migración
 *     limpia: un cert heredado expedido ANTES de corregir el NIT/DV en la
 *     entidad fiscal no debe impedir crear la config — solo deja el cert
 *     sin poblar.
 *
 * (c) Resultado:
 *   - `null` significa "no hay cert heredable"; `create()` continúa sin
 *     copiar nada y el usuario sube el cert por la ruta normal.
 *   - El objeto devuelto lleva DOS bloques:
 *       - `source`: metadatos para la respuesta de la API (id, tipo, expiry).
 *       - `fields`: columnas a copiar a la fila nueva. Separar evita que un
 *         cambio accidental en la respuesta afecte lo que se persiste.
 */
export async function findInheritableCertificate(params: {
  prisma: { dian_configurations: { findMany: Function } };
  logger: Logger;
  accounting_entity_id: number;
  nit?: string | null;
  nit_dv?: string | null;
  /** Override for `now()` in tests; default `new Date()`. */
  now?: Date;
}): Promise<InheritableCertificate | null> {
  const {
    prisma,
    logger,
    accounting_entity_id,
    nit: dto_nit,
    nit_dv: dto_nit_dv,
    now = new Date(),
  } = params;

  const candidates = await prisma.dian_configurations.findMany({
    where: {
      accounting_entity_id,
      // `not: null` aquí (y no en JS) hace Postgres use el índice sobre
      // `certificate_password_encrypted` y descarte las filas sin password
      // antes de traerlas al cliente — Fix #2.
      certificate_s3_key: { not: null },
      certificate_password_encrypted: { not: null },
      enablement_status: { in: SOURCE_ENABLEMENT_STATUSES as unknown as string[] },
      // Cert vigente o sin fecha de expiración declarada. Fix #4.
      OR: [
        { certificate_expiry: null },
        { certificate_expiry: { gt: now } },
      ],
    },
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      configuration_type: true,
      certificate_expiry: true,
      certificate_s3_key: true,
      certificate_password_encrypted: true,
      certificate_kms_key_id: true,
      certificate_fingerprint: true,
      certificate_subject: true,
      certificate_issuer: true,
      certificate_serial_number: true,
      certificate_nit: true,
      certificate_source: true,
      certificate_uploaded_at: true,
    },
  });

  // Guardia de NIT sobre la lista YA filtrada por SQL. Si la fuente más vieja
  // falla, saltamos a la siguiente — antes este loop no existía (Fix #2).
  const source = candidates.find((candidate: any) =>
    certificateNitMatches({
      certificateTaxId: candidate.certificate_nit,
      nit: dto_nit,
      dv: dto_nit_dv,
    }),
  );

  if (!source || !source.certificate_s3_key || !source.certificate_password_encrypted) {
    // Distinguimos el "ningún candidato" del "todos descartados por NIT":
    // el primero es el caso normal de un tenant nuevo, el segundo indica
    // que hay certs pero ninguno con el NIT correcto, y eso amerita un warn
    // porque el siguiente cert que el usuario suba puede quedar con el
    // mismo NIT-equivocado que las fuentes.
    if (candidates.length > 0) {
      logger.warn(
        `QUI-679: cert inheritance skipped for accounting_entity_id=${accounting_entity_id}: ` +
          `${candidates.length} candidate sibling(s) have cert, but none match ` +
          `the new config's NIT (${dto_nit ?? 'null'}-${dto_nit_dv ?? 'null'}). ` +
          `Sibling NITs: ${candidates.map((c: any) => c.certificate_nit ?? 'null').join(', ')}.`,
      );
    }
    return null;
  }

  return {
    source: {
      id: source.id,
      configuration_type: source.configuration_type,
      certificate_expiry: source.certificate_expiry,
      certificate_uploaded_at: source.certificate_uploaded_at,
    },
    fields: {
      certificate_s3_key: source.certificate_s3_key,
      certificate_password_encrypted: source.certificate_password_encrypted,
      certificate_kms_key_id: source.certificate_kms_key_id,
      certificate_expiry: source.certificate_expiry,
      certificate_fingerprint: source.certificate_fingerprint,
      certificate_subject: source.certificate_subject,
      certificate_issuer: source.certificate_issuer,
      certificate_serial_number: source.certificate_serial_number,
      certificate_nit: source.certificate_nit,
      certificate_source: source.certificate_source,
      certificate_uploaded_at: source.certificate_uploaded_at,
    },
  };
}
