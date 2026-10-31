import type { BadgeVariant } from '../../../../../../shared/components';
import { EmailChannel, SmsChannel, SmsSpend } from './messaging-channels.interface';

export interface ChannelState {
  label: string;
  variant: BadgeVariant;
}

/** Badge of the SMS card. A failed load wins: the stored state is unknown. */
export function smsChannelState(
  channel: SmsChannel | null,
  loadFailed: boolean,
): ChannelState {
  if (loadFailed) return { label: 'Error', variant: 'error' };
  if (!channel) return { label: 'Sin configurar', variant: 'neutral' };
  if (!channel.enabled) return { label: 'Desactivado', variant: 'neutral' };
  const { limit, remaining } = channel.spend;
  if (limit === null || limit === 0) {
    return { label: 'Pendiente: define un tope', variant: 'warning' };
  }
  if (remaining !== null && remaining <= 0) {
    return { label: 'Tope alcanzado', variant: 'error' };
  }
  return { label: 'Conectado', variant: 'success' };
}

/** Badge of the email card. A failed load wins: the stored state is unknown. */
export function emailChannelState(
  channel: EmailChannel | null,
  loadFailed: boolean,
): ChannelState {
  if (loadFailed) return { label: 'Error', variant: 'error' };
  if (!channel) return { label: 'Sin configurar', variant: 'neutral' };
  return channel.enabled
    ? { label: 'Conectado', variant: 'success' }
    : { label: 'Desactivado', variant: 'neutral' };
}

/** Spend bar width, 0-100. A cap of 0 blocks every SMS, so it reads as full. */
export function smsSpendPercent(spend: SmsSpend | null | undefined): number {
  if (!spend) return 0;
  if (spend.limit === 0) return 100;
  if (!spend.limit) return 0;
  return Math.min(100, Math.round((spend.used / spend.limit) * 100));
}

export function formatUsd(value: number): string {
  return `US$ ${value.toFixed(2)}`;
}
