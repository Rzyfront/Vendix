import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { TechnicalKeyVaultService } from '@common/services/technical-key-vault.service';
import {
  isWellFormedTechnicalKey,
  normalizeTechnicalKey,
  TECHNICAL_KEY_LENGTHS,
  TECHNICAL_KEY_LENGTHS_LABEL,
} from '../fiscal-document-requirements';

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

      const resolution = await tx.invoice_resolutions.findFirst({
        where,
        orderBy: { created_at: 'desc' },
      });

      if (!resolution) {
        throw new VendixHttpException(ErrorCodes.FISCAL_RESOLUTION_MISSING);
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

      const result = await tx.invoice_resolutions.updateMany({
        where: {
          id: resolution.id,
          current_number: { lt: resolution.range_to },
        },
        // Absolute assignment rather than `increment`, because the floored value
        // is what must land. Safe under the advisory lock: no concurrent
        // allocation can slip between the read and this write.
        data: {
          current_number: cursor + 1,
        },
      });

      if (result.count !== 1) {
        throw new VendixHttpException(ErrorCodes.FISCAL_RESOLUTION_EXHAUSTED);
      }

      return tx.invoice_resolutions.findUnique({
        where: { id: resolution.id },
      });
    });

    if (!updated) {
      throw new VendixHttpException(ErrorCodes.FISCAL_RESOLUTION_MISSING);
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
}
