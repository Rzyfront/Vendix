import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  PLATFORM_FISCAL_SETTINGS_KEY,
  VENDOR_SUPPORT_FISCAL_SETTINGS_KEY,
} from '../../../../common/constants/platform-fiscal.constants';
import {
  requirementsFor,
  type FiscalDocumentType,
} from '../fiscal-document-requirements';
import { buildInternalSeriesDefaults } from './invoice-number-generator';
import {
  findActiveResolution,
  isSingleActiveDocumentType,
  lockResolutionSeries,
} from './resolution-selection.util';

/**
 * Archivado lógico de resoluciones (`invoice_resolutions.archived_at`).
 * Puro: sin Nest. `client` = `tx` o prisma `withoutScope()`. Nunca hay borrado
 * físico: archivar es `is_active=false` + `archived_at` + `archived_by_user_id`,
 * y la fila SIGUE ocupando su prefijo en los únicos parciales.
 */

/** Estados de `fiscal_transmission_status_enum` que aún tienen trabajo pendiente. */
export const IN_FLIGHT_TRANSMISSION_STATUSES = [
  'queued',
  'signing',
  'signed',
  'submitted',
  'retrying',
  'contingency',
] as const;

/** Forma admitida del prefijo de una serie de reemplazo. */
export const REPLACEMENT_PREFIX_PATTERN = /^[A-Z0-9]{1,10}$/;

export interface ArchivableResolution {
  id: number;
  accounting_entity_id: number;
  document_type: FiscalDocumentType | string;
  is_active: boolean;
  archived_at: Date | null;
}

/**
 * Lanza si la resolución no puede archivarse. Devuelve `requires_replacement`
 * cuando es la serie de notas en uso y se indicó un prefijo de reemplazo.
 */
export async function assertResolutionArchivable(
  client: any,
  resolution: ArchivableResolution,
  opts: { now: Date; replacement_prefix?: string | null },
): Promise<{ requires_replacement: boolean }> {
  const { id, accounting_entity_id } = resolution;
  const document_type = resolution.document_type as FiscalDocumentType;

  // a. Ya archivada.
  if (resolution.archived_at) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_RESOLUTION_016,
      'Esta resolución ya está archivada y es de solo lectura.',
      { resolution_id: id },
    );
  }

  // b. Documentos en vuelo (por transmitir o en cola de reintentos).
  const [in_flight_invoices, pending_retries] = await Promise.all([
    client.invoices.count({
      where: {
        resolution_id: id,
        transmission_status: { in: [...IN_FLIGHT_TRANSMISSION_STATUSES] },
      },
    }),
    client.invoice_retry_queue.count({
      where: { status: 'pending', invoice: { resolution_id: id } },
    }),
  ]);
  if (in_flight_invoices + pending_retries > 0) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_RESOLUTION_012,
      'No se puede archivar: la resolución tiene documentos pendientes de transmitir o en cola de reintentos. ' +
        'Espera a que terminen o resuélvelos y vuelve a intentarlo.',
      {
        resolution_id: id,
        in_flight_invoices,
        pending_retries,
      },
    );
  }

  // c. Cableada a la configuración fiscal de la plataforma.
  const settings: Array<{ key: string; value: any }> =
    await client.platform_settings.findMany({
      where: {
        key: {
          in: [PLATFORM_FISCAL_SETTINGS_KEY, VENDOR_SUPPORT_FISCAL_SETTINGS_KEY],
        },
      },
    });
  const wired = settings.filter((s) => s?.value?.invoice_resolution_id === id);
  if (wired.length > 0) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_RESOLUTION_013,
      'No se puede archivar: la resolución está asignada a la facturación fiscal de la plataforma. ' +
        'Cambia la resolución en esa configuración y vuelve a intentarlo.',
      { resolution_id: id, platform_settings_keys: wired.map((s) => s.key) },
    );
  }

  // d. Set de pruebas DIAN en curso sobre el mismo eje de habilitación.
  const testing_configurations: number = await client.dian_configurations.count(
    {
      where: {
        accounting_entity_id,
        configuration_type: requirementsFor(document_type).configuration_type,
        enablement_status: 'testing',
      },
    },
  );
  if (testing_configurations > 0) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_RESOLUTION_014,
      'No se puede archivar: hay un set de pruebas de la DIAN en curso para este tipo de documento. ' +
        'Termínalo antes de archivar la resolución.',
      { resolution_id: id, testing_configurations },
    );
  }

  // e. Serie de notas en uso: exige una serie de reemplazo.
  if (isSingleActiveDocumentType(document_type)) {
    const in_use = await findActiveResolution(client, {
      accounting_entity_id,
      document_type,
      now: opts.now,
    });
    if (in_use?.id === id) {
      const other_active: number = await client.invoice_resolutions.count({
        where: {
          accounting_entity_id,
          document_type,
          is_active: true,
          archived_at: null,
          id: { not: id },
        },
      });
      if (other_active === 0) {
        if (!opts.replacement_prefix?.trim()) {
          throw new VendixHttpException(
            ErrorCodes.INVOICING_RESOLUTION_015,
            'Esta es la serie de notas en uso. Para archivarla indica el prefijo de la serie nueva que la reemplaza.',
            { resolution_id: id },
          );
        }
        return { requires_replacement: true };
      }
    }
  }

  return { requires_replacement: false };
}

/**
 * Archiva la resolución dentro de `tx`, bajo el advisory lock de la serie. Si
 * era la serie de notas en uso, abre en la misma transacción la serie de
 * reemplazo. El prefijo inválido o ya usado lanza `INVOICING_RESOLUTION_015`.
 */
export async function archiveResolutionInTx(
  tx: any,
  params: {
    resolution: ArchivableResolution;
    user_id: number | null;
    now: Date;
    replacement_prefix?: string | null;
    organization_id: number;
  },
): Promise<{ archived: any; replacement: any | null }> {
  const { now, user_id, organization_id } = params;
  const { accounting_entity_id } = params.resolution;
  const document_type = params.resolution.document_type as FiscalDocumentType;

  await lockResolutionSeries(tx, { accounting_entity_id, document_type });

  // Relee dentro del lock: la fila recibida pudo quedar obsoleta.
  const fresh = await tx.invoice_resolutions.findUnique({
    where: { id: params.resolution.id },
  });
  if (!fresh) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_RESOLUTION_016,
      'La resolución ya no existe.',
      { resolution_id: params.resolution.id },
    );
  }

  const { requires_replacement } = await assertResolutionArchivable(
    tx,
    fresh,
    { now, replacement_prefix: params.replacement_prefix },
  );

  // Valida el reemplazo ANTES de escribir: así un fallo no deja nada a medias
  // aunque el llamador no revierta la transacción.
  let replacement_prefix: string | null = null;
  if (requires_replacement) {
    replacement_prefix = params.replacement_prefix!.trim().toUpperCase();
    // 422 sería más preciso para la forma inválida; se reutiliza 015 a propósito.
    if (!REPLACEMENT_PREFIX_PATTERN.test(replacement_prefix)) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_015,
        'El prefijo de la serie nueva debe tener de 1 a 10 caracteres, solo letras y números.',
        { resolution_id: fresh.id, replacement_prefix },
      );
    }
    const taken = await tx.invoice_resolutions.findFirst({
      where: {
        accounting_entity_id,
        document_type,
        prefix: replacement_prefix,
      },
      select: { id: true },
    });
    if (taken) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_015,
        `El prefijo ${replacement_prefix} ya está usado por otra serie; elige uno nuevo.`,
        {
          resolution_id: fresh.id,
          replacement_prefix,
          conflicting_resolution_id: taken.id,
        },
      );
    }
  }

  const archived = await tx.invoice_resolutions.update({
    where: { id: fresh.id },
    data: {
      is_active: false,
      archived_at: now,
      archived_by_user_id: user_id,
    },
  });

  let replacement: any | null = null;
  if (replacement_prefix) {
    const defaults = buildInternalSeriesDefaults(replacement_prefix, now);
    replacement = await tx.invoice_resolutions.create({
      data: {
        organization_id,
        store_id: null,
        accounting_entity_id,
        document_type,
        resolution_number: defaults.resolution_number,
        resolution_date: now,
        prefix: defaults.prefix,
        range_from: defaults.range_from,
        range_to: defaults.range_to,
        current_number: defaults.current_number,
        valid_from: defaults.valid_from,
        valid_to: defaults.valid_to,
        is_active: defaults.is_active,
        technical_key: defaults.technical_key,
      },
    });
  }

  return { archived, replacement };
}
