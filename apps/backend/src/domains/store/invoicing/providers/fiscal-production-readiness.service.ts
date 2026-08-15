import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { certificateNitMatches } from '../dian-config/certificates/nit-match.util';
import { resolveTestSetProof } from '../dian-config/test-set-wait.util';
import { EncryptionService } from '@common/services/encryption.service';
import { isHabilitacionResolution } from '@common/interfaces/fiscal-status.interface';

type DianConfigurationType =
  | 'invoicing'
  | 'support_document'
  | 'payroll'
  | 'equivalent_document';
type ReadinessDocumentType =
  | 'sales_invoice'
  | 'credit_note'
  | 'debit_note'
  | 'support_document'
  | 'support_adjustment_note'
  | 'payroll'
  | 'payroll_adjustment'
  | 'pos_equivalent_document'
  | 'equivalent_adjustment_note';

/** One unmet prerequisite, phrased for the merchant (not for a log line). */
export interface ProductionReadinessCheck {
  key: string;
  label: string;
  satisfied: boolean;
  /** What the merchant has to do about it. Empty when already satisfied. */
  action: string;
  /**
   * `tenant` = the merchant can fix it from the panel.
   * `platform` = only Vendix operations can fix it (e.g. a missing env var).
   */
  owner: 'tenant' | 'platform';
  /**
   * `blocking` (default when absent) keeps the historical meaning: an unsatisfied
   * check makes the configuration NOT ready.
   *
   * `warning` is an early alert — something that still works today but will stop
   * working on a known date (a certificate about to expire, a numbering range
   * about to run out). It must NEVER flip `ready` to false: an alert that blocks
   * emission the moment it fires is not an alert, it is the outage it was meant
   * to prevent.
   */
  severity?: 'blocking' | 'warning';
  /**
   * WHO the check is waiting on — orthogonal to `owner`, which says who can fix
   * it.
   *
   * `vendix` = the ball is on our side of the net (the merchant in the panel, or
   * Vendix operations for `owner: 'platform'`). Actionable right now.
   * `dian` = we already did our part and the DIAN has not ruled. NOT actionable:
   * showing "sube el certificado"-style copy for these is what makes merchants
   * re-send a test set that is still under review and burn a second block of
   * consecutives.
   *
   * Defaults to `vendix` when absent.
   */
  blocked_by?: 'vendix' | 'dian';
  /** Days left, on the time-based warnings. */
  days_remaining?: number;
  /** Percentage of the numbering range still available, on range warnings. */
  percent_remaining?: number;
  /**
   * Cuántas claves técnicas se pudieron comparar ENTRE SÍ en los checks que
   * buscan una clave repetida.
   *
   * Existe porque `satisfied: true` es ambiguo en una comprobación comparativa:
   * significa lo mismo «comparé y salieron todas distintas» que «no había nada
   * que comparar». La segunda lectura NO es evidencia de nada, y publicarla como
   * si fuera un aprobado es cómo un control se apaga en silencio. El número deja
   * el rastro auditable de sobre cuánta evidencia se pronunció el check.
   *
   * Nunca lleva claves ni huellas: sólo el CONTEO. Ver `TechnicalKeyUniquenessFinding`.
   */
  fingerprints_compared?: number;
  /**
   * Matiz de un check SATISFECHO — nunca una tarea pendiente.
   *
   * Va aparte de `action` a propósito: `action` es lo que el comerciante tiene
   * que hacer, y la UI lo pinta como un to-do. Escribir aquí «no había con qué
   * comparar» le pondría un deber al lado de un check en verde. Este campo es
   * informativo y debe renderizarse como nota, o no renderizarse.
   */
  note?: string;
  /**
   * `true` cuando el `satisfied` de este check NO describe la configuración real,
   * sino el escenario hipotético bajo el que se evaluó.
   *
   * `getProductionReadiness` llama al evaluador con `environment: 'production'` y
   * `enablement_status: 'enabled'` forzados a propósito, porque la pregunta que
   * responde el endpoint es «si promovieras AHORA, ¿qué te faltaría?». Sin ese
   * override, los dos ejes que el propio botón de promoción va a cambiar saldrían
   * siempre insatisfechos y taparían lo que de verdad bloquea.
   *
   * El problema no era el override sino el silencio: la respuesta trae
   * `environment: "test"` y `enablement_status: "not_started"` en la cabecera y,
   * unas líneas más abajo, sendos checks con esas mismas claves diciendo
   * `satisfied: true`. Dos afirmaciones opuestas sobre el mismo campo en el mismo
   * payload, sin nada que distinga cuál es la real — se lee como un checklist
   * roto, y quien lo audite concluirá que el evaluador miente.
   *
   * Ausente (o `false`) = el check habla de la configuración tal como está.
   */
  assumed?: boolean;
}

/** A check counts against `ready` only when it is blocking. */
export function isBlockingCheck(check: ProductionReadinessCheck): boolean {
  return (check.severity ?? 'blocking') === 'blocking';
}

/** True when the merchant (or Vendix) can still act on the check. */
export function isActionableCheck(check: ProductionReadinessCheck): boolean {
  return (check.blocked_by ?? 'vendix') === 'vendix';
}

/**
 * Escalation ladder for the certificate expiry alert, in days. The tiers are the
 * ones a Colombian certificate renewal realistically needs: a .p12 reissue by an
 * entidad de certificación digital takes days, not minutes, so a single alert on
 * the last day would arrive too late to act on.
 */
export const CERTIFICATE_EXPIRY_ALERT_DAYS = [30, 15, 7] as const;

/** Below this share of remaining numbers the resolution is flagged. */
export const RESOLUTION_RANGE_WARNING_PERCENT = 10;

export interface ProductionReadinessReport {
  ready: boolean;
  dian_configuration_id: number;
  environment: string;
  enablement_status: string;
  checks: ProductionReadinessCheck[];
  missing: string[];
  /**
   * Unsatisfied `warning` checks. Separate from `missing` on purpose: the UI
   * shows them in a different register ("esto va a romperse") and the promotion
   * gate must not read them as blockers.
   */
  warnings: ProductionReadinessCheck[];
  /** Blocking checks the merchant or Vendix can still act on. */
  actionable: ProductionReadinessCheck[];
  /**
   * Blocking checks where our part is done and the DIAN has not ruled. Split out
   * so the UI can say "esperando a la DIAN" instead of handing the merchant a
   * to-do they cannot complete.
   */
  waiting_on_dian: ProductionReadinessCheck[];
}

/**
 * Clave técnica compartida entre NIT distintos, si la hay.
 *
 * `null` significa COMPROBADO Y LIMPIO. Es obligatorio en `ReadinessConfig` para
 * que un llamador no pueda omitirlo: un campo opcional ausente se leería como
 * «sin hallazgo» y la comprobación fallaría en abierto, que es exactamente el
 * modo de fallo que este archivo existe para evitar.
 */
export type SharedTechnicalKeyFinding = {
  resolution_id: number;
  foreign: Array<{ resolution_id: number; tax_id: string | null }>;
};

/**
 * Dos o más resoluciones del MISMO contribuyente guardando la misma ClTec.
 *
 * ── POR QUÉ ES SIEMPRE UN ERROR, Y NO UNA CONFIGURACIÓN RARA ───────────────
 *
 * La DIAN entrega una clave técnica DISTINTA por cada rango de numeración que
 * autoriza (Anexo Técnico 1.9 §11.6). No hay escenario legítimo en el que dos
 * autorizaciones compartan clave: si se repite, alguien copió la del rango
 * anterior al renovar. Es un error de captura, no una decisión.
 *
 * ── POR QUÉ HAY QUE CAZARLO ANTES DE EMITIR ────────────────────────────────
 *
 * La ClTec es la 14ª entrada del hash del CUFE y la ÚNICA que el XML no lleva:
 * la DIAN la pone de su lado al recomputar. Con la clave del rango anterior, el
 * CUFE que enviamos no coincide con el que ella calcula y rechaza el documento
 * — pero el consecutivo autorizado ya se gastó, y un consecutivo gastado no se
 * recupera. El daño no lo repara corregir la clave después.
 *
 * ── POR QUÉ SE COMPARAN HUELLAS Y NO CLAVES ────────────────────────────────
 *
 * `technical_key_fingerprint` es un SHA-256 determinista de la clave (ver
 * `TechnicalKeyVaultService.fingerprint`). Comparar por él permite detectar la
 * repetición SIN descifrar nada y sin que el valor de la clave pase por este
 * servicio. La huella tampoco sale de aquí: el hallazgo viaja identificando las
 * resoluciones por su NÚMERO y PREFIJO —lo que el comerciante lee en el PDF de
 * la autorización— porque la huella publicada sigue siendo un índice ciego con
 * el que correlacionar qué rangos comparten clave.
 */
export type DuplicateTechnicalKeyGroup = {
  /** Las resoluciones que comparten clave. Siempre dos o más. */
  resolutions: Array<{
    resolution_id: number;
    resolution_number: string;
    prefix: string | null;
  }>;
};

/**
 * Resultado completo de la sonda de unicidad, incluida la ausencia de evidencia.
 *
 * `duplicates: []` NO basta como respuesta: se lee igual con diez resoluciones
 * comparadas y limpias que con diez resoluciones de las que ninguna tiene huella
 * persistida —el estado histórico, anterior a que la columna existiera—. Por eso
 * los conteos viajan con el hallazgo: son lo que distingue «comprobado y limpio»
 * de «no había con qué comprobar», y el check dice cuál de las dos es.
 */
export type TechnicalKeyUniquenessFinding = {
  /** Resoluciones activas consideradas, ya excluido el rango SETP. */
  examined: number;
  /** Cuántas de ellas traían huella persistida — las únicas comparables. */
  fingerprinted: number;
  /** Grupos que comparten huella. Vacío = ninguna repetida entre las comparables. */
  duplicates: DuplicateTechnicalKeyGroup[];
};

/** Shape `assertProductionReady` / `evaluateProductionReadiness` need. */
type ReadinessConfig = {
  /** Resultado de `findResolutionsSharingTechnicalKey`. `null` = comprobado y limpio. */
  shared_technical_key: SharedTechnicalKeyFinding | null;
  /**
   * Resultado de `findDuplicateTechnicalKeys` — la misma ClTec repetida en dos
   * rangos del MISMO contribuyente.
   *
   * OPCIONAL, al revés que `shared_technical_key`, y la asimetría es deliberada:
   * el hallazgo ya trae dentro sus propios conteos (`examined`, `fingerprinted`),
   * así que un hallazgo presente nunca se puede confundir con «no había nada que
   * comparar» — que es el fallo en abierto contra el que `shared_technical_key`
   * se defiende volviéndose obligatorio. Aquí esa defensa vive en el dato, no en
   * el tipo, y a cambio los llamadores que construyen esta forma a mano siguen
   * compilando.
   *
   * Ausente = el llamador no corrió la sonda. El check lo dice en su `note` y no
   * inventa una alarma: no haber mirado tampoco es evidencia de duplicado.
   */
  technical_key_uniqueness?: TechnicalKeyUniquenessFinding;
  /**
   * `true` cuando el llamador FORZÓ `environment`/`enablement_status` para
   * preguntar «si promoviera ahora, ¿qué me faltaría?» en vez de describir la
   * configuración tal como está.
   *
   * Sólo marca los dos checks correspondientes con `assumed: true`; no cambia
   * ninguna evaluación. Opcional y por defecto `false`, así que quien construya
   * esta forma a mano —los specs, el gate— sigue compilando y sigue leyéndose
   * como lo que es: una foto de la realidad.
   */
  assume_production?: boolean;
  id: number;
  operation_mode: string;
  environment: string;
  enablement_status: string;
  software_id: string | null;
  software_pin_encrypted: string | null;
  certificate_s3_key: string | null;
  certificate_password_encrypted: string | null;
  /** Optional so existing callers that build this shape by hand keep compiling. */
  certificate_kms_key_id?: string | null;
  certificate_expiry: Date | null;
  certificate_fingerprint?: string | null;
  certificate_nit?: string | null;
  /**
   * Obligatorio por la misma razón que `shared_technical_key`: ausente se leería
   * como «sin evidencia» y `resolveTestSetProof` caería al último lote, leyendo
   * «no pasó» sobre una habilitación que la DIAN concedió. Un `select` que no la
   * pida debe romper en compilación, no en producción.
   */
  enablement_evidence: unknown;
  test_set_id: string | null;
  last_test_result: unknown;
  nit?: string | null;
  nit_dv?: string | null;
  accounting_entity_id?: number | null;
};

interface ResolveConfigParams {
  organization_id: number;
  store_id?: number | null;
  accounting_entity_id: number;
  configuration_type: DianConfigurationType;
  document_type?: ReadinessDocumentType;
  requireProduction?: boolean;
}

@Injectable()
export class FiscalProductionReadinessService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Whole days from now until `date`, floored. Negative when already past.
   *
   * Floored on purpose: with 6.9 days left the merchant must read "6", not "7" —
   * rounding up an expiry countdown is how a renewal gets scheduled for the day
   * after the certificate dies.
   */
  private daysUntil(date: Date, now: Date = new Date()): number {
    const ms = date.getTime() - now.getTime();
    return Math.floor(ms / 86_400_000);
  }

  /**
   * Alert for secrets still stored under a weaker envelope — the platform-wide
   * static scrypt salt, or a master key that is no longer the active one.
   *
   * WARNING, never blocking. These values decrypt correctly today; the weakness is
   * that one scrypt run per master key used to precompute the derived key for
   * every secret in the platform. Blocking emission over it would convert a
   * hardening item into an outage, which is exactly what `severity: 'warning'`
   * exists to prevent.
   *
   * It also self-heals: the next emission or habilitación test rewrites the row
   * (see `DianSecretEnvelopeService`), so the warning disappears without anyone
   * running a migration — which is impossible here anyway, since only the
   * application can decrypt these columns.
   */
  buildSecretsEnvelopeWarning(
    config: Pick<
      ReadinessConfig,
      'software_pin_encrypted' | 'certificate_password_encrypted'
    >,
  ): ProductionReadinessCheck {
    const base = {
      key: 'secrets_envelope',
      label: 'Secretos DIAN cifrados con salt por registro',
      owner: 'platform' as const,
      severity: 'warning' as const,
    };

    // With no real key configured there is nothing better to rewrite under, and
    // the blocking `DIAN_ENCRYPTION_KEY` check already reports that situation.
    // Raising this warning too would just duplicate it.
    if (this.encryption.isUsingFallbackKey()) {
      return { ...base, satisfied: true, action: '' };
    }

    const pending = [
      config.software_pin_encrypted,
      config.certificate_password_encrypted,
    ].some((value) => !!value && this.encryption.needsReencryption(value));

    if (!pending) return { ...base, satisfied: true, action: '' };

    return {
      ...base,
      satisfied: false,
      action:
        'Los secretos DIAN de esta configuración siguen cifrados con el formato anterior ' +
        '(salt compartido o llave previa). Se re-cifran automáticamente en la próxima emisión ' +
        'o prueba de habilitación; no requiere ninguna acción manual.',
    };
  }

  /**
   * Reports the custody of the certificate's private key.
   *
   * `warning`, never blocking, and the reason matters: an exportable key in an
   * encrypted `.p12` is a **legitimate, legal** configuration — the DIAN requires
   * a certificate, not an HSM. Turning weaker-but-valid custody into a blocker
   * would stop a merchant from invoicing over a hardening they never agreed to,
   * which is the outage the alert exists to prevent.
   *
   * It stays visible while the key is exportable so the merchant can decide, and
   * goes quiet the moment `certificate_kms_key_id` is set — at which point BOTH
   * the XAdES document signature and the WS-Security envelope signature are
   * produced inside the HSM (see `DianXmlSignerService.buildWsCredentials`: moving
   * only one of the two would leave the private key in this process anyway and the
   * hardening would be cosmetic).
   */
  buildPrivateKeyCustodyWarning(
    config: Pick<ReadinessConfig, 'certificate_kms_key_id'>,
  ): ProductionReadinessCheck {
    const base = {
      key: 'private_key_custody',
      label: 'Llave privada del certificado en HSM (no exportable)',
      owner: 'platform' as const,
      severity: 'warning' as const,
    };

    if (config.certificate_kms_key_id) {
      return { ...base, satisfied: true, action: '' };
    }

    return {
      ...base,
      satisfied: false,
      action:
        'La llave privada del certificado se lee del .p12 en memoria del proceso. ' +
        'Para custodia no exportable, crear una clave asimétrica RSA en AWS KMS ' +
        '(Origin: AWS_KMS, KeyUsage: SIGN_VERIFY) y registrar su ARN en ' +
        'certificate_kms_key_id. La firma pasa a producirse dentro del HSM sin ' +
        'ningún otro cambio: el certificado sigue siendo público y se lee de S3.',
    };
  }

  /**
   * Early alert for a certificate that is still valid but about to expire.
   *
   * `satisfied: true` means "no alert" — either there is no expiry date to judge
   * (that case is already a BLOCKING `certificate_expiry` failure, so raising a
   * second warning about it would only duplicate noise) or there is more runway
   * than the widest tier.
   */
  buildCertificateExpiryWarning(
    certificate_expiry: Date | null,
    now: Date = new Date(),
  ): ProductionReadinessCheck {
    const base = {
      key: 'certificate_expiry_soon',
      label: 'Certificado digital próximo a vencer',
      owner: 'tenant' as const,
      severity: 'warning' as const,
    };

    if (!certificate_expiry || certificate_expiry <= now) {
      return { ...base, satisfied: true, action: '' };
    }

    const days = this.daysUntil(certificate_expiry, now);
    const widest = Math.max(...CERTIFICATE_EXPIRY_ALERT_DAYS);
    if (days > widest) {
      return { ...base, satisfied: true, action: '', days_remaining: days };
    }

    // NARROWEST matching tier, not the first one that matches: the tiers are
    // declared widest-first, so `find(t => days <= t)` would return 30 for a
    // certificate with 4 days left and the merchant would read "agenda la
    // renovación" on the day the certificate is about to die.
    const tier = Math.min(
      ...CERTIFICATE_EXPIRY_ALERT_DAYS.filter((t) => days <= t),
    );
    const urgency =
      tier <= 7
        ? 'Renueva el certificado digital YA'
        : tier <= 15
          ? 'Renueva el certificado digital esta semana'
          : 'Agenda la renovación del certificado digital';

    return {
      ...base,
      satisfied: false,
      days_remaining: days,
      action: `${urgency}: vence en ${days} ${
        days === 1 ? 'día' : 'días'
      } (${certificate_expiry.toISOString().slice(0, 10)}). Sin certificado vigente la DIAN rechaza toda emisión.`,
    };
  }

  /**
   * Early alert for a numbering resolution running out of consecutives.
   *
   * Measured against the AUTHORIZED range, not against what is left from the
   * current number: a resolution authorised for 1000 numbers with 80 left is at
   * 8% regardless of how fast the tenant burned the first 920.
   */
  buildResolutionRangeWarning(resolution: {
    prefix: string | null;
    range_from: number;
    range_to: number;
    current_number: number;
  }): ProductionReadinessCheck {
    const base = {
      key: 'resolution_range_low',
      label: 'Rango de numeración por agotarse',
      owner: 'tenant' as const,
      severity: 'warning' as const,
    };

    const total = resolution.range_to - resolution.range_from + 1;
    if (total <= 0) return { ...base, satisfied: true, action: '' };

    const remaining = Math.max(0, resolution.range_to - resolution.current_number);
    const percent = (remaining / total) * 100;

    if (percent > RESOLUTION_RANGE_WARNING_PERCENT) {
      return {
        ...base,
        satisfied: true,
        action: '',
        percent_remaining: Math.round(percent * 10) / 10,
      };
    }

    return {
      ...base,
      satisfied: false,
      percent_remaining: Math.round(percent * 10) / 10,
      action: `Solicita una nueva Autorización de Numeración en Muisca: al prefijo ${
        resolution.prefix ?? '(sin prefijo)'
      } le quedan ${remaining} números (${
        Math.round(percent * 10) / 10
      }% del rango). Al agotarse, la facturación se detiene.`,
    };
  }

  /**
   * La misma clave técnica repetida en dos rangos autorizados del propio NIT.
   *
   * BLOQUEANTE, no aviso, y es la única forma honesta de reportarlo: un aviso
   * describe algo que hoy funciona y romperá después, y esto no funciona hoy.
   * Cada emisión bajo el rango con la clave copiada termina en rechazo con el
   * consecutivo ya consumido, así que dejar pasar la emisión «avisando» sería
   * gastar numeración autorizada para confirmar lo que la comprobación ya sabe.
   *
   * Es COMPLEMENTARIO a `technical_key_per_nit`, no una variante suya: aquel
   * caza la clave de OTRO contribuyente (contaminación entre tenants) y éste la
   * del rango ANTERIOR del mismo (error de captura al renovar). Un tenant con
   * una sola resolución en toda la plataforma pasa el primero y puede fallar el
   * segundo en cuanto renueve, que es justo cuando ocurre.
   *
   * El mensaje nombra las resoluciones por su número y prefijo. Nunca por su
   * clave ni por su huella: el comerciante corrige mirando el PDF de la
   * autorización, donde el número y el prefijo son lo que identifica el rango —
   * imprimir la clave no ayudaría a corregir y sí la sacaría del cofre.
   */
  buildTechnicalKeyUniquenessCheck(
    finding?: TechnicalKeyUniquenessFinding,
  ): ProductionReadinessCheck {
    const base = {
      key: 'technical_key_uniqueness',
      label: 'Una clave técnica distinta por cada rango autorizado',
      owner: 'tenant' as const,
    };

    // Nadie corrió la sonda. No es un hallazgo ni su contrario, y fabricar
    // cualquiera de los dos sería peor que decirlo.
    if (!finding) {
      return {
        ...base,
        satisfied: true,
        action: '',
        note:
          'No se comprobó si dos rangos comparten clave técnica: el llamador no ' +
          'resolvió `technical_key_uniqueness` con `findDuplicateTechnicalKeys`. ' +
          'El check no afirma que las claves sean distintas, sólo que no las miró.',
      };
    }

    // Con menos de dos huellas persistidas no hay comparación posible. Es el
    // estado HISTÓRICO: la columna `technical_key_fingerprint` se llena cuando
    // alguien guarda o lee la resolución, así que las filas anteriores a ella
    // llegan aquí sin huella. Ausencia de evidencia no es evidencia de
    // duplicado, y convertirla en alarma pondría en rojo a todo el parque
    // instalado por una migración que aún no ha pasado por sus filas.
    if (finding.fingerprinted < 2) {
      return {
        ...base,
        satisfied: true,
        action: '',
        fingerprints_compared: finding.fingerprinted,
        note:
          finding.fingerprinted === 0
            ? `Sin evidencia para comparar: ninguna de las ${finding.examined} ` +
              'resolución(es) activa(s) tiene todavía persistida la huella de su ' +
              'clave técnica. Se persiste sola la próxima vez que se guarde o se ' +
              'lea la resolución.'
            : 'Sólo una resolución activa tiene huella persistida: no hay una ' +
              'segunda clave con la cual compararla.',
      };
    }

    if (!finding.duplicates.length) {
      return {
        ...base,
        satisfied: true,
        action: '',
        fingerprints_compared: finding.fingerprinted,
      };
    }

    const named = finding.duplicates
      .map((group) =>
        group.resolutions
          .map(
            (r) =>
              `resolución ${r.resolution_number} (prefijo ${
                (r.prefix ?? '').trim() || 'sin prefijo'
              })`,
          )
          .join(' y '),
      )
      .join('; ');

    return {
      ...base,
      satisfied: false,
      fingerprints_compared: finding.fingerprinted,
      action:
        `Dos rangos autorizados están guardando la MISMA clave técnica: ${named}. ` +
        'La DIAN entrega una clave técnica distinta por cada Autorización de ' +
        'Numeración, así que dos resoluciones no pueden compartirla: al renovar el ' +
        'rango se copió la clave del anterior. Repón la clave del rango vigente ' +
        'desde el PDF de la autorización (viene junto al prefijo y al rango ' +
        'autorizado), o consúltala en el servicio web de Rangos de Numeración de la ' +
        'DIAN, y vuelve a guardarla en la resolución afectada. Mientras siga la ' +
        'clave equivocada, la DIAN recomputa el CUFE con la verdadera, no coincide ' +
        'con el que enviamos y rechaza el documento con el consecutivo ya gastado — ' +
        'y un consecutivo autorizado no se recupera.',
    };
  }

  isProductionRuntime(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  async resolveOwnSoftwareConfig(params: ResolveConfigParams) {
    const requireProduction =
      params.requireProduction ?? this.isProductionRuntime();
    const allowedStatuses = requireProduction
      ? (['enabled'] as const)
      : (['testing', 'test_set_passed', 'enabled'] as const);

    const config = await this.prisma
      .withoutScope()
      .dian_configurations.findFirst({
        where: {
          organization_id: params.organization_id,
          accounting_entity_id: params.accounting_entity_id,
          configuration_type: params.configuration_type,
          operation_mode: 'own_software',
          enablement_status: { in: [...allowedStatuses] },
          ...(requireProduction && { environment: 'production' }),
        },
        orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
      });

    if (!config) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_CONFIG_INCOMPLETE,
        'No DIAN own-software configuration is enabled for this fiscal entity and document type.',
        {
          organization_id: params.organization_id,
          store_id: params.store_id,
          accounting_entity_id: params.accounting_entity_id,
          configuration_type: params.configuration_type,
          require_production: requireProduction,
        },
      );
    }

    if (requireProduction) {
      this.assertProductionReady({
        ...config,
        // Se consulta aquí, donde hay `params` y contexto async, y se pasa como
        // dato: `assertProductionReady` y `evaluateProductionReadiness` son
        // sincrónicos a propósito para que el gate y la lista no puedan divergir.
        shared_technical_key: await this.findResolutionsSharingTechnicalKey(
          params,
          config.environment,
        ),
        // Se resuelve AQUÍ, en el gate, y no sólo en la pantalla: el daño que
        // previene —un consecutivo autorizado quemado en un rechazo— ocurre en
        // el instante de emitir, y una alarma que sólo vive en un checklist que
        // nadie abrió no lo evita. Sin filtro de ambiente, al revés que la sonda
        // de contaminación entre NIT: la clave repetida dentro del mismo
        // contribuyente es un error de captura en cualquier ambiente, y el rango
        // de habilitación —el único caso legítimo de clave compartida— ya queda
        // fuera por prefijo.
        technical_key_uniqueness: await this.findDuplicateTechnicalKeys(params),
      });
      // La DIAN no emite resolución de numeración para la nómina electrónica
      // (el DSPNE numera con su propio consecutivo NumNE, no con una
      // invoice_resolutions), por lo que exigir una resolución activa bloquearía
      // el corte a producción de nómina de forma permanente. Facturación de venta
      // y documento soporte sí requieren resolución vigente.
      if (params.configuration_type !== 'payroll') {
        await this.assertResolutionReady(params);
      }
    }

    return config;
  }

  /**
   * Non-throwing counterpart of {@link assertProductionReady}. Returns the full
   * checklist so the UI can show the merchant *what* is missing and *who* has to
   * fix it, instead of a single opaque 412. The predicates are shared, so the
   * checklist can never drift from the gate that actually blocks emission.
   */
  evaluateProductionReadiness(
    config: ReadinessConfig,
  ): ProductionReadinessReport {
    const certNitMatches =
      !!config.certificate_nit &&
      (!config.nit ||
        certificateNitMatches({
          certificateTaxId: config.certificate_nit,
          nit: config.nit,
          dv: config.nit_dv,
        }));
    const certValid =
      !!config.certificate_expiry && config.certificate_expiry > new Date();

    // La clave técnica del rango está LIGADA AL NIT: la DIAN la asigna por cada
    // rango de numeración de cada NIT, y alimenta el CUFE. Dos NIT distintos no
    // pueden compartirla — si la comparten, al menos uno calcula un CUFE que la
    // DIAN recomputa distinto y rechaza, con el consecutivo ya gastado.
    //
    // Llega COMO DATO en `config` y no se consulta aquí: esta función es sincrónica
    // y pura a propósito, para que la lista que ve el comerciante no pueda divergir
    // del gate que bloquea la emisión. El campo es OBLIGATORIO en `ReadinessConfig`
    // justamente para que ningún llamador pueda omitirlo y dejar la comprobación
    // fallando en abierto.
    const shared_cltec = config.shared_technical_key;

    const checks: ProductionReadinessCheck[] = [
      {
        key: 'operation_mode',
        label: 'Modo de operación "software propio"',
        satisfied: config.operation_mode === 'own_software',
        action: 'Vendix debe habilitar el modo software propio para este NIT.',
        owner: 'platform',
      },
      {
        key: 'test_set_evidence',
        label: 'Set de pruebas aprobado por la DIAN',
        // Sobre la prueba DURABLE, no sobre el último lote: un reenvío posterior
        // sobrescribe `last_test_result` y borraría un hecho ya ocurrido. Ver
        // `resolveTestSetProof`.
        satisfied: this.hasPassedTestSetForConfig(config),
        action: 'Ejecuta el set de pruebas y espera el visto bueno de la DIAN.',
        owner: 'tenant',
        blocked_by: 'dian',
      },
      {
        key: 'enablement_evidence',
        label: 'Evidencia de habilitación almacenada',
        satisfied: !!config.enablement_evidence,
        action:
          'Se guarda automáticamente cuando la DIAN aprueba el set de pruebas.',
        owner: 'tenant',
        blocked_by: 'dian',
      },
      {
        key: 'enablement_status',
        label: 'Habilitación marcada como "enabled"',
        satisfied: config.enablement_status === 'enabled',
        action:
          'Promueve la configuración a producción una vez la DIAN apruebe el set.',
        owner: 'tenant',
        assumed: config.assume_production === true,
      },
      {
        key: 'environment',
        label: 'Ambiente en producción',
        satisfied: config.environment === 'production',
        action: 'Cambia el ambiente a Producción en el paso de Ambiente.',
        owner: 'tenant',
        assumed: config.assume_production === true,
      },
      {
        key: 'software_id',
        label: 'Software ID registrado',
        satisfied: !!config.software_id,
        action: 'Copia el Software ID del portal DIAN en el paso 1.',
        owner: 'tenant',
      },
      {
        key: 'software_pin',
        label: 'PIN del software guardado',
        satisfied: !!config.software_pin_encrypted,
        action: 'Ingresa el PIN del software en el paso 1.',
        owner: 'tenant',
      },
      {
        key: 'test_set_id',
        label: 'Test Set ID registrado',
        satisfied: !!config.test_set_id,
        action: 'Copia el TestSetId que la DIAN asignó a tu software.',
        owner: 'tenant',
      },
      {
        key: 'accounting_entity_id',
        label: 'Entidad contable asociada',
        satisfied: !!config.accounting_entity_id,
        action: 'Completa los datos fiscales (NIT) de la entidad.',
        owner: 'tenant',
      },
      {
        key: 'certificate_s3_key',
        label: 'Certificado digital cargado',
        satisfied: !!config.certificate_s3_key,
        action: 'Sube el archivo .p12 en el paso de Certificado.',
        owner: 'tenant',
      },
      {
        key: 'certificate_password',
        label: 'Contraseña del certificado guardada',
        satisfied: !!config.certificate_password_encrypted,
        action: 'Vuelve a subir el certificado con su contraseña.',
        owner: 'tenant',
      },
      {
        key: 'certificate_fingerprint',
        label: 'Huella del certificado calculada',
        satisfied: !!config.certificate_fingerprint,
        action: 'Vuelve a subir el certificado para recalcular su huella.',
        owner: 'tenant',
      },
      {
        key: 'certificate_nit',
        label: 'Certificado emitido para este NIT',
        satisfied: certNitMatches,
        action:
          'El NIT del certificado debe coincidir con el NIT de la entidad fiscal.',
        owner: 'tenant',
      },
      {
        key: 'certificate_expiry',
        label: 'Certificado vigente',
        satisfied: certValid,
        action: 'Renueva el certificado digital: está vencido o sin fecha.',
        owner: 'tenant',
      },
      {
        key: 'DIAN_ENCRYPTION_KEY',
        label: 'Llave de cifrado de secretos configurada',
        // Asked of the EncryptionService instead of re-reading the env var: the
        // service is what actually decided which key it encrypts with, and it
        // falls back to a repository-visible key when none is configured. Reading
        // `process.env` here could report "configured" for a key the service
        // rejected (wrong length, unusable value) while every DIAN secret on disk
        // is encrypted with the public fallback.
        satisfied: !this.encryption.isUsingFallbackKey(),
        action:
          'Vendix debe definir DIAN_ENCRYPTION_KEY en el entorno del servidor: ' +
          'los secretos DIAN están cifrados con la llave de respaldo visible en el repositorio.',
        owner: 'platform',
      },
      {
        key: 'technical_key_per_nit',
        label: 'Clave técnica propia del rango (no compartida con otro NIT)',
        // `=== null` y no `!shared_cltec`: distingue COMPROBADO Y LIMPIO (null) de
        // NO COMPROBADO (undefined). El campo es obligatorio en `ReadinessConfig`,
        // pero eso NO lo garantiza TypeScript: `StorePrismaService` expone sus
        // modelos sobre un `scoped_client: any`, así que un llamador que difunda una
        // fila leída por ahí compila sin el campo y lo pasa como `undefined`.
        // Con `!shared_cltec` ese caso daba `satisfied: true` y la comprobación
        // pasaba en vacío — el fallo en abierto que este archivo existe para evitar.
        satisfied: shared_cltec === null,
        // El caso más común no es contaminación entre tenants: es seguir con la
        // resolución de HABILITACIÓN. La DIAN reparte a todos el mismo rango de
        // prueba (`SETP`), y ese rango NO es facturable. Producción exige una
        // «Autorización de Numeración de Facturación» propia, solicitada en MUISCA,
        // que trae su prefijo, su rango y SU clave técnica. Decirlo así convierte un
        // mensaje desconcertante en el siguiente paso.
        action: shared_cltec === undefined
          ? 'No se comprobó si la clave técnica está compartida con otro NIT. ' +
            'El llamador debe resolver `shared_technical_key` con ' +
            '`findResolutionsSharingTechnicalKey` antes de evaluar: sin ese dato la ' +
            'comprobación no puede afirmar nada, y afirmar que está limpia sería ' +
            'peor que no comprobarla.'
          : shared_cltec
          ? `La clave técnica de la resolución ${shared_cltec.resolution_id} está ` +
            `compartida con ${shared_cltec.foreign.length} resolución(es) de otro NIT ` +
            `(${shared_cltec.foreign
              .map((f) => `res ${f.resolution_id} → NIT ${f.tax_id ?? 'sin NIT'}`)
              .join('; ')}). La DIAN asigna una clave técnica por rango y por NIT, y ` +
            'alimenta el CUFE: con una clave ajena el CUFE que calculamos no coincide ' +
            'con el que la DIAN recomputa desde el XML, y el documento se rechaza con ' +
            'el consecutivo ya gastado. ' +
            'SI LA RESOLUCIÓN ES LA DE HABILITACIÓN (prefijo SETP), esto es lo ' +
            'esperado y no hay nada que corregir en ella: ese rango es el sandbox de ' +
            'la DIAN, lo comparten todos los contribuyentes y NO es facturable. Lo ' +
            'que falta es la resolución de PRODUCCIÓN: solicítala en MUISCA (Formato ' +
            '1876), asocia el rango en el portal, y regístrala aquí con su propio ' +
            'prefijo y su propia clave técnica.'
          : '',
        owner: 'tenant',
      },
      // Hermano del anterior y no un duplicado suyo: aquel busca la clave de
      // OTRO NIT, éste la del rango ANTERIOR del propio. Ver
      // `buildTechnicalKeyUniquenessCheck`.
      this.buildTechnicalKeyUniquenessCheck(config.technical_key_uniqueness),
      this.buildSecretsEnvelopeWarning(config),
      this.buildPrivateKeyCustodyWarning(config),
      this.buildCertificateExpiryWarning(config.certificate_expiry),
    ];

    const unsatisfied = checks.filter((c) => !c.satisfied);
    const missing = unsatisfied.filter(isBlockingCheck).map((c) => c.key);
    const warnings = unsatisfied.filter((c) => !isBlockingCheck(c));
    const blocking = unsatisfied.filter(isBlockingCheck);

    return {
      ready: missing.length === 0,
      dian_configuration_id: config.id,
      environment: config.environment,
      enablement_status: config.enablement_status,
      checks,
      missing,
      warnings,
      actionable: blocking.filter(isActionableCheck),
      waiting_on_dian: blocking.filter((c) => !isActionableCheck(c)),
    };
  }

  assertProductionReady(config: ReadinessConfig): void {
    if (config.operation_mode !== 'own_software') {
      throw new VendixHttpException(
        ErrorCodes.DIAN_PROVIDER_OWN_SOFTWARE_REQUIRED,
        undefined,
        { dian_configuration_id: config.id },
      );
    }

    // Certificate identity/expiry keep their dedicated error codes: they are not
    // "incomplete setup" but an actively wrong certificate, and the frontend maps
    // them to specific remediation copy.
    if (
      config.certificate_nit &&
      config.nit &&
      !certificateNitMatches({
        certificateTaxId: config.certificate_nit,
        nit: config.nit,
        dv: config.nit_dv,
      })
    ) {
      throw new VendixHttpException(ErrorCodes.DIAN_CERT_004, undefined, {
        dian_configuration_id: config.id,
        expected_nit: this.onlyDigits(config.nit),
        certificate_nit: this.onlyDigits(config.certificate_nit),
      });
    }
    if (config.certificate_expiry && config.certificate_expiry <= new Date()) {
      throw new VendixHttpException(ErrorCodes.DIAN_CERT_003, undefined, {
        dian_configuration_id: config.id,
        certificate_expiry: config.certificate_expiry,
      });
    }

    const report = this.evaluateProductionReadiness(config);
    // `operation_mode` already threw above; drop it so the payload keeps the
    // exact same `missing` semantics it had before this refactor.
    const missing = report.missing.filter((key) => key !== 'operation_mode');

    if (missing.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_ENABLEMENT_001,
        'DIAN own-software production prerequisites are incomplete.',
        {
          dian_configuration_id: config.id,
          missing,
        },
      );
    }
  }

  /**
   * ¿La DIAN aprobó el set de pruebas?
   *
   * Público porque `enablement_status: 'enabled'` lo necesita, y NO debe exigir
   * readiness de producción: son dos cosas distintas y la DIAN las separa. Su
   * correo de habilitación dice «ha finalizado el proceso de pruebas y actualmente
   * se encuentra en estado habilitado», y en la MISMA carta pide, como paso
   * posterior, «asociar y crear la numeración necesaria». O sea: habilitado ocurre
   * ANTES de tener numeración de producción.
   *
   * Se expone el predicado en vez de duplicarlo para que el registro del estado y
   * el checklist no puedan divergir — el mismo criterio que protege al resto del
   * archivo.
   */
  hasPassedTestSetPublic(lastTestResult: unknown): boolean {
    return this.hasPassedTestSet(lastTestResult);
  }

  /**
   * ¿Pasó el set de pruebas, según la prueba DURABLE y no según el último lote?
   *
   * Preferir esta sobre `hasPassedTestSetPublic` cuando se tenga la configuración
   * entera. `last_test_result` es a la vez el puntero al lote en vuelo y la prueba
   * de la habilitación, así que un intento posterior la sobrescribe: el 2026-08-09
   * un reenvío accidental y su posterior descarte dejaron la plataforma leyéndose
   * como «habilitación pendiente» catorce horas después de que la DIAN la
   * habilitara. `resolveTestSetProof` antepone `enablement_evidence`, que solo se
   * escribe en éxito.
   */
  hasPassedTestSetForConfig(config: {
    enablement_status: string | null;
    enablement_evidence: unknown;
    last_test_result: unknown;
  }): boolean {
    return this.hasPassedTestSet(resolveTestSetProof(config));
  }

  private hasPassedTestSet(lastTestResult: unknown): boolean {
    if (!lastTestResult || typeof lastTestResult !== 'object') return false;
    const data = lastTestResult as Record<string, any>;
    return data?.dian_response?.success === true || data?.success === true;
  }

  /**
   * ¿La clave técnica de la resolución activa está compartida con otro NIT?
   *
   * La `ClTec` la asigna la DIAN **por cada rango de numeración de cada NIT** y
   * alimenta el CUFE sin viajar en el XML, así que la DIAN la recompone de su lado
   * a partir del NIT y el rango. Compartirla entre NIT distintos garantiza que al
   * menos uno de ellos emita un CUFE que no coincide con el recomputado — y el
   * consecutivo se gasta igual.
   *
   * No se valida la LONGITUD de la clave a propósito: el anexo no publica su
   * formato, y afirmar un largo deducido es el error que ya costó una habilitación
   * con la composición del set de pruebas. Lo que sí está publicado, y es lo que
   * se comprueba, es que la clave pertenece a un único par (NIT, rango).
   */
  async findResolutionsSharingTechnicalKey(
    params: ResolveConfigParams,
    environment?: string,
  ): Promise<SharedTechnicalKeyFinding | null> {
    // SOLO APLICA A PRODUCCIÓN, y esto es una corrección de la primera versión.
    //
    // En habilitación la DIAN asigna a TODO contribuyente el MISMO rango de
    // prueba: prefijo `SETP`, resolución `18760000001`, rango 990000000-995000000
    // y la MISMA clave técnica. Verificado contra el portal de habilitación de dos
    // NIT distintos. Compartirla ahí no es contaminación entre tenants — es cómo
    // funciona el ambiente de pruebas.
    //
    // La primera versión de este check no lo distinguía y habría bloqueado a todo
    // tenant en habilitación, que es justo cuando más necesita emitir. La regla de
    // «una ClTec por (NIT, rango)» rige la numeración de PRODUCCIÓN, que sí sale de
    // una resolución propia solicitada en MUISCA.
    if (environment !== 'production') return null;

    const document_type =
      params.document_type ?? this.defaultDocumentType(params.configuration_type);
    const own = await this.prisma
      .withoutScope()
      .invoice_resolutions.findFirst({
        where: {
          organization_id: params.organization_id,
          accounting_entity_id: params.accounting_entity_id,
          document_type,
          is_active: true,
        },
        select: {
          id: true,
          technical_key: true,
          accounting_entity: { select: { tax_id: true } },
        },
      });
    if (!own?.technical_key) return null;

    const others = await this.prisma
      .withoutScope()
      .invoice_resolutions.findMany({
        where: { technical_key: own.technical_key, id: { not: own.id } },
        select: {
          id: true,
          accounting_entity: { select: { tax_id: true } },
        },
      });

    const own_nit = this.onlyDigits(own.accounting_entity?.tax_id);
    const foreign = others
      .filter(
        (o) => this.onlyDigits(o.accounting_entity?.tax_id) !== own_nit,
      )
      .map((o) => ({
        resolution_id: o.id,
        tax_id: o.accounting_entity?.tax_id ?? null,
      }));

    return foreign.length ? { resolution_id: own.id, foreign } : null;
  }

  /**
   * ¿Dos rangos activos del propio contribuyente guardan la misma ClTec?
   *
   * ── POR QUÉ COMPARA HUELLAS Y NO LAS CLAVES ────────────────────────────────
   *
   * Porque la clave en claro es un secreto fiscal y no tiene por qué entrar en
   * este servicio para responder a una pregunta de IGUALDAD. `technical_key_fingerprint`
   * es un SHA-256 determinista de la clave normalizada, así que dos rangos con la
   * misma clave dan la misma huella y basta agrupar por ella. La huella se usa
   * como llave del Map y muere aquí: lo que sale identifica las resoluciones por
   * número y prefijo.
   *
   * Comparar contra `technical_key_encrypted` no serviría —salt e IV frescos por
   * fila hacen que dos claves iguales den ciphertexts distintos— y comparar
   * contra `technical_key` en claro obligaría a pasear el secreto por memoria
   * para nada.
   *
   * ── POR QUÉ EL `where` NO FILTRA `fingerprint != null` ─────────────────────
   *
   * Aunque sólo las filas CON huella son comparables, la consulta trae también
   * las que no la tienen. Sin ese conteo, cero duplicados se leería igual con
   * cinco rangos comparados y limpios que con cinco rangos de los que ninguno
   * tiene huella —el estado histórico— y el check daría por aprobado lo que
   * nunca miró. El conteo viaja en el hallazgo para que el check pueda decir
   * cuál de las dos cosas pasó.
   *
   * ── POR QUÉ SE EXCLUYE SETP ────────────────────────────────────────────────
   *
   * El rango de habilitación es el sandbox que la DIAN reparte idéntico a todo
   * contribuyente: prefijo, resolución, rango y clave son los mismos para todos.
   * Dos filas SETP coincidiendo no son un error de captura, son el ambiente de
   * pruebas — y bloquear por eso pararía justo al tenant que está habilitándose.
   * Es la misma corrección que ya se aplicó en `findResolutionsSharingTechnicalKey`.
   */
  async findDuplicateTechnicalKeys(
    params: ResolveConfigParams,
  ): Promise<TechnicalKeyUniquenessFinding> {
    const document_type =
      params.document_type ?? this.defaultDocumentType(params.configuration_type);

    // Tipado explícito: `withoutScope()` devuelve el cliente sin tipar, y sin
    // esta anotación las filas entrarían como `any` y un renombre de columna
    // pasaría la compilación para fallar en runtime contra la base.
    const rows: Array<{
      id: number;
      prefix: string | null;
      resolution_number: string;
      technical_key_fingerprint: string | null;
    }> = await this.prisma.withoutScope().invoice_resolutions.findMany({
      // Filtro de tenant EXPLÍCITO: `withoutScope()` no aplica ninguno, y la
      // pregunta es sobre los rangos de ESTA entidad fiscal — la contaminación
      // entre NIT distintos es la otra sonda.
      where: {
        organization_id: params.organization_id,
        accounting_entity_id: params.accounting_entity_id,
        document_type,
        is_active: true,
      },
      select: {
        id: true,
        prefix: true,
        resolution_number: true,
        // La ÚNICA de las tres columnas de clave técnica que se pide. Ni el
        // texto plano ni el ciphertext hacen falta para comparar por igualdad.
        technical_key_fingerprint: true,
      },
      orderBy: [{ id: 'asc' }],
    });

    const comparable = rows.filter((r) => !isHabilitacionResolution(r.prefix));

    const by_fingerprint = new Map<
      string,
      DuplicateTechnicalKeyGroup['resolutions']
    >();
    for (const row of comparable) {
      const fingerprint = (row.technical_key_fingerprint ?? '').trim();
      if (!fingerprint) continue;
      const group = by_fingerprint.get(fingerprint) ?? [];
      group.push({
        resolution_id: row.id,
        resolution_number: row.resolution_number,
        prefix: row.prefix ?? null,
      });
      by_fingerprint.set(fingerprint, group);
    }

    const groups = [...by_fingerprint.values()];
    return {
      examined: comparable.length,
      fingerprinted: groups.reduce((total, group) => total + group.length, 0),
      duplicates: groups
        .filter((resolutions) => resolutions.length > 1)
        .map((resolutions) => ({ resolutions })),
    };
  }

  private async assertResolutionReady(params: ResolveConfigParams): Promise<void> {
    const document_type =
      params.document_type ?? this.defaultDocumentType(params.configuration_type);
    const now = new Date();
    const resolution = await this.prisma.withoutScope().invoice_resolutions.findFirst({
      where: {
        organization_id: params.organization_id,
        accounting_entity_id: params.accounting_entity_id,
        document_type,
        is_active: true,
        valid_from: { lte: now },
        valid_to: { gte: now },
      },
      select: { id: true, current_number: true, range_to: true },
    });

    if (!resolution) {
      throw new VendixHttpException(ErrorCodes.FISCAL_RESOLUTION_MISSING, undefined, {
        organization_id: params.organization_id,
        store_id: params.store_id,
        accounting_entity_id: params.accounting_entity_id,
        document_type,
      });
    }

    if (resolution.current_number >= resolution.range_to) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_RESOLUTION_EXHAUSTED,
        undefined,
        {
          organization_id: params.organization_id,
          store_id: params.store_id,
          accounting_entity_id: params.accounting_entity_id,
          document_type,
          invoice_resolution_id: resolution.id,
        },
      );
    }
  }

  private defaultDocumentType(
    configuration_type: DianConfigurationType,
  ): ReadinessDocumentType {
    if (configuration_type === 'support_document') return 'support_document';
    if (configuration_type === 'payroll') return 'payroll';
    // Its own authorized range — checking `sales_invoice` here would report a DE
    // configuration ready on the strength of a range it must never consume.
    if (configuration_type === 'equivalent_document') {
      return 'pos_equivalent_document';
    }
    return 'sales_invoice';
  }

  private onlyDigits(value?: string | null): string {
    return String(value ?? '').replace(/\D/g, '');
  }
}
