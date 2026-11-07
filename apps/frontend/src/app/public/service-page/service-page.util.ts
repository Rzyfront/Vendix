import { formatDurationUnitShort } from '../../shared/utils/duration-unit.util';
import type { EcommerceProduct } from '../../private/modules/ecommerce/services/catalog.service';

/** A category filter chip of the service list. */
export interface ServiceCategoryChip {
  id: number;
  name: string;
  slug: string;
  count: number;
}

/** What a service card draws; the ecommerce catalog row and the editor's preview both satisfy it. */
export type ServiceCardData = Pick<
  EcommerceProduct,
  | 'id'
  | 'name'
  | 'slug'
  | 'description'
  | 'final_price'
  | 'image_url'
  | 'service_duration_minutes'
  | 'service_duration_unit'
  | 'service_modality'
  | 'requires_booking'
  | 'categories'
>;

type ServiceLike = Pick<EcommerceProduct, 'id' | 'slug' | 'categories' | 'requires_booking'>;

/** Categories of the listed services, in order of first appearance, with counts. */
export function serviceCategories(services: ServiceLike[]): ServiceCategoryChip[] {
  const chips = new Map<number, ServiceCategoryChip>();
  for (const service of services) {
    for (const category of service.categories ?? []) {
      const chip = chips.get(category.id);
      if (chip) chip.count++;
      else chips.set(category.id, { ...category, count: 1 });
    }
  }
  return [...chips.values()];
}

/** Services of one category; `null` = every service. Keeps the page order. */
export function servicesInCategory<T extends ServiceLike>(
  services: T[],
  categoryId: number | null,
): T[] {
  if (categoryId === null) return services;
  return services.filter((s) => (s.categories ?? []).some((c) => c.id === categoryId));
}

/**
 * "45 min", "2 h", "1 día", "1 h 30 min"; `null` when the service has no duration.
 * With an hour or day unit that divides the value evenly it reads in that unit;
 * a null unit keeps the minutes-based form.
 */
export function formatDuration(
  minutes: number | null | undefined,
  unit?: string | null,
): string | null {
  if (!minutes || minutes <= 0) return null;
  if (unit === 'hour' || unit === 'day') return formatDurationUnitShort(minutes, unit);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * Where "Reservar" goes: a bookable service opens the ecommerce booking
 * (`/book/:id`, the same route its product card uses); any other service
 * opens its detail, where it is added to the cart.
 */
export function bookingTarget(service: ServiceLike): (string | number)[] {
  return service.requires_booking ? ['/book', service.id] : ['/products', service.slug];
}
