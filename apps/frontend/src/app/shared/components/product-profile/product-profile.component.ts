import { Component, computed, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { BadgeComponent } from '../badge/badge.component';
import { CurrencyPipe } from '../../pipes/currency/currency.pipe';
import {
  ProductProfileImage,
  ProductProfileIngredient,
  ProductProfileProduct,
  ProductProfileRecipe,
  ProductProfileVariant,
} from './product-profile.interface';

/**
 * Ficha de producto/receta: la "vista de perfil" que comparten recetas,
 * fórmulas, producción y KDS.
 *
 * Reglas de diseño (pedido de Rafael, 2026-10-29):
 * - **Compacta y densa**: la información se toca, no se separa con paddings
 *   grandes. Nada de `p-6`/`space-y-6`; todo en `gap-2`/`p-3` como máximo.
 * - Solo tokens de Soft UI (cero hex, cero valores arbitrarios).
 * - La foto manda: si no hay imagen, placeholder neutro con icono (nunca un
 *   hueco roto ni un `<img>` sin `alt`).
 * - Lectura, no edición: este componente nunca renderiza inputs.
 */
@Component({
  selector: 'app-product-profile',
  standalone: true,
  imports: [IconComponent, BadgeComponent, CurrencyPipe],
  templateUrl: './product-profile.component.html',
})
export class ProductProfileComponent {
  readonly product = input.required<ProductProfileProduct>();
  readonly variant = input<ProductProfileVariant | null>(null);
  readonly recipe = input<ProductProfileRecipe | null>(null);
  /** KDS y rol cocina: false oculta toda cifra de dinero. */
  readonly showMoney = input<boolean>(true);

  /** Foto principal: `image_url` resuelta > `is_main` > primera de la galería > foto de la variante. */
  readonly mainImage = computed<string | null>(() => {
    const product = this.product();
    if (product.image_url) return product.image_url;
    const images = this.sortedImages(product.product_images);
    if (images.length > 0) return images[0].image_url;
    return this.variantImageUrl();
  });

  /** Resto de fotos, sin repetir la principal. */
  readonly gallery = computed<ProductProfileImage[]>(() => {
    const main = this.mainImage();
    return this.sortedImages(this.product().product_images).filter(
      (img) => img.image_url !== main,
    );
  });

  /** Precio de venta ya normalizado a número (el pipe `currency` no acepta strings). */
  readonly price = computed<number | null>(() => {
    const raw = this.product().base_price;
    if (raw === null || raw === undefined) return null;
    const num = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(num) ? num : null;
  });

  readonly variantLabel = computed<string | null>(() => {
    const variant = this.variant();
    if (!variant) return null;
    const name = variant.name?.trim();
    if (name) return name;
    const sku = variant.sku?.trim();
    return sku ? `Variante ${sku}` : null;
  });

  readonly metaChips = computed<{ icon: string; label: string }[]>(() => {
    const product = this.product();
    const chips: { icon: string; label: string }[] = [];
    const prep = product.preparation_time_minutes;
    if (prep && prep > 0) chips.push({ icon: 'clock', label: `${prep} min` });
    const unit = product.stock_unit?.trim();
    if (unit) chips.push({ icon: 'scale', label: unit });
    const sku = product.sku?.trim();
    if (sku) chips.push({ icon: 'tag', label: sku });
    return chips;
  });

  readonly recipeTotals = computed<{ label: string; value: string }[]>(() => {
    const recipe = this.recipe();
    if (!recipe) return [];
    const totals: { label: string; value: string }[] = [
      {
        label: 'Rendimiento',
        value: `${this.formatQty(recipe.yield_quantity)} ${recipe.yield_unit}`,
      },
    ];
    const waste = this.toNumber(recipe.waste_percent);
    if (waste > 0) totals.push({ label: 'Merma', value: `${this.formatQty(waste)}%` });
    return totals;
  });

  readonly ingredients = computed<
    (ProductProfileIngredient & { image: string | null })[]
  >(() => {
    const recipe = this.recipe();
    if (!recipe?.items?.length) return [];
    return recipe.items.map((item) => ({
      ...item,
      image: this.ingredientImage(item),
    }));
  });

  quantityLabel(item: ProductProfileIngredient): string {
    const unit = (item.product?.stock_unit ?? item.stock_unit ?? '').trim();
    const qty = this.formatQty(item.quantity);
    return unit ? `${qty} ${unit}` : qty;
  }

  ingredientWasteLabel(item: ProductProfileIngredient): string | null {
    const waste = this.toNumber(item.waste_percent);
    return waste > 0 ? `+${this.formatQty(waste)}% merma` : null;
  }

  ingredientNote(item: ProductProfileIngredient): string | null {
    const note = item.notes?.trim();
    return note ? note : null;
  }

  /** 12.5 → "12.5" · 2.0000 → "2" · nunca "2.0000" */
  formatQty(value: number | string | null | undefined): string {
    const num = this.toNumber(value);
    if (!Number.isFinite(num)) return '0';
    return String(Math.round(num * 10000) / 10000);
  }

  private ingredientImage(item: ProductProfileIngredient): string | null {
    if (item.image_url) return item.image_url;
    const fromProduct = this.sortedImages(item.product?.product_images);
    if (fromProduct.length > 0) return fromProduct[0].image_url;
    const own = this.sortedImages(item.product_images);
    return own.length > 0 ? own[0].image_url : null;
  }

  private variantImageUrl(): string | null {
    const variant = this.variant();
    if (!variant) return null;
    return variant.variant_image_url || variant.product_images?.image_url || null;
  }

  private sortedImages(
    images: ProductProfileImage[] | null | undefined,
  ): ProductProfileImage[] {
    if (!images?.length) return [];
    return [...images].sort((a, b) => {
      const mainDelta = Number(b.is_main ?? false) - Number(a.is_main ?? false);
      if (mainDelta !== 0) return mainDelta;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
  }

  private toNumber(value: number | string | null | undefined): number {
    if (value === null || value === undefined) return 0;
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : 0;
  }
}
