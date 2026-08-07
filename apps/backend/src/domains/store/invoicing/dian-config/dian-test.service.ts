import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import AdmZip = require('adm-zip');
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { DianSecretEnvelopeService } from '../../../../common/services/dian-secret-envelope.service';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { S3Service } from '../../../../common/services/s3.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  DianSoapClient,
  WsSecurityCredentials,
} from '../providers/dian-direct/dian-soap.client';
import { DianSendBillResponse } from '../providers/dian-direct/interfaces/dian-response.interface';
import { DianResponseParserService } from '../providers/dian-direct/dian-response-parser.service';
import { DianXmlSignerService } from '../providers/dian-direct/dian-xml-signer.service';
import { UblInvoiceBuilder } from '../providers/dian-direct/xml/ubl-invoice.builder';
import { UblCreditNoteBuilder } from '../providers/dian-direct/xml/ubl-credit-note.builder';
import { UblDebitNoteBuilder } from '../providers/dian-direct/xml/ubl-debit-note.builder';
import { UblCommonBuilder } from '../providers/dian-direct/xml/ubl-common.builder';
import { CufeCalculator } from '../utils/cufe-calculator';
import {
  DianIssuerData,
  DianCustomerData,
} from '../providers/dian-direct/interfaces/dian-config.interface';
import { ProviderInvoiceData } from '../providers/invoice-provider.interface';
import {
  DEFAULT_STORE_TIMEZONE,
  localDateString,
  localTimeString,
  resolveStoreTimezone,
} from '../../../../common/utils/store-timezone.util';
import {
  buildDianXmlFileName,
  buildDianZipFileName,
  softwareCodeForOperationMode,
  DianDocumentKind,
} from '../utils/dian-file-naming.util';
import { analyzeTestSetWait } from './test-set-wait.util';
import {
  aggregateZipVerdicts,
  TestSetZipAggregate,
  TestSetZipCounts,
  TestSetZipVerdict,
} from './test-set-zip-aggregate.util';
import {
  DianTestSetJob,
  DianTestSetJobState,
  DianTestSetJobStatusResult,
} from './dian-test-set-job.interface';
import {
  buildTestSetCompositionView,
  describeComposition,
  resolveTestSetComposition,
  testSetSize,
} from './dian-test-set-composition';

/**
 * StatusCodes con los que la DIAN dice "no tengo ese documento".
 *
 * No son un veredicto sobre el documento: son la ausencia del documento en sus
 * registros. Tratarlos como veredicto invierte el diagnóstico del lote, porque
 * "la DIAN contestó algo" no es lo mismo que "la DIAN lo conoce".
 */
const DIAN_TRACKID_NOT_FOUND_CODES = new Set(['66', '066', '0066']);

/** One GetStatusZip poll attempt recorded in last_test_result for diagnostics. */
export interface TestSetPollAttempt {
  attempt: number;
  status_code: string;
  status_message: string;
  success: boolean;
  /**
   * ZipKey consultado. Opcional porque un lote de un solo ZipKey no necesita
   * desambiguar, y porque los registros escritos antes de que el sondeo fuera
   * multi-lote no lo traen.
   */
  zip_key?: string;
}

// `TestSetZipVerdict` y `TestSetZipCounts` viven en `test-set-zip-aggregate.util`
// junto a la regla que los combina, por la misma razón que `analyzeTestSetWait`:
// el endpoint HTTP y el cron de re-sondeo deben coincidir en el veredicto.

@Injectable()
export class DianTestService {
  private readonly logger = new Logger(DianTestService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: EncryptionService,
    private readonly soap_client: DianSoapClient,
    private readonly response_parser: DianResponseParserService,
    private readonly s3_service: S3Service,
    private readonly xml_signer: DianXmlSignerService,
    private readonly secret_envelope: DianSecretEnvelopeService,
    // Productor de la cola del set de pruebas. Consumidor: DianTestSetProcessor.
    // La cola se registra en cada módulo que expone el flujo (tienda,
    // organización y plataforma) porque las tres superficies comparten ESTE
    // servicio, no una copia por dominio.
    @InjectQueue('dian-test-set') private readonly testSetQueue: Queue,
  ) {}

  private async getConfigById(config_id: number) {
    const config = await this.prisma.dian_configurations.findFirst({
      where: { id: config_id },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    return config;
  }

  /**
   * Extracts WS-Security credentials (private key + DER cert) from the config's
   * stored .p12. Returns undefined and logs a warning if the certificate is
   * missing or cannot be opened, so callers degrade gracefully.
   */
  private async loadWsCredentials(config: {
    certificate_s3_key: string | null;
    certificate_password_encrypted: string | null;
    /** Non-exportable custody, when the entity has migrated its key to an HSM. */
    certificate_kms_key_id?: string | null;
  }): Promise<WsSecurityCredentials | undefined> {
    if (!config.certificate_s3_key || !config.certificate_password_encrypted) {
      return undefined;
    }
    try {
      const cert_password = this.encryption.decrypt(
        config.certificate_password_encrypted,
      );
      const p12_buffer = await this.s3_service.downloadImage(
        config.certificate_s3_key,
      );
      return this.xml_signer.buildWsCredentials(
        p12_buffer,
        cert_password,
        config.certificate_kms_key_id,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to extract WS-Security credentials, continuing without: ${error.message}`,
      );
      return undefined;
    }
  }

  /**
   * Tests connectivity to DIAN web services for a specific configuration.
   */
  async testConnection(config_id: number) {
    const config = await this.getConfigById(config_id);
    const environment = config.environment as 'test' | 'production';

    // Load certificate for WS-Security
    let ws_credentials: WsSecurityCredentials | undefined;
    if (config.certificate_s3_key && config.certificate_password_encrypted) {
      try {
        const cert_password = this.encryption.decrypt(
          config.certificate_password_encrypted,
        );
        const p12_buffer = await this.s3_service.downloadImage(
          config.certificate_s3_key,
        );
        ws_credentials = this.xml_signer.buildWsCredentials(
          p12_buffer,
          cert_password,
          config.certificate_kms_key_id,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to extract WS-Security credentials for connection test, continuing without: ${error.message}`,
        );
      }
    }

    try {
      const response = await this.soap_client.getStatus(
        '00000000-0000-0000-0000-000000000000',
        environment,
        ws_credentials,
      );

      // Connection is successful if DIAN responded with valid SOAP.
      // A SOAP Fault (e.g., InvalidSecurity) means DIAN is reachable but rejected auth.
      // Both valid responses and SOAP faults confirm connectivity.
      const is_connected =
        response.success ||
        response.is_soap_fault === true ||
        (response.status_code !== 'NETWORK_ERROR' &&
          response.status_code !== 'TIMEOUT' &&
          response.raw_response.includes('Envelope'));

      const is_security_error =
        response.is_soap_fault &&
        response.raw_response.includes('InvalidSecurity');

      await this.createAuditLog(config.id, {
        action: 'test_connection',
        status: is_connected ? 'success' : 'error',
        error_message: is_connected ? null : 'No response from DIAN',
        duration_ms: response.duration_ms,
      });

      return {
        success: is_connected,
        environment,
        response_time_ms: response.duration_ms,
        message: is_connected
          ? is_security_error
            ? 'Conexión exitosa. El certificado será utilizado para firmar las facturas al enviarlas.'
            : 'Conexión exitosa con los servicios de la DIAN'
          : 'No se pudo conectar con los servicios de la DIAN',
        dian_status: response.status_code,
      };
    } catch (error) {
      this.logger.error(`DIAN connection test failed: ${error.message}`);

      await this.createAuditLog(config.id, {
        action: 'test_connection',
        status: 'error',
        error_message: error.message,
      });

      throw new VendixHttpException(ErrorCodes.DIAN_CONN_001);
    }
  }

  /**
   * Encola el set de pruebas y responde de inmediato con el id del job.
   *
   * POR QUÉ NO ES SINCRÓNICO: `executeTestSet` tarda ~74 s (reservar numeración,
   * construir 50 UBL, firmarlos con XAdES, comprimir y subir a la DIAN). El
   * `location /` de nginx en producción hereda el `proxy_read_timeout` por
   * defecto de 60 s, así que los envíos del 2026-08-05 devolvieron 504 al
   * navegador mientras el backend los completaba bien — dejando la UI mostrando
   * el estado previo al envío y un toast que afirmaba que no se había enviado.
   *
   * Las validaciones BARATAS se repiten aquí a propósito, para que el llamador
   * reciba su 409/412 en la misma respuesta HTTP en vez de tener que sondear un
   * job que va a fallar. Las caras (leer la resolución, contar facturas
   * emitidas) se quedan solo en el worker.
   */
  async enqueueTestSet(
    config_id: number,
    resolution_id: number,
    options: { smoke?: boolean; validate_only?: boolean } = {},
  ): Promise<{ job_id: string }> {
    const config = await this.getConfigById(config_id);

    // La vía de validación no envía al set, así que no necesita su identificador:
    // un tenant que aún no tiene set asignado igual puede comprobar que su
    // certificado, su firma y su XML son conformes antes de pedirlo.
    if (!config.test_set_id && !options.validate_only) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_001,
        'No test set ID configured',
      );
    }

    if (config.environment !== 'test') {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_006,
        'La configuración ya está en ambiente de producción: el set de pruebas solo se envía en ambiente de habilitación.',
        { dian_configuration_id: config_id, environment: config.environment },
      );
    }

    // `abandoned !== true` es deliberado y no es redundante con `pending`.
    // Una fila descartada por el defecto anterior puede seguir teniendo
    // `pending: true` y `zip_key`, y sin esta condición el tenant queda encerrado:
    // la UI le ofrece ejecutar el set y aquí se le niega. El descarte gana.
    //
    // La vía de validación queda EXENTA: la guarda existe para no gastar otro
    // bloque de consecutivos en un set que la DIAN todavía debe juzgar, y una
    // validación sincrónica no se envía al set. Sin esta exención el diagnóstico
    // sería inalcanzable justo cuando más se necesita — con un lote atascado.
    const previous = (config.last_test_result ?? {}) as Record<string, any>;
    if (
      !options.validate_only &&
      previous.pending === true &&
      previous.zip_key &&
      previous.abandoned !== true
    ) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_002,
        `El set de pruebas ${previous.zip_key} aún está en validación en la DIAN. Consulta su estado antes de reenviar.`,
        { dian_configuration_id: config_id, zip_key: previous.zip_key },
      );
    }

    const context = RequestContextService.getContext();
    const payload: DianTestSetJob = {
      config_id,
      resolution_id,
      smoke: options.smoke === true,
      validate_only: options.validate_only === true,
      context: {
        // `store_id` puede quedar `undefined` legítimamente: la plataforma emite
        // con la organización como identidad fiscal, sin tienda.
        store_id: context?.store_id,
        organization_id: context?.organization_id,
        user_id: context?.user_id,
        is_super_admin: context?.is_super_admin,
        is_owner: context?.is_owner,
        request_id: context?.request_id ?? `queue-${randomUUID()}`,
      },
    };

    const job = await this.testSetQueue.add('run', payload, {
      // `attempts: 1` — sin reintento, a diferencia del resto de las colas del
      // repo. Cada intento reservaría un bloque NUEVO de consecutivos
      // autorizados y enviaría otro lote que la DIAN rechazaría como duplicado.
      // Consecutivos quemados no se recuperan: reintentar es decisión humana.
      attempts: 1,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    });

    this.logger.log(
      `Set de pruebas DIAN encolado job=${job.id} config=${config_id} resolucion=${resolution_id}`,
    );
    return { job_id: String(job.id) };
  }

  /**
   * Estado del job encolado.
   *
   * GUARDIA IDOR — los ids de BullMQ son enteros globales secuenciales sobre una
   * cola compartida por todos los tenants, y `job.returnvalue` sale de Redis, así
   * que el cliente Prisma scopeado NO lo protege.
   *
   * El calco de `receipt-scan` compara `job.data.context.store_id` con el del
   * llamador y exige que no sea nulo. Aquí eso no sirve: la plataforma y las
   * configuraciones de organización corren con `store_id` nulo por diseño, así
   * que ese chequeo rechazaría a los legítimos y, peor, dejaría a dos llamadores
   * con `store_id` nulo viéndose entre sí. La comparación correcta es contra la
   * `config_id` que el llamador YA demostró poder leer: quien invoca este método
   * resolvió su configuración por su propia ruta scopeada.
   *
   * Un job desconocido, evicted o ajeno devuelven el MISMO 404, para no filtrar
   * que otro tenant está corriendo una habilitación.
   */
  async getTestSetJobStatus(
    job_id: string,
    config_id: number,
  ): Promise<DianTestSetJobStatusResult> {
    const job = await this.testSetQueue.getJob(job_id);
    if (!job || job.data?.config_id !== config_id) {
      throw new VendixHttpException(ErrorCodes.DIAN_TEST_SET_007);
    }
    const status = (await job.getState()) as DianTestSetJobState;
    return {
      status,
      result: job.returnvalue ?? undefined,
      error: job.failedReason || undefined,
    };
  }

  /**
   * Trabajo pesado del set de pruebas, ejecutado por el worker.
   *
   * Construye los documentos UBL que exige el modo de operación del tenant — la
   * cantidad la provisiona la DIAN por set y la publica su portal en «Total de
   * documentos requeridos»; para software propio son 50 (30 FV + 10 ND + 10 NC),
   * verificado el 2026-08-05 —, los firma con el certificado .p12, los empaqueta
   * en un solo ZIP y los envía por `SendTestSetAsync`.
   *
   * NO sondea el veredicto. `SendTestSetAsync` es asíncrono: la DIAN solo devuelve
   * un ZipKey y tarda minutos en clasificar, así que sondear aquí no podía
   * alcanzar un veredicto — solo alargaba el trabajo 33 s. El veredicto lo
   * obtienen el cron de repoll y el endpoint de consulta de estado.
   *
   * `options.validate_only` cambia la operación SOAP a `SendBillSync`, que SÍ es
   * sincrónica: la DIAN contesta en la misma llamada con `IsValid` y la lista
   * completa de reglas violadas. Ver el comentario del bucle de envío.
   */
  async executeTestSet(
    config_id: number,
    resolution_id: number,
    options: { smoke?: boolean; validate_only?: boolean } = {},
  ) {
    // Una validación es por definición de UN documento: someter 50 a `SendBillSync`
    // no diría nada que el primero no diga y gastaría 50 consecutivos. Se deriva
    // aquí, una vez, para que el resto del método no tenga que recordar la regla.
    const diagnostic = options.smoke === true || options.validate_only === true;
    const started_at = Date.now();
    const config = await this.getConfigById(config_id);

    // La vía de validación no envía al set, así que no necesita su identificador.
    // Misma exención que en `enqueueTestSet`.
    if (!config.test_set_id && !options.validate_only) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_001,
        'No test set ID configured',
      );
    }

    // Guard against a second submission while DIAN still owes us a verdict for
    // the previous ZipKey. Re-sending consumes another block of resolution numbers and
    // DIAN rejects the batch as duplicated, which is unrecoverable from the UI.
    const previous_result = (config.last_test_result ?? {}) as Record<
      string,
      any
    >;
    // `abandoned !== true`: ver la misma guarda en `enqueueTestSet`. Un lote
    // descartado no bloquea el reenvío, ni aunque `pending` haya quedado en true.
    //
    // `!options.validate_only`: esta guarda está DUPLICADA en `enqueueTestSet` y en
    // este método, y exentar solo la primera no sirve para nada — el encolado pasa,
    // el worker revienta, y el fallo llega como un job `failed` en vez de un 409
    // inmediato, que es peor de leer. Las dos copias tienen que compartir la
    // exención o ninguna la tiene.
    if (
      !options.validate_only &&
      previous_result.pending === true &&
      previous_result.zip_key &&
      previous_result.abandoned !== true
    ) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_002,
        `El set de pruebas ${previous_result.zip_key} aún está en validación en la DIAN. Consulta su estado antes de reenviar.`,
        { dian_configuration_id: config_id, zip_key: previous_result.zip_key },
      );
    }

    const environment = config.environment as 'test' | 'production';

    // 1. Decrypt credentials
    const software_pin = this.encryption.decrypt(config.software_pin_encrypted);
    const cert_password = config.certificate_password_encrypted
      ? this.encryption.decrypt(config.certificate_password_encrypted)
      : null;

    // Best moment to retire a weaker envelope: the habilitación flow holds the
    // plaintext and runs long before any production consecutive is at stake.
    await this.secret_envelope.upgradeInPlace(config.id, config, {
      software_pin,
      certificate_password: cert_password,
    });

    // 2. Load resolution
    const resolution = await this.prisma.invoice_resolutions.findFirst({
      where: { id: resolution_id },
    });
    if (!resolution) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_001,
        'Resolution not found',
      );
    }

    // GUARDA — la misma resolución DIAN activa dos veces en la misma organización.
    //
    // Se comprueba ANTES de reservar el bloque de numeración: reservar primero y
    // descubrirlo después ya habría movido `current_number`.
    //
    // LA DIAN NUMERA POR (NIT EMISOR, RESOLUCIÓN). El NIT emisor es `config.nit`
    // — es el valor que los seis builders de `dian-direct.provider.ts` escriben
    // en `cac:AccountingSupplierParty/…/cbc:CompanyID` vía
    // `issuer_nit: onlyDigits(config.nit)`. Dos matices que definen esta guarda:
    //
    // 1. NO se agrupa por `accounting_entities.tax_id`. Ese campo es el eje
    //    CONTABLE (a qué libro se imputa el asiento) y NUNCA viaja en el XML. En
    //    producción las tres entidades de la organización 1 comparten el
    //    `tax_id` de la semilla (`900123456-7`) mientras el NIT real de la
    //    plataforma vive en `config.nit` (`902056589`). Agrupar por ese campo
    //    lanzaría este 409 sobre emisiones legítimas y a la vez dejaría pasar el
    //    caso inverso: dos entidades con `tax_id` distinto emitiendo bajo un
    //    mismo `config.nit`.
    //
    // 2. NO se agrupa por `config.nit` directamente: `invoice_resolutions` no
    //    tiene FK a `dian_configurations`, y la organización 1 tiene TRES
    //    configuraciones a nivel plataforma con tres NIT distintos (13, 14, 15).
    //    Resolver «qué configuración emitiría esta fila» sería adivinar.
    //
    // Queda `organization_id`: la frontera de tenant real, y el alcance bajo el
    // cual una sola configuración DIAN gobierna la emisión. El caso de producción
    // que motiva la guarda:
    //
    //   resolución 9  → entidad 18 «Tienda Principal Vendix»     consecutivo 989999999 (nunca emitió)
    //   resolución 10 → entidad 95 «Vendix S.A.S. (Consolidado)» consecutivo 990000160
    //
    // Misma organización, misma resolución 18760000001, mismo rango, contadores
    // separados. Emitir por la 9 saca 990000000 bajo un NIT que ya entregó hasta
    // 990000160, y la DIAN rechaza numeración duplicada de forma DEFINITIVA: ese
    // consecutivo no se recupera. La resolución 8 (HIDRO, organización 75) queda
    // fuera y así debe ser: otro NIT, contador legítimamente independiente.
    //
    // No se auto-resuelve eligiendo la de `current_number` mayor: sin saber cuál
    // fila es la correcta, adivinar puede quemar el resto del rango en silencio.
    // Un humano decide cuál desactivar.
    //
    // LÍMITE CONOCIDO: la consulta va por el cliente Prisma SCOPEADO, así que si
    // el alcance del llamador no alcanza la fila gemela, la guarda no la ve.
    // Cruzar el aislamiento de tenant para verla sería peor. Es defensa en
    // profundidad, no el control principal: el control principal es no tener dos
    // filas activas.
    const active_twin = await this.prisma.invoice_resolutions.findFirst({
      where: {
        id: { not: resolution.id },
        is_active: true,
        organization_id: resolution.organization_id,
        document_type: resolution.document_type,
        resolution_number: resolution.resolution_number,
        prefix: resolution.prefix,
        range_from: resolution.range_from,
        range_to: resolution.range_to,
      },
      select: {
        id: true,
        current_number: true,
        accounting_entity_id: true,
      },
    });
    if (active_twin) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_008,
        `La resolución ${resolution.resolution_number} (prefijo ${resolution.prefix}, ` +
          `rango ${resolution.range_from}-${resolution.range_to}) está activa dos veces ` +
          `en esta organización: id=${resolution.id} en la entidad contable ` +
          `${resolution.accounting_entity_id} (consecutivo ${resolution.current_number}) y ` +
          `id=${active_twin.id} en la entidad ${active_twin.accounting_entity_id} ` +
          `(consecutivo ${active_twin.current_number}). Ambas emitirían bajo el NIT ` +
          `${config.nit}, así que desactiva la que no corresponda antes de emitir: la que ` +
          `quede atrasada reemitiría numeración que la DIAN ya recibió bajo ese NIT, y ese ` +
          `rechazo es definitivo.`,
        {
          dian_configuration_id: config_id,
          resolution_id: resolution.id,
          duplicate_resolution_id: active_twin.id,
          nit: config.nit,
        },
      );
    }

    // The test set is a HABILITACIÓN artifact. Two provable guards keep it from
    // consuming production numbering, which can never be recovered:
    //
    // (a) A configuration already in `production` has nothing left to enable, and
    //     the resolutions attached to it are production ranges.
    // (b) A resolution that has already issued real `invoices` rows is a live
    //     range. Test sets never persist invoices, so a habilitación resolution
    //     stays at zero no matter how many times the set is re-sent — the
    //     condition therefore never blocks a legitimate retry.
    if (environment !== 'test') {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_006,
        'La configuración ya está en ambiente de producción: el set de pruebas solo se envía en ambiente de habilitación.',
        { dian_configuration_id: config_id, environment },
      );
    }
    // `invoices` está en `store_scoped_models`, así que el cliente scopeado exige
    // `store_id` en contexto y lanza 403 "store context required". La plataforma
    // corre este mismo flujo con `store_id: undefined` a propósito
    // (SubscriptionFiscalService.runInPlatformContext): su identidad fiscal es la
    // organización, no una tienda. Con el cliente scopeado, el guard hacía
    // inalcanzable la habilitación de plataforma en vez de protegerla.
    //
    // Contar sin scope es seguro aquí: `resolution_id` ya viene de la resolución
    // leída arriba CON scope, así que la fila está probada como propia del
    // llamador. El conteo no abre ninguna lectura que el scope no permitiera.
    const issued_invoices = await this.prisma.withoutScope().invoices.count({
      where: { resolution_id },
    });
    if (issued_invoices > 0) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_006,
        `La resolución ${resolution.prefix}${resolution.resolution_number} ya emitió ${issued_invoices} documento(s) reales, así que es una resolución de producción. Usa la resolución de habilitación que generó el portal DIAN.`,
        { resolution_id, issued_invoices },
      );
    }

    // Composition comes from the tenant's declared mode of operation. La cantidad
    // la provisiona la DIAN por set y la publica en su portal («Total de
    // documentos requeridos»): no se deriva de la norma. Para software propio el
    // portal exige 50 (30 FV + 10 ND + 10 NC), verificado el 2026-08-05.
    //
    // VÍA DE HUMO — `options.smoke`: emite UNA factura y gasta UN consecutivo.
    //
    // Existe porque un consecutivo autorizado es finito e irrecuperable. HIDRO
    // gastó 150 en tres lotes de 50 sin que la DIAN recibiera un solo documento,
    // y en los tres casos la única forma de saberlo fue el contador del portal.
    // Antes de gastar 50 hay que poder gastar 1: si `Recibidos` pasa de 0 a 1, el
    // camino de envío funciona; si no, no se gastaron 49 números para averiguarlo.
    //
    // No es un set válido para habilitar: la DIAN exige la composición completa.
    // Es un diagnóstico del transporte y la ingesta.
    //
    // VÍA DE VALIDACIÓN — `options.validate_only`: la misma factura, sometida a
    // `SendBillSync` en vez de `SendTestSetAsync`. Comparte la composición de 1
    // documento por la razón de arriba.
    const composition = diagnostic
      ? { invoices: 1, debit_notes: 0, credit_notes: 0 }
      : resolveTestSetComposition(config.operation_mode);
    const TEST_SET_SIZE = testSetSize(composition);

    // El código `ppp` del nombre de archivo se resuelve ANTES de reservar el
    // bloque de numeración: un modo de operación sin código soportado debe
    // fallar sin quemar consecutivos autorizados, que no se recuperan.
    const software_code = softwareCodeForOperationMode(config.operation_mode);

    // The documents must consume FRESH numbers. Starting at `range_from`
    // (the old behaviour) meant a second run re-emitted the exact same numbers
    // and CUFEs, which DIAN rejects as duplicates. `current_number` is the last
    // number actually used, so the batch starts right after it.
    const next_number = Math.max(
      resolution.range_from,
      (resolution.current_number ?? 0) + 1,
    );
    if (next_number + TEST_SET_SIZE - 1 > resolution.range_to) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_003,
        `La resolución ${resolution.prefix}${resolution.resolution_number} solo tiene ${Math.max(0, resolution.range_to - next_number + 1)} números disponibles y el set de pruebas requiere ${TEST_SET_SIZE} (${describeComposition(composition)}).`,
        { resolution_id, next_number, range_to: resolution.range_to },
      );
    }

    // Reserve the block BEFORE building and signing the documents. Advancing
    // `current_number` afterwards would leave a window where the batch is
    // already in DIAN's hands but the numbers still look available, so a crash
    // or a retry would re-send numbering DIAN has — and DIAN rejects duplicated
    // numbering. Reserving first can only leave an unused gap in the range,
    // which is harmless; the reverse mistake is not recoverable.
    // `updateMany` (not `update`) so the guard on `current_number` makes the
    // reservation atomic: two concurrent runs cannot claim the same block.
    const reserved = await this.prisma.invoice_resolutions.updateMany({
      where: { id: resolution_id, current_number: resolution.current_number },
      data: { current_number: next_number + TEST_SET_SIZE - 1 },
    });
    if (reserved.count === 0) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_002,
        'Otro proceso está consumiendo la numeración de esta resolución. Espera a que termine y vuelve a intentarlo.',
        { dian_configuration_id: config_id, resolution_id },
      );
    }

    // 3. Resolve tenant context and the issuer's timezone up front: every date
    //    rendered into the XML below is a CIVIL date of the issuer, so it must be
    //    derived in their zone, never by serializing a UTC instant.
    const context = RequestContextService.getContext();
    if (!context) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_001,
        'No request context',
      );
    }
    const store_id = context.store_id;
    const timezone = store_id
      ? await resolveStoreTimezone(this.prisma, store_id)
      : DEFAULT_STORE_TIMEZONE;

    // DIAN InvoiceControl (sts:DianExtensions/InvoiceControl) — populated from the
    // numbering-resolution row so the AuthorizedInvoices range and authorization
    // period rendered in the XML are the real habilitación values, not empty.
    // The validity range is a civil date range: `toISOString()` would shift it a
    // day whenever the stored instant falls before the zone's UTC offset.
    const control = {
      invoice_authorization: resolution.resolution_number,
      authorization_start_date: localDateString(resolution.valid_from, timezone),
      authorization_end_date: localDateString(resolution.valid_to, timezone),
      prefix: resolution.prefix,
      range_from: String(resolution.range_from),
      range_to: String(resolution.range_to),
    };

    const organization = await this.prisma.organizations.findFirst({
      where: { id: context.organization_id },
    });

    const issuer: DianIssuerData = {
      nit: config.nit,
      nit_dv: config.nit_dv || '0',
      // El nombre lo manda la CONFIGURACIÓN DIAN, no la organización: la DIAN
      // lo confronta contra el RUT del NIT que va en el mismo documento, y el
      // dueño del NIT es la entidad fiscal, no el tenant de Vendix. Con la
      // precedencia invertida el set declaraba el nombre de la organización
      // ('Vendix Corp') sobre el NIT de la entidad fiscal ('QUICKSS S.A.S.
      // SOLUCIONES RÁPIDAS DE SOFTWARE'), y la DIAN notificaba FAJ43b «Nombre
      // informado No corresponde al registrado en el RUT con respecto al Nit
      // suministrado». La organización queda como caída para configuraciones
      // viejas sin nombre propio.
      legal_name: config.name || organization?.name,
      address_line: 'Calle 1 # 1-1',
      city_code: '11001',
      city_name: 'Bogotá',
      department_code: '11',
      department_name: 'Bogotá D.C.',
      country_code: 'CO',
      email: 'test@vendix.com',
      tax_regime: '49',
      // `tax_scheme` alimenta `cbc:TaxLevelCode`, que pertenece a la lista de
      // RESPONSABILIDADES FISCALES: O-13 gran contribuyente, O-15 autorretenedor,
      // O-23 agente de retención de IVA, O-47 régimen simple, R-99-PN no aplica.
      //
      // Aquí decía `'ZZ'`, que es de OTRA lista —la de tributos, `cac:TaxScheme`—,
      // y la DIAN lo rechaza con la regla FAJ26 «Responsabilidad informada por
      // emisor no válido según lista». El contrato estaba bien documentado en
      // `DianIssuerData` y la emisión real ya lo respeta
      // (`dian-direct.provider.ts`, que cae a 'O-15'): el valor inválido vivía
      // solo en el generador del set de pruebas. Se usa el MISMO valor por defecto
      // que la emisión real para que habilitación y producción no declaren cosas
      // distintas sobre el mismo NIT.
      tax_scheme: 'O-15',
    };

    const customer: DianCustomerData = {
      document_type: '13',
      document_number: '222222222222',
      legal_name: 'Consumidor Test DIAN',
      address_line: 'Calle Test 123',
      city_code: '11001',
      city_name: 'Bogotá',
      department_code: '11',
      department_name: 'Bogotá D.C.',
      country_code: 'CO',
      email: 'test@consumidor.com',
      tax_regime: '49',
    };

    // 4. Download certificate from S3
    let p12_buffer: Buffer | null = null;
    if (!config.certificate_s3_key || !cert_password) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CERT_001,
        'DIAN test set requires the fiscal entity certificate before generating signed XML.',
        { dian_configuration_id: config_id },
      );
    }

    p12_buffer = await this.s3_service.downloadImage(
      config.certificate_s3_key,
    );

    // 4b. Extract WS-Security credentials from certificate
    let ws_credentials: WsSecurityCredentials | undefined;
    if (p12_buffer && cert_password) {
      try {
        ws_credentials = this.xml_signer.buildWsCredentials(
          p12_buffer,
          cert_password,
          config.certificate_kms_key_id,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to extract WS-Security credentials, continuing without: ${error.message}`,
        );
      }
    }

    // 5. Update status to testing.
    //
    // Las vías de diagnóstico NO lo tocan: un documento suelto no es un intento de
    // habilitación, y marcar `testing` por él dejaría la guía de habilitación
    // afirmando que hay un set en curso cuando no lo hay.
    if (!diagnostic) {
      await this.prisma.dian_configurations.update({
        where: { id: config_id },
        data: { enablement_status: 'testing' },
      });
    }

    // 6. Generate the documents
    //
    // `consecutive` viaja con cada archivo porque cada documento se envía en SU
    // PROPIO ZIP y el ZIP se nombra con el consecutivo del documento que
    // contiene. Antes se armaba un solo ZIP con los 50 y se nombraba con el
    // consecutivo del PRIMERO — ver el comentario del bucle de envío.
    const files: { name: string; content: string; consecutive: number }[] = [];
    const invoice_cufes: { number: string; cufe: string; date: string }[] = [];
    // Evidence persisted alongside the batch. Without the document key there is
    // no way to ask DIAN about an individual document later, which is exactly
    // what left a stalled batch undiagnosable: the ZipKey only answers "did you
    // process my package?", never "does this document exist in your records?".
    const documents: {
      number: string;
      cufe: string;
      kind: DianDocumentKind;
      file_name: string;
      issue_date: string;
      issue_time: string;
    }[] = [];
    // Emission timestamp MUST be the issuer's civil wall clock, not UTC. The
    // previous code took the UTC clock and appended a literal `-05:00`, so every
    // document declared an instant five hours in the future — and between 00:00Z
    // and 05:00Z the date rolled a day ahead of Colombia as well. That value
    // feeds both the UBL and the CUFE, so a wrong clock invalidates the whole
    // document. Offset and time now come from the same conversion.
    const issued_at = new Date();
    const today = localDateString(issued_at, timezone);
    const time_now = localTimeString(issued_at, timezone);

    // Numbering blocks: invoices first, then debit notes, then credit notes.
    // Derived from the composition so the three loops cannot overlap when the
    // mode changes the counts.
    const debit_note_offset = composition.invoices;
    const credit_note_offset = composition.invoices + composition.debit_notes;

    // 6a. Generate the invoices required by the mode
    for (let i = 0; i < composition.invoices; i++) {
      const invoice_number = `${resolution.prefix}${next_number + i}`;
      const subtotal = (100000 + i * 15000).toFixed(2);
      const tax = (parseFloat(subtotal) * 0.19).toFixed(2);
      const total = (parseFloat(subtotal) + parseFloat(tax)).toFixed(2);

      const software_security_code =
        UblCommonBuilder.generateSoftwareSecurityCode(
          config.software_id,
          software_pin,
          invoice_number,
        );

      const cufe = CufeCalculator.generate({
        invoice_number,
        issue_date: today,
        issue_time: time_now,
        total_before_tax: subtotal,
        tax_iva: tax,
        total_amount: total,
        issuer_nit: config.nit,
        customer_nit: '222222222222',
        technical_key: resolution.technical_key || '',
        environment: environment === 'test' ? '2' : '1',
      });

      const invoice_data: ProviderInvoiceData = {
        invoice_number,
        invoice_type: '01',
        issue_date: today,
        issue_time: time_now,
        subtotal_amount: subtotal,
        discount_amount: '0.00',
        tax_amount: tax,
        withholding_amount: '0.00',
        total_amount: total,
        payment_means: '10',
        payment_form: '1',
        items: [
          {
            description: `Producto de prueba ${i + 1}`,
            quantity: '1.00',
            unit_price: subtotal,
            discount_amount: '0.00',
            tax_amount: tax,
            total_amount: total,
          },
        ],
        taxes: [
          {
            tax_name: 'IVA',
            tax_rate: '19.00',
            taxable_amount: subtotal,
            tax_amount: tax,
          },
        ],
      };

      let xml = UblInvoiceBuilder.build({
        invoice_data,
        control,
        issuer,
        customer,
        software_security: {
          software_id: config.software_id,
          software_pin,
          software_security_code,
        },
        cufe,
        environment,
      });

      // Sign XML if certificate available
      if (p12_buffer && cert_password) {
        xml = await this.xml_signer.sign(xml, p12_buffer, cert_password);
      }

      const invoice_file = buildDianXmlFileName('invoice', {
        nit: config.nit,
        consecutive: next_number + i,
        software_code,
        year: today,
      });
      files.push({
        name: invoice_file,
        content: xml,
        consecutive: next_number + i,
      });
      invoice_cufes.push({ number: invoice_number, cufe, date: today });
      documents.push({
        number: invoice_number,
        cufe,
        kind: 'invoice',
        file_name: invoice_file,
        issue_date: today,
        issue_time: time_now,
      });
    }

    // 6b. Generate the debit notes, each referencing an invoice of this same set
    for (let i = 0; i < composition.debit_notes; i++) {
      const note_number = `${resolution.prefix}${next_number + debit_note_offset + i}`;
      // Modulo, not a fixed index: with 2 invoices and 1 note the old `[i]`
      // happened to work, but any mode with more notes than invoices would read
      // `undefined` and emit a note with no BillingReference.
      const ref_invoice = invoice_cufes[i % invoice_cufes.length];
      const subtotal = (50000 + i * 5000).toFixed(2);
      const tax = (parseFloat(subtotal) * 0.19).toFixed(2);
      const total = (parseFloat(subtotal) + parseFloat(tax)).toFixed(2);

      const software_security_code =
        UblCommonBuilder.generateSoftwareSecurityCode(
          config.software_id,
          software_pin,
          note_number,
        );

      // El CUDE de una nota NO usa la clave técnica: el anexo §11.4 lo define
      // como
      //
      //   SHA-384(NumFac + FecFac + HorFac + ValFac + CodImp1 + ValImp1
      //     + CodImp2 + ValImp2 + CodImp3 + ValImp3 + ValTot + NitOFE + NumAdq
      //     + Software-PIN + TipoAmbiente)
      //
      // donde `Software-PIN` es «Pin del software registrado en el catálogo del
      // participante». La clave técnica solo entra en el CUFE de la factura, y
      // ni una ni otro viajan en el XML — de ahí que el error sea invisible en
      // el documento y solo aparezca cuando la DIAN recalcula el hash.
      //
      // La vía de emisión real (`dian-direct.provider.ts`) ya pasaba el PIN; el
      // generador del set pasaba `resolution.technical_key`, así que los 20
      // documentos de nota del set —10 NC + 10 ND de 50— llevaban un CUDE que
      // no reproduce el que la DIAN calcula. `CufeCalculator.generate` nombra el
      // parámetro `technical_key` porque es la misma posición en la cadena; lo
      // que cambia es el valor.
      const cude = CufeCalculator.generate({
        invoice_number: note_number,
        issue_date: today,
        issue_time: time_now,
        total_before_tax: subtotal,
        tax_iva: tax,
        total_amount: total,
        issuer_nit: config.nit,
        customer_nit: '222222222222',
        technical_key: software_pin,
        environment: environment === 'test' ? '2' : '1',
      });

      const debit_note_data: ProviderInvoiceData = {
        invoice_number: note_number,
        invoice_type: '92',
        issue_date: today,
        issue_time: time_now,
        subtotal_amount: subtotal,
        discount_amount: '0.00',
        tax_amount: tax,
        withholding_amount: '0.00',
        total_amount: total,
        payment_means: '10',
        payment_form: '1',
        notes: 'Intereses',
        items: [
          {
            description: `Ajuste débito prueba ${i + 1}`,
            quantity: '1.00',
            unit_price: subtotal,
            discount_amount: '0.00',
            tax_amount: tax,
            total_amount: total,
          },
        ],
        taxes: [
          {
            tax_name: 'IVA',
            tax_rate: '19.00',
            taxable_amount: subtotal,
            tax_amount: tax,
          },
        ],
      };

      let xml = UblDebitNoteBuilder.build({
        debit_note_data,
        control,
        issuer,
        customer,
        software_security: {
          software_id: config.software_id,
          software_pin,
          software_security_code,
        },
        cude,
        environment,
        original_invoice_number: ref_invoice.number,
        original_invoice_cufe: ref_invoice.cufe,
        original_invoice_date: ref_invoice.date,
      });

      if (p12_buffer && cert_password) {
        xml = await this.xml_signer.sign(xml, p12_buffer, cert_password);
      }

      const debit_file = buildDianXmlFileName('debit_note', {
        nit: config.nit,
        consecutive: next_number + debit_note_offset + i,
        software_code,
        year: today,
      });
      files.push({
        name: debit_file,
        content: xml,
        consecutive: next_number + debit_note_offset + i,
      });
      documents.push({
        number: note_number,
        cufe: cude,
        kind: 'debit_note',
        file_name: debit_file,
        issue_date: today,
        issue_time: time_now,
      });
    }

    // 6c. Generate the credit notes, each referencing an invoice of this same set
    for (let i = 0; i < composition.credit_notes; i++) {
      const note_number = `${resolution.prefix}${next_number + credit_note_offset + i}`;
      // Offset by the debit notes so credit and debit notes do not both reference
      // the same invoice when the set is small.
      const ref_invoice =
        invoice_cufes[
          (composition.debit_notes + i) % invoice_cufes.length
        ];
      const subtotal = (50000 + i * 5000).toFixed(2);
      const tax = (parseFloat(subtotal) * 0.19).toFixed(2);
      const total = (parseFloat(subtotal) + parseFloat(tax)).toFixed(2);

      const software_security_code =
        UblCommonBuilder.generateSoftwareSecurityCode(
          config.software_id,
          software_pin,
          note_number,
        );

      // El CUDE de una nota NO usa la clave técnica: el anexo §11.4 lo define
      // como
      //
      //   SHA-384(NumFac + FecFac + HorFac + ValFac + CodImp1 + ValImp1
      //     + CodImp2 + ValImp2 + CodImp3 + ValImp3 + ValTot + NitOFE + NumAdq
      //     + Software-PIN + TipoAmbiente)
      //
      // donde `Software-PIN` es «Pin del software registrado en el catálogo del
      // participante». La clave técnica solo entra en el CUFE de la factura, y
      // ni una ni otro viajan en el XML — de ahí que el error sea invisible en
      // el documento y solo aparezca cuando la DIAN recalcula el hash.
      //
      // La vía de emisión real (`dian-direct.provider.ts`) ya pasaba el PIN; el
      // generador del set pasaba `resolution.technical_key`, así que los 20
      // documentos de nota del set —10 NC + 10 ND de 50— llevaban un CUDE que
      // no reproduce el que la DIAN calcula. `CufeCalculator.generate` nombra el
      // parámetro `technical_key` porque es la misma posición en la cadena; lo
      // que cambia es el valor.
      const cude = CufeCalculator.generate({
        invoice_number: note_number,
        issue_date: today,
        issue_time: time_now,
        total_before_tax: subtotal,
        tax_iva: tax,
        total_amount: total,
        issuer_nit: config.nit,
        customer_nit: '222222222222',
        technical_key: software_pin,
        environment: environment === 'test' ? '2' : '1',
      });

      const credit_note_data: ProviderInvoiceData = {
        invoice_number: note_number,
        invoice_type: '91',
        issue_date: today,
        issue_time: time_now,
        subtotal_amount: subtotal,
        discount_amount: '0.00',
        tax_amount: tax,
        withholding_amount: '0.00',
        total_amount: total,
        payment_means: '10',
        payment_form: '1',
        notes: 'Devolución de bienes',
        items: [
          {
            description: `Devolución prueba ${i + 1}`,
            quantity: '1.00',
            unit_price: subtotal,
            discount_amount: '0.00',
            tax_amount: tax,
            total_amount: total,
          },
        ],
        taxes: [
          {
            tax_name: 'IVA',
            tax_rate: '19.00',
            taxable_amount: subtotal,
            tax_amount: tax,
          },
        ],
      };

      let xml = UblCreditNoteBuilder.build({
        credit_note_data,
        control,
        issuer,
        customer,
        software_security: {
          software_id: config.software_id,
          software_pin,
          software_security_code,
        },
        cude,
        environment,
        original_invoice_number: ref_invoice.number,
        original_invoice_cufe: ref_invoice.cufe,
        original_invoice_date: ref_invoice.date,
      });

      if (p12_buffer && cert_password) {
        xml = await this.xml_signer.sign(xml, p12_buffer, cert_password);
      }

      const credit_file = buildDianXmlFileName('credit_note', {
        nit: config.nit,
        consecutive: next_number + credit_note_offset + i,
        software_code,
        year: today,
      });
      files.push({
        name: credit_file,
        content: xml,
        consecutive: next_number + credit_note_offset + i,
      });
      documents.push({
        number: note_number,
        cufe: cude,
        kind: 'credit_note',
        file_name: credit_file,
        issue_date: today,
        issue_time: time_now,
      });
    }

    // 7-8. Enviar UN DOCUMENTO POR ZIP, un `SendTestSetAsync` por documento.
    //
    // POR QUÉ — el defecto que cierra:
    //
    // Antes se armaba UN ZIP con los 50 documentos y se nombraba con el
    // consecutivo del PRIMERO. `SendTestSetAsync` acepta un solo documento por
    // ZIP a pesar del nombre, así que la DIAN devolvía un ZipKey y descartaba el
    // paquete sin ingerirlo. El portal de habilitación lo dejó probado:
    //
    //   Requeridos 50 · Recibidos 0 · Aceptados 0 · **Rechazados 0**
    //
    // Cero rechazos es la firma: los documentos nunca llegaron a la validación
    // por documento, así que no había nada que rechazar. HIDRO quemó 150
    // consecutivos autorizados en 3 lotes sin un solo documento recibido.
    //
    // Un ZipKey prueba transporte, WS-Security y firma. NO prueba ingesta. Y
    // `GetStatusZip` responde «Batch en proceso de validación» también para un
    // ZipKey que la DIAN nunca encoló, así que tampoco es prueba de vida.
    //
    // Secuencial a propósito: son llamadas SOAP a la DIAN y el orden es la
    // evidencia de qué consecutivo se gastó primero.
    //
    // VÍA DE VALIDACIÓN — `options.validate_only` cambia la operación a
    // `SendBillSync`, que es SINCRÓNICA: la DIAN contesta en la misma llamada con
    // `IsValid` y la lista completa de reglas violadas (`ErrorMessage`), en vez de
    // un ZipKey que hay que sondear y que puede no llevar nunca a un veredicto.
    //
    // Por qué existe: un ZipKey no distingue «tu documento está bien y está en
    // cola» de «tu documento nunca se clasificó». Durante un mes eso dejó el
    // diagnóstico en manos del contador del portal, que solo dice sí o no y vive
    // fuera del sistema. `SendBillSync` dice POR QUÉ, con código de regla.
    //
    // Y no lleva `testSetId`: no puede rechazar el set ni consumir un intento de
    // habilitación, que es lo único verdaderamente irrecuperable aquí. El
    // documento es byte a byte el mismo que envía el set de pruebas — misma
    // generación, mismo CUFE, misma firma, mismo nombre de archivo —, porque un
    // diagnóstico sobre un documento distinto no diagnostica nada.
    const submissions: {
      file_name: string;
      zip_file_name: string;
      zip_key: string | null;
      success: boolean;
      status_code?: string;
      status_message?: string;
      raw_response?: string;
      error?: string;
      /** Reglas de validación que la DIAN reportó para ESTE documento. */
      error_messages?: string[];
    }[] = [];

    for (const file of files) {
      const file_zip_name = buildDianZipFileName({
        nit: config.nit,
        consecutive: file.consecutive,
        software_code,
        year: today,
      });

      try {
        const response = options.validate_only
          ? await this.soap_client.sendBillSync(
              this.buildMultiFileZip([file]),
              file_zip_name,
              environment,
              ws_credentials,
            )
          : await this.soap_client.sendTestSetAsync(
              this.buildMultiFileZip([file]),
              file_zip_name,
              config.test_set_id,
              environment,
              ws_credentials,
            );
        submissions.push({
          file_name: file.name,
          zip_file_name: file_zip_name,
          zip_key: response.zip_key ?? null,
          success: response.success,
          status_code: response.status_code,
          status_message: response.status_message,
          raw_response: response.raw_response?.slice(0, 4000),
          // Las reglas violadas son el producto de la vía de validación: sin
          // persistirlas el envío sincrónico no valdría más que el asíncrono.
          ...(response.error_messages?.length
            ? { error_messages: response.error_messages }
            : {}),
        });
      } catch (error) {
        // No se aborta: los documentos ya enviados gastaron consecutivos y su
        // ZipKey es la única forma de preguntar por ellos después. Perder ese
        // rastro por un fallo en el documento 37 es peor que registrarlo.
        submissions.push({
          file_name: file.name,
          zip_file_name: file_zip_name,
          zip_key: null,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // El primer envío hace de representante para la forma persistida que ya leen
    // la UI, `analyzeTestSetWait` y el cron de repoll — todos asumen UN
    // `zip_key`. Con la vía de humo (1 documento) el representante ES el único
    // envío, así que la fidelidad es exacta. Para el set completo esto es
    // PARCIAL y queda pendiente: sondear los 50 ZipKeys es trabajo aparte.
    const first = submissions[0];
    const submit: DianSendBillResponse = {
      success: submissions.some((s) => s.success),
      zip_key: first?.zip_key ?? undefined,
      status_code: first?.status_code,
      status_message: first?.status_message,
      raw_response: first?.raw_response,
      // Dos clases de error se agregan aquí y ninguna puede tapar a la otra: el
      // fallo de transporte (`error`) y las reglas de validación que la DIAN
      // reportó por documento (`error_messages`). Sin la segunda, la vía de
      // validación devolvería `IsValid: false` sin decir qué falló.
      error_messages: [
        ...submissions
          .filter((s) => s.error)
          .map((s) => `${s.file_name}: ${s.error}`),
        ...submissions.flatMap((s) =>
          (s.error_messages ?? []).map((m) => `${s.file_name}: ${m}`),
        ),
      ],
    } as DianSendBillResponse;

    const zip_file_name = first?.zip_file_name ?? '';
    const zip_key = first?.zip_key ?? null;

    // 9. NO se sondea aquí. `SendTestSetAsync` es asíncrono: la DIAN devuelve un
    //    ZipKey y tarda MINUTOS en classificar el lote, así que las 6 consultas
    //    en línea que había antes no podían alcanzar un veredicto — solo sumaban
    //    33 s a un request que ya se pasaba del `proxy_read_timeout` de nginx y
    //    volvía 504, dejando la UI con el estado previo al envío.
    //
    //    El veredicto lo obtienen el cron de repoll (cada 10 min, con backoff) y
    //    el endpoint de consulta de estado, ambos partiendo del `zip_key`
    //    persistido abajo. `poll_history` nace vacío y se llena en esas rutas.
    const poll_history: TestSetPollAttempt[] = [];
    const verdict: DianSendBillResponse = submit;

    const success = verdict.success;
    // A verdict is "still processing" ONLY when we never reached a terminal
    // state (no numeric StatusCode / fault / error list). A terminal non-success
    // (e.g. DIAN StatusCode 2 "set Rechazado") is a REJECTION, not pending.
    const terminal = zip_key ? this.isTerminalZipStatus(verdict) : true;
    const still_processing = !!zip_key && !success && !terminal;
    // `rejected` significa «la DIAN rechazó el SET de habilitación», y eso es lo
    // que leen la guía y el gate de emisión. Una validación sincrónica que sale
    // inválida NO es eso: no se envió al set, no consumió un intento y no cambia
    // el estado de la habilitación. Marcarla `rejected` haría que un diagnóstico
    // exitoso —encontrar los defectos— se leyera como un fracaso de habilitación.
    const rejected =
      options.validate_only === true ? false : !success && !still_processing;

    // 10. Persist result + raw evidence (DIAN's exact status XML for diagnosis).
    const result_data = {
      executed_at: new Date().toISOString(),
      // Marca el lote como diagnóstico, no como intento de habilitación. Sin esto
      // un envío de 1 documento se lee igual que un set completo fallido.
      smoke: options.smoke === true,
      // Vía de validación sincrónica: `SendBillSync`, sin `testSetId`. `is_valid`
      // es el veredicto que la DIAN dio en la misma llamada, y es lo único de este
      // registro que responde «¿el documento está bien?» sin ambigüedad.
      validate_only: options.validate_only === true,
      ...(options.validate_only ? { is_valid: success } : {}),
      total_documents: files.length,
      // Derivados de `composition`, no literales. Estaban escritos a mano como
      // 30/10/10, así que en cualquier modo con otra composición el registro
      // mentía sobre lo que se había enviado — justo el dato con el que se
      // distingue un set rechazado de uno mandado con el layout equivocado.
      invoices: composition.invoices,
      debit_notes: composition.debit_notes,
      credit_notes: composition.credit_notes,
      zip_key,
      zip_file_name,
      // Un ZipKey por documento: es lo que hay que sondear para el set completo.
      // `zip_key` de arriba es solo el primero, para la forma que ya leen la UI,
      // la espera y el cron.
      submissions,
      zip_keys: submissions.map((s) => s.zip_key).filter(Boolean),
      resolution_id,
      number_from: next_number,
      number_to: next_number + TEST_SET_SIZE - 1,
      // The mode and composition the batch was built for. Without them, a
      // rejected set cannot be told apart from one sent with the wrong layout.
      operation_mode: config.operation_mode,
      composition,
      // Per-document evidence: number, document key, kind and the exact civil
      // timestamp used to derive the key. This is what makes GetStatus-by-CUFE
      // possible after the fact.
      timezone,
      issue_date: today,
      issue_time: time_now,
      documents,
      dian_response: {
        success: verdict.success,
        status_code: verdict.status_code,
        status_message: verdict.status_message,
        error_messages: verdict.error_messages ?? [],
        raw_response: verdict.raw_response?.slice(0, 12000),
      },
      poll_history,
      pending: still_processing,
      rejected,
      tracking_id: zip_key ?? verdict.status_code,
      // `abandonTestSet` guarda aquí los ZipKey descartados «para que el abandono
      // sea auditable», y este objeto se escribe COMPLETO, así que sin arrastrarlo
      // el primer reenvío borraba justo la historia que el abandono creó. Pasó de
      // verdad: el lote 1947f8d4 quedó solo en `dian_audit_logs`.
      ...(Array.isArray(previous_result.abandoned_batches) &&
      previous_result.abandoned_batches.length > 0
        ? { abandoned_batches: previous_result.abandoned_batches }
        : {}),
    };

    await this.prisma.dian_configurations.update({
      where: { id: config_id },
      data: {
        // Una validación NO sobrescribe el registro del lote: `last_test_result`
        // es la única copia del ZipKey y de las claves de documento del envío en
        // vuelo, y perderlos deja ese lote imposible de consultar — exactamente el
        // agujero que ya nos dejó un lote solo en `dian_audit_logs`. Se anida bajo
        // `validation`, así que el diagnóstico convive con el lote en vez de
        // reemplazarlo.
        last_test_result: options.validate_only
          ? { ...previous_result, validation: result_data }
          : result_data,
        // Un diagnóstico NO mueve el estado de habilitación. El paso 5 ya evitaba
        // marcar `testing` ANTES de enviar, pero esta escritura de DESPUÉS seguía
        // haciéndolo: una vía de humo sobre una config `not_started` la dejaba en
        // `testing`, y un éxito suelto habría escrito `test_set_passed` —
        // habilitando con un documento donde la DIAN exige 50.
        ...(diagnostic
          ? {}
          : {
              enablement_status: success
                ? ('test_set_passed' as const)
                : ('testing' as const),
              enablement_evidence: success ? result_data : undefined,
            }),
      },
    });

    await this.createAuditLog(config.id, {
      // Acción propia: en la historia de auditoría una validación sincrónica no
      // debe leerse como un intento de habilitación.
      action: options.validate_only ? 'validate_document' : 'run_test_set',
      // Tri-state: a batch DIAN has not judged yet is `pending`, not `error`.
      // Labelling it `error` made a perfectly healthy submission look broken.
      status: success ? 'success' : still_processing ? 'pending' : 'error',
      error_message: success
        ? null
        : still_processing
          ? `En validación en la DIAN (ZipKey ${zip_key}) tras ${poll_history.length} consultas.`
          : verdict.error_messages?.join(' | ') || verdict.status_message,
      // Total wall time of the whole operation (generate + sign + zip + send +
      // poll), not just the last SOAP round-trip, which made a ~35 s process
      // show up as "107ms" in the audit table.
      duration_ms: Date.now() - started_at,
    });

    const is_ws_security_error =
      submit.is_soap_fault === true &&
      submit.raw_response?.includes('InvalidSecurity');

    return {
      success,
      documents_generated: true,
      message: options.validate_only
        ? success
          ? 'La DIAN validó el documento: IsValid = true, sin reglas violadas. El camino de generación y firma es conforme.'
          : `La DIAN rechazó el documento con ${verdict.error_messages?.length ?? 0} regla(s): ${verdict.error_messages?.join(' | ') || verdict.status_message}`
        : success
          ? 'Set de pruebas procesado y validado por la DIAN.'
          : is_ws_security_error
          ? `${files.length} documento(s) generado(s) y firmado(s). La DIAN rechazó la firma WS-Security del envelope SOAP.`
          : verdict.error_messages?.length
            ? `La DIAN reportó errores de validación: ${verdict.error_messages.join(' | ')}`
            : still_processing
              ? `Set recibido por la DIAN (ZipKey ${zip_key}); aún en proceso tras ${poll_history.length} consultas. Consulta GET :id/test-set-status en unos minutos.`
              : `Set de pruebas RECHAZADO por la DIAN: ${verdict.status_message}`,
      tracking_id: result_data.tracking_id,
      // Derivados de lo que REALMENTE se envió. Estaban escritos a mano como
      // 50/30/10/10, así que la vía de humo —1 factura, 1 consecutivo— devolvía
      // «50 documentos» y el número contradecía a `number_from`/`number_to`, que
      // sí eran correctos. Lo persistido (`result_data.total_documents`) siempre
      // usó `files.length`: la mentira vivía solo en la respuesta.
      total_documents: files.length,
      invoices_count: composition.invoices,
      debit_notes_count: composition.debit_notes,
      credit_notes_count: composition.credit_notes,
      environment,
      dian_status: verdict.status_code,
      error_messages: verdict.error_messages ?? [],
      zip_key,
      pending: still_processing,
      rejected,
      wait: analyzeTestSetWait(result_data),
      executed_at: result_data.executed_at,
      number_from: next_number,
      number_to: next_number + TEST_SET_SIZE - 1,
      // Las vías de diagnóstico NO escriben `enablement_status`, así que tampoco
      // pueden afirmarlo: devuelven el que la config tiene de verdad.
      enablement_status: diagnostic
        ? config.enablement_status
        : success
          ? 'test_set_passed'
          : 'testing',
      // Se devuelven para que la UI pueda distinguir un veredicto de validación de
      // un veredicto de habilitación sin inferirlo de la ausencia de `zip_key`.
      validate_only: options.validate_only === true,
      ...(options.validate_only ? { is_valid: success } : {}),
      response_time_ms: Date.now() - started_at,
    };
  }

  /**
   * Re-polls GetStatusZip for a previously submitted test set using the stored
   * ZipKey. Lets the caller resolve a verdict that was still "in process" when
   * run-test-set returned — WITHOUT re-sending the 50 documents (which would
   * burn resolution numbers). Updates last_test_result / enablement_status.
   */
  async checkTestSetStatus(config_id: number) {
    const started_at = Date.now();
    const config = await this.getConfigById(config_id);
    const environment = config.environment as 'test' | 'production';

    const previous = (config.last_test_result ?? {}) as Record<string, any>;

    // Un lote descartado NO se vuelve a consultar.
    //
    // Este era el bug: al descartar, `abandonTestSet` dejaba `pending: false`, y
    // el siguiente sondeo — el del wizard, cada 15 s — llamaba aquí, la DIAN
    // respondía «Batch en proceso de validación» y la línea de abajo reescribía
    // `pending: true`. El descarte se deshacía solo, y como las guardas de
    // reenvío miran `pending`, el tenant quedaba encerrado: la UI le ofrecía
    // ejecutar un set nuevo y el backend le contestaba DIAN_TEST_SET_002.
    //
    // Además de negarse a sondear, normaliza la fila: así una configuración ya
    // corrompida por el defecto anterior se cura en el primer sondeo, sin
    // necesidad de tocar datos de producción a mano.
    if (previous.abandoned === true) {
      const healed: Record<string, any> = { ...previous, pending: false };
      delete healed.zip_key;
      delete healed.tracking_id;

      if (previous.pending === true || previous.zip_key) {
        await this.prisma.dian_configurations.update({
          where: { id: config_id },
          data: { last_test_result: healed },
        });
      }

      return this.testSetStatusFromStoredResult(
        config,
        healed,
        'El lote anterior está descartado. Puedes ejecutar un set de pruebas nuevo.',
      );
    }

    const zip_key: string | null = previous.zip_key ?? null;

    if (!zip_key) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_001,
        'No hay un ZipKey de set de pruebas registrado. Ejecuta primero run-test-set.',
      );
    }

    // Un envío de 50 documentos sale como 50 ZIP independientes, cada uno con su
    // propio ZipKey; `zip_key` es solo el PRIMERO. Consultar únicamente ese
    // dejaba los otros 49 veredictos inalcanzables por construcción: la DIAN
    // podía haber rechazado el documento 37 y la UI seguía informando «en
    // proceso» porque el documento 1 seguía en cola. `zip_keys` los guarda todos
    // desde el envío (ver el armado de `last_test_result`), así que la
    // información estaba ahí: nadie la leía.
    const zip_keys: string[] = (
      Array.isArray(previous.zip_keys) ? previous.zip_keys : []
    ).filter((k: unknown): k is string => typeof k === 'string' && k.length > 0);
    const batch_keys = zip_keys.length ? zip_keys : [zip_key];

    const ws_credentials = await this.loadWsCredentials(config);

    const poll_history: TestSetPollAttempt[] = [];
    let verdict: DianSendBillResponse;
    let zip_verdicts: Record<string, TestSetZipVerdict> | undefined;
    let zip_counts: TestSetZipCounts | undefined;
    let zip_aggregate: TestSetZipAggregate | undefined;

    if (batch_keys.length === 1) {
      // Un lote único conserva el reintento acotado de siempre: el asistente
      // espera que UNA consulta lo resuelva, y con un solo ZipKey esos ~36 s de
      // espera sí caben en la petición.
      verdict = await this.pollTestSetStatus(
        batch_keys[0],
        environment,
        ws_credentials,
        poll_history,
      );
    } else {
      const batch = await this.pollBatchZipKeys(
        batch_keys,
        environment,
        ws_credentials,
        poll_history,
        (previous.zip_verdicts ?? {}) as Record<string, TestSetZipVerdict>,
      );
      verdict = batch.primary;
      zip_verdicts = batch.verdicts;
      zip_aggregate = batch.aggregate;
      zip_counts = batch.aggregate.counts;
    }

    // Con N lotes el estado sale del agregado (`aggregateZipVerdicts`), no de un
    // veredicto suelto: basta un rechazo para que el set esté rechazado, y hacen
    // falta TODOS resueltos con éxito para declararlo aprobado.
    const success = zip_aggregate ? zip_aggregate.success : verdict.success;
    // Terminal non-success (real StatusCode / fault / errors) == rejected, not pending.
    const still_processing = zip_aggregate
      ? zip_aggregate.pending
      : !success && !this.isTerminalZipStatus(verdict);
    const rejected = !success && !still_processing;

    const result_data = {
      ...previous,
      rechecked_at: new Date().toISOString(),
      zip_key,
      dian_response: {
        success: verdict.success,
        status_code: verdict.status_code,
        status_message: verdict.status_message,
        error_messages: verdict.error_messages ?? [],
        raw_response: verdict.raw_response?.slice(0, 12000),
      },
      poll_history,
      pending: still_processing,
      rejected,
      ...(zip_verdicts && { zip_verdicts }),
      ...(zip_counts && { zip_counts }),
    };

    // Concurrencia optimista sobre el lote consultado.
    //
    // Sondear a la DIAN tarda ~31 s, y este método hace leer-modificar-escribir
    // sobre TODO `last_test_result`. Sin este chequeo, una consulta que empezó
    // antes de un envío escribe su snapshot rancio encima y borra el ZipKey del
    // lote nuevo.
    //
    // Pasó en producción, config 12, con estos tiempos exactos:
    //   00:13:04.228  la consulta lee `last_test_result` (ZipKey 932bceac)
    //   00:13:16.447  el envío escribe el suyo         (ZipKey fa6f3f51)
    //   00:13:35.444  la consulta escribe su snapshot  → fa6f3f51 desaparece
    // Ese lote se envió a la DIAN, quemó 50 consecutivos autorizados
    // (990000050–990000099) y su ZipKey solo sobrevive en `dian_audit_logs`.
    // Un veredicto que no se puede consultar es un bloque de numeración perdido.
    //
    // La ventana no desaparece con el envío asíncrono: el cron reconsulta cada
    // 10 minutos y tarda 31 s, así que puede solaparse igual con un envío de 81 s.
    const current = await this.getConfigById(config_id);
    const current_result = (current.last_test_result ?? {}) as Record<
      string,
      any
    >;
    if (current_result.zip_key !== zip_key) {
      // Otro envío reemplazó el lote mientras consultábamos. El veredicto que
      // traemos es de un lote que ya no es el vigente: escribirlo perdería el
      // nuevo. Se descarta el resultado, no el lote.
      await this.createAuditLog(config.id, {
        action: 'check_test_set_status',
        status: 'pending',
        error_message:
          `La consulta del lote ${zip_key} se descartó: otro envío dejó ` +
          `${current_result.zip_key ?? '(ninguno)'} como lote vigente mientras se consultaba.`,
        duration_ms: Date.now() - started_at,
      });

      return this.testSetStatusFromStoredResult(
        current,
        current_result,
        'Se envió un lote nuevo mientras se consultaba el anterior. Consulta el estado del lote vigente.',
      );
    }

    await this.prisma.dian_configurations.update({
      where: { id: config_id },
      data: {
        last_test_result: result_data,
        // Only ever promote enablement_status; never demote a passed set.
        enablement_status: success
          ? 'test_set_passed'
          : config.enablement_status,
        // Only write evidence on success; leave the prior value untouched otherwise.
        ...(success && { enablement_evidence: result_data }),
      },
    });

    const wait = analyzeTestSetWait(result_data);

    await this.createAuditLog(config.id, {
      action: 'check_test_set_status',
      status: success ? 'success' : still_processing ? 'pending' : 'error',
      error_message: success
        ? null
        : still_processing
          ? wait.reason ?? `Aún en validación en la DIAN (ZipKey ${zip_key}).`
          : verdict.error_messages?.join(' | ') || verdict.status_message,
      duration_ms: Date.now() - started_at,
    });

    return {
      success,
      pending: still_processing,
      rejected,
      zip_key,
      // Nulo cuando el lote es de un solo ZipKey: ahí el recuento no aporta nada
      // que `pending`/`rejected` no digan ya.
      zip_counts: (zip_counts ?? null) as TestSetZipCounts | null,
      dian_status: verdict.status_code,
      status_message: verdict.status_message,
      error_messages: verdict.error_messages ?? [],
      poll_history,
      // Echo the submission metadata so the UI can render the full picture from
      // a single re-poll response instead of a second GET.
      executed_at: previous.executed_at ?? null,
      rechecked_at: result_data.rechecked_at,
      total_documents: previous.total_documents ?? null,
      invoices_count: previous.invoices ?? null,
      debit_notes_count: previous.debit_notes ?? null,
      credit_notes_count: previous.credit_notes ?? null,
      environment,
      enablement_status: success ? 'test_set_passed' : config.enablement_status,
      // Bounded reading of the wait, so the UI can stop offering "vuelve a
      // consultar" once that has demonstrably stopped working.
      wait,
      message: success
        ? 'La DIAN validó el set de pruebas. La habilitación quedó aprobada.'
        : still_processing
          ? wait.stalled
            ? 'La DIAN recibió el lote pero no emite veredicto. Seguir consultando no lo va a resolver: diagnostica por documento o descarta el lote y reenvía.'
            : 'La DIAN sigue validando el set de pruebas. Vuelve a consultar en unos minutos.'
          : `La DIAN rechazó el set de pruebas: ${verdict.status_message}`,
    };
  }

  /**
   * Per-document diagnosis of a submitted batch.
   *
   * `GetStatusZip` answers "did you process my package?" and nothing else — a
   * queued batch and a batch DIAN silently discarded look identical. Asking
   * `GetStatus` for an individual document key answers a different question:
   * "does this document exist in your records?". That is what separates
   * "still queued" from "never classified", which is undecidable from the
   * ZipKey alone.
   *
   * Read-only: never re-sends documents and never consumes numbering.
   */
  async getTestSetDocumentStatus(config_id: number, sample_size = 3) {
    const started_at = Date.now();
    const config = await this.getConfigById(config_id);
    const environment = config.environment as 'test' | 'production';

    const previous = (config.last_test_result ?? {}) as Record<string, any>;
    if (!previous.zip_key) {
      throw new VendixHttpException(ErrorCodes.DIAN_TEST_SET_004);
    }

    const persisted: any[] = Array.isArray(previous.documents)
      ? previous.documents
      : [];
    if (!persisted.length) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_005,
        `El set ${previous.zip_key} se envió antes de que se persistieran las claves de documento, así que no puede consultarse por CUFE.`,
        { dian_configuration_id: config_id, zip_key: previous.zip_key },
      );
    }

    // One document per kind: the batch is homogeneous within a kind, so three
    // probes answer the question without hammering DIAN with fifty round-trips.
    const sample: any[] = [];
    for (const kind of ['invoice', 'debit_note', 'credit_note']) {
      const first = persisted.find((doc) => doc.kind === kind);
      if (first) sample.push(first);
    }
    const probes = (sample.length ? sample : persisted).slice(0, sample_size);

    const ws_credentials = await this.loadWsCredentials(config);

    const documents: Array<Record<string, any>> = [];
    for (const doc of probes) {
      const status = await this.soap_client.getStatus(
        doc.cufe,
        environment,
        ws_credentials,
      );
      // Código 66 — "TrackId no existe en los registros de la DIAN" — ES una
      // respuesta, pero la respuesta es "no lo tengo". `has_dian_verdict` solo
      // mira que el StatusCode no venga vacío, así que un 66 lo ponía en true y
      // el documento salía `registered: true` mientras la DIAN decía lo
      // contrario. De esa bandera cuelgan `registered_count` y `verdict`, o sea
      // todo el dictamen: el diagnóstico aconsejaba escalar con la DIAN cuando lo
      // correcto era descartar el lote y reenviar.
      const not_found = DIAN_TRACKID_NOT_FOUND_CODES.has(
        (status.status_code ?? '').trim(),
      );
      // Tri-state, never a plain boolean: DIAN answering "no verdict" about a
      // document it DOES know is a different fact from not knowing it at all.
      const has_verdict =
        !not_found &&
        (status.has_dian_verdict === true ||
          (status.error_messages?.length ?? 0) > 0);
      documents.push({
        number: doc.number,
        kind: doc.kind,
        cufe: doc.cufe,
        file_name: doc.file_name ?? null,
        registered: !not_found && (has_verdict || status.success === true),
        status_code: status.status_code,
        status_message: status.status_message,
        error_messages: status.error_messages ?? [],
      });
    }

    const registered_count = documents.filter((d) => d.registered).length;

    await this.createAuditLog(config.id, {
      action: 'diagnose_test_set_documents',
      status: registered_count > 0 ? 'success' : 'pending',
      error_message:
        registered_count > 0
          ? null
          : `Ninguno de los ${documents.length} documentos consultados está registrado en la DIAN (ZipKey ${previous.zip_key}).`,
      duration_ms: Date.now() - started_at,
    });

    return {
      zip_key: previous.zip_key,
      environment,
      total_documents: persisted.length,
      sampled: documents.length,
      registered_count,
      // The actionable reading, so the UI does not have to re-derive it.
      verdict:
        registered_count === 0
          ? 'not_registered'
          : registered_count < documents.length
            ? 'partially_registered'
            : 'registered',
      documents,
      response_time_ms: Date.now() - started_at,
    };
  }

  /**
   * Marks a batch DIAN never judged as abandoned, releasing the re-send guard.
   *
   * `DIAN_TEST_SET_002` exists to stop accidental double submissions, not to
   * leave a configuration permanently stuck: a batch that never gets a verdict
   * would otherwise require editing `last_test_result` by hand in the database.
   * The discarded ZipKey is preserved as history so the abandonment is auditable.
   */
  async abandonTestSet(config_id: number) {
    const config = await this.getConfigById(config_id);
    const previous = (config.last_test_result ?? {}) as Record<string, any>;
    const zip_key: string | null = previous.zip_key ?? null;

    if (!zip_key) {
      throw new VendixHttpException(ErrorCodes.DIAN_TEST_SET_004);
    }

    const abandoned_batches = Array.isArray(previous.abandoned_batches)
      ? previous.abandoned_batches
      : [];

    const result_data: Record<string, any> = {
      ...previous,
      pending: false,
      abandoned: true,
      abandoned_at: new Date().toISOString(),
      abandoned_batches: [
        ...abandoned_batches,
        {
          zip_key,
          executed_at: previous.executed_at ?? null,
          number_from: previous.number_from ?? null,
          number_to: previous.number_to ?? null,
        },
      ],
    };

    // El puntero al lote vivo se BORRA, no se deja con `pending: false`.
    //
    // `pending` solo era un booleano que cualquier sondeo podía reescribir, y uno
    // lo hacía: `checkTestSetStatus` devolvía `pending: true` en cuanto la DIAN
    // repetía «en proceso de validación», deshaciendo el descarte. Sin `zip_key`
    // no hay nada que consultar, así que el descarte deja de ser una bandera
    // opinable y pasa a ser un hecho estructural.
    //
    // La clave no se pierde: queda en `abandoned_batches` (arriba) y en
    // `dian_audit_logs`, que es donde vive la auditoría del abandono.
    delete result_data.zip_key;
    delete result_data.tracking_id;

    await this.prisma.dian_configurations.update({
      where: { id: config_id },
      data: { last_test_result: result_data, enablement_status: 'testing' },
    });

    await this.createAuditLog(config.id, {
      action: 'abandon_test_set',
      status: 'success',
      error_message: `Lote ${zip_key} descartado sin veredicto de la DIAN; la configuración queda libre para reenviar.`,
    });

    return {
      abandoned: true,
      zip_key,
      message:
        'El lote anterior quedó descartado. Puedes ejecutar un nuevo set de pruebas.',
    };
  }

  /**
   * Respuesta de una consulta de estado que NO sondeó a la DIAN (lote descartado)
   * o que decidió no escribir su resultado (otro envío ganó la carrera).
   *
   * Existe para que esas salidas tengan EXACTAMENTE la misma forma que el retorno
   * normal: la UI y el cron leen campos concretos de esta respuesta
   * (`wait.state`, `success`, `zip_key`…), y una unión con propiedades ausentes
   * los rompe en compilación o, peor, en runtime con `undefined`.
   */
  private testSetStatusFromStoredResult(
    config: { environment: string; enablement_status: string },
    result: Record<string, any>,
    message: string,
  ) {
    const wait = analyzeTestSetWait(result);
    return {
      success: false,
      pending: result.pending === true,
      rejected: result.rejected === true,
      zip_key: (result.zip_key ?? null) as string | null,
      zip_counts: (result.zip_counts ?? null) as TestSetZipCounts | null,
      dian_status: null as string | null,
      status_message: wait.reason,
      error_messages: [] as string[],
      poll_history: [] as TestSetPollAttempt[],
      executed_at: result.executed_at ?? null,
      rechecked_at: result.rechecked_at ?? null,
      total_documents: result.total_documents ?? null,
      invoices_count: result.invoices ?? null,
      debit_notes_count: result.debit_notes ?? null,
      credit_notes_count: result.credit_notes ?? null,
      environment: config.environment as 'test' | 'production',
      enablement_status: config.enablement_status,
      wait,
      message,
    };
  }

  /**
   * Polls GetStatusZip until DIAN returns a terminal verdict or the bounded
   * attempts are exhausted. Records each attempt in `poll_history`.
   */
  private async pollTestSetStatus(
    zip_key: string,
    environment: 'test' | 'production',
    ws_credentials: WsSecurityCredentials | undefined,
    poll_history: TestSetPollAttempt[],
  ): Promise<DianSendBillResponse> {
    const max_attempts = 6;
    const delay_ms = 5_000;
    let last: DianSendBillResponse | null = null;

    for (let attempt = 1; attempt <= max_attempts; attempt++) {
      // Give DIAN a moment to process the batch before each poll.
      await this.sleep(delay_ms);

      const status = await this.soap_client.getStatusZip(
        zip_key,
        environment,
        ws_credentials,
      );
      last = status;

      poll_history.push({
        attempt,
        status_code: status.status_code,
        status_message: status.status_message,
        success: status.success,
      });

      this.logger.log(
        `[DIAN test-set] GetStatusZip ${attempt}/${max_attempts} ` +
          `zipKey=${zip_key} status=${status.status_code} success=${status.success}`,
      );

      if (this.isTerminalZipStatus(status)) {
        return status;
      }
    }

    return last as DianSendBillResponse;
  }

  /**
   * Sondea los N ZipKeys de un lote y agrega su veredicto.
   *
   * POR QUÉ NO REUSA `pollTestSetStatus` PARA N LOTES
   *
   * Ese método reintenta hasta 6 veces con 5 s de espera ANTES de cada intento:
   * ~36 s por ZipKey. Con un envío de 50 documentos —que sale como 50 ZIP
   * independientes, cada uno con su propio ZipKey— eso son 30 minutos de tiempo
   * de pared. No cabe en una petición HTTP y desborda el cron que lo invoca.
   *
   * El reintento interno existe para que UNA consulta resuelva UN lote que puede
   * voltear a terminal en esos 30 s. Con N lotes la repetición la aporta quien
   * llama (el cron cada 15 min), así que aquí se hace UN intento por ZipKey no
   * resuelto y se persiste el que sí resolvió. Cada invocación avanza y ninguna
   * repregunta lo ya sabido.
   *
   * AGREGACIÓN — un lote de habilitación es atómico frente al operador:
   *   · cualquier ZipKey terminal sin éxito  ⇒ el set está RECHAZADO
   *   · todos resueltos y todos con éxito    ⇒ el set está APROBADO
   *   · en cualquier otro caso               ⇒ sigue PENDIENTE
   *
   * `primary` es el veredicto que representa al lote en `dian_response`: el
   * primer rechazo si hay alguno —que es lo que el operador necesita leer—, si
   * no el primer éxito, y si no el último «en proceso».
   */
  private async pollBatchZipKeys(
    zip_keys: string[],
    environment: 'test' | 'production',
    ws_credentials: WsSecurityCredentials | undefined,
    poll_history: TestSetPollAttempt[],
    known: Record<string, TestSetZipVerdict>,
  ): Promise<{
    primary: DianSendBillResponse;
    verdicts: Record<string, TestSetZipVerdict>;
    aggregate: TestSetZipAggregate;
  }> {
    const verdicts: Record<string, TestSetZipVerdict> = { ...known };
    const pending_keys = zip_keys.filter((k) => !verdicts[k]);

    // Concurrencia acotada: 50 peticiones simultáneas a la DIAN es un pico que
    // el servicio de habilitación responde con timeouts, y un timeout aquí se
    // lee igual que «en proceso» — perderíamos el veredicto sin saberlo.
    const CONCURRENCY = 5;
    let cursor = 0;
    let pending_sample: DianSendBillResponse | null = null;

    const worker = async () => {
      while (cursor < pending_keys.length) {
        const key = pending_keys[cursor++];
        const status = await this.soap_client.getStatusZip(
          key,
          environment,
          ws_credentials,
        );

        poll_history.push({
          attempt: poll_history.length + 1,
          status_code: status.status_code,
          status_message: status.status_message,
          success: status.success,
          zip_key: key,
        });

        if (this.isTerminalZipStatus(status)) {
          verdicts[key] = {
            zip_key: key,
            success: status.success,
            status_code: status.status_code,
            status_message: status.status_message,
            error_messages: status.error_messages ?? [],
            resolved_at: new Date().toISOString(),
          };
        } else {
          // Solo se guarda una muestra NO terminal, y solo para conservar la
          // redacción literal de la DIAN («Batch en proceso de validación») en el
          // agregado. Un veredicto terminal nunca se lee de aquí: para eso está
          // `aggregate.primary_key`.
          pending_sample = pending_sample ?? status;
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pending_keys.length) }, worker),
    );

    const aggregate = aggregateZipVerdicts(zip_keys, verdicts);

    // `duration_ms: 0` porque este objeto no representa una llamada: reconstituye
    // un veredicto YA persistido para que el agregado tenga la misma forma que un
    // sondeo en vivo. Medir cero milisegundos de red es exacto, no un relleno.
    const asResponse = (v: TestSetZipVerdict): DianSendBillResponse => ({
      success: v.success,
      status_code: v.status_code,
      status_message: v.status_message,
      error_messages: v.error_messages,
      raw_response: '',
      has_dian_verdict: true,
      duration_ms: 0,
    });

    const primary = aggregate.primary_key
      ? asResponse(verdicts[aggregate.primary_key])
      : (pending_sample ?? {
          success: false,
          status_code: 'NO_VERDICT',
          status_message: 'Batch en proceso de validación.',
          error_messages: [],
          raw_response: '',
          duration_ms: 0,
        });

    this.logger.log(
      `[DIAN test-set] agregado sobre ${aggregate.counts.total} ZipKeys: ` +
        `resueltos=${aggregate.counts.resolved} aceptados=${aggregate.counts.accepted} ` +
        `rechazados=${aggregate.counts.rejected} pendientes=${aggregate.counts.pending}`,
    );

    return { primary, verdicts, aggregate };
  }

  /**
   * A GetStatusZip response is terminal (batch processed) when DIAN returns a
   * numeric <b:StatusCode>, a SOAP fault, or a populated ErrorMessageList.
   * Otherwise the batch is still being processed and we keep polling.
   */
  private isTerminalZipStatus(status: DianSendBillResponse): boolean {
    if (status.is_soap_fault === true) return true;
    if ((status.error_messages?.length ?? 0) > 0) return true;
    // The parser already distinguishes a populated <b:StatusCode> from the
    // self-closing/nil one DIAN returns while the batch is queued, so trust that
    // flag instead of re-scraping the raw XML here.
    if (typeof status.has_dian_verdict === 'boolean') {
      return status.has_dian_verdict;
    }
    return /<b:StatusCode\b[^>]*>\s*\d+\s*<\/b:StatusCode>/.test(
      status.raw_response || '',
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Gets the test results for a specific DIAN configuration.
   */
  async getTestResults(config_id: number) {
    const config = await this.prisma.dian_configurations.findFirst({
      where: { id: config_id },
      select: {
        id: true,
        enablement_status: true,
        environment: true,
        test_set_id: true,
        last_test_result: true,
      },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    return {
      enablement_status: config.enablement_status,
      environment: config.environment,
      test_set_id: config.test_set_id,
      last_result: config.last_test_result,
      // Derived on read, never stored: `pending` + `executed_at` are the facts,
      // and a persisted "stalled" flag would go stale the moment DIAN answers.
      wait: analyzeTestSetWait(config.last_test_result),
      // Cuántos documentos y consecutivos implica un envío en ESTE modo de
      // operación. Sin esto la UI imprimía 50, la composición de 2019.
      composition: buildTestSetCompositionView(config.operation_mode),
    };
  }

  /**
   * Builds a multi-file ZIP archive and returns its base64 representation.
   * Uses adm-zip for reliable ZIP format compatibility with DIAN.
   */
  private buildMultiFileZip(
    files: { name: string; content: string }[],
  ): string {
    const zip = new AdmZip();
    for (const file of files) {
      zip.addFile(file.name, Buffer.from(file.content, 'utf-8'));
    }
    return zip.toBuffer().toString('base64');
  }

  private async createAuditLog(
    dian_configuration_id: number,
    data: {
      action: string;
      status: string;
      error_message?: string | null;
      duration_ms?: number;
    },
  ): Promise<void> {
    try {
      await this.prisma.dian_audit_logs.create({
        data: {
          dian_configuration_id,
          ...data,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create DIAN audit log: ${error.message}`);
    }
  }
}
