import { HttpException, Injectable, Logger } from '@nestjs/common';

import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { TechnicalKeyVaultService } from '../../../../common/services/technical-key-vault.service';
import { parsePlausibleFiscalDate } from '../../../../common/utils/fiscal-date.util';
import { normalizeTechnicalKey } from '../fiscal-document-requirements';
import {
  assertTechnicalKeyShape,
  describeTechnicalKeyShape,
  TechnicalKeyShape,
} from '../utils/technical-key.util';
import {
  DianNumberingRange,
  NumberingRangeOutcome,
  parseNumberingRangeResponse,
} from '../providers/dian-direct/dian-numbering-range.parser';
import { DianTestService } from './dian-test.service';
import {
  ApplyNumberingRangeItemDto,
  ApplyNumberingRangesDto,
} from './dto/apply-numbering-range.dto';
import { isHabilitationNumbering } from './habilitation-numbering.util';

/** La resolución guardada, tal como puede viajar al cliente. */
export interface LocalResolutionView {
  id: number;
  prefix: string;
  resolution_number: string;
  range_from: number;
  range_to: number;
  valid_from: string;
  valid_to: string;
  current_number: number;
  is_active: boolean;
  document_type: string;
}

export interface NumberingRangeComparison {
  resolution_number: string | null;
  prefix: string | null;
  range_from: number | null;
  range_to: number | null;
  valid_from: string | null;
  valid_to: string | null;
  resolution_date: string | null;
  local: LocalResolutionView | null;
  /** Nombres de campo que la DIAN y la fila local NO declaran igual. */
  differences: string[];
  /**
   * `true`/`false` sólo cuando hay algo que comparar. `null` cuando no hay fila
   * local, y también cuando la DIAN no reportó ClTec para ese rango: afirmar
   * `false` ahí acusaría al comerciante de tener la clave mal cuando lo que
   * falta es el dato del otro lado.
   */
  technical_key_matches: boolean | null;
  /**
   * FORMA de la ClTec que reportó la DIAN — longitud y familia de caracteres,
   * nunca el valor. `null` cuando la DIAN no reportó clave para ese rango.
   *
   * Existe porque `assertTechnicalKeyShape` puede rechazar la clave de la propia
   * DIAN, y entonces hay que decidir quién se equivoca: nuestro invariante de 40
   * caracteres o la respuesta del servicio autoritativo. Con la longitud sola no
   * se decide; con la familia sí (hex de 64 = SHA-256; base64 de 64 = 48 bytes
   * de otro artefacto). Ponerlo en la consulta —que no escribe nada— evita
   * diagnosticar a base de intentos de aplicar.
   */
  technical_key_shape: TechnicalKeyShape | null;
  status: 'in_sync' | 'differs' | 'missing_local';
  /**
   * `true` cuando este rango es la numeración de PRUEBA de habilitación, no una
   * autorización con la que se factura de verdad. Ver `isHabilitationNumbering`:
   * `invoice_resolutions` no tiene columna de entorno, así que esta marca
   * derivada es la única señal que distingue una cosa de la otra.
   */
  is_habilitation_numbering: boolean;
}

export interface NumberingRangeReport {
  dian_configuration_id: number;
  nit: string;
  software_id: string;
  /**
   * El ambiente que se CONSULTÓ. Desde que es parámetro de la petición puede no
   * ser el de la configuración, y quien lea este informe necesita saber sobre
   * qué catálogo de la DIAN se está afirmando lo que se afirma.
   */
  environment: 'production' | 'test';
  /**
   * El de la CONFIGURACIÓN. Existe para que la pantalla pueda decir «estás
   * mirando producción con una configuración en habilitación» en vez de dejar
   * que el operador lo deduzca: una lista de rangos de producción sobre una
   * configuración en `test` es correcta y a la vez no es lo que él espera ver.
   */
  config_environment: 'production' | 'test';
  queried_at: string;
  /**
   * Ordenados con PRODUCCIÓN PRIMERO. Ver `sortProductionFirst`: el orden en que
   * la DIAN devuelve los rangos no significa nada, y dejar la numeración de
   * pruebas arriba invita a aplicarla primero.
   */
  ranges: NumberingRangeComparison[];
  /** Resoluciones guardadas que la DIAN NO reporta. Se señalan, no se tocan. */
  local_only: Array<{
    id: number;
    prefix: string;
    resolution_number: string;
    range_from: number;
    range_to: number;
    valid_from: string;
    valid_to: string;
    is_active: boolean;
    /** Misma marca derivada que en `ranges`, aquí sobre la fila guardada. */
    is_habilitation_numbering: boolean;
  }>;
  /**
   * Qué ocurrió al leer la respuesta, tal como lo clasifica el parser.
   *
   * Viaja SIEMPRE, también con rangos, porque es lo que le permite a la pantalla
   * distinguir las dos maneras de no tener nada que mostrar: `empty_list` es una
   * afirmación sobre el NEGOCIO —«la DIAN no te reporta numeración en este
   * ambiente»—, y `unrecognized_contract` lo es sobre el SOFTWARE —«no entendimos
   * lo que la DIAN dijo»—. Antes sólo se publicaba la segunda, así que una lista
   * legítimamente vacía acusaba a la DIAN de un cambio de contrato inexistente y
   * mandaba a depurar durante horas algo que nunca estuvo roto.
   */
  outcome: NumberingRangeOutcome;
  /**
   * `OperationCode` / `OperationDescription`: el veredicto que la DIAN da sobre
   * la consulta misma. Son texto de estado —no transportan ClTec ni nada con lo
   * que se pueda recomputar un CUFE—, así que sí pueden viajar al navegador, y
   * son lo ÚNICO que explica un `empty_list`, donde por diseño no hay
   * `element_names` que mirar.
   */
  operation_code: string | null;
  operation_description: string | null;
  /**
   * Sólo cuando `outcome === 'unrecognized_contract'`. Ver el parser: en
   * `empty_list` la lista va vacía a propósito, porque ahí el contrato SÍ se
   * entendió y publicar los nombres del contrato normal invitaría a leerlos como
   * sospechosos.
   */
  unparsed?: { element_names: string[] };
}

/** Lo que produjo la escritura de UN rango que salió bien. */
export interface ApplyNumberingRangeResult {
  resolution_id: number;
  created: boolean;
  applied_fields: string[];
  skipped_fields: string[];
}

/**
 * Una fila del lote, con su desenlace PROPIO.
 *
 * `ok: false` no es una excepción degradada: es el resultado legítimo de un
 * elemento que no se pudo aplicar dentro de un lote donde los demás sí. Por eso
 * el error viaja en la fila —con su código y su mensaje— y no como estado HTTP:
 * el estado HTTP describe la petición, y la petición sí se atendió.
 */
export interface ApplyNumberingRangeItemResult {
  /** Eco del selector recibido, para que la pantalla case fila con casilla. */
  resolution_number: string;
  prefix: string;
  ok: boolean;
  resolution_id: number | null;
  created: boolean;
  applied_fields: string[];
  skipped_fields: string[];
  error: { code: string; message: string } | null;
  /**
   * Si lo aplicado (o intentado) es numeración de PRUEBA. Viaja también aquí y
   * no sólo en la consulta porque es el único momento en que la pantalla sabe
   * qué acaba de escribir: sin la marca podría anunciar como «listo para
   * facturar» una resolución de habilitación recién traída.
   */
  is_habilitation_numbering: boolean;
}

export interface ApplyNumberingRangesResult {
  /** Cuántos elementos terminaron bien. */
  applied: number;
  /** Cuántos fallaron. La suma con `applied` es el total DEDUPLICADO. */
  failed: number;
  results: ApplyNumberingRangeItemResult[];
}

/**
 * El par que identifica un rango, ya recortado y listo para buscar.
 *
 * Se conserva el texto TAL COMO LLEGÓ (recortado, no normalizado) porque es lo
 * que se devuelve en `results`: la pantalla tiene que reconocer sus propias
 * casillas, y una versión en mayúsculas no le sirve para eso.
 */
interface NumberingRangeSelector {
  resolution_number: string;
  prefix: string;
}

/**
 * Lo que devuelve `applyOne`: lo escrito y el rango de la DIAN con el que se
 * escribió. El segundo hace falta para marcar si lo aplicado era numeración de
 * habilitación, y sacarlo de aquí evitaría volver a buscarlo en el llamador.
 */
interface AppliedNumberingRange {
  applied: ApplyNumberingRangeResult;
  target: DianNumberingRange;
}

/** Lo que `applyOne` necesita saber y que se resuelve UNA vez por lote. */
interface ApplyBatchContext {
  config_id: number;
  config: { organization_id: number; store_id: number | null };
  nit: string;
  accounting_entity_id: number | null;
  ranges: DianNumberingRange[];
  element_names: string[];
  /**
   * Qué ocurrió al leer la respuesta. Sin esto, un elemento que no empareja
   * porque la DIAN no reporta nada en ese ambiente y otro que no empareja porque
   * no entendimos la respuesta cuentan la misma historia, y sólo una de las dos
   * es cierta.
   */
  outcome: NumberingRangeOutcome;
  /**
   * El ambiente al que se le preguntó. Va al mensaje del fallo: «la DIAN no
   * reporta rangos» sin decir DÓNDE es la mitad de la frase que hacía dar
   * vueltas — la otra mitad es que probablemente estaba mirando el catálogo
   * equivocado.
   */
  environment: 'production' | 'test';
}

/**
 * Fila completa de `invoice_resolutions`, con las tres columnas de la ClTec.
 * Nunca sale de este servicio: `toLocalView` la proyecta antes de responder.
 */
type StoredResolution = {
  id: number;
  prefix: string;
  resolution_number: string;
  resolution_date: Date;
  range_from: number;
  range_to: number;
  current_number: number;
  valid_from: Date;
  valid_to: Date;
  is_active: boolean;
  document_type: string;
  technical_key: string | null;
  technical_key_encrypted: string | null;
  technical_key_fingerprint: string | null;
};

/**
 * Cruce entre los rangos que la DIAN tiene autorizados y las resoluciones
 * guardadas, y la acción de traer uno a la base.
 *
 * ── EL DEFECTO QUE CIERRA ──────────────────────────────────────────────────
 *
 * Toda factura electrónica de HIDRO (entidad fiscal 92, NIT 902075738) fue
 * rechazada en producción con `FAD06 — Valor del CUFE no está calculado
 * correctamente`. El cálculo del CUFE era correcto: recomputar el SHA-384 con
 * los 15 campos del XML firmado, la ClTec guardada y `TipoAmb=1` reproduce
 * EXACTO el CUFE emitido. Lo que estaba mal era la clave: la guardada es la
 * «Clave actual vigente» del portal MUISCA, y esa pantalla muestra la clave que
 * se usaría para una resolución NUEVA — el mismo portal declaraba «No. claves
 * generadas: 3». La DIAN recomputa con la clave LIGADA A LA RESOLUCIÓN, que en
 * ese tenant era otra.
 *
 * `GetNumberingRange` es la fuente autoritativa por resolución. El cliente SOAP
 * y hasta una rama interna que lo invoca existían desde antes; lo que faltaba
 * era exponerlo, y mientras faltara la ClTec se seguía TECLEANDO y el defecto se
 * repetía en cada tenant nuevo.
 *
 * ── POR QUÉ LA ClTec NO SALE DE AQUÍ ───────────────────────────────────────
 *
 * La respuesta de la DIAN la trae en claro, y quien la tiene recomputa el CUFE
 * de todo lo emitido bajo ese rango — que es exactamente la prueba de
 * autenticidad que la DIAN confronta. La comparación contra
 * `technicalKeyVault.reveal()` ocurre EN EL SERVIDOR y sólo viaja un booleano.
 * No se registra en logs, ni en mensajes de error, ni en `details` de
 * excepciones.
 */
@Injectable()
export class DianNumberingRangeService {
  private readonly logger = new Logger(DianNumberingRangeService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly dian_test_service: DianTestService,
    private readonly technicalKeyVault: TechnicalKeyVaultService,
  ) {}

  /**
   * Consulta a la DIAN y devuelve el diff contra lo guardado. No escribe nada.
   *
   * ── EL AMBIENTE ES DE LA PREGUNTA, NO DE LA CONFIGURACIÓN ──────────────────
   *
   * Ausente ⇒ el de la configuración, que es como se comportaba antes. Se puede
   * pedir el contrario porque heredarlo cerraba un ciclo del que no se salía:
   * una configuración en habilitación preguntaba a `vpfe-hab`, donde las
   * autorizaciones de producción no viven, así que la lista volvía vacía; sin
   * rango no había fila en `invoice_resolutions`; sin esa fila el readiness
   * respondía `FISCAL_RESOLUTION_MISSING`; sin readiness no había promoción; y
   * sin producción la consulta seguía apuntando a habilitación. Ver
   * `DianTestService.queryNumberingRange` para el incidente concreto.
   *
   * Esta operación LEE. Ninguna guarda de emisión ni de promoción depende de
   * qué catálogo se consulte.
   */
  async queryRanges(
    config_id: number,
    environment?: 'test' | 'production' | null,
  ): Promise<NumberingRangeReport> {
    const query = await this.dian_test_service.queryNumberingRange(
      config_id,
      environment,
    );
    const {
      ranges,
      element_names,
      outcome,
      operation_code,
      operation_description,
    } = parseNumberingRangeResponse(query.raw_response);

    const local_rows = await this.loadLocalResolutions(
      query.accounting_entity_id,
    );
    const matched_ids = new Set<number>();
    const pairing = this.pairRanges(ranges, local_rows, matched_ids);

    const comparisons = ranges.map((range, index) =>
      this.compare(range, pairing[index]),
    );

    // PRODUCCIÓN PRIMERO, y el orden se decide AQUÍ y no en la pantalla.
    //
    // La DIAN devuelve los rangos en el orden que le parece, y la numeración de
    // habilitación suele encabezar la lista por ser la más antigua. Quien abre
    // esta pantalla para arreglar su facturación se encuentra entonces con el
    // rango de pruebas en la primera fila, que es el que menos quiere aplicar.
    // El emparejamiento con las filas locales ya ocurrió arriba, así que
    // reordenar aquí no mueve ninguna correspondencia.
    comparisons.sort(sortProductionFirst);

    const report: NumberingRangeReport = {
      dian_configuration_id: query.dian_configuration_id,
      nit: query.nit,
      software_id: query.software_id,
      environment: query.environment,
      config_environment: query.config_environment,
      queried_at: query.queried_at,
      outcome,
      operation_code,
      operation_description,
      ranges: comparisons,
      local_only: local_rows
        .filter((row) => !matched_ids.has(row.id))
        .map((row) => ({
          id: row.id,
          prefix: row.prefix,
          resolution_number: row.resolution_number,
          range_from: row.range_from,
          range_to: row.range_to,
          valid_from: row.valid_from.toISOString(),
          valid_to: row.valid_to.toISOString(),
          is_active: row.is_active,
          is_habilitation_numbering: isHabilitationNumbering(row),
        })),
    };

    // SÓLO cuando el contrato no se reconoció, y NO cuando la lista vino vacía.
    //
    // La condición era `comparisons.length === 0`, y ahí está el defecto: una
    // respuesta perfectamente vigente cuya lista viene sin ítems —porque ese NIT
    // no tiene numeración autorizada EN ESE AMBIENTE— publicaba `unparsed`, y el
    // panel lo traducía a «la DIAN respondió con una estructura que no se pudo
    // interpretar». Es la acusación equivocada contra la parte equivocada: manda
    // a depurar el parser cuando lo que falta es una autorización de numeración.
    // El parser ya distingue los tres desenlaces; aquí sólo hay que creerle.
    //
    // Cuando la DIAN sí renombra un campo, la respuesta se vería como «no tienes
    // rangos autorizados» —una afirmación de negocio falsa— y el único modo de
    // depurarla sería volcar el XML, que trae la ClTec. Los nombres de elemento
    // bastan y no exponen nada.
    if (outcome === 'unrecognized_contract') {
      report.unparsed = { element_names };
    }

    return report;
  }

  /**
   * Trae a `invoice_resolutions` los rangos SELECCIONADOS de la DIAN, con un
   * resultado por elemento.
   *
   * NO ACEPTA LOS VALORES DEL CLIENTE, sólo el par que SELECCIONA el rango. Lo
   * que se está escribiendo es la clave con la que se firmará el CUFE de cada
   * factura del rango: aceptarla del payload la convertiría en un campo que
   * cualquiera con `invoicing:write` puede dictar, y una clave dictada es
   * indistinguible de la autorizada hasta que la DIAN rechaza el primer
   * documento y quema su consecutivo. La fuente sigue siendo la respuesta de la
   * DIAN, elemento por elemento.
   *
   * ── UNA SOLA CONSULTA SOAP PARA TODO EL LOTE ───────────────────────────────
   *
   * La versión de un rango volvía a preguntarle a la DIAN en cada aplicación. En
   * lote eso serían N llamadas a `GetNumberingRange` para responder una pregunta
   * —qué rangos tiene autorizados este NIT y con qué ClTec cada uno— que ya tuvo
   * respuesta en la primera. Y no es sólo trabajo de más: cada repetición es otra
   * oportunidad de que la DIAN se caiga a mitad del lote y la mitad restante
   * falle por un motivo que no tiene nada que ver con lo que el usuario pidió.
   * Se consulta UNA vez y los N elementos se resuelven contra ese resultado.
   *
   * ── UN ELEMENTO QUE FALLA NO ARRASTRA AL RESTO ─────────────────────────────
   *
   * Cada elemento se aplica en su propio ámbito de error y el que falla se
   * reporta con `ok: false` y su código. Un lote parcialmente aplicado es un
   * desenlace legítimo y hay que decirlo con precisión: envolverlo en un fallo
   * global dejaría al comerciante sin saber cuáles de sus resoluciones quedaron
   * escritas, y con la única salida de reintentar el lote entero.
   *
   * Tampoco hay una transacción que los envuelva a todos, y es deliberado: cada
   * escritura ya es atómica por sí sola, y una transacción común convertiría un
   * elemento malo en la pérdida de todos los buenos — exactamente lo contrario
   * de lo que este contrato promete.
   *
   * ── QUÉ SÍ TUMBA EL LOTE ENTERO ────────────────────────────────────────────
   *
   * Sólo lo que invalida la pregunta completa: que la configuración no exista
   * (`DIAN_CONFIG_001`), que la DIAN no conteste (`DIAN_NUMBERING_RANGE_001`) o
   * que el cuerpo esté mal formado (lo rechaza el `ValidationPipe` antes de
   * llegar). Esas sí suben como excepción, porque con ellas NINGÚN elemento
   * tiene respuesta posible.
   *
   * ── DE QUÉ AMBIENTE SALEN LOS VALORES ──────────────────────────────────────
   *
   * Del que se pida, y ausente ⇒ el de la configuración. Tiene que poder ser el
   * mismo que el de la consulta: si la pantalla puede VER el catálogo de
   * producción desde una configuración en habilitación pero no puede TRAER de
   * él, lo visible queda fuera del alcance de lo aplicable y el ciclo que este
   * cambio rompe se vuelve a cerrar un paso más adelante.
   *
   * ── POR QUÉ ESO NO ADELANTA NINGUNA HABILITACIÓN ───────────────────────────
   *
   * Porque escribir la fila no es lo que autoriza a emitir.
   * `InvoiceEmissionGateService.assertElectronicEmissionLive` exige
   * `environment === 'production' && enablement_status === 'enabled'` sobre la
   * CONFIGURACIÓN antes de CUALQUIER emisión electrónica, y esta operación no
   * toca ninguna de las dos columnas: una resolución de producción aplicada
   * mientras la configuración sigue en `test` queda escrita y es INCONSUMIBLE.
   * Ésa es la razón por la que desacoplar la consulta no necesita un estado
   * intermedio ni tocar `promoteToProduction`, el gate del set de pruebas o el
   * propio `assertElectronicEmissionLive`.
   *
   * El parámetro explícito manda sobre `dto.environment` para que un riel que ya
   * resolvió el ambiente por otra vía —una query, un contexto de plataforma— no
   * tenga que mutar el cuerpo que recibió; sin él gobierna el del cuerpo, y sin
   * ninguno de los dos, el de la configuración.
   */
  async applyRanges(
    config_id: number,
    dto: ApplyNumberingRangesDto,
    environment?: 'test' | 'production' | null,
  ): Promise<ApplyNumberingRangesResult> {
    // UN RESULTADO POR PAR DISTINTO. Aplicar dos veces la misma clave no rompe
    // nada —la segunda pasada no encuentra diferencias—, pero un `results` con
    // filas repetidas haría que la pantalla informara de dos acciones donde hubo
    // una, y que el conteo de `applied` no cuadrara con lo que el usuario marcó.
    const selectors = dedupeSelectors(dto.ranges ?? []);

    const query = await this.dian_test_service.queryNumberingRange(
      config_id,
      environment ?? dto.environment ?? null,
    );
    const { ranges, element_names, outcome } = parseNumberingRangeResponse(
      query.raw_response,
    );

    // La configuración se lee UNA vez, aquí y no dentro de cada creación. Así
    // «la configuración no existe» es un fallo del lote —que es lo que es— en
    // vez de repetirse como error de cada elemento; y de paso se ahorran N
    // lecturas de una fila que no cambia durante el lote.
    const config = await this.dian_test_service.getConfigById(config_id);

    const context: ApplyBatchContext = {
      config_id,
      config,
      nit: query.nit,
      accounting_entity_id: query.accounting_entity_id,
      ranges,
      element_names,
      outcome,
      environment: query.environment,
    };

    const results: ApplyNumberingRangeItemResult[] = [];

    for (const selector of selectors) {
      try {
        const { applied, target } = await this.applyOne(selector, context);
        results.push({
          resolution_number: selector.resolution_number,
          prefix: selector.prefix,
          ok: true,
          resolution_id: applied.resolution_id,
          created: applied.created,
          applied_fields: applied.applied_fields,
          skipped_fields: applied.skipped_fields,
          error: null,
          is_habilitation_numbering: isHabilitationNumbering(target),
        });
      } catch (error: unknown) {
        results.push({
          resolution_number: selector.resolution_number,
          prefix: selector.prefix,
          ok: false,
          resolution_id: null,
          created: false,
          applied_fields: [],
          skipped_fields: [],
          error: this.describeItemFailure(error, selector, config_id),
          // Sin rango emparejado sólo queda el número que pidió el cliente. No
          // se escribió nada, así que la marca es informativa; se calcula igual
          // para que la pantalla no tenga que tratar la fila fallida como un
          // caso aparte.
          is_habilitation_numbering: isHabilitationNumbering({
            resolution_number: selector.resolution_number,
          }),
        });
      }
    }

    const failed = results.filter((row) => !row.ok).length;

    return { applied: results.length - failed, failed, results };
  }

  /**
   * Resuelve UN elemento del lote contra la respuesta de la DIAN ya obtenida.
   *
   * Lanza cuando el elemento no se puede aplicar. Quien lo llama decide si eso
   * es una fila con `ok: false` o una excepción: aquí sólo se declara el motivo
   * con el mismo código que tendría si fuera la única petición.
   *
   * Devuelve también el rango de la DIAN que se aplicó, porque el llamador lo
   * necesita para marcar si lo escrito era numeración de habilitación.
   */
  private async applyOne(
    selector: NumberingRangeSelector,
    context: ApplyBatchContext,
  ): Promise<AppliedNumberingRange> {
    const { config_id, ranges, element_names, outcome, environment } = context;
    const resolution_number = selector.resolution_number || null;
    const prefix = selector.prefix || null;

    // LOS DOS, no uno u otro. El par `(resolution_number, prefix)` es lo que
    // identifica un rango sin ambigüedad: un mismo prefijo puede aparecer en dos
    // autorizaciones sucesivas, y un número de resolución sin prefijo no dice
    // sobre qué serie escribir. Lo que se está por escribir es la clave con la
    // que se firma el CUFE de cada factura del rango, así que un emparejamiento
    // «suficientemente bueno» escribiría una clave fiscal sobre la resolución
    // equivocada y rechazaría todo lo que esa serie emita después.
    //
    // El DTO ya lo exige; esta comprobación se conserva porque los carriles de
    // escritura de resoluciones no comparten todos el mismo `ValidationPipe` y
    // un llamador interno puede armar el DTO a mano: lo que no exija la capa de
    // servicio no lo exige nadie.
    if (!resolution_number || !prefix) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_009,
        'Indica el número de resolución Y el prefijo del rango que quieres traer de la DIAN: los dos juntos son lo que identifica el rango sin ambigüedad.',
        { dian_configuration_id: config_id, resolution_number, prefix },
      );
    }

    const matches = ranges.filter(
      (range) =>
        normalizeText(range.resolution_number) ===
          normalizeText(resolution_number) &&
        normalizeText(range.prefix) === normalizeText(prefix),
    );

    if (matches.length === 0) {
      // TRES MANERAS DISTINTAS DE NO EMPAREJAR, y decirlas todas igual fue el
      // defecto. Antes el detalle llevaba `element_names` con sólo mirar
      // `ranges.length === 0`, así que una lista legítimamente vacía —el NIT no
      // tiene numeración autorizada EN ESE AMBIENTE— se publicaba como si la
      // DIAN hubiera cambiado su contrato, y el operador se iba a depurar el
      // parser en vez de a mirar el catálogo correcto.
      //
      // `empty_list` es una afirmación sobre el NEGOCIO y por eso nombra el
      // ambiente consultado: quien preguntó en habilitación por una resolución
      // de producción no tiene un problema, tiene la pregunta hecha al catálogo
      // equivocado, y el mensaje es el único sitio donde eso se puede decir.
      // `unrecognized_contract` es una afirmación sobre el SOFTWARE, y sólo ahí
      // los nombres de elemento significan algo — en `empty_list` invitarían a
      // leer como sospechosos los nombres del contrato normal.
      const message =
        outcome === 'empty_list'
          ? `La DIAN no reporta ningún rango de numeración para el NIT ${context.nit} en el ambiente de ${describeEnvironment(environment)}, así que tampoco el de resolución ${resolution_number} con prefijo ${prefix}. Si la autorización que buscas es del otro ambiente, consulta los rangos indicándolo.`
          : `La DIAN no reporta un rango con número de resolución ${resolution_number} y prefijo ${prefix} para el NIT ${context.nit} en el ambiente de ${describeEnvironment(environment)}. Consulta primero los rangos autorizados y elige uno de los que la DIAN devuelve.`;

      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_002, message, {
        dian_configuration_id: config_id,
        resolution_number,
        prefix,
        // El ambiente es público —el comerciante lo eligió— y es justo el dato
        // que convierte «no lo reporta» en «no lo reporta AQUÍ».
        environment,
        outcome,
        // Sólo cuando de verdad no entendimos la respuesta. Ver arriba.
        ...(outcome === 'unrecognized_contract' ? { element_names } : {}),
      });
    }

    // Ambigüedad → se para. Escoger «el primero» resolvería el 100 % de los
    // casos hasta el día en que no, y ese día habría escrito la ClTec de un
    // rango en la resolución de otro sin dejar rastro de la elección.
    if (matches.length > 1) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_007,
        `La DIAN reporta ${matches.length} rangos con número de resolución ${resolution_number} y prefijo ${prefix}: el par no identifica uno solo, así que no se puede decidir cuál traer sin arriesgar escribir la clave técnica en la resolución equivocada. Captúralo a mano desde la autorización de numeración.`,
        {
          dian_configuration_id: config_id,
          resolution_number,
          prefix,
          matches: matches.length,
        },
      );
    }

    const target = matches[0];

    // LAS FILAS LOCALES SE RELEEN EN CADA ELEMENTO, y no se cachea el listado
    // como sí se cachea la respuesta de la DIAN. La respuesta de la DIAN no
    // cambia durante el lote; `invoice_resolutions` SÍ cambia, porque la escribe
    // este mismo bucle. Con una foto tomada al principio, un segundo elemento
    // que empareje con la fila que el primero acaba de crear no la vería y
    // crearía una fila duplicada para la misma serie. Releer cuesta una consulta
    // local por elemento y hace que el lote se comporte exactamente como N
    // llamadas sucesivas — menos las N consultas SOAP.
    const local_rows = await this.loadLocalResolutions(
      context.accounting_entity_id,
    );
    const existing = this.matchLocal(target, local_rows, new Set<number>());

    const applied = existing
      ? await this.updateFromDian(existing, target, config_id)
      : await this.createFromDian(
          target,
          config_id,
          context.accounting_entity_id,
          context.config,
        );

    return { applied, target };
  }

  /**
   * Traduce lo que falló en UN elemento a un `{ code, message }` publicable.
   *
   * Los errores del dominio ya vienen con su código y con un mensaje redactado
   * para el comerciante, así que viajan tal cual: son la razón por la que este
   * contrato reporta por elemento en vez de rendirse en el primero.
   *
   * Lo que NO se reenvía es el mensaje de un error inesperado. Un error de
   * Prisma o de red trae texto pensado para un log, y esta respuesta va al
   * navegador; además, la escritura que acaba de fallar tocaba las tres columnas
   * de la clave técnica, y publicar un mensaje crudo de esa operación es la
   * clase de fuga que nadie revisa hasta que ya ocurrió. El detalle queda en el
   * log del servidor, que es donde se depura.
   */
  private describeItemFailure(
    error: unknown,
    selector: NumberingRangeSelector,
    config_id: number,
  ): { code: string; message: string } {
    if (error instanceof VendixHttpException) {
      return { code: error.errorCode, message: error.message };
    }

    if (error instanceof HttpException) {
      const body = error.getResponse();
      const declared =
        typeof body === 'object' && body !== null
          ? (body as Record<string, unknown>).error_code
          : null;
      return {
        code:
          typeof declared === 'string'
            ? declared
            : ErrorCodes.SYS_INTERNAL_001.code,
        message: error.message,
      };
    }

    this.logger.error(
      `Fallo inesperado al aplicar el rango ${selector.resolution_number}/${selector.prefix} de la configuración ${config_id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error instanceof Error ? error.stack : undefined,
    );

    return {
      code: ErrorCodes.SYS_INTERNAL_001.code,
      message:
        'Ocurrió un error inesperado al traer este rango de la DIAN. Los demás rangos del lote no se vieron afectados; revisa los registros del servidor para el detalle.',
    };
  }

  // ---------------------------------------------------------------------------
  // Lectura y emparejamiento
  // ---------------------------------------------------------------------------

  /**
   * Resoluciones de la entidad fiscal de ESTA configuración.
   *
   * El filtro explícito por `accounting_entity_id` es defensa en profundidad,
   * no el control principal: `StorePrismaService` ya scopea `invoice_resolutions`
   * por la entidad fiscal del contexto. Se añade porque una configuración DIAN
   * declara SU entidad, y comparar los rangos de un NIT contra las resoluciones
   * de otro produciría un diff que invita a corregir la fila equivocada.
   */
  private async loadLocalResolutions(
    accounting_entity_id: number | null,
  ): Promise<StoredResolution[]> {
    if (!accounting_entity_id) return [];

    return (await this.prisma.invoice_resolutions.findMany({
      where: { accounting_entity_id },
      orderBy: { id: 'asc' },
    })) as StoredResolution[];
  }

  /**
   * Reparte las filas locales entre los rangos de la DIAN, EN TRES PASADAS.
   *
   * ── POR QUÉ NO BASTA CON DECIDIR RANGO POR RANGO ───────────────────────────
   *
   * Porque un mismo número de resolución puede amparar VARIOS prefijos, y ese
   * caso rompe cualquier emparejamiento codicioso. Ocurrió en producción el
   * 16/08/2026 con el NIT 902075738: la DIAN devolvió dos rangos bajo la
   * resolución `18764113258848` —`DSJL`, sin clave técnica, y `FVJL`, con la
   * clave de 64 hex que había que aplicar—. Con la decisión tomada por rango y
   * en orden de llegada, `DSJL` llegó primero, no encontró par exacto, cayó al
   * criterio por número y se quedó con la fila local `FVJL` (id 13). El rango
   * `FVJL` —el único con clave— acabó `missing_local`, con
   * `technical_key_matches: null` y `differences: []`.
   *
   * Es decir: la pantalla construida para diagnosticar el FAD06 no llegó a
   * comparar la clave ni una vez, y encima reportó una diferencia de `prefix`
   * inventada por el emparejamiento equivocado. Nadie lo habría notado leyendo
   * la respuesta: se veía como un caso perfectamente normal.
   *
   * Repartir por pasadas lo arregla porque el par EXACTO se reclama antes de
   * que exista cualquier candidato laxo. Ningún criterio flojo puede quedarse
   * con una fila que otro rango reclama de manera precisa.
   *
   *   1. número Y prefijo — la identidad completa que autoriza la DIAN.
   *   2. sólo número — para filas guardadas sin prefijo o con uno corregido.
   *   3. sólo prefijo — respaldo para las anteriores a que el número se
   *      exigiera, y para las notas, rotuladas `INTERNA-<prefijo>`.
   *
   * @param taken se rellena con los ids reclamados; el llamador lo usa para
   *              calcular `local_only`.
   * @returns un arreglo paralelo a `ranges`: la fila de cada uno, o `null`.
   */
  private pairRanges(
    ranges: DianNumberingRange[],
    rows: StoredResolution[],
    taken: Set<number>,
  ): (StoredResolution | null)[] {
    const paired: (StoredResolution | null)[] = ranges.map(() => null);

    const claim = (
      matches: (range: DianNumberingRange, row: StoredResolution) => boolean,
    ): void => {
      ranges.forEach((range, index) => {
        if (paired[index]) return;
        const row = rows.find(
          (candidate) => !taken.has(candidate.id) && matches(range, candidate),
        );
        if (!row) return;
        paired[index] = row;
        taken.add(row.id);
      });
    };

    const sameNumber = (range: DianNumberingRange, row: StoredResolution) =>
      !!range.resolution_number &&
      normalizeText(row.resolution_number) ===
        normalizeText(range.resolution_number);

    const samePrefix = (range: DianNumberingRange, row: StoredResolution) =>
      !!range.prefix && normalizeText(row.prefix) === normalizeText(range.prefix);

    claim((range, row) => sameNumber(range, row) && samePrefix(range, row));
    claim(sameNumber);
    claim(samePrefix);

    return paired;
  }

  /**
   * La versión de un solo rango, para el carril de escritura.
   *
   * `applyRanges` resuelve un rango a la vez contra la lista local completa, así
   * que no hay competencia entre rangos que resolver: basta con preferir el par
   * exacto antes que los laxos, por el mismo motivo que {@link pairRanges}.
   */
  private matchLocal(
    range: DianNumberingRange,
    rows: StoredResolution[],
    taken: Set<number>,
  ): StoredResolution | null {
    const available = rows.filter((row) => !taken.has(row.id));

    const same_number = (row: StoredResolution) =>
      !!range.resolution_number &&
      normalizeText(row.resolution_number) ===
        normalizeText(range.resolution_number);

    const same_prefix = (row: StoredResolution) =>
      !!range.prefix && normalizeText(row.prefix) === normalizeText(range.prefix);

    return (
      available.find((row) => same_number(row) && same_prefix(row)) ??
      available.find(same_number) ??
      available.find(same_prefix) ??
      null
    );
  }

  private compare(
    range: DianNumberingRange,
    local: StoredResolution | null,
  ): NumberingRangeComparison {
    const base = {
      resolution_number: range.resolution_number,
      prefix: range.prefix,
      range_from: range.range_from,
      range_to: range.range_to,
      valid_from: range.valid_from,
      valid_to: range.valid_to,
      resolution_date: range.resolution_date,
      technical_key_shape: describeTechnicalKeyShape(range.technical_key),
    };

    // LOS DOS LADOS, no sólo el de la DIAN.
    //
    // Basta con que UNO de ellos sea numeración de habilitación para marcar la
    // fila. Si la DIAN reportó el rango incompleto —sin número o sin límites— y
    // es la fila local la que delata que es de pruebas, preguntar sólo al lado
    // de la DIAN devolvería `false`, y ese `false` es la señal con la que la
    // pantalla decide si presenta el rango como facturable.
    const is_habilitation_numbering =
      isHabilitationNumbering(range) ||
      (local !== null && isHabilitationNumbering(local));

    if (!local) {
      return {
        ...base,
        local: null,
        differences: [],
        technical_key_matches: null,
        status: 'missing_local',
        is_habilitation_numbering,
      };
    }

    const technical_key_matches = this.technicalKeyMatches(range, local);
    const differences = this.fieldDifferences(range, local);

    // LA ClTec ES UNA DIFERENCIA MÁS, y la que más importa.
    //
    // `differences` es lo que la pantalla lee para decidir si ofrece «Aplicar».
    // Dejar la clave divergente fuera de la lista dejaría la fila que CAUSA el
    // FAD06 marcada como `in_sync` y sin acción posible — es decir, la única
    // fila para la que esta pantalla existe sería la única que no se puede
    // arreglar desde ella. Por eso `in_sync` significa «todo coincide, clave
    // incluida», sin excepciones.
    if (technical_key_matches === false) {
      differences.push('technical_key');
    }

    return {
      ...base,
      local: toLocalView(local),
      differences,
      technical_key_matches,
      status: differences.length > 0 ? 'differs' : 'in_sync',
      is_habilitation_numbering,
    };
  }

  /**
   * Qué campos declara distinto cada lado.
   *
   * Un campo que la DIAN no reporta NO cuenta como diferencia: la ausencia del
   * dato no es una discrepancia, y marcarla como tal empujaría a «corregir» la
   * fila local borrando lo único que se tiene.
   */
  private fieldDifferences(
    range: DianNumberingRange,
    local: StoredResolution,
  ): string[] {
    const differences: string[] = [];

    if (
      range.resolution_number &&
      normalizeText(range.resolution_number) !==
        normalizeText(local.resolution_number)
    ) {
      differences.push('resolution_number');
    }
    if (range.prefix && normalizeText(range.prefix) !== normalizeText(local.prefix)) {
      differences.push('prefix');
    }
    if (range.range_from !== null && range.range_from !== local.range_from) {
      differences.push('range_from');
    }
    if (range.range_to !== null && range.range_to !== local.range_to) {
      differences.push('range_to');
    }
    // Por DÍA CIVIL y no por instante: los dos lados guardan la fecha anclada en
    // UTC, pero comparar el ISO completo convertiría cualquier diferencia de
    // hora residual en una divergencia de vigencia que no existe.
    if (differsByDay(range.valid_from, local.valid_from)) {
      differences.push('valid_from');
    }
    if (differsByDay(range.valid_to, local.valid_to)) {
      differences.push('valid_to');
    }
    if (differsByDay(range.resolution_date, local.resolution_date)) {
      differences.push('resolution_date');
    }

    return differences;
  }

  /**
   * Compara la ClTec EN EL SERVIDOR. Devuelve un booleano y nada más.
   *
   * `reveal()` y no `local.technical_key`: la copia cifrada es la que manda al
   * hashear el CUFE, así que comparar contra la columna en claro respondería
   * sobre una clave que la emisión ya no usa.
   */
  private technicalKeyMatches(
    range: DianNumberingRange,
    local: StoredResolution,
  ): boolean | null {
    const from_dian = normalizeTechnicalKey(range.technical_key);
    if (!from_dian) return null;

    const stored = normalizeTechnicalKey(this.technicalKeyVault.reveal(local));
    return stored.length > 0 && stored === from_dian;
  }

  // ---------------------------------------------------------------------------
  // Escritura
  // ---------------------------------------------------------------------------

  private async createFromDian(
    range: DianNumberingRange,
    config_id: number,
    accounting_entity_id: number | null,
    // Llega resuelta desde `applyRanges` en vez de leerse aquí: es la misma fila
    // para todo el lote y no cambia entre elementos.
    config: { organization_id: number; store_id: number | null },
  ): Promise<ApplyNumberingRangeResult> {
    if (!accounting_entity_id) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_006,
        'La configuración DIAN no tiene entidad contable, así que la resolución no tendría dónde colgar. Completa la identidad fiscal antes de traer el rango.',
        { dian_configuration_id: config_id },
      );
    }

    // Sin número, sin prefijo o sin límites no hay resolución que crear, y NO se
    // rellena con nada: copiar el prefijo de una fila local o acuñar un número
    // interno para tapar un hueco del parseo escribiría la clave técnica de este
    // rango bajo una identidad fiscal que la DIAN no autorizó.
    if (
      !range.resolution_number ||
      !range.prefix ||
      range.range_from === null ||
      range.range_to === null
    ) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_009,
        'La DIAN devolvió el rango sin número de resolución, sin prefijo o sin los límites de numeración, así que no se puede crear la resolución. Revisa la respuesta con la consulta de rangos y captúrala a mano.',
        {
          dian_configuration_id: config_id,
          resolution_number: range.resolution_number,
          prefix: range.prefix,
          range_from: range.range_from,
          range_to: range.range_to,
        },
      );
    }

    const technical_key = assertTechnicalKeyShape(range.technical_key, {
      dian_configuration_id: config_id,
      prefix: range.prefix,
    });

    const created = await this.prisma.invoice_resolutions.create({
      data: {
        organization_id: config.organization_id,
        store_id: config.store_id,
        accounting_entity_id,
        // La DIAN no reporta el tipo de documento en `GetNumberingRange`: un
        // rango autorizado por resolución es de factura de venta. Los tipos que
        // no numeran contra resolución no llegan por esta vía.
        document_type: 'sales_invoice',
        resolution_number: range.resolution_number,
        resolution_date: this.toFiscalDate(
          'fecha de resolución',
          range.resolution_date,
        ),
        prefix: range.prefix,
        range_from: range.range_from,
        range_to: range.range_to,
        // Un número por debajo del inicio del rango: nada consumido todavía. Es
        // la misma convención de `ResolutionsService.create`.
        current_number: range.range_from - 1,
        valid_from: this.toFiscalDate('válida desde', range.valid_from),
        valid_to: this.toFiscalDate('válida hasta', range.valid_to),
        is_active: true,
        // Las tres columnas de la ClTec se escriben juntas — claro, cifrado y
        // huella. Escribir sólo una deja la fila apuntando a dos claves a la vez
        // y la que manda al recomputar el CUFE es la vieja.
        ...this.technicalKeyVault.sealForWrite(technical_key),
      },
    });

    // SIMETRÍA ESCRITURA/LECTURA: la fila nace con la entidad fiscal de la
    // configuración; si el alcance del llamador resuelve otra, quedaría
    // persistida pero invisible en los listados —una fila fantasma—. No se
    // revierte (la resolución es correcta y borrarla perdería el dato), pero
    // tiene que quedar dicho en el log en vez de descubrirse como «guardé y no
    // aparece».
    const visible = await this.prisma.invoice_resolutions.findFirst({
      where: { id: created.id },
      select: { id: true },
    });
    if (!visible) {
      this.logger.warn(
        `La resolución ${created.id} se creó en la entidad contable ${accounting_entity_id} de la configuración ${config_id}, pero el alcance fiscal del llamador no la alcanza: no aparecerá en los listados.`,
      );
    }

    this.logger.log(
      `Resolución ${created.resolution_number} (prefijo ${created.prefix}) creada desde GetNumberingRange, config ${config_id}`,
    );

    return {
      resolution_id: created.id,
      created: true,
      applied_fields: [
        'resolution_number',
        'prefix',
        'range_from',
        'range_to',
        'valid_from',
        'valid_to',
        'resolution_date',
        ...(technical_key ? ['technical_key'] : []),
      ],
      skipped_fields: [],
    };
  }

  private async updateFromDian(
    local: StoredResolution,
    range: DianNumberingRange,
    config_id: number,
  ): Promise<ApplyNumberingRangeResult> {
    // `current_number` arranca en `range_from - 1`. Alcanzar `range_from`
    // significa que la DIAN ya vio un consecutivo salido de este rango —incluido
    // el set de pruebas, que quema números sin escribir filas en `invoices`—, y
    // a partir de ahí la identidad fiscal de la fila está comprometida con
    // documentos ya reportados. Misma regla que `ResolutionsService.update`
    // (INVOICING_RESOLUTION_005); aquí no se lanza sino que se reporta, porque
    // el resto del rango SÍ se puede corregir y negar todo dejaría al
    // comerciante sin poder arreglar justo lo que rompe.
    const consumed = local.current_number >= local.range_from;

    const applied_fields: string[] = [];
    const skipped_fields: string[] = [];
    // `any` por la misma razón que `update_data` en `ResolutionsService.update`:
    // el objeto se arma campo a campo según lo que la DIAN reporte distinto, y
    // el tipo generado por Prisma no admite una construcción incremental.
    const data: any = {};

    const immutable_when_consumed = new Set([
      'prefix',
      'range_from',
      'resolution_number',
    ]);

    for (const field of this.fieldDifferences(range, local)) {
      if (consumed && immutable_when_consumed.has(field)) {
        skipped_fields.push(field);
        continue;
      }

      switch (field) {
        case 'resolution_number':
          data.resolution_number = range.resolution_number;
          break;
        case 'prefix':
          data.prefix = range.prefix;
          break;
        case 'range_from':
          data.range_from = range.range_from;
          break;
        case 'range_to':
          // Bajar el techo por debajo de lo ya consumido haría que la siguiente
          // asignación reutilizara un número que ya viaja en un documento
          // reportado. Lo que dice la DIAN manda salvo en esto: su rango no
          // sabe cuántos números hemos gastado.
          if (consumed && (range.range_to ?? 0) < local.current_number) {
            skipped_fields.push('range_to');
            continue;
          }
          data.range_to = range.range_to;
          break;
        case 'valid_from':
          data.valid_from = this.toFiscalDate('válida desde', range.valid_from);
          break;
        case 'valid_to':
          data.valid_to = this.toFiscalDate('válida hasta', range.valid_to);
          break;
        case 'resolution_date':
          data.resolution_date = this.toFiscalDate(
            'fecha de resolución',
            range.resolution_date,
          );
          break;
      }
      applied_fields.push(field);
    }

    // LA ClTec SE CORRIGE SIEMPRE, consumida o no.
    //
    // Es justo el campo que este defecto obliga a poder arreglar: una clave
    // equivocada rechaza CADA documento del rango con FAD06, y el rango no se
    // desatasca sin cambiarla. No altera la identidad fiscal de lo ya emitido —
    // los CUFE ya calculados están en manos de la DIAN y no se recalculan— así
    // que no cae bajo la regla de inmutabilidad, que protege prefijo, tipo,
    // número inicial y número de resolución.
    //
    // Si la DIAN no reporta clave para el rango, la local NO se toca: sellar
    // `null` borraría la única copia que existe, y la clave la emitió la DIAN al
    // autorizar un rango que ya está en uso.
    const from_dian = normalizeTechnicalKey(range.technical_key);
    if (from_dian && this.technicalKeyMatches(range, local) === false) {
      const technical_key = assertTechnicalKeyShape(range.technical_key, {
        resolution_id: local.id,
        dian_configuration_id: config_id,
      });
      Object.assign(data, this.technicalKeyVault.sealForWrite(technical_key));
      applied_fields.push('technical_key');
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.invoice_resolutions.update({
        where: { id: local.id },
        data,
      });
      this.logger.log(
        `Resolución ${local.id} alineada con GetNumberingRange (config ${config_id}): ${applied_fields.join(', ')}`,
      );
    }

    return {
      resolution_id: local.id,
      created: false,
      applied_fields,
      skipped_fields,
    };
  }

  /**
   * Convierte una fecha de la DIAN en `Date`, validando las cotas fiscales.
   *
   * Una vigencia imposible entra al período de autorización del XML y la DIAN
   * rechaza el documento con FAB07b/FAB08b, así que se corta antes de guardarla
   * — con el mismo validador que usan las tres consolas de resoluciones.
   */
  private toFiscalDate(label: string, iso: string | null): Date {
    if (!iso) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_010,
        `La DIAN devolvió el rango sin la ${label}, así que la resolución no se puede guardar con una vigencia completa. Captúrala a mano desde la autorización de numeración.`,
      );
    }
    return parsePlausibleFiscalDate(label, iso);
  }
}

/** Comparación insensible a mayúsculas y espacios de borde. */
function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

/**
 * El ambiente EN CASTELLANO, para los mensajes que lee un comerciante.
 *
 * `test` se dice «habilitación» y no «pruebas»: es el nombre con el que la DIAN
 * lo llama en el portal y en el trámite, y es el que el usuario reconoce cuando
 * el mensaje le está diciendo, en el fondo, que preguntó en el sitio que no era.
 */
function describeEnvironment(environment: 'production' | 'test'): string {
  return environment === 'production' ? 'producción' : 'habilitación';
}

/**
 * Un selector por PAR distinto, en el orden en que el cliente los mandó.
 *
 * La deduplicación es por el par NORMALIZADO —`FVJL` y `fvjl ` son el mismo
 * rango— pero lo que se conserva es el texto de la PRIMERA aparición, sin pasar
 * a mayúsculas: `results` lo devuelve tal cual para que la pantalla reconozca la
 * casilla que marcó el usuario.
 */
function dedupeSelectors(
  items: ApplyNumberingRangeItemDto[],
): NumberingRangeSelector[] {
  const seen = new Set<string>();
  const selectors: NumberingRangeSelector[] = [];

  for (const item of items) {
    const resolution_number = (item?.resolution_number ?? '').trim();
    const prefix = (item?.prefix ?? '').trim();
    const key = `${normalizeText(resolution_number)}|${normalizeText(prefix)}`;

    if (seen.has(key)) continue;
    seen.add(key);
    selectors.push({ resolution_number, prefix });
  }

  return selectors;
}

/**
 * Producción antes que habilitación; dentro de cada grupo, por número de
 * resolución y prefijo.
 *
 * El desempate por los dos campos es lo que hace el orden DETERMINISTA: sin él
 * el resultado dependería del orden en que la DIAN devolvió los rangos, que no
 * está documentado y cambia entre entornos, y la pantalla reordenaría sus filas
 * entre dos consultas idénticas.
 */
function sortProductionFirst(
  a: NumberingRangeComparison,
  b: NumberingRangeComparison,
): number {
  if (a.is_habilitation_numbering !== b.is_habilitation_numbering) {
    return a.is_habilitation_numbering ? 1 : -1;
  }

  const by_number = normalizeText(a.resolution_number).localeCompare(
    normalizeText(b.resolution_number),
  );
  if (by_number !== 0) return by_number;

  return normalizeText(a.prefix).localeCompare(normalizeText(b.prefix));
}

/** `true` cuando la DIAN reporta el dato y su DÍA CIVIL difiere del guardado. */
function differsByDay(from_dian: string | null, local: Date): boolean {
  if (!from_dian) return false;
  return from_dian.slice(0, 10) !== local.toISOString().slice(0, 10);
}

function toLocalView(row: StoredResolution): LocalResolutionView {
  return {
    id: row.id,
    prefix: row.prefix,
    resolution_number: row.resolution_number,
    range_from: row.range_from,
    range_to: row.range_to,
    valid_from: row.valid_from.toISOString(),
    valid_to: row.valid_to.toISOString(),
    current_number: row.current_number,
    is_active: row.is_active,
    document_type: String(row.document_type),
  };
}
