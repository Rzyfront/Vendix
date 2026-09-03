import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { TechnicalKeyVaultService } from '@common/services/technical-key-vault.service';
import {
  internalSeriesPrefixFor,
  isWellFormedTechnicalKey,
  normalizeTechnicalKey,
  requirementsFor,
  TECHNICAL_KEY_LENGTHS,
  TECHNICAL_KEY_LENGTHS_LABEL,
} from '../fiscal-document-requirements';
import { RANGE_BOUND } from '../resolutions/dto/create-resolution.dto';

type FiscalDocumentType =
  | 'sales_invoice'
  | 'credit_note'
  | 'debit_note'
  | 'support_document'
  | 'support_adjustment_note'
  | 'payroll'
  | 'payroll_adjustment'
  | 'pos_equivalent_document'
  | 'equivalent_adjustment_note';

type GenerateNextNumberOptions =
  | number
  | {
      resolution_id?: number;
      document_type?: FiscalDocumentType;
      accounting_entity_id?: number;
      organization_id?: number;
      store_id?: number | null;
    };

/**
 * Cuántos consecutivos se dan de alta —y se añaden al ampliar— en una serie
 * interna. No hay tope legal que respetar: el bloque existe solo para que el
 * `range_to` sea un número legible en pantalla y para que ampliar sea un evento
 * ocasional en el log, no uno por documento.
 */
export const INTERNAL_SERIES_BLOCK = 1000;

/**
 * Vigencia que se le pone a una serie interna, en años.
 *
 * `valid_from`/`valid_to` existen porque una Autorización de Numeración DIAN
 * caduca. Una serie interna no caduca: ponerle un año haría que el consecutivo
 * de las notas se bloqueara solo el día del aniversario, que es exactamente el
 * bloqueo que este código existe para quitar.
 */
export const INTERNAL_SERIES_VALIDITY_YEARS = 100;

@Injectable()
export class InvoiceNumberGenerator {
  private readonly logger = new Logger(InvoiceNumberGenerator.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly fiscalScope: FiscalScopeService,
    // Llega por `EncryptionModule`, que es @Global. Ver la precondición de
    // `sales_invoice` más abajo: sin esto la puerta valida una columna y la
    // emisión hashea otra.
    private readonly technicalKeyVault: TechnicalKeyVaultService,
  ) {}

  /**
   * Atomically generates the next invoice number within the active resolution.
   * Uses a database-level atomic increment to prevent race conditions.
   */
  async generateNextNumber(resolution_id?: number): Promise<{
    invoice_number: string;
    resolution_id: number;
  }>;
  async generateNextNumber(options?: GenerateNextNumberOptions): Promise<{
    invoice_number: string;
    resolution_id: number;
  }>;
  async generateNextNumber(options?: GenerateNextNumberOptions): Promise<{
    invoice_number: string;
    resolution_id: number;
  }> {
    const normalized =
      typeof options === 'number'
        ? { resolution_id: options }
        : options || {};
    const context = RequestContextService.getContext();
    const organization_id =
      normalized.organization_id ?? context?.organization_id;
    const store_id = normalized.store_id ?? context?.store_id ?? null;
    const document_type = normalized.document_type ?? 'sales_invoice';

    if (!organization_id) {
      throw new Error('Organization context is required for fiscal numbering');
    }

    const accounting_entity_id =
      normalized.accounting_entity_id ??
      (
        await this.fiscalScope.resolveAccountingEntityForFiscal({
          organization_id,
          store_id,
        })
      ).id;

    const client = this.prisma.withoutScope();
    const updated = await client.$transaction(async (tx: any) => {
      const lockKey = `invoice_resolution:${accounting_entity_id}:${document_type}`;
      // pg_advisory_xact_lock returns void — must use $executeRaw, not $queryRaw.
      // Prisma's driver adapter (7.4.1) cannot map a `void` result column and
      // throws P2010 UnsupportedNativeDataType when this runs through $queryRaw.
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        lockKey,
      );

      const where = {
        accounting_entity_id,
        document_type,
        is_active: true,
        valid_from: { lte: new Date() },
        valid_to: { gte: new Date() },
        ...(normalized.resolution_id && { id: normalized.resolution_id }),
      };

      const resolution =
        (await tx.invoice_resolutions.findFirst({
          where,
          orderBy: { created_at: 'desc' },
        })) ??
        (await this.provisionInternalSeries(tx, {
          accounting_entity_id,
          organization_id,
          document_type,
          // Si el llamador nombró una resolución concreta y no apareció, el
          // problema es ESA fila —borrada, inactiva o vencida—, no la ausencia
          // de serie. Fabricar otra ignoraría en silencio lo que pidió.
          requested_resolution_id: normalized.resolution_id,
        }));

      if (!resolution) {
        const { label } = requirementsFor(document_type);
        throw new VendixHttpException(
          ErrorCodes.FISCAL_RESOLUTION_MISSING,
          `No hay una resolución de numeración vigente para «${label}». ` +
            'Este documento se numera contra una Autorización de Numeración de la DIAN, así que su rango no se puede ' +
            'crear ni ampliar automáticamente: solicítala en MUISCA y regístrala en Facturación → Resoluciones. ' +
            'No se asignó numeración.',
          { document_type, document_label: label, accounting_entity_id },
        );
      }

      // PRECONDICIÓN DE LA FACTURA DE VENTA — clave técnica utilizable.
      //
      // ESTE es el punto exacto donde todavía no se ha gastado nada: el lock ya
      // serializa la asignación y el `updateMany` de abajo aún no ha movido
      // `current_number`. Un consecutivo autorizado es irrecuperable, así que
      // cualquier condición que vaya a hacer que la DIAN rechace el documento
      // tiene que fallar ANTES de consumirlo.
      //
      // Solo `sales_invoice`: su CUFE lleva la ClTec como 14º campo del hash. En
      // los demás tipos ese campo es el Software-PIN (ver
      // `fiscal-document-requirements.ts`), y exigirles ClTec bloquearía notas y
      // documentos equivalentes que legítimamente no la tienen.
      //
      // El caso real: una ClTec de 38 caracteres guardada sin que nadie mirara
      // su forma. El XML salió perfecto —la ClTec no viaja en él—, la DIAN
      // recomputó el CUFE con la verdadera y respondió «Valor del CUFE no está
      // calculado correctamente». El número ya estaba quemado.
      //
      // Se valida por la BÓVEDA, no por la columna plana. La ClTec vive en tres
      // columnas y `reveal()` PREFIERE la cifrada; leer aquí `technical_key` a
      // secas comprobaba la forma de una clave que puede no ser la que después
      // se hashea. Una fila con la plana corregida y la cifrada rancia pasaba
      // esta puerta con 40 hex impecables y firmaba el CUFE con la vieja — el
      // mismo rechazo por «CUFE mal calculado», sólo que ahora con un validador
      // dando el visto bueno. Validar exactamente lo que se va a hashear es la
      // única versión de esta comprobación que sirve para algo.
      if (document_type === 'sales_invoice') {
        const technical_key = normalizeTechnicalKey(
          this.technicalKeyVault.reveal(resolution),
        );
        if (!isWellFormedTechnicalKey(technical_key)) {
          throw new VendixHttpException(
            ErrorCodes.INVOICING_RESOLUTION_011,
            `La resolución ${resolution.prefix}${resolution.resolution_number} no tiene una clave técnica (ClTec) utilizable: ` +
              `${technical_key.length === 0 ? 'está vacía' : `tiene ${technical_key.length} caracteres`} y la DIAN la emite de ` +
              `${TECHNICAL_KEY_LENGTHS_LABEL} en hexadecimal. Corrígela en Facturación → Resoluciones copiándola del PDF de la Autorización ` +
              'de Numeración antes de emitir: con una clave equivocada la DIAN rechaza la factura por CUFE mal calculado y el ' +
              'consecutivo autorizado que gasta no se recupera. No se asignó numeración.',
            {
              resolution_id: resolution.id,
              document_type,
              technical_key_length: technical_key.length,
              expected_lengths: [...TECHNICAL_KEY_LENGTHS],
            },
          );
        }
      }

      // The cursor must never sit below the authorized floor. A blind
      // `increment: 1` on a resolution whose `current_number` drifted to 0 emits
      // numbers starting at 1 — outside the range the DIAN authorized — and the
      // DIAN rejects every single one of them. Flooring here (under the advisory
      // lock that already serializes allocation) makes the first number of a
      // pristine or drifted resolution be exactly `range_from`.
      const floor = resolution.range_from - 1;
      const cursor =
        resolution.current_number < floor ? floor : resolution.current_number;

      if (cursor !== resolution.current_number) {
        this.logger.warn(
          `Resolution #${resolution.id} cursor ${resolution.current_number} was below its authorized floor ${floor}; ` +
            `allocating from ${resolution.range_from} instead of emitting out-of-range numbering`,
        );
      }

      const allocate = (ceiling: number) =>
        tx.invoice_resolutions.updateMany({
          where: {
            id: resolution.id,
            current_number: { lt: ceiling },
          },
          // Absolute assignment rather than `increment`, because the floored value
          // is what must land. Safe under the advisory lock: no concurrent
          // allocation can slip between the read and this write.
          data: {
            current_number: cursor + 1,
          },
        });

      let result = await allocate(resolution.range_to);

      // AGOTAR UNA SERIE INTERNA NO PUEDE BLOQUEAR.
      //
      // Un rango DIAN agotado SÍ tiene que parar en seco: seguir numerando fuera
      // de él produce documentos que la DIAN rechaza uno por uno. Pero el rango
      // de una nota lo pusimos nosotros —el comerciante nunca lo pidió, ni pudo
      // dimensionarlo—, así que dejar que impida corregir una factura es un
      // bloqueo autoinfligido sin nada detrás que lo justifique.
      //
      // Se amplía y se reintenta UNA vez. Un segundo fallo ya no es agotamiento
      // —el techo acaba de subir— sino contención o una fila corrupta, y taparlo
      // con un bucle escondería el defecto real detrás de numeración quemada.
      const extendable = internalSeriesPrefixFor(document_type) !== null;

      // El techo VIGENTE, que deja de ser `resolution.range_to` en cuanto se
      // amplía. Se lleva aparte porque si el reintento tampoco asigna, el error
      // de abajo tiene que decir contra qué rango se midió: reportar el viejo
      // describiría un agotamiento que ya no existe y mandaría a quien lea la
      // traza a ampliar un rango que acaba de crecer.
      let ceiling = resolution.range_to;

      if (result.count !== 1 && extendable) {
        const extended_to = Math.min(
          ceiling + INTERNAL_SERIES_BLOCK,
          RANGE_BOUND,
        );

        if (extended_to > ceiling) {
          await tx.invoice_resolutions.update({
            where: { id: resolution.id },
            data: { range_to: extended_to },
          });

          this.logger.log(
            `Internal series #${resolution.id} (${document_type}) exhausted at ${ceiling}; ` +
              `extended to ${extended_to} instead of blocking`,
          );

          ceiling = extended_to;
          result = await allocate(ceiling);
        }
      }

      if (result.count !== 1) {
        const { label } = requirementsFor(document_type);
        throw new VendixHttpException(
          ErrorCodes.FISCAL_RESOLUTION_EXHAUSTED,
          extendable
            ? `La serie interna de «${label}» (${resolution.prefix}) no admitió el siguiente consecutivo ni después de ampliarla. ` +
                'No se asignó numeración.'
            : `La resolución ${resolution.prefix}${resolution.resolution_number} agotó su rango autorizado ` +
                `(${resolution.range_from}-${ceiling}). Solicita un rango nuevo en MUISCA y regístralo en ` +
                'Facturación → Resoluciones: numerar fuera del rango autorizado hace que la DIAN rechace el documento. ' +
                'No se asignó numeración.',
          {
            resolution_id: resolution.id,
            document_type,
            document_label: label,
            range_from: resolution.range_from,
            range_to: ceiling,
          },
        );
      }

      return tx.invoice_resolutions.findUnique({
        where: { id: resolution.id },
      });
    });

    if (!updated) {
      // Defensivo: la fila acaba de aceptar el `updateMany` dentro de la misma
      // transacción, así que llegar aquí significa que desapareció entre medias.
      throw new VendixHttpException(
        ErrorCodes.FISCAL_RESOLUTION_MISSING,
        `La resolución de «${requirementsFor(document_type).label}» dejó de existir mientras se le asignaba el ` +
          'consecutivo. No se asignó numeración; vuelve a intentarlo.',
        { document_type },
      );
    }

    const next_number = updated.current_number;
    const invoice_number = `${updated.prefix}${next_number}`;

    this.logger.log(
      `Generated ${document_type} number: ${invoice_number} (resolution #${updated.id})`,
    );

    return {
      invoice_number,
      resolution_id: updated.id,
    };
  }

  /**
   * Da de alta —o revive— la serie interna de un documento cuya numeración no
   * autoriza la DIAN. Devuelve `null` cuando el tipo no la admite.
   *
   * ## Por qué existe
   *
   * `invoice_resolutions` es el cursor de TODO documento, pero solo la mitad de
   * los tipos tiene detrás un acto administrativo que obligue a darlo de alta a
   * mano. Las notas no: la DIAN no emite Autorización de Numeración para ellas
   * (Oficio 346 de 2018) y su consecutivo es interno del emisor. Aun así el
   * generador exigía la fila igual, nadie la creaba —no hay seed, y la pantalla
   * de resoluciones pide datos de una autorización que para una nota no
   * existe— y el resultado era que ninguna factura se podía corregir. El
   * bloqueo no protegía nada: solo faltaba un contador que podíamos poner.
   *
   * ## Por qué revive en vez de crear siempre
   *
   * La búsqueda de arriba filtra por `is_active` y por vigencia. Una serie
   * interna desactivada o con `valid_to` pasado no aparece, y crear entonces una
   * fila nueva con el MISMO prefijo reiniciaría el consecutivo en 1 y emitiría
   * `NC1` por segunda vez. Dos documentos fiscales con el mismo número es un
   * daño peor que el bloqueo que estamos quitando, así que la búsqueda de
   * reutilización se hace SIN esos dos filtros y solo se crea si de verdad no
   * hay nada.
   *
   * Corre dentro del `pg_advisory_xact_lock` del llamador, que ya serializa por
   * `(accounting_entity_id, document_type)`: dos notas simultáneas de una
   * entidad recién estrenada no pueden crear dos filas.
   *
   * `store_id` queda en `null` a propósito: la búsqueda de consecutivo no filtra
   * por tienda, así que la serie pertenece a la entidad contable. Sellarla a una
   * tienda le daría a cada una su propio contador y volvería a numerar `NC1` dos
   * veces dentro del mismo NIT.
   */
  private async provisionInternalSeries(
    tx: any,
    params: {
      accounting_entity_id: number;
      organization_id: number;
      document_type: FiscalDocumentType;
      requested_resolution_id?: number;
    },
  ): Promise<any | null> {
    const {
      accounting_entity_id,
      organization_id,
      document_type,
      requested_resolution_id,
    } = params;

    if (requested_resolution_id) return null;

    const prefix = internalSeriesPrefixFor(document_type);
    if (!prefix) return null;

    const now = new Date();
    const valid_to = new Date(now);
    valid_to.setFullYear(valid_to.getFullYear() + INTERNAL_SERIES_VALIDITY_YEARS);

    const dormant = await tx.invoice_resolutions.findFirst({
      where: { accounting_entity_id, document_type },
      orderBy: { created_at: 'desc' },
    });

    if (dormant) {
      this.logger.warn(
        `Internal series #${dormant.id} (${document_type}) was inactive or expired; reactivating instead of ` +
          `opening a second one, which would re-issue ${dormant.prefix}${dormant.range_from}`,
      );

      return tx.invoice_resolutions.update({
        where: { id: dormant.id },
        data: { is_active: true, valid_from: now, valid_to },
      });
    }

    const created = await tx.invoice_resolutions.create({
      data: {
        organization_id,
        store_id: null,
        accounting_entity_id,
        document_type,
        // Rótulo interno, no una autorización. Misma convención que
        // `ResolutionsService.resolveResolutionNumber`, que la eligió por lo
        // mismo: la columna es NOT NULL y no hay número DIAN que poner.
        resolution_number: `INTERNA-${prefix}`,
        resolution_date: now,
        prefix,
        range_from: 1,
        range_to: INTERNAL_SERIES_BLOCK,
        current_number: 0,
        valid_from: now,
        valid_to,
        is_active: true,
        // Sin ClTec: `accepts_technical_key: false`. Escribirle una haría que
        // `invoice-flow.service.ts` la inyectara y el CUDE se firmara con la
        // clave equivocada en vez de con el Software-PIN.
        technical_key: null,
      },
    });

    this.logger.log(
      `Opened internal series ${prefix}1-${INTERNAL_SERIES_BLOCK} for ${document_type} ` +
        `(resolution #${created.id}, accounting entity ${accounting_entity_id})`,
    );

    return created;
  }
}
