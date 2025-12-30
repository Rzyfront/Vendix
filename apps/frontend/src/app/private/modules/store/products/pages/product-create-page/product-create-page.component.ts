import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router, Params } from '@angular/router';
import {
    FormBuilder,
    FormGroup,
    ReactiveFormsModule,
    FormsModule, // Added FormsModule
    Validators,
    FormControl
} from '@angular/forms';
import {
    ButtonComponent,
    InputComponent,
    ToastService,
    IconComponent,
    SelectorComponent,
    SelectorOption,
    MultiSelectorComponent,
    MultiSelectorOption,
    TextareaComponent,
    ModalComponent,
} from '../../../../../../shared/components';
import {
    CreateProductDto,
    CreateProductImageDto,
    ProductCategory,
    Brand,
    Product,
    ProductState,
} from '../../interfaces';
import { ProductsService } from '../../services/products.service';
import { CategoriesService } from '../../services/categories.service';
import { BrandsService } from '../../services/brands.service';
import { CategoryQuickCreateComponent } from '../../components/category-quick-create.component';
import { BrandQuickCreateComponent } from '../../components/brand-quick-create.component';
import { AdjustmentCreateModalComponent } from '../../../inventory/operations/components/adjustment-create-modal.component';
import { InventoryService } from '../../../inventory/services/inventory.service';
import { CreateAdjustmentDto } from '../../../inventory/interfaces';

interface VariantAttribute {
    name: string;
    values: string[];
}

interface GeneratedVariant {
    sku: string;
    name: string;
    price: number;
    stock: number;
    attributes: Record<string, string>;
}

@Component({
    selector: 'app-product-create-page',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        ReactiveFormsModule,
        FormsModule,
        ButtonComponent,
        InputComponent,
        IconComponent,
        SelectorComponent,
        MultiSelectorComponent,
        TextareaComponent,
        ModalComponent,
        CategoryQuickCreateComponent,
        BrandQuickCreateComponent,
        AdjustmentCreateModalComponent,
    ],
    templateUrl: './product-create-page.component.html',
})
export class ProductCreatePageComponent implements OnInit {
    productForm: FormGroup;
    isSubmitting = false;
    isEditMode = false;
    productId: number | null = null;
    product: Product | null = null;

    imageUrls: string[] = [];
    activeImageIndex = 0;
    isStockDetailsOpen = false;
    categoryOptions: MultiSelectorOption[] = [];
    brandOptions: SelectorOption[] = [];
    taxCategoryOptions: MultiSelectorOption[] = [];
    stateOptions: SelectorOption[] = [
        { value: ProductState.ACTIVE, label: 'Activo' },
        { value: ProductState.INACTIVE, label: 'Inactivo' },
        { value: ProductState.ARCHIVED, label: 'Archivado' },
    ];

    // Variants State
    hasVariants = false;
    variantAttributes: VariantAttribute[] = [];
    generatedVariants: GeneratedVariant[] = [];

    // New Attribute Input
    newAttributeName = '';
    newAttributeValue = '';
    currentAttributeValues: string[] = [];

    // Quick create modals state
    isCategoryCreateOpen = false;
    isBrandCreateOpen = false;
    isAdjustmentModalOpen = false;
    isAdjusting = false;

    constructor(
        private fb: FormBuilder,
        private productsService: ProductsService,
        private categoriesService: CategoriesService,
        private brandsService: BrandsService,
        private toastService: ToastService,
        private router: Router,
        private route: ActivatedRoute,
        private inventoryService: InventoryService
    ) {
        this.productForm = this.createForm();
    }

    ngOnInit(): void {
        this.loadCategoriesAndBrands();

        // Check for ID in route to determine edit mode
        this.route.params.subscribe((params: Params) => {
            if (params['id']) {
                this.productId = +params['id'];
                this.isEditMode = true;
                this.loadProduct(this.productId);
            }
        });
    }

    private createForm(): FormGroup {
        return this.fb.group({
            name: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(255)]],
            slug: ['', [Validators.maxLength(255)]],
            description: [''],
            base_price: [0, [Validators.min(0)]],
            sku: ['', [Validators.maxLength(100)]],
            stock_quantity: [0, [Validators.min(0)]],
            category_ids: [[] as number[]],
            brand_id: [null],
            tax_category_ids: [[] as number[]],
            state: [ProductState.ACTIVE],
        });
    }

    private loadProduct(id: number): void {
        this.productsService.getProductById(id).subscribe({
            next: (product: Product) => {
                this.product = product;
                this.patchForm(product);
            },
            error: (error: any) => {
                console.error('Error loading product:', error);
                this.toastService.error('Error al cargar el producto');
                this.router.navigate(['/admin/products']);
            }
        });
    }

    private patchForm(product: Product): void {
        // Extract category IDs from product_categories
        const categoryIds = (product.product_categories || [])
            .map((pc: any) => pc.category_id)
            .filter(id => id !== undefined);

        // Extract tax category IDs
        const taxCategoryIds = (product.product_tax_assignments || [])
            .map((ta: any) => ta.tax_category_id)
            .filter(id => id !== undefined);

        this.productForm.patchValue({
            name: product.name,
            slug: product.slug,
            description: product.description,
            base_price: product.base_price,
            sku: product.sku,
            stock_quantity: product.stock_quantity,
            category_ids: categoryIds,
            brand_id: product.brand_id,
            tax_category_ids: taxCategoryIds,
            state: product.state,
        });

        // Load images
        if (product.product_images && product.product_images.length > 0) {
            this.imageUrls = product.product_images.map((img: any) => img.image_url);
        }

        // Load variants if present
        if (product.product_variants && product.product_variants.length > 0) {
            this.hasVariants = true;
            this.generatedVariants = product.product_variants.map((v: any) => ({
                sku: v.sku,
                name: v.name || `${product.name} - ${v.sku}`,
                price: v.price_override !== undefined ? Number(v.price_override) : Number(product.base_price),
                stock: v.stock_quantity,
                attributes: v.attributes || {}
            }));

            // Try to reconstruct variantAttributes from variants if possible
            // This is a bit complex without stored attribute definitions
            // For now, we just show the generated variants list
        }
    }

    private loadCategoriesAndBrands(): void {
        this.loadCategories();
        this.loadBrands();
        this.loadTaxCategories();
    }

    private loadCategories(): void {
        this.categoriesService.getCategories().subscribe({
            next: (categories: ProductCategory[]) => {
                this.categoryOptions = categories.map((cat: ProductCategory) => ({
                    value: cat.id,
                    label: cat.name,
                    description: cat.description,
                }));
            },
            error: (error: any) => {
                console.error('Error loading categories:', error);
            },
        });
    }

    private loadTaxCategories(): void {
        // TODO: Create tax categories service and endpoint
        // For now, use placeholder data
        this.taxCategoryOptions = [
            { value: 1, label: 'IVA 19%', description: 'Impuesto al valor agregado' },
            { value: 2, label: 'IVA 5%', description: 'Impuesto reducido' },
            { value: 3, label: 'Exento', description: 'Sin impuesto' },
        ];
    }

    private loadBrands(): void {
        this.brandsService.getBrands().subscribe({
            next: (brands: Brand[]) => {
                this.brandOptions = brands.map((brand: Brand) => ({
                    value: brand.id,
                    label: brand.name,
                    description: brand.description,
                }));
            },
            error: (error: any) => {
                console.error('Error loading brands:', error);
            },
        });
    }

    toggleVariants(event: any): void {
        this.hasVariants = event.target.checked;

        const priceControl = this.productForm.get('base_price');
        const stockControl = this.productForm.get('stock_quantity');

        if (this.hasVariants) {
            priceControl?.clearValidators();
            stockControl?.clearValidators();
            // If switching to variants, maybe we should init with one empty attribute group?
            if (this.variantAttributes.length === 0) {
                this.variantAttributes.push({ name: '', values: [] });
            }
        } else {
            priceControl?.setValidators([Validators.required, Validators.min(0)]);
            stockControl?.setValidators([Validators.min(0)]);
        }
        priceControl?.updateValueAndValidity();
        stockControl?.updateValueAndValidity();
    }

    // Variant Attribute Management
    addAttribute(): void {
        this.variantAttributes.push({ name: '', values: [] });
    }

    removeAttribute(index: number): void {
        this.variantAttributes.splice(index, 1);
        this.generateVariants();
    }

    addAttributeValue(attrIndex: number, event: any): void {
        const value = event.target.value.trim();
        if (value) {
            if (!this.variantAttributes[attrIndex].values.includes(value)) {
                this.variantAttributes[attrIndex].values.push(value);
                this.generateVariants();
            }
            event.target.value = '';
        }
    }

    removeAttributeValue(attrIndex: number, valueIndex: number): void {
        this.variantAttributes[attrIndex].values.splice(valueIndex, 1);
        this.generateVariants();
    }

    generateVariants(): void {
        // Filter incomplete attributes
        const validAttributes = this.variantAttributes.filter(
            attr => attr.name && attr.values.length > 0
        );

        if (validAttributes.length === 0) {
            this.generatedVariants = [];
            return;
        }

        // Generate Cartesian product
        const combinations = this.cartesian(validAttributes.map(a => a.values));

        const basePrice = this.productForm.get('base_price')?.value || 0;
        const baseSku = this.productForm.get('sku')?.value || '';

        this.generatedVariants = combinations.map(combo => {
            const attributes: Record<string, string> = {};
            let nameSuffix = '';
            let skuSuffix = '';

            validAttributes.forEach((attr, index) => {
                const value = combo[index];
                attributes[attr.name] = value;
                nameSuffix += ` ${value}`; // e.g. " Red L"
                skuSuffix += `-${value.toUpperCase().substring(0, 3)}`; // e.g. "-RED-L"
            });

            // Check if this variant already exists to preserve custom values
            const existing = this.generatedVariants.find(v =>
                JSON.stringify(v.attributes) === JSON.stringify(attributes)
            );

            if (existing) return existing;

            return {
                name: `${this.productForm.get('name')?.value || 'Product'}${nameSuffix}`,
                sku: baseSku ? `${baseSku}${skuSuffix}` : '',
                price: basePrice,
                stock: 0,
                attributes
            };
        });
    }

    private cartesian(args: any[][]): any[] {
        const r: any[] = [];
        const max = args.length - 1;
        function helper(arr: any[], i: number) {
            for (let j = 0, l = args[i].length; j < l; j++) {
                const a = arr.slice(0); // clone arr
                a.push(args[i][j]);
                if (i == max) r.push(a);
                else helper(a, i + 1);
            }
        }
        if (args.length > 0) helper([], 0);
        return r;
    }


    // ... (Copy basic handlers from Modal: ImageUrl, FileSelect, etc.) ...
    onCategoryCreated(category: ProductCategory): void {
        this.loadCategories();
        // Add to current selection
        const currentIds = this.productForm.get('category_ids')?.value || [];
        if (category && category.id) {
            this.productForm.patchValue({ category_ids: [...currentIds, category.id] });
        }
        this.isCategoryCreateOpen = false;
    }

    onBrandCreated(brand: Brand): void {
        this.loadBrands();
        if (brand && brand.id) {
            this.productForm.patchValue({ brand_id: brand.id });
        }
        this.isBrandCreateOpen = false;
    }

    get totalStockOnHand(): number {
        return (this.product?.stock_levels || []).reduce((sum, sl: any) => sum + (sl.quantity_on_hand || 0), 0);
    }

    get totalStockAvailable(): number {
        return (this.product?.stock_levels || []).reduce((sum, sl: any) => sum + (sl.quantity_available || 0), 0);
    }

    get totalStockReserved(): number {
        return (this.product?.stock_levels || []).reduce((sum, sl: any) => sum + (sl.quantity_reserved || 0), 0);
    }

    get lowStockCount(): number {
        return (this.product?.stock_levels || []).filter((sl: any) => (sl.quantity_available || 0) <= (sl.reorder_point || 0)).length;
    }

    get warehouseCount(): number {
        return new Set((this.product?.stock_levels || []).map((sl: any) => sl.location_id)).size;
    }

    isExpired(date: Date | string): boolean {
        if (!date) return false;
        const expiryDate = new Date(date);
        const today = new Date();
        return expiryDate < today;
    }

    triggerFileUpload(): void {
        const fileInput = document.querySelector('.file-input') as HTMLInputElement;
        fileInput?.click();
    }

    onFileSelect(event: Event): void {
        const input = event.target as HTMLInputElement;
        const files = input.files;
        if (files) {
            const filesArray = Array.from(files);
            const remainingSlots = 5 - this.imageUrls.length;

            if (remainingSlots <= 0) {
                this.toastService.warning('Límite de 5 imágenes alcanzado');
                input.value = '';
                return;
            }

            filesArray.slice(0, remainingSlots).forEach((file) => {
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const result = e.target?.result as string;
                        this.imageUrls.push(result);
                        if (this.imageUrls.length === 1) {
                            this.activeImageIndex = 0;
                        }
                    };
                    reader.readAsDataURL(file);
                }
            });
            input.value = '';
        }
    }

    removeImage(index: number): void {
        this.imageUrls.splice(index, 1);
        if (this.activeImageIndex >= this.imageUrls.length) {
            this.activeImageIndex = Math.max(0, this.imageUrls.length - 1);
        }
    }

    setActiveImage(index: number): void {
        this.activeImageIndex = index;
    }

    nextImage(): void {
        if (this.imageUrls.length === 0) return;
        this.activeImageIndex = (this.activeImageIndex + 1) % this.imageUrls.length;
    }

    prevImage(): void {
        if (this.imageUrls.length === 0) return;
        this.activeImageIndex = (this.activeImageIndex - 1 + this.imageUrls.length) % this.imageUrls.length;
    }

    onImageError(event: Event): void {
        const img = event.target as HTMLImageElement;
        img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjRjRNEY2Ii8+CjxwYXRoIGQ9Ik0xMiA2VjEwTDEwIDhMMTIgNlpNMTIgNlYxMEwxNCA4TDEyIDZaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPgo=';
    }

    private isValidUrl(string: string): boolean {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    onCancel(): void {
        this.router.navigate(['/admin/products']);
    }

    onSubmit(): void {
        if (this.productForm.invalid || this.isSubmitting) {
            this.productForm.markAllAsTouched();
            return;
        }

        this.isSubmitting = true;
        const formValue = this.productForm.value;

        // Prepare Images
        const images: CreateProductImageDto[] = this.imageUrls.map(
            (url, index) => ({
                image_url: url,
                is_main: index === 0,
            }),
        );

        // Basic DTO
        const productData: CreateProductDto = {
            name: formValue.name,
            slug: formValue.slug || undefined,
            description: formValue.description || undefined,
            base_price: Number(formValue.base_price),
            sku: formValue.sku || undefined,
            stock_quantity: Number(formValue.stock_quantity),
            category_ids: formValue.category_ids || [],
            tax_category_ids: formValue.tax_category_ids || [],
            brand_id: formValue.brand_id ? Number(formValue.brand_id) : null,
            state: formValue.state || ProductState.ACTIVE,
            images: images.length > 0 ? images : undefined,
        };

        // Add Variants if enabled
        if (this.hasVariants && this.generatedVariants.length > 0) {
            productData.variants = this.generatedVariants.map(v => ({
                sku: v.sku,
                name: v.name,
                price_override: Number(v.price),
                stock_quantity: Number(v.stock),
                attributes: v.attributes
            }));

            // If variants exist, base product stock is sum of variants (usually handled by backend, but good to be explicit or 0)
            // Backend ignores base stock if variants are present usually, or it's a separate concept.
            // For now sending 0 for base stock if variants exist? 
            // The service logic we saw earlier didn't seem to sum it up automatically on creation, 
            // but `ProductVariantService` creates stock movements.
        }

        const request$ = this.isEditMode && this.productId
            ? this.productsService.updateProduct(this.productId, productData as any) // Cast to any to avoid strict UpdateDto mismatch if needed, or fix DTO
            : this.productsService.createProduct(productData);

        request$.subscribe({
            next: () => {
                this.toastService.success(
                    this.isEditMode
                        ? 'Producto actualizado correctamente'
                        : 'Producto creado correctamente'
                );
                this.router.navigate(['/admin/products']);
            },
            error: (err: any) => { // Fix implicit any
                console.error('Error saving product:', err);
                this.toastService.error(
                    this.isEditMode
                        ? 'Error al actualizar el producto'
                        : 'Error al crear el producto'
                );
                this.isSubmitting = false;
            }
        });
    }

    getErrorMessage(fieldName: string): string {
        const field = this.productForm.get(fieldName);
        if (!field || !field.errors || !field.touched) return '';
        if (field.errors['required']) return 'Required field';
        if (field.errors['min']) return `Min value: ${field.errors['min'].min}`;
        return 'Invalid value';
    }

    // Adjustment Modal
    openAdjustmentModal(): void {
        this.isAdjustmentModalOpen = true;
    }

    openStockAdjustment(): void {
        this.openAdjustmentModal();
    }

    closeAdjustmentModal(): void {
        this.isAdjustmentModalOpen = false;
    }

    onAdjustmentSave(dto: CreateAdjustmentDto): void {
        this.isAdjusting = true;
        this.inventoryService.createAdjustment(dto).subscribe({
            next: () => {
                this.toastService.success('Ajuste de inventario realizado correctamente');
                this.isAdjusting = false;
                this.closeAdjustmentModal();
                // Reload product to see stock changes (optional but good)
                if (this.productId) {
                    this.loadProduct(this.productId);
                }
                // Redirect to adjustments history as per plan
                this.router.navigate(['/admin/inventory/adjustments']);
            },
            error: (err) => {
                console.error('Error creating adjustment', err);
                this.toastService.error('Error al realizar el ajuste');
                this.isAdjusting = false;
            }
        });
    }
}
