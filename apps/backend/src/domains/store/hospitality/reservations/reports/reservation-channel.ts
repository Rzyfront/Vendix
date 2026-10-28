import { Prisma } from '@prisma/client';

/**
 * Hospitality Suite (H7.4) — sales channel of a reservation, derived from how
 * it was created: a booking from the own web engine (H6.6) starts as a
 * `tentative` hold; anything else was entered by the hotel staff. A future
 * channel (OTA, Vexi) adds its value here and its rule in `channelWhere`.
 */
export const LODGING_CHANNELS = ['front_desk', 'web'] as const;
export type LodgingChannel = (typeof LODGING_CHANNELS)[number];

export const LODGING_CHANNEL_LABELS: Record<LodgingChannel, string> = {
  front_desk: 'Recepción',
  web: 'Motor web',
};

/** The creation event of a web booking (no previous status, a hold). */
const WEB_CREATION = { from_status: null, to_status: 'tentative' } as const;

/** Reservation filter for one channel. */
export function channelWhere(channel: LodgingChannel): Prisma.lodging_reservationsWhereInput {
  return channel === 'web' ? { events: { some: WEB_CREATION } } : { events: { none: WEB_CREATION } };
}

/** Channel from the creation event of the reservation (select `events` with `from_status: null`). */
export function channelOf(creation: { to_status: string } | undefined): LodgingChannel {
  return creation?.to_status === WEB_CREATION.to_status ? 'web' : 'front_desk';
}
