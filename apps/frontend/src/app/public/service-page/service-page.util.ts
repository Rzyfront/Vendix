import type { EcommerceProduct } from '../../private/modules/ecommerce/services/catalog.service';

/** A category filter chip of the service list. */
export interface ServiceCategoryChip {
  id: number;
  name: string;
  slug: string;
  count: number;
}

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

/** "45 min", "1 h", "1 h 30 min"; `null` when the service has no duration. */
export function formatDuration(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
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
