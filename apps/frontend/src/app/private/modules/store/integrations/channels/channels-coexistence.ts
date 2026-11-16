import type { WhatsappChannel } from './channels.interface';

export const COEXISTENCE_PHONE_LINE =
  'También lo usas en la app WhatsApp Business';
export const COEXISTENCE_DISCONNECT_NOTE =
  'Vendix dejará de enviar y recibir por este número. Para desvincularlo por completo, en la app WhatsApp Business ve a Ajustes → Cuenta → Plataforma empresarial → Desconectar cuenta.';
export const CONNECT_SUCCESS_MESSAGE = 'WhatsApp quedó conectado.';
export const CONNECT_HELP_MESSAGE =
  '¿Ya atiendes por la app WhatsApp Business? Puedes conectar ese mismo número sin borrar tu cuenta: Meta te pedirá confirmarlo desde la app (versión 2.24.17 o superior). Si es un WhatsApp personal, primero pásalo a WhatsApp Business. Ten el celular a mano.';

type ChannelView = Pick<
  WhatsappChannel,
  'status' | 'phone_number_id' | 'registration_status' | 'coexistence'
>;

/** True when the number is shared with the WhatsApp Business app. */
export function isCoexistenceChannel(
  channel: Pick<WhatsappChannel, 'coexistence'> | null | undefined,
): boolean {
  return channel?.coexistence?.enabled === true;
}

/** A number in coexistence is already registered: it never needs registration. */
export function registrationNotRequired(
  channel: Pick<WhatsappChannel, 'registration_status'> | null | undefined,
): boolean {
  return channel?.registration_status === 'not_required';
}

/** Whether the «Falta registrar el número» banner applies. */
export function needsRegistrationNotice(
  channel: ChannelView | null | undefined,
): boolean {
  return Boolean(
    channel &&
    channel.status === 'connected' &&
    channel.phone_number_id &&
    channel.registration_status !== 'registered' &&
    !registrationNotRequired(channel),
  );
}

/** Whether the «Reintentar registro» button applies (ignoring in-flight state). */
export function allowsRegistrationRetry(
  channel: ChannelView | null | undefined,
): boolean {
  return Boolean(
    channel &&
    channel.status !== 'disconnected' &&
    channel.phone_number_id &&
    channel.registration_status !== 'registered' &&
    !registrationNotRequired(channel),
  );
}

/** Toast after a successful connect: coexistence never says «falta registrar». */
export function connectedOutcome(
  channel: Pick<
    WhatsappChannel,
    'status' | 'last_error' | 'registration_status'
  >,
): { kind: 'success'; message: string } | { kind: 'error'; message: string } {
  if (channel.status === 'error' && !registrationNotRequired(channel)) {
    return {
      kind: 'error',
      message:
        channel.last_error ||
        'WhatsApp quedó conectado, pero falta registrar el número.',
    };
  }
  return { kind: 'success', message: CONNECT_SUCCESS_MESSAGE };
}

/**
 * Reason shown above the card: the error of a failed channel, or why Meta
 * disconnected it (a disconnect from Vendix stores no reason).
 */
export function channelAlertMessage(
  channel: Pick<WhatsappChannel, 'status' | 'last_error'> | null | undefined,
): string | null {
  if (!channel?.last_error) return null;
  return channel.status === 'error' || channel.status === 'disconnected'
    ? channel.last_error
    : null;
}
