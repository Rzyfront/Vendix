import { blockStrings, blockText } from './app-page-view.util';

/**
 * Apps booking-detail — the hotel's real stay data the server sends
 * (`stay_facts`, same shape in the editor preview and on the public page).
 * The owner only chooses what to show; none of it is typed by hand.
 */
export interface AppStayFacts {
  check_in?: string | null;
  check_out?: string | null;
  cancellation?: string | null;
  max_guests?: number | null;
  deposit_percent?: number | null;
  has_photos?: boolean;
  has_availability?: boolean;
}

export interface StayDetailPart {
  key: 'duration' | 'capacity' | 'inclusions' | 'cancellation' | 'deposit' | 'note';
  label: string;
  icon: string;
  text: string;
  /** Only «Qué incluye»: one entry per item. */
  items?: string[];
}

/** A switch with its default when absent (old documents keep their look). */
function flag(props: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = props[key];
  return typeof value === 'boolean' ? value : fallback;
}

/** "Desde las 3:00 p. m." → "desde las 3:00 p. m.". */
function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * What the `stay_detail` block shows, in order: stay times, capacity, what is
 * included, cancellation, deposit and the note. A part whose datum is missing
 * is left out; an empty list means the block is not drawn at all.
 */
export function stayDetailParts(props: Record<string, unknown>, facts: AppStayFacts | null): StayDetailPart[] {
  const parts: StayDetailPart[] = [];
  const f = facts ?? {};

  if (flag(props, 'show_duration', true)) {
    const times = [
      f.check_in ? `entrada ${lowerFirst(f.check_in)}` : '',
      f.check_out ? `salida ${lowerFirst(f.check_out)}` : '',
    ].filter(Boolean);
    if (times.length) {
      parts.push({ key: 'duration', label: 'Duración', icon: 'clock', text: `Por noches: ${times.join(' · ')}.` });
    }
  }
  if (flag(props, 'show_capacity', true) && typeof f.max_guests === 'number' && f.max_guests > 0) {
    parts.push({
      key: 'capacity',
      label: 'Capacidad',
      icon: 'users',
      text: `Hasta ${f.max_guests} ${f.max_guests === 1 ? 'huésped' : 'huéspedes'} por habitación.`,
    });
  }
  if (flag(props, 'show_inclusions', true)) {
    const items = blockStrings(props, 'inclusions');
    if (items.length) parts.push({ key: 'inclusions', label: 'Qué incluye', icon: 'check', text: items.join(', '), items });
  }
  if (flag(props, 'show_cancellation', true) && f.cancellation) {
    parts.push({ key: 'cancellation', label: 'Cancelación', icon: 'shield-check', text: f.cancellation });
  }
  if (flag(props, 'show_deposit', false) && typeof f.deposit_percent === 'number' && f.deposit_percent > 0) {
    parts.push({
      key: 'deposit',
      label: 'Anticipo',
      icon: 'wallet',
      text: `Al reservar se paga un anticipo del ${f.deposit_percent} % del valor de la estadía.`,
    });
  }
  if (flag(props, 'show_note', false)) {
    const note = blockText(props, 'note');
    if (note) parts.push({ key: 'note', label: 'Nota', icon: 'info', text: note });
  }
  return parts;
}
