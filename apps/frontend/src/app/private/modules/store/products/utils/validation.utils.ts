import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { CreateProductDto, UpdateProductDto } from '../interfaces';

export class ValidationUtils {
  /**
   * Validate SKU format
   */
  static skuValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const skuPattern = /^[A-Z0-9-_]+$/;
      return skuPattern.test(control.value) ? null : { invalidSku: true };
    };
  }

  /**
   * Validate price (positive number)
   */
  static priceValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      if (value === null || value === undefined) return null;

      const numValue = Number(value);
      return numValue > 0 ? null : { invalidPrice: true };
    };
  }

  /**
   * Validate stock quantity (non-negative integer)
   */
  static stockValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      if (value === null || value === undefined) return null;

      const numValue = Number(value);
      return Number.isInteger(numValue) && numValue >= 0
        ? null
        : { invalidStock: true };
    };
  }

  /**
   * Validate product name
   */
  static productNameValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return { required: true };

      const name = control.value.trim();
      return name.length >= 1 && name.length <= 255
        ? null
        : { invalidProductName: true };
    };
  }

  /**
   * Validate slug format
   */
  static slugValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const slugPattern = /^[a-z0-9-]+$/;
      return slugPattern.test(control.value) ? null : { invalidSlug: true };
    };
  }

  /**
   * Validate create product DTO
   */
  static validateCreateProduct(data: CreateProductDto): string[] {
    const errors: string[] = [];

    if (!data.name || data.name.trim().length === 0) {
      errors.push('Product name is required');
    }

    if (!data.base_price || data.base_price <= 0) {
      errors.push('Base price must be greater than 0');
    }

    if (data.stock_quantity !== undefined && data.stock_quantity < 0) {
      errors.push('Stock quantity cannot be negative');
    }

    if (data.sku && !/^[A-Z0-9-_]+$/.test(data.sku)) {
      errors.push(
        'SKU must contain only uppercase letters, numbers, hyphens, and underscores',
      );
    }

    return errors;
  }

  /**
   * Validate update product DTO
   */
  static validateUpdateProduct(data: UpdateProductDto): string[] {
    const errors: string[] = [];

    if (
      data.name !== undefined &&
      (data.name.trim().length === 0 || data.name.length > 255)
    ) {
      errors.push('Product name must be between 1 and 255 characters');
    }

    if (data.base_price !== undefined && data.base_price <= 0) {
      errors.push('Base price must be greater than 0');
    }

    if (data.stock_quantity !== undefined && data.stock_quantity < 0) {
      errors.push('Stock quantity cannot be negative');
    }

    if (data.sku && !/^[A-Z0-9-_]+$/.test(data.sku)) {
      errors.push(
        'SKU must contain only uppercase letters, numbers, hyphens, and underscores',
      );
    }

    return errors;
  }
}
