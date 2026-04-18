import { AbstractControl, ValidationErrors, ValidatorFn, FormGroup, FormArray } from '@angular/forms';
import { GeneratedVariant } from '../pages/product-create-page/product-create-page.component';

/**
 * Validator: sale_price must be less than base_price
 */
export function saleLessThanBaseValidator(
  basePriceKey = 'base_price',
  salePriceKey = 'sale_price',
  isOnSaleKey = 'is_on_sale'
): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const group = control as FormGroup;
    const basePrice = Number(group.get(basePriceKey)?.value || 0);
    const salePrice = Number(group.get(salePriceKey)?.value || 0);
    const isOnSale = group.get(isOnSaleKey)?.value;

    if (isOnSale && salePrice > 0 && salePrice >= basePrice) {
      return { saleLessThanBase: { basePrice, salePrice } };
    }
    return null;
  };
}

/**
 * Validator: when price_override is set, it must be explicit (not 0)
 */
export function priceOverrideExplicitValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const group = control as FormGroup;
    const priceOverride = group.get('price_override')?.value;
    const price = group.get('price')?.value;

    // If price_override is explicitly set (not null/undefined) and not 0,
    // it should be different from the base price
    if (priceOverride !== null && priceOverride !== undefined && priceOverride !== '') {
      const numOverride = Number(priceOverride);
      if (numOverride === 0) {
        return { priceOverrideExplicit: true };
      }
    }
    return null;
  };
}

/**
 * Validator: SKU must be unique across all variants
 */
export function uniqueSkuAcrossVariantsValidator(
  getVariants: () => GeneratedVariant[],
  currentVariantKey?: (v: GeneratedVariant) => string
): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const variants = getVariants();
    if (!variants || variants.length === 0) return null;

    const skus = variants
      .map((v) => {
        const sku = v.sku?.trim();
        return currentVariantKey ? currentVariantKey(v) + ':' + sku : sku;
      })
      .filter((s) => s && s.split(':')[1]);

    const uniqueSkus = new Set(skus);
    if (uniqueSkus.size !== skus.length) {
      return { duplicateSku: true };
    }
    return null;
  };
}

/**
 * Validator: variant track_inventory override - if parent track_inventory is false,
 * variant cannot have track_inventory_override = true
 */
export function variantTrackInventoryOverrideValidator(
  parentTrackInventoryKey = 'track_inventory'
): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const group = control as FormGroup;
    const parentTrackInventory = group.get(parentTrackInventoryKey)?.value;
    const variantTrackOverride = group.get('track_inventory_override')?.value;

    // If parent doesn't track inventory, variant cannot override to track
    if (parentTrackInventory === false && variantTrackOverride === true) {
      return { variantTrackInventoryOverride: true };
    }
    return null;
  };
}

/**
 * Validator: services cannot have variants
 */
export function serviceHasNoVariantsValidator(
  productTypeKey = 'product_type',
  hasVariantsKey = 'hasVariants'
): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const group = control as FormGroup;
    const productType = group.get(productTypeKey)?.value;
    const hasVariants = group.get(hasVariantsKey)?.value;

    if (productType === 'service' && hasVariants === true) {
      return { serviceHasNoVariants: true };
    }
    return null;
  };
}

/**
 * Cross-field validator: sale price vs base price for FormGroup
 */
export function salePriceLessThanBasePriceValidator(
  basePriceControl: AbstractControl | null,
  salePriceControl: AbstractControl | null,
  isOnSaleControl: AbstractControl | null
): ValidationErrors | null {
  if (!basePriceControl || !salePriceControl || !isOnSaleControl) {
    return null;
  }

  const basePrice = Number(basePriceControl.value || 0);
  const salePrice = Number(salePriceControl.value || 0);
  const isOnSale = isOnSaleControl.value;

  if (isOnSale && salePrice > 0 && salePrice >= basePrice) {
    return { saleLessThanBase: { basePrice, salePrice } };
  }
  return null;
}

/**
 * FormArray variant validator: validates all variants in array
 */
export function variantsArrayValidator(
  validateVariant: (variant: AbstractControl) => ValidationErrors | null
): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const array = control as FormArray;
    const errors: ValidationErrors[] = [];

    array.controls.forEach((variant, index) => {
      const error = validateVariant(variant);
      if (error) {
        errors.push({ [`variant_${index}`]: error });
      }
    });

    return errors.length > 0 ? { variantsErrors: errors } : null;
  };
}

/**
 * Validate variant SKU uniqueness within FormArray
 */
export function variantSkuUniquenessValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const array = control as FormArray;
    const skus: string[] = [];

    array.controls.forEach((variant) => {
      const sku = (variant as FormGroup).get('sku')?.value?.trim();
      if (sku) skus.push(sku);
    });

    const uniqueSkus = new Set(skus);
    if (uniqueSkus.size !== skus.length) {
      return { duplicateVariantSkus: true };
    }
    return null;
  };
}
