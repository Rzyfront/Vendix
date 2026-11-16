import type { Prisma } from '@prisma/client';

/**
 * Shared data for turning a WhatsApp (meta_cloud) channel into `disconnected`.
 * Used by the user-initiated disconnect and by the `account_update` webhook so
 * both clear the token the same way.
 */

export interface WhatsappDisconnectionInfo {
  event: string;
  reason?: string | null;
  initiated_by?: string | null;
}

export interface WhatsappDisconnectionRecord extends WhatsappDisconnectionInfo {
  at: string;
}

export interface WhatsappDisconnectOptions {
  now?: Date;
  last_error?: string | null;
  disconnection?: WhatsappDisconnectionRecord;
}

export function buildWhatsappDisconnectData(
  previousMetadata: Record<string, unknown> | null | undefined,
  options: WhatsappDisconnectOptions = {},
) {
  const now = options.now ?? new Date();
  return {
    status: 'disconnected' as const,
    access_token_encrypted: null,
    last_error: options.last_error ?? null,
    disconnected_at: now,
    metadata: {
      ...(previousMetadata ?? {}),
      disconnected_at: now.toISOString(),
      ...(options.disconnection
        ? { disconnection: options.disconnection }
        : {}),
    } as unknown as Prisma.InputJsonObject,
  };
}

export function resolveWhatsappDisconnectionMessage(
  info: WhatsappDisconnectionInfo,
): string {
  if (info.reason === 'PRIMARY_INACTIVITY') {
    return 'Tu WhatsApp Business estuvo inactivo en el celular unos 14 días y se desconectó de Vendix. Vuelve a conectarlo.';
  }
  if (info.event === 'PARTNER_REMOVED' && info.initiated_by === 'USER') {
    return 'Desconectaste Vendix desde la app WhatsApp Business.';
  }
  return 'Tu número se desconectó de Vendix. Vuelve a conectarlo.';
}
