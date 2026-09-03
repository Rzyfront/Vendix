import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import AdmZip = require('adm-zip');
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { DianSecretEnvelopeService } from '../../../../common/services/dian-secret-envelope.service';
import { TechnicalKeyVaultService } from '../../../../common/services/technical-key-vault.service';
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
import {
  UblStructureValidator,
  summarizeUblViolations,
} from '../providers/dian-direct/xml/ubl-structure.validator';
import {
  DianTotalsValidator,
  summarizeDianTotalsViolations,
} from '../providers/dian-direct/xml/dian-totals.validator';
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
import { resolveInvoiceControl } from '../../../../common/helpers/invoice-control.helper';
import {
  buildDianXmlFileName,
  buildDianZipFileName,
  softwareCodeForOperationMode,
  DianDocumentKind,
} from '../utils/dian-file-naming.util';
import {
  analyzeTestSetWait,
  resolveTestSetWait,
} from './test-set-wait.util';
import {
  aggregateZipVerdicts,
  describeRejectedDocuments,
  indexDocumentsByZipKey,
  rejectionMessages,
  MAX_RAW_RESPONSE_CHARS,
  TestSetDocumentRef,
  TestSetZipAggregate,
  TestSetZipCounts,
  TestSetZipVerdict,
} from './test-set-zip-aggregate.util';
import {
  buildNotePhaseView,
  canWriteEnablementStatus,
  decideNotePhase,
  isTestSetClosedByDian,
  resolveRegisteredInvoiceReferences,
  NOTE_PHASE_MAX_POLLS,
  NOTE_PHASE_POLL_DELAY_MS,
} from './note-phase-gate.util';
import { resolveIssuerFiscalIdentity } from '../utils/fiscal-issuer.util';
import {
  isWellFormedTechnicalKey,
  normalizeTechnicalKey,
  TECHNICAL_KEY_LENGTHS,
  TECHNICAL_KEY_LENGTHS_LABEL,
} from '../fiscal-document-requirements';
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
  /**
   * Reglas que la DIAN reportó EN ESTE intento.
   *
   * EL DEFECTO QUE CIERRA: los dos push de este arreglo copiaban
   * `status_code`/`status_message`/`success` y descartaban `status.error_messages`,
   * teniéndolos delante. `poll_history` es lo que un operador lee cuando quiere
   * saber qué contestó la DIAN en cada consulta, y contestaba sin el motivo.
   *
   * Opcional: los intentos escritos antes de este campo no lo traen, y un sondeo
   * sin reglas (el caso normal, «en proceso») no debe inventar un arreglo vacío
   * en cada fila del historial.
   */
  error_messages?: string[];
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
    // El import ya estaba; el servicio no. Se usa en la precondición de ClTec
    // del set de pruebas para leer la MISMA clave que hashea la emisión real.
    private readonly technicalKeyVault: TechnicalKeyVaultService,
    // Productor de la cola del set de pruebas. Consumidor: DianTestSetProcessor.
    // La cola se registra en cada módulo que expone el flujo (tienda,
    // organización y plataforma) porque las tres superficies comparten ESTE
    // servicio, no una copia por dominio.
    @InjectQueue('dian-test-set') private readonly testSetQueue: Queue,
  ) {}

  /**
   * Devuelve el event loop al resto del proceso durante UN turno de macrotarea.
   *
   * ## Por qué hace falta un `setImmediate` y no basta con `await` (QUI-674)
   *
   * Los bucles que arman el set son CPU pura: construir el UBL, calcular el
   * CUFE/CUDE (SHA-384) y firmar (canonicalización C14N + `crypto.createSign()`,
   * que es la API SÍNCRONA y no baja al threadpool). Entre el `update` de
   * `enablement_status` y el primer `SendTestSetAsync` NO hay una sola operación
   * de E/S real: los `await` de `sign()` resuelven promesas YA cumplidas, así que
   * son MICROTAREAS. La cola de microtareas se drena entera antes de volver al
   * event loop, de modo que los 50 documentos corrían en un ÚNICO macrotask
   * ininterrumpido.
   *
   * Consecuencias medidas en producción: nginx devolvía 504 en rutas triviales
   * (`/api/store/notifications?limit=15`) porque el proceso —el MISMO que sirve
   * la API— no llegaba a atender el socket, y BullMQ registraba
   * `could not renew lock for job` porque su temporizador de renovación (a la
   * mitad de `lockDuration`) tampoco podía correr.
   *
   * `setImmediate` encola en la fase *check*, que corre DESPUÉS de la fase de
   * timers: ceder aquí es exactamente lo que le da su turno al renovador del lock
   * y a los sockets HTTP pendientes. Es la cesión mínima: un turno por documento.
   */
  private yieldEventLoop(): Promise<void> {
    return new Promise<void>((resolve) => setImmediate(resolve));
  }

  async getConfigById(config_id: number) {
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
   * Pregunta a la DIAN qué rangos de numeración tiene AUTORIZADOS esta
   * configuración, y devuelve la respuesta CRUDA para que el llamador la lea.
   *
   * ── POR QUÉ ES PÚBLICO Y VIVE AQUÍ ─────────────────────────────────────────
   *
   * Porque la carga de credenciales WS-Security (`loadWsCredentials`) es
   * privada y no trivial: descifra la contraseña, baja el `.p12` de S3 y decide
   * entre custodia en proceso y HSM. `DianNumberingRangeService` sólo necesita
   * el XML; duplicar esa carga allí crearía una segunda forma de abrir el
   * certificado, que es justo el tipo de divergencia que hizo que el set de
   * pruebas se firmara con una ClTec y la producción con otra.
   *
   * ── POR QUÉ NO PASA POR `enqueueTestSet` ───────────────────────────────────
   *
   * Esta consulta no emite nada, no reserva un solo consecutivo y no toca el set
   * de pruebas. Las guardas de la cola —exigir `test_set_id`, exigir
   * `environment === 'test'`, bloquear si hay un lote pendiente de veredicto—
   * existen para proteger numeración autorizada; aplicarlas aquí dejaría
   * inalcanzable el diagnóstico precisamente cuando más se necesita: con una
   * habilitación atascada, o ya en producción, que es donde vive el defecto
   * FAD06 que esta consulta resuelve.
   *
   * ⚠️ `raw_response` TRAE LA ClTec EN CLARO. No devolver este objeto por HTTP
   * ni escribirlo en un `job.returnvalue`: quien tenga la clave recomputa el
   * CUFE de todo lo emitido bajo ese rango. La superficie HTTP es
   * `GET /store/invoicing/dian-config/:id/numbering-ranges`, que compara la
   * clave en el servidor y publica sólo un booleano.
   *
   * ── POR QUÉ EL AMBIENTE ES PARÁMETRO Y NO SE HEREDA ────────────────────────
   *
   * Porque heredarlo de `config.environment` cerraba un ciclo del que no se
   * salía por dentro. Una configuración en habilitación preguntaba a
   * `vpfe-hab.dian.gov.co`, donde las autorizaciones de PRODUCCIÓN no viven, así
   * que la lista volvía vacía; sin rango no había cómo crear la fila de
   * `invoice_resolutions`; sin esa fila `assertResolutionReady` respondía
   * `FISCAL_RESOLUTION_MISSING`; sin readiness `promoteToProduction` se negaba; y
   * sin producción la consulta seguía apuntando a habilitación. Seis pasos y
   * vuelta al primero.
   *
   * La configuración 20 (NIT 1123408049) sólo salió de ahí por el rodeo:
   * inventar una resolución falsa, promover con ella, consultar los rangos
   * reales, borrar la falsa y activar la verdadera. Entre la promoción y el
   * borrado la configuración estaba EN PRODUCCIÓN con una ClTec inventada, y
   * cualquier factura emitida en esa ventana se habría firmado con ella: la DIAN
   * la rechaza con `FAD06` y el consecutivo autorizado que gastó no vuelve.
   *
   * ── POR QUÉ PREGUNTAR POR EL OTRO AMBIENTE NO ABRE NADA ────────────────────
   *
   * Esta operación LEE. No emite documento, no reserva consecutivo y no toca
   * `config.environment`: el ambiente sólo decide a qué catálogo de la DIAN se
   * dirige el sobre SOAP. Ninguna guarda de emisión ni de promoción cambia por
   * esto — ver la nota equivalente en `DianNumberingRangeService.applyRanges`
   * para el lado que SÍ escribe.
   *
   * Ausente ⇒ el de la configuración, que es exactamente lo que hacía antes.
   */
  async queryNumberingRange(
    config_id: number,
    environment?: 'test' | 'production' | null,
  ): Promise<{
    dian_configuration_id: number;
    nit: string;
    software_id: string;
    /** El ambiente que de verdad se CONSULTÓ. */
    environment: 'production' | 'test';
    /**
     * El de la configuración. Viaja aparte porque a partir de este cambio los
     * dos pueden diferir, y quien lea la respuesta necesita saberlo para no
     * atribuirle a la configuración un catálogo que no es el suyo.
     */
    config_environment: 'production' | 'test';
    accounting_entity_id: number | null;
    queried_at: string;
    raw_response: string;
  }> {
    const config = await this.getConfigById(config_id);
    const credentials = await this.loadWsCredentials(config);
    const nit = String(config.nit ?? '').replace(/\D/g, '');
    const config_environment =
      config.environment === 'production' ? 'production' : 'test';
    const queried_environment = environment ?? config_environment;

    // `accountCodeT` es el NIT del proveedor tecnológico. En software propio el
    // obligado ES su propio proveedor, así que va el mismo NIT.
    const response = await this.soap_client.getNumberingRange(
      nit,
      nit,
      String(config.software_id ?? ''),
      queried_environment,
      credentials,
    );

    // `success` NO sirve de criterio: `parseSoapResponse` sólo conoce el
    // vocabulario de SendBill/GetStatus, así que una consulta de rangos
    // perfectamente exitosa vuelve con `status_code: 'NO_VERDICT'` y
    // `success: false`. Lo que sí distingue un fallo real es la ausencia de
    // sobre —los tres modos de fallo de transporte devuelven `raw_response`
    // vacío— o un SOAP Fault, que es la DIAN rechazando la petición.
    const transport_failed =
      !response.raw_response?.trim() ||
      response.is_soap_fault === true ||
      response.status_code === 'TIMEOUT' ||
      response.status_code === 'NETWORK_ERROR' ||
      response.status_code === 'DIAN_UNAVAILABLE';

    if (transport_failed) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_NUMBERING_RANGE_001,
        `La DIAN no respondió la consulta de rangos de numeración: ${response.status_message}`,
        {
          dian_configuration_id: config_id,
          // El mensaje de la DIAN, nunca su cuerpo: el XML trae la ClTec.
          dian_status_code: response.status_code,
          // Los DOS: sin el consultado no se sabe a qué catálogo no contestó la
          // DIAN, y sin el de la configuración no se sabe si el fallo ocurrió
          // preguntando por el ambiente propio o por el contrario.
          environment: queried_environment,
          config_environment,
        },
      );
    }

    return {
      dian_configuration_id: config.id,
      nit,
      software_id: String(config.software_id ?? ''),
      environment: queried_environment,
      config_environment,
      accounting_entity_id: config.accounting_entity_id ?? null,
      queried_at: new Date().toISOString(),
      raw_response: response.raw_response,
    };
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
    // LA DIAN NO ACEPTA DOCUMENTOS CONTRA UN SET QUE YA APROBÓ.
    //
    // Responde status 2 a cada uno: «Set de prueba con identificador … se
    // encuentra Aceptado.» Medido el 2026-08-09: un reenvío gastó 30 consecutivos
    // autorizados para cosechar 30 veces esa frase. Los documentos estaban bien —
    // el humo sincrónico del mismo código dio `is_valid: true`.
    //
    // Las vías de diagnóstico quedan EXENTAS: `validate_only` y `smoke` van por
    // `SendBillSync` sin `testSetId`, no tocan el set, y son justamente cómo se
    // comprueba un arreglo después de la habilitación.
    if (
      !options.validate_only &&
      !options.smoke &&
      isTestSetClosedByDian(config.enablement_status)
    ) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_006,
        'La DIAN ya aprobó el set de pruebas de esta configuración y no acepta más documentos contra él: ' +
          'responde «Set de prueba … se encuentra Aceptado» y cada consecutivo enviado se pierde. ' +
          'Para comprobar un arreglo usa la vía de validación sincrónica, que cuesta 1 consecutivo y no toca el set.',
        {
          dian_configuration_id: config_id,
          enablement_status: config.enablement_status,
        },
      );
    }

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

    // PR 5 — guard anti-duplicado. La guarda anterior solo leía
    // last_test_result.pending, que se escribe al final del worker; entre el
    // add() y la primera escritura de pending (puede ser minutos), N clicks
    // encolaban N jobs y quemaban N bloques de 50 consecutivos autorizados
    // irrecuperables. Aquí consultamos la cola BullMQ directamente: barato
    // porque solo hay 1-2 jobs vivos esperados y la cola ya tiene
    // removeOnComplete/Fail configurado.
    if (!options.validate_only && !options.smoke) {
      const liveJobs = await this.testSetQueue.getJobs(['waiting', 'active']);
      const dup = liveJobs.find((j) => j?.data?.config_id === config_id);
      if (dup) {
        throw new VendixHttpException(
          ErrorCodes.DIAN_TEST_SET_002,
          `Ya hay un lote del config ${config_id} en cola (job ${dup.id}). Consulta su estado antes de reenviar.`,
          { dian_configuration_id: config_id, job_id: String(dup.id) },
        );
      }
    }

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
   * PR 4 — escribe `last_test_result.abandoned = true` y limpia `pending`.
   *
   * Se invoca desde el listener `onFailed` del processor cuando el job
   * falla por OOM, exit 137 o error del servicio. La condición de carrera
   * con el cron de repoll es benigna: el repoll lee `last_test_result` por
   * su propia ruta; si está `abandoned: true` simplemente no hace nada.
   */
  async persistTestSetAbandonment(
    config_id: number,
    reason: string,
  ): Promise<void> {
    const current = await this.prisma.dian_configurations.findUnique({
      where: { id: config_id },
      select: { last_test_result: true },
    });
    const last = (current?.last_test_result ?? {}) as Record<string, any>;
    await this.prisma.dian_configurations.update({
      where: { id: config_id },
      data: {
        last_test_result: {
          ...last,
          pending: false,
          abandoned: true,
          abandoned_reason: reason,
          abandoned_at: new Date().toISOString(),
        },
      },
    });
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
    options: {
      smoke?: boolean;
      validate_only?: boolean;
      numbering_range?: boolean;
      check_status?: boolean;
      /**
       * Qué documento emite la vía de diagnóstico. Por defecto una factura.
       *
       * Existe porque los rechazos que quedaban vivos eran de NOTA, y un humo que
       * solo puede emitir facturas no puede medirlos: había que gastar los 50
       * consecutivos del set completo para ver si una nota había quedado bien.
       * Con esto la pregunta cuesta 1.
       */
      validate_kind?: DianDocumentKind;
    } = {},
  ) {
    // CONSULTA DE VEREDICTO — corta aquí, sin emitir ni reservar numeración.
    // Resuelve el estado de un lote ya enviado por `GetStatusZip`.
    if (options.check_status === true) {
      return this.checkTestSetStatus(config_id);
    }

    // CONSULTA DE RANGOS AUTORIZADOS — corta aquí, antes de tocar numeración.
    //
    // No emite ningún documento y no reserva ningún consecutivo: le pregunta a la
    // DIAN qué resolución, prefijo, rango, VIGENCIA y clave técnica tiene
    // registrados para este OFE. Es la fuente autoritativa de esos datos.
    //
    // Existe porque transcribirlos del portal a mano ya produjo tres defectos: un
    // municipio de otro pueblo (44847 Uribia por 44001 Riohacha), unas fechas de
    // vigencia que la DIAN rechaza con FAB07b/FAB08b, y —el caro— una ClTec que
    // no es la ligada a la resolución, que rechaza cada factura con FAD06.
    //
    // LA RESPUESTA CRUDA YA NO SALE DE AQUÍ. Este retorno se persiste en
    // `job.returnvalue` (Redis) y se sirve por `GET :id/run-test-set/:jobId`, y
    // el XML de `GetNumberingRange` trae la ClTec EN CLARO: publicarlo entrega
    // la llave con la que se recomputa el CUFE de todo el rango. Para leer los
    // rangos está `GET :id/numbering-ranges`, que compara la clave en el
    // servidor y devuelve sólo un booleano.
    if (options.numbering_range === true) {
      const query = await this.queryNumberingRange(config_id);
      return {
        numbering_range_query: true,
        dian_configuration_id: query.dian_configuration_id,
        nit: query.nit,
        software_id: query.software_id,
        environment: query.environment,
        queried_at: query.queried_at,
        ranges_endpoint:
          'GET /store/invoicing/dian-config/:id/numbering-ranges',
      };
    }

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

    // SET YA APROBADO POR LA DIAN — copia de la guarda de `enqueueTestSet`, y por
    // la misma razón que el comentario de abajo da para la guarda de lote pendiente:
    // las dos copias tienen que existir o ninguna sirve. La cola se puede alimentar
    // directamente sin pasar por `enqueueTestSet` —así se ejecutaron todos los
    // envíos de operador de esta habilitación—, y ese camino se salta la primera.
    //
    // Va ANTES de reservar numeración: el objeto es no gastar consecutivos que la
    // DIAN va a devolver con «Set de prueba … se encuentra Aceptado».
    if (
      !options.validate_only &&
      !options.smoke &&
      isTestSetClosedByDian(config.enablement_status)
    ) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_006,
        'La DIAN ya aprobó el set de pruebas de esta configuración y no acepta más documentos contra él: ' +
          'responde «Set de prueba … se encuentra Aceptado» y cada consecutivo enviado se pierde. ' +
          'Para comprobar un arreglo usa la vía de validación sincrónica, que cuesta 1 consecutivo y no toca el set.',
        {
          dian_configuration_id: config_id,
          enablement_status: config.enablement_status,
        },
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
    //
    // `validate_kind` elige QUÉ documento emite el diagnóstico. Sigue siendo UN
    // consecutivo; lo que cambia es cuál de los tres tipos se pone a prueba. Una
    // nota emitida así referencia una factura de un lote ANTERIOR que la DIAN ya
    // aceptó (ver más abajo), no una de este lote: si no, el humo arrastraría
    // CBG04a/DBG04a y no distinguiría «la nota está mal» de «su factura no existe».
    const composition = diagnostic
      ? options.validate_kind === 'debit_note'
        ? { invoices: 0, debit_notes: 1, credit_notes: 0 }
        : options.validate_kind === 'credit_note'
          ? { invoices: 0, debit_notes: 0, credit_notes: 1 }
          : { invoices: 1, debit_notes: 0, credit_notes: 0 }
      : resolveTestSetComposition(config.operation_mode);
    const TEST_SET_SIZE = testSetSize(composition);

    // El código `ppp` del nombre de archivo se resuelve ANTES de reservar el
    // bloque de numeración: un modo de operación sin código soportado debe
    // fallar sin quemar consecutivos autorizados, que no se recuperan.
    const software_code = softwareCodeForOperationMode(config.operation_mode);

    // La ClTec del rango se resuelve AQUÍ por el mismo motivo que `software_code`:
    // es el 14º campo del CUFE de cada factura del set y el bloque de numeración
    // todavía no está reservado.
    //
    // Antes se hacía `resolution.technical_key || ''` en el sitio de uso: sin
    // clave se hasheaba la cadena vacía y salían 30 facturas con un CUFE que la
    // DIAN nunca podría reproducir. El set se rechazaba entero, la habilitación
    // no avanzaba y el mensaje no decía por qué — mientras 50 consecutivos
    // autorizados quedaban gastados. Es el mismo hueco que quemó una factura
    // real en producción con una clave de 38 caracteres, solo que multiplicado
    // por el tamaño del set.
    //
    // Solo se exige cuando el set incluye facturas: las vías de diagnóstico de
    // nota (`validate_kind`) emiten un CUDE con Software-PIN y no tocan la ClTec.
    let invoice_technical_key = '';
    if (composition.invoices > 0) {
      // Por la BÓVEDA, igual que `invoice-flow.service.ts` al emitir de verdad.
      // Este servicio validaba y hasheaba la columna plana; eran coherentes
      // ENTRE SÍ, y ahí estaba la trampa: el set de pruebas se firmaba con una
      // clave y la producción con la que `reveal()` prefiere —la cifrada—. Se
      // consigue la habilitación con una ClTec y se emite con otra, que es el
      // peor desenlace posible porque el fallo aparece después de certificar.
      const technical_key = normalizeTechnicalKey(
        this.technicalKeyVault.reveal(resolution),
      );
      if (!isWellFormedTechnicalKey(technical_key)) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_RESOLUTION_011,
          `La resolución ${resolution.prefix}${resolution.resolution_number} no tiene una clave técnica (ClTec) utilizable: ` +
            `${technical_key.length === 0 ? 'está vacía' : `tiene ${technical_key.length} caracteres`} y la DIAN la emite de ` +
            `${TECHNICAL_KEY_LENGTHS_LABEL} en hexadecimal. Cópiala completa desde la resolución de habilitación que generó el portal DIAN ` +
            'antes de enviar el set: con una clave equivocada la DIAN rechaza los documentos por CUFE mal calculado y los ' +
            'consecutivos que gasten no se recuperan. No se reservó numeración.',
          {
            dian_configuration_id: config_id,
            resolution_id,
            technical_key_length: technical_key.length,
            expected_lengths: [...TECHNICAL_KEY_LENGTHS],
          },
        );
      }
      invoice_technical_key = technical_key;
    }

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

    // DIAN InvoiceControl (sts:DianExtensions/InvoiceControl) — lo construye el
    // RESOLVEDOR ÚNICO, no este archivo.
    //
    // Aquí vivía la única implementación del bloque, y por eso la emisión real
    // salía sin él: no había nada compartido que consumir. Ahora ambos caminos
    // llaman a `resolveInvoiceControl`, así que el set de pruebas y la producción
    // declaran la misma autorización por construcción y no por coincidencia.
    const control = resolveInvoiceControl(resolution, timezone, new Date(), {
      resolution_id: resolution.id,
      document_type: resolution.document_type,
    });

    // ALCANCE FISCAL: `fiscal_data` vive en `store_settings` para entidades con
    // alcance de TIENDA y en `organization_settings` para las de ORGANIZACIÓN. Es
    // el mismo criterio que aplica la emisión real en `dian-direct.provider.ts`, y
    // leer solo el de organización deja sin identidad a los tenants por tienda:
    // en producción HIDRO (cfg 12, store 97) tiene su `fiscal_data` en
    // `store_settings` y `organization_settings.fiscal_data` en null.
    const issuer_entity = config.accounting_entity_id
      ? await this.prisma.withoutScope().accounting_entities.findFirst({
          where: { id: config.accounting_entity_id },
          select: {
            name: true,
            legal_name: true,
            fiscal_scope: true,
            // La dirección FISCAL, no una de despacho: vive en `addresses` con
            // `type='billing'` por la decisión documentada en `schema.prisma`.
            organization: {
              include: {
                organization_settings: true,
                addresses: {
                  where: { type: 'billing' },
                  orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
                  take: 1,
                },
              },
            },
            store: {
              include: {
                store_settings: true,
                addresses: {
                  where: { type: 'billing' },
                  orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
                  take: 1,
                },
              },
            },
          },
        })
      : null;

    const is_store_scope = issuer_entity?.fiscal_scope === 'STORE';
    const organization =
      issuer_entity?.organization ??
      (await this.prisma.organizations.findFirst({
        where: { id: context.organization_id },
      }));

    const scoped_settings = (
      is_store_scope
        ? issuer_entity?.store?.store_settings?.settings
        : issuer_entity?.organization?.organization_settings?.settings
    ) as Record<string, unknown> | undefined;
    // Respaldo cruzado: un tenant por tienda que solo guardó su identidad a nivel
    // de organización (o al revés) no debe quedarse sin emisor por eso.
    const org_settings =
      scoped_settings ??
      ((issuer_entity?.organization?.organization_settings?.settings ??
        issuer_entity?.store?.store_settings?.settings) as
        | Record<string, unknown>
        | undefined);

    const scoped_address = is_store_scope
      ? issuer_entity?.store?.addresses?.[0]
      : issuer_entity?.organization?.addresses?.[0];

    // EL EMISOR SALE DE LA FUENTE ÚNICA DE LA VERDAD, NO DE LITERALES.
    //
    // Aquí vivían hardcodeados `address_line: 'Calle 1 # 1-1'`, `city_code:
    // '11001'` (Bogotá), `tax_regime: '49'` y `tax_scheme: 'O-15'`. Con el NIT de
    // Quickss (902056589), cuyo RUT registra Riohacha 44847 y las
    // responsabilidades O-13 y O-47, cada documento del set declaraba tres cosas
    // incoherentes con el RUT a la vez. La peor era `'49'`: NO responsable de IVA
    // en documentos que cobran 19% de IVA, una contradicción dentro del mismo
    // documento.
    //
    // `resolveIssuerFiscalIdentity` es el MISMO resolvedor que consume la emisión
    // real, así que habilitación y producción no pueden volver a declarar cosas
    // distintas sobre el mismo NIT — que es exactamente cómo se produjo un 'O-15'
    // aquí y un 'O-13' allá.
    const issuer: DianIssuerData = resolveIssuerFiscalIdentity({
      nit: config.nit,
      config_name: config.name,
      fiscal_data: (org_settings?.fiscal_data ?? null) as Record<
        string,
        unknown
      > | null,
      entity: issuer_entity,
      organization,
      address: scoped_address ?? null,
      email: organization?.email,
    });

    const customer: DianCustomerData = {
      document_type: 'CC',
      document_number: '222222222222',
      verification_digit: null,
      legal_name: 'Consumidor Test DIAN',
      address_line: 'Calle Test 123',
      city_code: '11001',
      city_name: 'Bogotá',
      department_code: '11',
      department_name: 'Bogotá D.C.',
      country_code: 'CO',
      email: 'test@consumidor.com',
      tax_regime: '49',
      tax_responsibilities: ['R-99-PN'],
      person_type: 'NATURAL',
      ciiu_code: null,
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
    //
    // Y una config ya `enabled` TAMPOCO: ninguna rama de este método vuelve nunca
    // a `enabled`, así que reenviar el set para probar las notas degradaría una
    // habilitación que la DIAN ya concedió y que su portal solo devuelve a mano.
    // Ver `canWriteEnablementStatus`.
    const may_write_enablement = canWriteEnablementStatus(
      config.enablement_status,
    );
    if (!diagnostic && may_write_enablement) {
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
    // `kind` viaja con el archivo porque la transmisión va en DOS FASES y tiene
    // que separar facturas de notas. Derivarlo del índice paralelo de
    // `documents[]` funcionaría hoy y se rompería en silencio el día que alguien
    // añada un push a uno de los dos arreglos y no al otro.
    const files: {
      name: string;
      content: string;
      consecutive: number;
      kind: DianDocumentKind;
    }[] = [];
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
        // Probada con forma de ClTec antes de reservar numeración. La cadena
        // vacía es inalcanzable: este bucle solo corre cuando
        // `composition.invoices > 0`, que es la condición que exige la clave.
        technical_key: invoice_technical_key,
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
      this.assertStructurallyValid(xml);
      this.assertTotalsCoherent(xml);

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
        kind: 'invoice',
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

      // Un turno del event loop por documento: ver `yieldEventLoop`.
      await this.yieldEventLoop();
    }

    // 6a-bis. Cuando el lote NO emite facturas propias —el humo de una nota— la
    // referencia sale de un lote ANTERIOR, de entre las facturas que la DIAN
    // ACEPTÓ y por tanto tiene registradas.
    //
    // Es lo que hace que el humo de una nota sea una medición limpia: si la DIAN
    // vuelve a objetar, la objeción es del documento y no de una factura que aún
    // no existe de su lado. Sin esto el diagnóstico arrastraría CBG04a/DBG04a y
    // volvería a mezclar las dos causas — el ruido que costó un mes separar.
    if (
      invoice_cufes.length === 0 &&
      composition.debit_notes + composition.credit_notes > 0
    ) {
      const registered = resolveRegisteredInvoiceReferences(previous_result);
      if (registered.length === 0) {
        throw new VendixHttpException(
          ErrorCodes.DIAN_TEST_SET_003,
          'No hay ninguna factura aceptada por la DIAN a la que la nota pueda referenciar. ' +
            'Emite primero un set (o un humo de factura) y espera su veredicto: una nota ' +
            'contra una factura no registrada se rechaza con CBG04a/DBG04a y gasta el consecutivo.',
          { dian_configuration_id: config_id, resolution_id },
        );
      }
      invoice_cufes.push(...registered);
      this.logger.log(
        `[DIAN test-set] la nota referenciará una factura ya aceptada: ` +
          `${registered[0].number} (${registered.length} disponibles).`,
      );
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

      this.assertStructurallyValid(xml);
      this.assertTotalsCoherent(xml);

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
        kind: 'debit_note',
      });
      documents.push({
        number: note_number,
        cufe: cude,
        kind: 'debit_note',
        file_name: debit_file,
        issue_date: today,
        issue_time: time_now,
      });

      // Un turno del event loop por documento: ver `yieldEventLoop`.
      await this.yieldEventLoop();
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

      this.assertStructurallyValid(xml);
      this.assertTotalsCoherent(xml);

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
        kind: 'credit_note',
      });
      documents.push({
        number: note_number,
        cufe: cude,
        kind: 'credit_note',
        file_name: credit_file,
        issue_date: today,
        issue_time: time_now,
      });

      // Un turno del event loop por documento: ver `yieldEventLoop`.
      await this.yieldEventLoop();
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
    // Declarado aquí y no después del envío porque la espera entre fase 1 y fase
    // 2 sondea `GetStatusZip` y sus intentos son parte del historial del lote: si
    // el operador ve «diferida tras 20 consultas», tiene que poder leer las 20.
    const poll_history: TestSetPollAttempt[] = [];

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
      /**
       * Las mismas reglas DECODIFICADAS del `ApplicationResponse` que viaja en
       * base64 dentro de `<b:XmlBase64Bytes>`. No es redundante con
       * `error_messages`: la DIAN puede devolver `<b:ErrorMessage i:nil="true"/>`
       * y poner el motivo únicamente ahí dentro, que es el caso que dejaba un
       * rechazo sin explicación.
       */
      rejection_rules?: TestSetZipVerdict['rejection_rules'];
      /**
       * Fase del envío: 1 = facturas, 2 = notas. Persistir la fase es lo que
       * permite leer después «las facturas salieron y las notas no» sin
       * deducirlo del nombre del archivo.
       */
      phase: 1 | 2;
    }[] = [];

    const transmit = async (
      batch: typeof files,
      phase: 1 | 2,
    ): Promise<void> => {
      for (const file of batch) {
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
          // UN RECHAZO DE ENVÍO, no un acuse. `SendTestSetAsync` devuelve
          // `success: false` SIEMPRE —su respuesta es un ZipKey, no un
          // veredicto—, así que condicionar por `!success` a secas escribiría 50
          // filas de «rechazo» en cada envío sano. La ausencia de ZipKey es lo
          // que separa las dos cosas: la vía sincrónica (`SendBillSync`), el
          // SOAP Fault y el error HTTP no traen ninguno.
          const is_submit_rejection = !response.success && !response.zip_key;
          const decoded = this.decodeRejection(
            is_submit_rejection ? response.raw_response : undefined,
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
            // Las reglas DECODIFICADAS del `ApplicationResponse`. La DIAN puede
            // devolver `ErrorMessage` vacío y poner el motivo solo ahí dentro.
            ...(decoded.rejection_rules?.length
              ? { rejection_rules: decoded.rejection_rules }
              : {}),
            phase,
          });

          if (is_submit_rejection) {
            const doc = documents.find((d) => d.file_name === file.name);
            const rules = [
              ...(decoded.rejection_rules ?? []).map((r) =>
                r.code && r.code !== 'DIAN_VALIDATION'
                  ? `${r.code}: ${r.message}`
                  : r.message,
              ),
              ...(response.error_messages ?? []),
            ];
            await this.createAuditLog(config.id, {
              action: options.validate_only
                ? 'validate_document_rejected'
                : 'test_set_document_rejected',
              status: 'error',
              document_type: doc?.kind ?? file.kind,
              document_number: doc?.number ?? null,
              cufe: doc?.cufe ?? decoded.document_key ?? null,
              // El XML FIRMADO que se transmitió. Es la única copia fuera del
              // JSON del lote, y el JSON se reescribe con el envío siguiente.
              request_xml: file.content,
              response_xml: decoded.raw_response ?? response.raw_response ?? null,
              error_message: `${response.status_code}: ${
                rules.length ? rules.join(' | ') : response.status_message
              }`,
            });
          }
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
            phase,
          });
        }
      }
    };

    // ENVÍO EN DOS FASES — las notas salen DESPUÉS de que la DIAN acepte las
    // facturas que referencian.
    //
    // POR QUÉ — el defecto que cierra:
    //
    // El set enviaba los 50 documentos de corrido, así que una nota llegaba a
    // validación en el mismo minuto que la factura a la que apunta. La DIAN la
    // rechazaba porque, cuando validó la nota, esa factura todavía no estaba en
    // sus registros:
    //
    //   CBG04a  «documento referenciado no existe»  (10 notas crédito)
    //   DBG04a  «documento referenciado no existe»  (10 notas débito)
    //
    // No es un defecto del builder de la nota: el `BillingReference` lleva el
    // número, el CUFE y la fecha correctos. Es un defecto de ORDEN, y solo del
    // generador del set — la emisión real ya exige que la factura referenciada
    // esté `accepted` antes de permitir su nota (`invoice-flow.service.ts`).
    // Este generador era la única excepción a su propia regla.
    //
    // La numeración se reserva UNA SOLA VEZ, arriba, para las dos fases juntas.
    // Partirla abriría una ventana entre fase 1 y fase 2 donde otro proceso
    // podría tomar los consecutivos que las notas ya tienen asignados en su XML
    // firmado — y un XML firmado no se puede renumerar.
    const invoice_files = files.filter((f) => f.kind === 'invoice');
    const note_files = files.filter((f) => f.kind !== 'invoice');

    // La vía sincrónica (`validate_only`) NO se parte: `SendBillSync` contesta en
    // la misma llamada y no devuelve ZipKey, así que no hay nada que sondear
    // entre fases. La vía de humo tampoco, porque su composición no lleva notas.
    const two_phase = note_files.length > 0 && !options.validate_only;

    /**
     * Resultado de la fase de notas. `null` cuando no hubo dos fases.
     * Se persiste para que un operador pueda leer qué pasó sin reconstruirlo.
     */
    let note_phase: {
      sent: boolean;
      reason: string;
      invoice_zip_keys: string[];
      polls: number;
      /**
       * Notas generadas y firmadas que NO se transmitieron. Se guardan enteras
       * —no solo sus números— porque su consecutivo ya está reservado y dentro
       * de un XML firmado: regenerarlas mañana daría otro CUDE (la fecha y hora
       * de emisión entran en el hash) y el consecutivo quedaría inservible.
       * Guardarlas es lo que hace que un tope de espera agotado no pierda 20
       * números autorizados irrecuperables.
       */
      deferred?: { name: string; consecutive: number; content: string }[];
    } | null = null;

    /**
     * Veredictos que la DIAN dio sobre las facturas durante la espera entre fases.
     *
     * Se guardan aquí para persistirlos con el lote. La primera corrida real los
     * perdió —vivían solo dentro del bucle de espera—, así que el registro quedó
     * sin `zip_verdicts` y la razón del rechazo hubo que recuperarla con un
     * re-sondeo. La razón era que la DIAN CIERRA el set al aprobarlo: «Set de
     * prueba … se encuentra Aceptado». Ese dato decide si reintentar tiene
     * sentido, y no debería costar una consulta extra averiguarlo.
     */
    let phase_one_verdicts: Record<string, TestSetZipVerdict> = {};

    if (!two_phase) {
      await transmit(files, 1);
    } else {
      await transmit(invoice_files, 1);

      const invoice_zip_keys = submissions
        .map((s) => s.zip_key)
        .filter((k): k is string => !!k);

      // CHECKPOINT ANTES DE ESPERAR. El worker corre con `attempts: 1`, así que
      // si muere durante la espera no hay reintento: sin este guardado se
      // perderían los ZipKeys de las facturas ya enviadas, que son la única
      // forma de volver a preguntar por ellas. Cuesta un UPDATE.
      await this.persistNotePhaseCheckpoint(config_id, {
        invoice_submissions: submissions,
        invoice_zip_keys,
        deferred_notes: note_files.map((f) => ({
          name: f.name,
          consecutive: f.consecutive,
        })),
        resolution_id,
        number_from: next_number,
        number_to: next_number + TEST_SET_SIZE - 1,
        // Los 50 documentos, no solo los transmitidos: `documents` lleva la clave
        // de cada uno, y es lo que permite preguntarle a la DIAN por un documento
        // concreto después. Para las notas diferidas es la única copia de su CUDE.
        documents,
        timezone,
        issue_date: today,
        issue_time: time_now,
        composition,
      });

      // ZipKey → documento de ESTE lote, con lo que ya está en memoria y con la
      // misma regla de cruce que aplica sobre lo persistido: `submissions` trae
      // `file_name` + `zip_key`, `documents` trae `file_name` + número + CUFE.
      const documents_by_zip_key = indexDocumentsByZipKey({
        submissions,
        documents,
      });

      const wait = await this.waitForInvoicesRegistered(
        invoice_zip_keys,
        environment,
        ws_credentials,
        poll_history,
        {
          dian_configuration_id: config.id,
          documents_by_zip_key,
        },
      );

      phase_one_verdicts = wait.verdicts;

      if (wait.ready) {
        await transmit(note_files, 2);
        note_phase = {
          sent: true,
          reason: wait.reason,
          invoice_zip_keys,
          polls: wait.polls,
        };
      } else {
        // NO se transmiten las notas. Enviarlas contra facturas que la DIAN aún
        // no registró es gastar 20 consecutivos autorizados para cosechar los
        // mismos CBG04a/DBG04a que este cambio existe para eliminar.
        note_phase = {
          sent: false,
          reason: wait.reason,
          invoice_zip_keys,
          polls: wait.polls,
          deferred: note_files.map((f) => ({
            name: f.name,
            consecutive: f.consecutive,
            content: f.content,
          })),
        };
        this.logger.warn(
          `[DIAN test-set] fase 2 diferida: ${wait.reason}. ` +
            `${note_files.length} notas quedan generadas y sin transmitir ` +
            `(consecutivos ${note_files[0]?.consecutive}-${note_files[note_files.length - 1]?.consecutive}).`,
        );
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

    // 9. NO se sondea el veredicto FINAL aquí. `SendTestSetAsync` es asíncrono: la
    //    DIAN devuelve un ZipKey y tarda MINUTOS en clasificar el lote, así que las
    //    6 consultas en línea que había antes no podían alcanzar un veredicto —
    //    solo sumaban 33 s a un request que ya se pasaba del `proxy_read_timeout`
    //    de nginx y volvía 504, dejando la UI con el estado previo al envío.
    //
    //    El veredicto lo obtienen el cron de repoll (cada 10 min, con backoff) y
    //    el endpoint de consulta de estado, ambos partiendo del `zip_key`
    //    persistido abajo.
    //
    //    Ese razonamiento sigue en pie y NO lo contradice la espera de la fase 1:
    //    esa espera no busca el veredicto del set, busca una precondición del
    //    documento siguiente, y ocurre dentro del worker de BullMQ —donde no hay
    //    timeout de nginx que agotar— no dentro de la petición HTTP. `poll_history`
    //    llega aquí con los intentos de esa espera si hubo dos fases, y vacío si no.
    const verdict: DianSendBillResponse = submit;

    const success = verdict.success;
    // A verdict is "still processing" ONLY when we never reached a terminal
    // state (no numeric StatusCode / fault / error list). A terminal non-success
    // (e.g. DIAN StatusCode 2 "set Rechazado") is a REJECTION, not pending.
    const terminal = zip_key ? this.isTerminalZipStatus(verdict) : true;
    // LA ESPERA DE LA FASE 1 YA SABE LA RESPUESTA — y sin esto se descartaba.
    //
    // `verdict` viene de las respuestas de ENVÍO (`submit`), que solo dicen «la
    // DIAN acusó recibo». Cuando hubo dos fases, la espera además CONSULTÓ
    // `GetStatusZip` y tiene veredictos terminales. La primera corrida real
    // escribió `pending: true` sobre un lote cuyas 30 facturas la DIAN ya había
    // rechazado, y hubo que re-sondear para corregirlo: el dato estaba en la mano
    // y se tiraba.
    const phase_one = Object.keys(phase_one_verdicts).length
      ? aggregateZipVerdicts(
          Object.keys(phase_one_verdicts),
          phase_one_verdicts,
        )
      : null;
    const still_processing = phase_one
      ? phase_one.pending
      : !!zip_key && !success && !terminal;
    // `rejected` significa «la DIAN rechazó el SET de habilitación», y eso es lo
    // que leen la guía y el gate de emisión. Una validación sincrónica que sale
    // inválida NO es eso: no se envió al set, no consumió un intento y no cambia
    // el estado de la habilitación. Marcarla `rejected` haría que un diagnóstico
    // exitoso —encontrar los defectos— se leyera como un fracaso de habilitación.
    const rejected =
      options.validate_only === true
        ? false
        : phase_one
          ? phase_one.rejected
          : !success && !still_processing;

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
      // GENERADOS ≠ TRANSMITIDOS desde que el envío va en dos fases: si la fase 2
      // se difiere, se generan 50 y salen 30. `total_documents` se conserva con su
      // significado de siempre —lo generado— para no romper a quien ya lo lee, y
      // los dos números van explícitos al lado. Es el mismo cuidado que este
      // archivo ya se aplicó cuando `total_documents` devolvía 50 en una vía de
      // humo de 1 documento: un número que el cliente no puede derivar es un
      // número que el cliente va a malinterpretar.
      // Nombres en plural-primero a propósito: la respuesta de este método ya
      // expone un `documents_generated` BOOLEANO («llegamos a generar»), y dos
      // campos con el mismo nombre y distinto tipo es una trampa garantizada.
      generated_documents: files.length,
      transmitted_documents: submissions.length,
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
      // Rastro del envío en dos fases. Cuando `sent` es falso las notas están
      // generadas, firmadas y sin transmitir, con su consecutivo ya reservado:
      // `deferred` las lleva enteras para que reenviarlas no exija regenerarlas
      // (regenerar cambia la fecha de emisión y con ella el CUDE).
      ...(note_phase ? { note_phase } : {}),
      // Veredictos que la DIAN dio sobre las facturas DURANTE la espera. Se
      // persisten en la misma clave que usan el cron de repoll y
      // `checkTestSetStatus`, así que un lote diferido llega con su razón ya
      // escrita en vez de exigir una consulta más para averiguarla.
      ...(Object.keys(phase_one_verdicts).length
        ? { zip_verdicts: phase_one_verdicts }
        : {}),
      ...(phase_one ? { zip_counts: phase_one.counts } : {}),
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
        //
        // Una config ya `enabled` conserva su estado y solo SUMA evidencia: la
        // habilitación la concedió la DIAN y este método no tiene rama que la
        // devuelva. Ver `canWriteEnablementStatus`.
        ...(diagnostic
          ? {}
          : may_write_enablement
            ? {
                enablement_status: success
                  ? ('test_set_passed' as const)
                  : ('testing' as const),
                enablement_evidence: success ? result_data : undefined,
              }
            : {
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
      // Con dos fases, generado y transmitido pueden diferir: si la fase 2 se
      // difiere se generan 50 y salen 30. Se dicen los dos en vez de dejar que se
      // deduzcan. OJO: `documents_generated` de arriba es un BOOLEANO con otro
      // significado («llegamos a generar»), y no es lo mismo que estos recuentos.
      generated_documents: files.length,
      transmitted_documents: submissions.length,
      // El rastro de la fase de notas, en su VISTA: los números y la razón, no los
      // XML firmados que lleva el registro persistido. Va en esta respuesta porque
      // es la que el asistente lee al terminar el job, y quien acaba de enviar el
      // set es exactamente quien necesita saber que 20 notas quedaron retenidas.
      note_phase: buildNotePhaseView(note_phase),
      invoices_count: composition.invoices,
      debit_notes_count: composition.debit_notes,
      credit_notes_count: composition.credit_notes,
      environment,
      dian_status: verdict.status_code,
      error_messages: verdict.error_messages ?? [],
      zip_key,
      pending: still_processing,
      rejected,
      // ESTE SITIO NO USA `resolveTestSetWait`, Y ES A PROPÓSITO.
      //
      // Es la respuesta de «acabo de enviar esto»: el `wait` describe el lote que
      // se acaba de transmitir, no la habilitación. Anteponer la prueba durable
      // acá haría que un humo o una validación sincrónica sobre una configuración
      // ya `enabled` contestara con el veredicto del set aprobado meses atrás, en
      // lugar del documento que el operador acaba de mandar.
      //
      // En una corrida real de habilitación da lo mismo —la configuración no está
      // cerrada, así que `resolveTestSetProof` caería igual a este registro—, pero
      // en las vías de diagnóstico no, y son justo las que se usan para depurar.
      wait: analyzeTestSetWait(result_data),
      executed_at: result_data.executed_at,
      number_from: next_number,
      number_to: next_number + TEST_SET_SIZE - 1,
      // Las vías de diagnóstico NO escriben `enablement_status`, así que tampoco
      // pueden afirmarlo: devuelven el que la config tiene de verdad. Igual una
      // config ya `enabled`, que este método no degrada.
      enablement_status:
        diagnostic || !may_write_enablement
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
      // El cruce ZipKey→documento sale del propio registro del lote, así que el
      // log y la evidencia por documento pueden nombrar lo que se rechazó.
      const documents_by_zip_key = indexDocumentsByZipKey(previous);
      const batch = await this.pollBatchZipKeys(
        batch_keys,
        environment,
        ws_credentials,
        poll_history,
        (previous.zip_verdicts ?? {}) as Record<string, TestSetZipVerdict>,
        documents_by_zip_key,
      );
      verdict = batch.primary;
      zip_verdicts = batch.verdicts;
      zip_aggregate = batch.aggregate;
      zip_counts = batch.aggregate.counts;

      // Una fila por documento rechazado, ANTES de tocar `last_test_result`.
      //
      // El orden importa: el JSON se reescribe entero y puede perder la carrera
      // contra otro envío (ver la concurrencia optimista de abajo, que DESCARTA
      // el resultado). La fila de auditoría no participa de esa carrera, así que
      // el motivo del rechazo sobrevive incluso cuando el veredicto se descarta.
      await this.persistRejectionEvidence(
        config.id,
        batch.verdicts,
        batch.resolved_now,
        documents_by_zip_key,
      );
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

    // Sobre la prueba DURABLE, con los valores que ACABAN de escribirse.
    //
    // `config` se leyó antes del update, así que usarlo tal cual describiría el
    // estado anterior. Y sin `resolveTestSetProof` esta ruta —la que el asistente
    // sondea cada 15 s— seguía leyendo el último lote: una configuración
    // `enabled` cuyo lote posterior fue rechazado o descartado recibía
    // `wait.state: 'abandoned'` junto a su insignia «Habilitado», y la tarjeta de
    // espera le ofrecía ejecutar un set nuevo sobre una habilitación concedida.
    // Es el defecto del 2026-08-09, que quedó vivo en esta ruta.
    const wait = resolveTestSetWait({
      enablement_status: success ? 'test_set_passed' : config.enablement_status,
      enablement_evidence: success ? result_data : config.enablement_evidence,
      last_test_result: result_data,
    });

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
      // GENERADOS Y TRANSMITIDOS, porque desde el envío en dos fases no son el
      // mismo número y `total_documents` conserva el significado de generados.
      //
      // Sin estos tres campos el asistente decía «50 documentos» sobre un lote
      // del que salieron 30, y las 20 notas retenidas eran invisibles: el backend
      // las guardaba en `note_phase` y esta proyección las descartaba. Un dato que
      // el cliente no recibe es indistinguible de un dato que no existe.
      generated_documents: previous.generated_documents ?? null,
      transmitted_documents: previous.transmitted_documents ?? null,
      note_phase: buildNotePhaseView(previous.note_phase),
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

    // `enablement_status: 'testing'` SOLO si no hay una habilitación que perder.
    //
    // Descartar un lote deja la configuración libre para reenviar, y por eso baja el
    // estado a `testing`. Sobre una config ya `enabled` eso sería tirar lo que la
    // DIAN concedió —y que su portal solo devuelve a mano— por una operación de
    // limpieza de un puntero. Es el mismo defecto que `executeTestSet` tenía y que
    // `canWriteEnablementStatus` cierra; esta era la tercera copia.
    //
    // El descarte SÍ sigue ocurriendo: se borra `zip_key` y se registra el lote en
    // `abandoned_batches`. Lo único que no pasa es la degradación.
    await this.prisma.dian_configurations.update({
      where: { id: config_id },
      data: {
        last_test_result: result_data,
        ...(canWriteEnablementStatus(config.enablement_status)
          ? { enablement_status: 'testing' as const }
          : {}),
      },
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
   * Nombre del ZIP contenedor de una nota diferida.
   *
   * Se DERIVA del nombre del XML, no se recalcula: el anexo define
   * `<tag><nnnnnnnnnn><ppp><aa><dddddddd>.xml` para el XML y el MISMO cuerpo con
   * prefijo `z` para el ZIP, así que copiar el cuerpo garantiza que el
   * contenedor y su contenido declaren el mismo NIT, el mismo `ppp`, el mismo
   * año y el mismo consecutivo. Recalcularlo con el reloj de hoy le cambiaría el
   * `aa` a una nota firmada en diciembre y transmitida en enero, y el worker de
   * la DIAN parsea ese nombre por posiciones fijas.
   *
   * `slice(-23)` toma el cuerpo sin depender del largo del tag (2 para `nc`/`nd`,
   * 3 para `nas`/`ncs`). Si el nombre persistido no tiene la forma esperada se
   * recompone con el helper compartido, que es lo que lo generó.
   */
  private zipNameForDeferredNote(
    xml_file_name: string,
    fallback: {
      nit: string;
      consecutive: number;
      software_code: string;
      year?: string;
    },
  ): string {
    const body = String(xml_file_name ?? '')
      .replace(/\.xml$/i, '')
      .slice(-23);
    if (/^\d{15}[0-9a-f]{8}$/i.test(body)) return `z${body}.zip`;
    return buildDianZipFileName(fallback);
  }

  /**
   * Transmite las notas que quedaron GENERADAS, FIRMADAS Y SIN ENVIAR.
   *
   * POR QUÉ EXISTE — el defecto que cierra:
   *
   * `decideNotePhase` difiere la fase 2 cuando la DIAN no registró las facturas
   * que las notas referencian, y `note_phase.deferred[]` las guarda ENTERAS, con
   * su XML firmado, precisamente para que reenviarlas no exija regenerarlas.
   * Ningún endpoint las consumía: HIDRO quedó con 20 notas firmadas y los
   * consecutivos 990000230-990000249 reservados, sin vía de recuperación. El
   * dato estaba persistido y era inalcanzable.
   *
   * NO REGENERA Y NO RENUMERA. El consecutivo entra en el `SoftwareSecurityCode`
   * y en el CUDE, así que renumerar exigiría volver a firmar y produciría OTRO
   * CUDE — es decir, otro documento, y el consecutivo original quedaría gastado
   * igual. El XML sale del JSON byte a byte y se transmite tal cual por la misma
   * `SendTestSetAsync` que usa la fase 2 del envío normal.
   *
   * REANUDABLE a propósito: cada nota transmitida SALE de `deferred` y ENTRA en
   * `transmitted` (con su XML, que nunca se borra). Una llamada interrumpida
   * —por un 504 de nginx, por ejemplo— se retoma invocando de nuevo, y solo
   * viajan las que faltan. `limit` permite partirlo a mano si hiciera falta.
   */
  async transmitDeferredNotes(config_id: number, limit?: number) {
    const started_at = Date.now();
    const config = await this.getConfigById(config_id);
    const environment = config.environment as 'test' | 'production';

    if (!config.test_set_id) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_001,
        'No test set ID configured',
      );
    }

    // Misma guarda que `enqueueTestSet` y `executeTestSet`, por la misma razón:
    // la DIAN no acepta documentos contra un set que ya aprobó y contesta «Set de
    // prueba … se encuentra Aceptado» a cada uno. Aquí los consecutivos ya están
    // gastados, así que lo que se evita no es quemarlos: es que el operador crea
    // que recuperó 20 notas cuando lo que cosechó fueron 20 veces esa frase.
    if (isTestSetClosedByDian(config.enablement_status)) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_006,
        'La DIAN ya cerró el set de pruebas de esta configuración, así que no admitirá las notas retenidas: ' +
          'responde «Set de prueba … se encuentra Aceptado» a cada documento. ' +
          'Las notas siguen guardadas con su XML firmado y su consecutivo.',
        {
          dian_configuration_id: config_id,
          enablement_status: config.enablement_status,
        },
      );
    }

    const previous = (config.last_test_result ?? {}) as Record<string, any>;
    const note_phase = (previous.note_phase ?? {}) as Record<string, any>;
    const deferred: { name: string; consecutive: number; content: string }[] =
      Array.isArray(note_phase.deferred) ? note_phase.deferred : [];

    // Solo las que traen su XML. Un checkpoint de fase 1 guarda `{name,
    // consecutive}` SIN `content` (ver `persistNotePhaseCheckpoint`), y sin el
    // XML firmado no hay nada que transmitir: regenerarlo daría otro CUDE.
    const transmittable = deferred.filter(
      (note) => typeof note?.content === 'string' && note.content.length > 0,
    );
    if (!transmittable.length) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_004,
        deferred.length
          ? `Las ${deferred.length} notas retenidas de esta configuración se registraron sin su XML firmado ` +
              '(checkpoint de fase 1), así que no pueden transmitirse: regenerarlas cambiaría el CUDE.'
          : 'Esta configuración no tiene notas retenidas por transmitir.',
        { dian_configuration_id: config_id, deferred_count: deferred.length },
      );
    }

    const batch =
      typeof limit === 'number' && limit > 0
        ? transmittable.slice(0, limit)
        : transmittable;

    const ws_credentials = await this.loadWsCredentials(config);
    const software_code = softwareCodeForOperationMode(config.operation_mode);
    const documents: any[] = Array.isArray(previous.documents)
      ? previous.documents
      : [];

    const sent: {
      file_name: string;
      zip_file_name: string;
      zip_key: string | null;
      success: boolean;
      status_code?: string;
      status_message?: string;
      raw_response?: string;
      error?: string;
      error_messages?: string[];
      phase: 2;
    }[] = [];
    const transmitted: typeof batch = [];

    for (const note of batch) {
      const doc = documents.find((d) => d?.file_name === note.name);
      const zip_file_name = this.zipNameForDeferredNote(note.name, {
        nit: config.nit,
        consecutive: note.consecutive,
        software_code,
        // La fecha de EMISIÓN de la nota, no la de hoy: el `aa` del nombre tiene
        // que ser el mismo con el que se firmó.
        year: previous.issue_date ?? undefined,
      });

      try {
        const response = await this.soap_client.sendTestSetAsync(
          // El XML sale del JSON tal cual. Ni se reconstruye ni se re-firma.
          this.buildMultiFileZip([{ name: note.name, content: note.content }]),
          zip_file_name,
          config.test_set_id,
          environment,
          ws_credentials,
        );

        sent.push({
          file_name: note.name,
          zip_file_name,
          zip_key: response.zip_key ?? null,
          success: response.success,
          status_code: response.status_code,
          status_message: response.status_message,
          raw_response: response.raw_response?.slice(0, 4000),
          ...(response.error_messages?.length
            ? { error_messages: response.error_messages }
            : {}),
          phase: 2,
        });

        // Sale de `deferred` solo si la DIAN acusó recibo con un ZipKey. Sin él
        // no hay nada que sondear después, y moverla igual perdería la única
        // vía de reintento que tiene un consecutivo ya reservado.
        if (response.zip_key) transmitted.push(note);

        // La fila de auditoría se escribe DENTRO del bucle, no al final: el
        // ZipKey es la única forma de volver a preguntar por un consecutivo ya
        // gastado, y si este proceso muere en la nota 12 los 11 anteriores no
        // pueden irse con él.
        await this.createAuditLog(config.id, {
          action: 'transmit_deferred_note',
          status: response.zip_key ? 'pending' : 'error',
          document_type: doc?.kind ?? null,
          document_number: doc?.number ?? String(note.consecutive),
          cufe: doc?.cufe ?? null,
          request_xml: note.content,
          response_xml: response.raw_response ?? null,
          error_message: response.zip_key
            ? `ZipKey ${response.zip_key} — pendiente de veredicto.`
            : response.error_messages?.join(' | ') || response.status_message,
          duration_ms: response.duration_ms,
        });
      } catch (error) {
        // No aborta el lote: cada nota es independiente y las que ya salieron
        // tienen su ZipKey registrado. Ver el mismo criterio en `transmit`.
        const message = error instanceof Error ? error.message : String(error);
        sent.push({
          file_name: note.name,
          zip_file_name,
          zip_key: null,
          success: false,
          error: message,
          phase: 2,
        });
        await this.createAuditLog(config.id, {
          action: 'transmit_deferred_note',
          status: 'error',
          document_type: doc?.kind ?? null,
          document_number: doc?.number ?? String(note.consecutive),
          cufe: doc?.cufe ?? null,
          request_xml: note.content,
          error_message: message,
        });
      }
    }

    const new_zip_keys = sent
      .map((s) => s.zip_key)
      .filter((k): k is string => !!k);
    const remaining = deferred.filter(
      (note) => !transmitted.some((t) => t.name === note.name),
    );

    // RELECTURA ANTES DE ESCRIBIR. Transmitir 20 notas tarda decenas de
    // segundos y `last_test_result` se reescribe entero, así que un envío que
    // haya empezado mientras tanto perdería su ZipKey con este UPDATE. Es
    // exactamente la carrera que ya costó un bloque de 50 consecutivos en la
    // config 12 (ver `checkTestSetStatus`).
    const current = await this.getConfigById(config_id);
    const current_result = (current.last_test_result ?? {}) as Record<
      string,
      any
    >;
    const batch_replaced = current_result.zip_key !== previous.zip_key;

    if (!batch_replaced) {
      await this.prisma.dian_configurations.update({
        where: { id: config_id },
        data: {
          last_test_result: {
            ...current_result,
            submissions: [
              ...(Array.isArray(current_result.submissions)
                ? current_result.submissions
                : []),
              ...sent,
            ],
            zip_keys: [
              ...(Array.isArray(current_result.zip_keys)
                ? current_result.zip_keys
                : []),
              ...new_zip_keys,
            ],
            transmitted_documents:
              (Number(current_result.transmitted_documents) || 0) +
              transmitted.length,
            note_phase: {
              ...note_phase,
              // `sent` solo cuando ya no queda ninguna retenida: mientras
              // `deferred` tenga contenido, la fase NO está enviada, y la vista
              // que lee la UI deriva `deferred_count` de ese mismo arreglo.
              sent: remaining.length === 0,
              reason: remaining.length
                ? `${transmitted.length} de ${deferred.length} notas retenidas se transmitieron desde su XML firmado; quedan ${remaining.length}.`
                : `Las ${transmitted.length} notas retenidas se transmitieron desde su XML firmado, sin regenerar consecutivos.`,
              // Las transmitidas NO se borran: se mueven, con su XML. Es la
              // única copia de un documento cuyo consecutivo ya está gastado.
              deferred: remaining,
              transmitted: [
                ...(Array.isArray(note_phase.transmitted)
                  ? note_phase.transmitted
                  : []),
                ...transmitted.map((note) => ({
                  ...note,
                  zip_key:
                    sent.find((s) => s.file_name === note.name)?.zip_key ?? null,
                  transmitted_at: new Date().toISOString(),
                })),
              ],
              transmitted_at: new Date().toISOString(),
            },
            // Hay ZipKeys nuevos sin veredicto: el cron de re-sondeo tiene que
            // adoptarlos, y `pending` es la bandera con la que decide.
            ...(new_zip_keys.length ? { pending: true } : {}),
          } as any,
        },
      });
    } else {
      this.logger.warn(
        `[DIAN test-set] otro envío reemplazó el lote mientras se transmitían las notas retenidas. ` +
          `No se reescribe last_test_result; los ZipKey ${new_zip_keys.join(', ') || '(ninguno)'} ` +
          `quedan en dian_audit_logs.`,
      );
    }

    await this.createAuditLog(config.id, {
      action: 'transmit_deferred_notes',
      status: new_zip_keys.length ? 'pending' : 'error',
      error_message: new_zip_keys.length
        ? `${transmitted.length} de ${batch.length} notas retenidas transmitidas desde su XML firmado. ` +
          `ZipKeys: ${new_zip_keys.join(', ')}.` +
          (batch_replaced
            ? ' Otro envío reemplazó el lote: el registro JSON no se actualizó.'
            : '')
        : `Ninguna de las ${batch.length} notas retenidas obtuvo ZipKey.`,
      duration_ms: Date.now() - started_at,
    });

    return {
      transmitted: transmitted.length,
      attempted: batch.length,
      // Lo que sigue retenido tras esta pasada, para que el llamador sepa si
      // tiene que volver a invocar.
      still_deferred: remaining.length,
      zip_keys: new_zip_keys,
      consecutives: transmitted.map((n) => n.consecutive),
      batch_replaced,
      submissions: sent.map((s) => ({
        file_name: s.file_name,
        zip_key: s.zip_key,
        status_code: s.status_code ?? null,
        status_message: s.status_message ?? s.error ?? null,
        error_messages: s.error_messages ?? [],
      })),
      message: new_zip_keys.length
        ? `${transmitted.length} nota(s) retenida(s) transmitida(s) desde su XML ya firmado, sin regenerar consecutivos. ` +
          'Consulta el estado del lote en unos minutos para conocer el veredicto.'
        : 'Ninguna nota retenida obtuvo ZipKey de la DIAN. Siguen guardadas con su XML firmado y su consecutivo.',
      response_time_ms: Date.now() - started_at,
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
    config: {
      environment: string;
      enablement_status: string;
      // Obligatoria: esta salida es la del lote DESCARTADO, y es precisamente
      // donde un descarte tapaba una habilitación concedida. Sin la evidencia el
      // `wait` volvería a describir el lote descartado.
      enablement_evidence: unknown;
    },
    result: Record<string, any>,
    message: string,
  ) {
    // Sobre la prueba durable. Con el lote a secas, una configuración `enabled`
    // que descartó un lote posterior leía `state: 'abandoned'` y la UI le decía
    // «ejecuta un set de pruebas nuevo». Ver `resolveTestSetProof`.
    const wait = resolveTestSetWait({
      enablement_status: config.enablement_status,
      enablement_evidence: config.enablement_evidence,
      last_test_result: result,
    });
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
      // Misma forma EXACTA que el retorno normal. Es la razón de ser de este
      // método: la UI lee campos concretos y una unión con propiedades ausentes
      // la rompe en compilación o, peor, en runtime con `undefined`.
      generated_documents: result.generated_documents ?? null,
      transmitted_documents: result.transmitted_documents ?? null,
      note_phase: buildNotePhaseView(result.note_phase),
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
   * Guarda el lote a mitad de camino: fase 1 transmitida, fase 2 todavía no.
   *
   * POR QUÉ NO SE PUEDE OMITIR
   *
   * El worker del set corre con `attempts: 1` a propósito (ver
   * `DianTestSetProcessor`): un reintento reservaría un bloque nuevo de
   * consecutivos. Eso significa que si el proceso muere durante la espera entre
   * fases, NADIE va a reintentar — y sin este guardado se irían con él los
   * ZipKeys de las facturas ya enviadas, que son la única forma de volver a
   * preguntarle a la DIAN por documentos cuyos consecutivos ya están gastados.
   *
   * La forma que escribe es deliberadamente la que el cron de repoll y
   * `checkTestSetStatus` YA saben leer (`zip_key`, `zip_keys`, `pending: true`),
   * para que un lote interrumpido siga siendo consultable por las rutas normales
   * en vez de necesitar una de rescate.
   *
   * Se sobrescribe al final con el resultado completo. Su vida útil es la ventana
   * de la espera, y cuesta un UPDATE.
   */
  private async persistNotePhaseCheckpoint(
    config_id: number,
    snapshot: {
      invoice_submissions: unknown[];
      invoice_zip_keys: string[];
      deferred_notes: { name: string; consecutive: number }[];
      resolution_id: number;
      number_from: number;
      number_to: number;
      documents: unknown[];
      timezone: string;
      issue_date: string;
      issue_time: string;
      composition: unknown;
    },
  ): Promise<void> {
    try {
      await this.prisma.dian_configurations.update({
        where: { id: config_id },
        data: {
          last_test_result: {
            executed_at: new Date().toISOString(),
            checkpoint: 'invoices_sent_notes_pending',
            // Representante para la forma de un solo `zip_key` que ya leen la UI,
            // la espera y el cron.
            zip_key: snapshot.invoice_zip_keys[0] ?? null,
            zip_keys: snapshot.invoice_zip_keys,
            submissions: snapshot.invoice_submissions,
            documents: snapshot.documents,
            resolution_id: snapshot.resolution_id,
            number_from: snapshot.number_from,
            number_to: snapshot.number_to,
            composition: snapshot.composition,
            timezone: snapshot.timezone,
            issue_date: snapshot.issue_date,
            issue_time: snapshot.issue_time,
            note_phase: {
              sent: false,
              reason:
                'Facturas transmitidas; esperando que la DIAN las registre antes de enviar las notas.',
              invoice_zip_keys: snapshot.invoice_zip_keys,
              polls: 0,
              deferred: snapshot.deferred_notes,
            },
            // `pending: true` es lo que hace que el cron de repoll adopte el lote
            // si este proceso no vuelve.
            pending: true,
            rejected: false,
          } as any,
        },
      });
    } catch (error) {
      // Un fallo del checkpoint NO aborta el envío: las facturas ya están en la
      // DIAN y sus consecutivos ya se gastaron. Abortar aquí perdería el lote de
      // la única forma que este método existe para evitar.
      this.logger.error(
        `[DIAN test-set] no se pudo guardar el checkpoint de fase 1: ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          `ZipKeys en riesgo: ${snapshot.invoice_zip_keys.join(', ')}`,
      );
    }
  }

  /**
   * Espera a que la DIAN REGISTRE las facturas del lote, que es la precondición
   * de las notas que las referencian.
   *
   * La REGLA no vive aquí: vive en `decideNotePhase` (`note-phase-gate.util.ts`),
   * pura y con su propio spec, por la misma razón que `analyzeTestSetWait` — una
   * decisión que gasta consecutivos autorizados irrecuperables no debe requerir
   * hablar con la DIAN para verificarse. Este método solo aporta el sondeo y el
   * reloj.
   */
  private async waitForInvoicesRegistered(
    invoice_zip_keys: string[],
    environment: 'test' | 'production',
    ws_credentials: WsSecurityCredentials | undefined,
    poll_history: TestSetPollAttempt[],
    /**
     * Con qué configuración y qué documentos se persiste la evidencia del
     * rechazo, sondeo a sondeo.
     *
     * Se escribe DENTRO del bucle, no al final: la primera corrida real de esta
     * espera vio «30 de 30 rechazadas» y el motivo se perdió porque solo vivía
     * en el mapa local. El worker corre con `attempts: 1`, así que si muere
     * durante la espera nadie reintenta — el mismo razonamiento que obligó al
     * checkpoint de la fase 1.
     */
    evidence: {
      dian_configuration_id: number;
      documents_by_zip_key: Record<string, TestSetDocumentRef>;
    },
  ): Promise<{
    ready: boolean;
    reason: string;
    polls: number;
    /**
     * Veredictos TERMINALES que la DIAN dio sobre las facturas durante la espera.
     *
     * SE DEVUELVEN PORQUE PERDERLOS COSTÓ EL DIAGNÓSTICO UNA VEZ. La primera
     * corrida real de esta espera vio «30 de 30 rechazadas», difirió las notas
     * correctamente… y tiró los mensajes: vivían solo en el mapa local de este
     * bucle, así que `last_test_result` quedó sin `zip_verdicts` y la razón de la
     * DIAN hubo que recuperarla con un re-sondeo aparte.
     *
     * La razón era «Set de prueba … se encuentra Aceptado», es decir que la DIAN
     * cierra el set al aprobarlo y no admite más documentos — un dato que decide
     * si tiene sentido volver a intentarlo, y que no debería costar otra consulta.
     */
    verdicts: Record<string, TestSetZipVerdict>;
  }> {
    // Sin ZipKey no hay nada que sondear: la decisión se resuelve sin red y sin
    // gastar los 10 minutos del tope.
    if (invoice_zip_keys.length === 0) {
      const decision = decideNotePhase({
        invoice_zip_key_count: 0,
        accepted: 0,
        rejected: 0,
        poll: 0,
      });
      return { ready: false, reason: decision.reason, polls: 0, verdicts: {} };
    }

    let verdicts: Record<string, TestSetZipVerdict> = {};

    for (let poll = 1; poll <= NOTE_PHASE_MAX_POLLS; poll++) {
      await this.sleep(NOTE_PHASE_POLL_DELAY_MS);

      const batch = await this.pollBatchZipKeys(
        invoice_zip_keys,
        environment,
        ws_credentials,
        poll_history,
        verdicts,
        evidence.documents_by_zip_key,
      );
      verdicts = batch.verdicts;
      await this.persistRejectionEvidence(
        evidence.dian_configuration_id,
        batch.verdicts,
        batch.resolved_now,
        evidence.documents_by_zip_key,
      );
      const { accepted, rejected } = batch.aggregate.counts;

      const decision = decideNotePhase({
        invoice_zip_key_count: invoice_zip_keys.length,
        accepted,
        rejected,
        poll,
      });

      this.logger.log(
        `[DIAN test-set] fase 1, sondeo ${poll}/${NOTE_PHASE_MAX_POLLS}: ` +
          `${decision.action} — ${decision.reason}`,
      );

      if (decision.action !== 'keep_waiting') {
        return {
          ready: decision.action === 'send_notes',
          reason: decision.reason,
          polls: poll,
          verdicts,
        };
      }
    }

    // Inalcanzable en la práctica: `decideNotePhase` devuelve `defer_notes` en el
    // último sondeo. Se conserva porque el bucle no se lo puede demostrar al
    // compilador, y devolver un `ready: false` explícito es más seguro que un
    // `throw` que perdería los ZipKeys de la fase 1.
    return {
      ready: false,
      reason: `Tope de espera agotado tras ${NOTE_PHASE_MAX_POLLS} consultas.`,
      polls: NOTE_PHASE_MAX_POLLS,
      verdicts,
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
        // Las reglas del intento, que este push descartaba teniéndolas en
        // `status`. Ver `TestSetPollAttempt.error_messages`.
        ...(status.error_messages?.length
          ? { error_messages: status.error_messages }
          : {}),
      });

      this.logger.log(
        `[DIAN test-set] GetStatusZip ${attempt}/${max_attempts} ` +
          `zipKey=${zip_key} status=${status.status_code} success=${status.success}` +
          (status.error_messages?.length
            ? ` reglas=${status.error_messages.join(' | ')}`
            : ''),
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
    /**
     * ZipKey → documento, para que el log agregado pueda NOMBRAR lo que se
     * rechazó. Opcional porque un llamador sin `last_test_result` a mano sigue
     * pudiendo sondear; lo único que pierde es el nombre del documento.
     */
    documents_by_zip_key: Record<string, TestSetDocumentRef> = {},
  ): Promise<{
    primary: DianSendBillResponse;
    verdicts: Record<string, TestSetZipVerdict>;
    aggregate: TestSetZipAggregate;
    /**
     * ZipKeys que resolvieron EN ESTA llamada.
     *
     * Se devuelven para que el llamador escriba la evidencia por documento una
     * sola vez. Sin esto, el cron de re-sondeo —que corre cada 10-15 min y
     * recibe `verdicts` acumulados— reescribiría en `dian_audit_logs` los mismos
     * 30 rechazos en cada pasada, y una tabla de auditoría que se repite deja de
     * poder leerse como historia.
     */
    resolved_now: string[];
  }> {
    const verdicts: Record<string, TestSetZipVerdict> = { ...known };
    const pending_keys = zip_keys.filter((k) => !verdicts[k]);
    const resolved_now: string[] = [];

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
          ...(status.error_messages?.length
            ? { error_messages: status.error_messages }
            : {}),
        });

        if (this.isTerminalZipStatus(status)) {
          verdicts[key] = {
            zip_key: key,
            success: status.success,
            status_code: status.status_code,
            status_message: status.status_message,
            error_messages: status.error_messages ?? [],
            resolved_at: new Date().toISOString(),
            // EL CRUDO SE CONSERVA, y solo sobre el rechazo.
            //
            // Un veredicto de aceptación no necesita evidencia: lo que hay que
            // poder releer es POR QUÉ la DIAN dijo que no. Guardarlo también en
            // los aceptados multiplicaría por 50 un JSON que ya se lee entero en
            // cada sondeo, sin añadir un dato accionable.
            ...(status.success
              ? {}
              : this.decodeRejection(status.raw_response)),
          };
          resolved_now.push(key);
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
      // Las reglas decodificadas primero, y el `ErrorMessage` de la DIAN
      // después. Este objeto es el que alimenta `dian_response.error_messages`
      // del registro y el mensaje que lee el operador: devolverlo con
      // `error_messages` a secas volvía a dejar fuera lo que el
      // `ApplicationResponse` sí decía.
      status_message: v.status_message,
      error_messages: rejectionMessages(v),
      // El crudo del veredicto, no un vacío. `raw_response: ''` era el segundo
      // punto donde el motivo del rechazo se tiraba: `primary` es lo que se
      // persiste en `dian_response.raw_response`, así que el lote quedaba con
      // una evidencia en blanco aunque el veredicto la tuviera.
      raw_response: v.raw_response ?? '',
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

    // EL MOTIVO, NO SOLO EL RECUENTO.
    //
    // EL DEFECTO QUE CIERRA: este log imprimía «rechazados=30» con los 30
    // veredictos —y sus `error_messages`— en el mismo scope. Un operador leía
    // que la DIAN había rechazado 30 de 30 y no tenía en el log una sola pista
    // de por qué; para averiguarlo había que volver a sondear a la DIAN por un
    // lote que ya había contestado.
    //
    // `indexDocumentsByZipKey` es lo que permite decir SETP990000200 en vez de
    // un ZipKey: el cruce ZipKey→documento existía (`resolveRegisteredInvoiceReferences`
    // lo hace para el lado aceptado) y ningún log lo aprovechaba.
    const rejected_lines = describeRejectedDocuments(
      verdicts,
      documents_by_zip_key,
    );
    if (rejected_lines.length) {
      this.logger.warn(
        `[DIAN test-set] motivos de rechazo (${rejected_lines.length} de ` +
          `${aggregate.counts.rejected}):\n  ${rejected_lines.join('\n  ')}`,
      );
    }

    return { primary, verdicts, aggregate, resolved_now };
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
   * Aborta el set de pruebas si un documento no cumple el modelo de contenido
   * de los XSD oficiales.
   *
   * Se replica aquí y no se hereda del provider porque el set de pruebas firma
   * por su cuenta (`this.xml_signer.sign`) sin pasar por
   * `DianDirectProvider.signXml`, que es donde vive la compuerta de emisión. Sin
   * esta copia, el camino más importante para detectar un defecto estructural
   * —el que la tienda usa para probar que sabe emitir, ANTES de tocar
   * producción— sería justo el que no lo detecta.
   *
   * Corre ANTES del `if` del certificado: en desarrollo no hay .p12 y el
   * documento se arma igual, así que atarla a la firma la apagaría exactamente
   * donde más barato es descubrir el problema.
   */
  private assertStructurallyValid(xml: string): void {
    const result = UblStructureValidator.validate(xml);
    if (result.valid) return;

    const summary = summarizeUblViolations(result.violations);
    this.logger.error(
      `Set de pruebas: XML estructuralmente inválido ` +
        `(${result.root ?? 'raíz desconocida'}): ${result.violations.length} ` +
        `violación(es). ${summary.join(' | ')}`,
    );

    throw new VendixHttpException(
      ErrorCodes.INVOICING_XSD_001,
      'Uno de los documentos del set de pruebas no cumple la estructura que ' +
        'exige la DIAN, así que el set no se envió. Es un defecto del generador ' +
        'de XML, no de la configuración de la tienda — repórtalo con el detalle ' +
        'que acompaña este error.',
      {
        document_root: result.root,
        violation_count: result.violations.length,
        violations: summary,
      },
    );
  }

  /**
   * Aborta el set de pruebas si la totalización de un documento no cierra.
   *
   * Se replica aquí por el mismo motivo que la estructural: el set firma por su
   * cuenta y no pasa por `DianDirectProvider.signXml`. El set de habilitación es
   * justo donde una operación excluida de IVA debería descubrirse — antes de
   * tocar producción y sin consecutivo autorizado de por medio.
   */
  private assertTotalsCoherent(xml: string): void {
    const result = DianTotalsValidator.validate(xml);
    if (result.valid) return;

    const summary = summarizeDianTotalsViolations(result.violations);
    this.logger.error(
      `Set de pruebas: XML con totalización inválida ` +
        `(${result.root ?? 'raíz desconocida'}): ${result.violations.length} ` +
        `violación(es). ${summary.join(' | ')}`,
    );

    throw new VendixHttpException(
      ErrorCodes.INVOICING_XSD_002,
      'Uno de los documentos del set de pruebas declara unos totales que la ' +
        'DIAN rechaza, así que el set no se envió. Es un defecto del generador ' +
        'de XML, no de la configuración de la tienda — repórtalo con el detalle ' +
        'que acompaña este error.',
      {
        document_root: result.root,
        violation_count: result.violations.length,
        rules: [...new Set(result.violations.map((v) => v.rule))],
        violations: summary,
      },
    );
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
        // Las dos columnas de abajo se LEÍAN sin pedirse, y por eso este método
        // estuvo devolviendo dos datos equivocados en silencio:
        //
        //   · `enablement_evidence` → `resolveTestSetProof` recibía `undefined` y
        //     caía al último lote, justo lo que esa función existe para evitar.
        //     Su firma ya es obligatoria, así que quitarla de acá no compila.
        //   · `operation_mode` → `buildTestSetCompositionView(undefined)`, así que
        //     la composición que la UI imprime no correspondía al modo real.
        //
        // Un `select` es un contrato con el resto del método, no una optimización.
        enablement_evidence: true,
        operation_mode: true,
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
      //
      // Y sobre la prueba DURABLE, no sobre el último lote: `last_test_result` es
      // a la vez el puntero al lote en vuelo y la prueba de la habilitación, así
      // que un intento posterior borraba un hecho ya ocurrido. Ver
      // `resolveTestSetProof`.
      wait: resolveTestSetWait(config),
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

  /**
   * Decodifica el `ApplicationResponse` de un rechazo y devuelve el trozo de
   * veredicto que lo conserva.
   *
   * EL ACTIVO QUE ESTABA SIN USAR: `<b:XmlBase64Bytes>` es el
   * `ApplicationResponse` de la DIAN, donde viven las reglas de rechazo por
   * documento (`cbc:Description`, `Regla: XXXX, Rechazo: …`, `cbc:UUID`).
   * `DianSoapClient.parseSoapResponse` —un scrape por regex— nunca lo mira, y
   * `DianResponseParserService.parseApplicationResponse` sí sabe leerlo desde
   * siempre. Estaba INYECTADO en este servicio (ver el constructor) y no se
   * invocaba ni una sola vez: solo lo usaba la emisión real
   * (`dian-direct.provider.ts`). Esta es la invocación que faltaba.
   *
   * Devuelve un objeto para hacer spread sobre el veredicto, de modo que un
   * crudo vacío no añada claves con `undefined` al JSON persistido.
   *
   * NUNCA LANZA: el parser ya atrapa lo suyo y devuelve `PARSE_ERROR`, pero un
   * fallo aquí no puede tumbar un sondeo cuyo propósito es no perder el
   * veredicto. Perder el detalle es malo; perder el veredicto entero es el
   * defecto que este trabajo cierra.
   */
  private decodeRejection(raw_response: string | undefined): {
    raw_response?: string;
    rejection_rules?: TestSetZipVerdict['rejection_rules'];
    document_key?: string;
  } {
    if (!raw_response) return {};

    const evidence = { raw_response: raw_response.slice(0, MAX_RAW_RESPONSE_CHARS) };
    try {
      const parsed = this.response_parser.parseApplicationResponse(raw_response);
      return {
        ...evidence,
        ...(parsed.errors?.length ? { rejection_rules: parsed.errors } : {}),
        ...(parsed.document_key ? { document_key: parsed.document_key } : {}),
      };
    } catch (error) {
      this.logger.warn(
        `[DIAN test-set] no se pudo decodificar el ApplicationResponse del rechazo: ` +
          `${error instanceof Error ? error.message : String(error)}. Se conserva el crudo.`,
      );
      return evidence;
    }
  }

  /**
   * Escribe UNA FILA POR DOCUMENTO RECHAZADO en `dian_audit_logs`.
   *
   * POR QUÉ AHÍ Y NO EN UNA TABLA NUEVA: `dian_audit_logs` ya tiene
   * `document_type`, `document_number`, `cufe`, `response_xml` y `error_message`,
   * ya está migrada e indexada por `dian_configuration_id`, `action` y
   * `created_at`. Lo único que faltaba era que `createAuditLog` aceptara esas
   * columnas — las descartaba por firma, no por esquema. Cero migraciones.
   *
   * Por qué por documento y no un resumen: `last_test_result` es un JSON que se
   * reescribe entero en cada envío, así que el motivo del rechazo del lote
   * anterior desaparece con el siguiente. Una fila por documento es historia
   * que ningún reenvío pisa, y es consultable por número y por CUFE.
   *
   * Solo los resueltos EN ESTA pasada (`resolved_now`): el cron re-sondea cada
   * 10-15 min con los veredictos acumulados, y reescribir los mismos 30 rechazos
   * en cada vuelta convertiría la auditoría en ruido.
   */
  private async persistRejectionEvidence(
    dian_configuration_id: number,
    verdicts: Record<string, TestSetZipVerdict>,
    resolved_now: string[],
    documents_by_zip_key: Record<string, TestSetDocumentRef>,
  ): Promise<number> {
    let written = 0;
    for (const key of resolved_now) {
      const verdict = verdicts[key];
      if (!verdict || verdict.success) continue;

      const doc = documents_by_zip_key[key];
      const rules = rejectionMessages(verdict);
      await this.createAuditLog(dian_configuration_id, {
        action: 'test_set_document_rejected',
        status: 'error',
        document_type: doc?.kind ?? null,
        document_number: doc?.number ?? null,
        // El CUFE del documento que enviamos manda sobre el que nombre el
        // ApplicationResponse: el primero es el que este sistema puede volver a
        // consultar con `GetStatus`, el segundo puede venir vacío.
        cufe: doc?.cufe ?? verdict.document_key ?? null,
        response_xml: verdict.raw_response ?? null,
        error_message:
          `ZipKey ${key} — ${verdict.status_code}: ` +
          (rules.length ? rules.join(' | ') : verdict.status_message),
      });
      written++;
    }
    return written;
  }

  /**
   * `document_type` y `document_number` son `VarChar(50)` y `cufe` `VarChar(255)`.
   *
   * Se recortan aquí y no en cada llamador porque un valor largo no produce un
   * campo feo: produce un `22001` de Postgres que aborta el INSERT, y este
   * helper existe justamente para que un fallo de auditoría no tumbe la
   * operación que audita.
   */
  private static clamp(
    value: string | null | undefined,
    max: number,
  ): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value);
    return text.length > max ? text.slice(0, max) : text;
  }

  /**
   * Fila de auditoría de una operación DIAN.
   *
   * Las columnas de DOCUMENTO son opcionales y se añadieron para QUI-675: la
   * firma anterior solo aceptaba `{action, status, error_message, duration_ms}`,
   * así que el detalle del rechazo por documento no tenía dónde ir aunque la
   * tabla llevara `document_type`, `document_number`, `cufe`, `request_xml` y
   * `response_xml` desde su migración. Todas son opcionales, así que los
   * llamadores anteriores no cambian.
   */
  private async createAuditLog(
    dian_configuration_id: number,
    data: {
      action: string;
      status: string;
      error_message?: string | null;
      duration_ms?: number;
      /** `invoice` | `debit_note` | `credit_note`. */
      document_type?: string | null;
      /** Número con prefijo de resolución, p. ej. `SETP990000230`. */
      document_number?: string | null;
      cufe?: string | null;
      /** El XML FIRMADO que se transmitió. Es la única copia fuera del JSON. */
      request_xml?: string | null;
      /** El XML con el que la DIAN contestó, crudo. */
      response_xml?: string | null;
    },
  ): Promise<void> {
    try {
      const { document_type, document_number, cufe, ...rest } = data;
      await this.prisma.dian_audit_logs.create({
        data: {
          dian_configuration_id,
          ...rest,
          document_type: DianTestService.clamp(document_type, 50),
          document_number: DianTestService.clamp(document_number, 50),
          cufe: DianTestService.clamp(cufe, 255),
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create DIAN audit log: ${error.message}`);
    }
  }
}
