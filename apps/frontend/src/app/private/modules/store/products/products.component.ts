import { Component, inject, DestroyRef, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { Router, ActivatedRoute } from '@angular/router';

// Services
import { ProductsService } from './services/products.service';
import { CategoriesService } from './services/categories.service';
import { BrandsService } from './services/brands.service';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../shared/components/dialog/dialog.service';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';
import { parseApiError } from '../../../../core/utils/parse-api-error';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';
import {
  VexiUiHost,
  VexiUiHostRegistry,
} from '../../../../core/services/vexi-ui-host.registry';

// Models
import {
  Product,
  ProductState,
  CreateProductDto,
  UpdateProductDto,
  ProductQueryDto,
  ProductStats,
  ProductCategory,
  Brand,
  ArchiveWriteOffPlan,
  readArchiveWriteOffPlan,
} from './interfaces';

// Components
import { ProductListComponent } from './components/product-list/product-list.component';
// QUI-729 — default unico del modulo. Sin esta constante el padre
// (`ProductsComponent`) y el hijo (`ProductListComponent`) escribian
// el mismo literal en sus archivos, y desincronizarse era trivial.
import { PRODUCT_LIST_DEFAULT_QUERY } from './components/product-list/product-list.constants';
import { ProductCreateModalComponent } from './components/product-create-modal.component';
import { BulkUploadModalComponent } from './components/bulk-upload-modal/bulk-upload-modal.component';
import { BulkImageUploadModalComponent } from './components/bulk-image-upload-modal/bulk-image-upload-modal.component';
import { ArchiveWriteOffModalComponent } from './components/archive-write-off-modal/archive-write-off-modal.component';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [
    ProductListComponent,
    ProductCreateModalComponent,
    BulkUploadModalComponent,
    BulkImageUploadModalComponent,
    ArchiveWriteOffModalComponent,
    StatsComponent,
  ],
  providers: [ProductsService],
  styles: [`
    @media (max-width: 639px) {
      .stats-container app-stats:first-child {
        margin-left: -1rem;
        padding-left: 0;
      }
    }
  `],
  template: `
    <div class="w-full">
      <!-- Stats Grid: sticky at top on mobile -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Productos Totales"
          [value]="stats().total_products"
          smallText="Catálogo completo, incluye insumos"
          iconName="package"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Productos Activos"
          [value]="stats().active_products"
          smallText="Disponibles para venta"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Categorías"
          [value]="stats().categories_count"
          smallText="Clasificación del catálogo"
          iconName="tags"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Marcas"
          [value]="stats().brands_count"
          smallText="Asociadas al catálogo"
          iconName="building-2"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Product List -->
      <app-product-list
        [products]="products()"
        [isLoading]="isLoading()"
        [categories]="categories()"
        [brands]="brands()"
        [paginationData]="pagination()"
        [canCreate]="canCreateProduct()"
        [canBulkEdit]="canBulkEditProducts()"
        (refresh)="loadProducts()"
        (search)="onSearch($event)"
        (filter)="onFilter($event)"
        (create)="openCreateModal()"
        (edit)="navigateToEditPage($event)"
        (delete)="deleteProduct($event)"
        (toggleState)="onToggleProductState($event)"
        (bulkUpload)="openBulkUploadModal()"
        (bulkImageUpload)="openBulkImageUploadModal()"
        (bulkEdit)="navigateToBulkEditPage()"
        (downloadCurrentProducts)="onDownloadCurrentProducts()"
        (pageChange)="changePage($event)"
      ></app-product-list>

      <!-- Modals -->
      <app-product-create-modal
        [(isOpen)]="isCreateModalOpen"
        [product]="null"
        [isSubmitting]="isCreatingProduct"
        (cancel)="onModalClose()"
        (submit)="onSaveProduct($event)"
      ></app-product-create-modal>

      <app-bulk-upload-modal
        [(isOpen)]="isBulkUploadModalOpen"
        (uploadComplete)="onBulkUploadComplete()"
      ></app-bulk-upload-modal>

      <app-bulk-image-upload-modal
        [(isOpen)]="isBulkImageUploadModalOpen"
        (uploadComplete)="onBulkImageUploadComplete()"
      ></app-bulk-image-upload-modal>

      <!--
        CP-PURCHASE-TRANSPARENCY D.9 — el diálogo del castigo. Sólo se abre
        cuando el producto TIENE existencias: el producto sin nada que castigar
        conserva el diálogo de confirmación de siempre y no pasa por aquí.
      -->
      <app-archive-write-off-modal
        [(modalOpen)]="isArchiveWriteOffModalOpen"
        [plan]="archiveWriteOffPlan()"
        [productName]="archiveTargetName()"
        [archiving]="isArchiving()"
        [errorMessage]="archiveErrorMessage()"
        (confirmed)="onConfirmArchiveWriteOff()"
      ></app-archive-write-off-modal>
    </div>
  `,
})
export class ProductsComponent {
  private currencyService = inject(CurrencyFormatService);
  private productsService = inject(ProductsService);
  private categoriesService = inject(CategoriesService);
  private brandsService = inject(BrandsService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private authFacade = inject(AuthFacade);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private vexiHosts = inject(VexiUiHostRegistry);

  readonly products = signal<Product[]>([]);
  readonly categories = signal<ProductCategory[]>([]);
  readonly brands = signal<Brand[]>([]);
  readonly isLoading = signal(false);
  storeId: string | null = null;

  // Pagination
  readonly pagination = signal({ page: 1, limit: 10, total: 0, totalPages: 0 });

  // FIX QUI-503: granular permissions derived from AuthFacade
  readonly canCreateProduct = computed(() =>
    this.authFacade.hasPermission('store:products:create'),
  );

  // QUI-567: gate de la acción "Edición masiva" del listado. Misma mecánica que
  // `canCreateProduct` (AuthFacade lee el signal `userPermissions`, así que el
  // computed es reactivo). Es afordancia de UI: el backend impone el permiso.
  readonly canBulkEditProducts = computed(() =>
    this.authFacade.hasPermission('store:products:bulk_update'),
  );

  // Stats
  readonly stats = signal<ProductStats>({
    total_products: 0,
    active_products: 0,
    inactive_products: 0,
    archived_products: 0,
    low_stock_products: 0,
    out_of_stock_products: 0,
    total_value: 0,
    categories_count: 0,
    brands_count: 0,
  });

  // Queries
  searchTerm = '';
  // QUI-729 — inicializar con el default para que la PRIMERA peticion
  // ya llegue filtrada (`is_ingredient=false`). El hijo
  // (`ProductListComponent`) ya no necesita reemitir tras el render, asi
  // que no hay carrera contra esta carga.
  currentFilters: Partial<ProductQueryDto> = { ...PRODUCT_LIST_DEFAULT_QUERY };

  // Modal State
  isCreateModalOpen = false;
  isBulkUploadModalOpen = false;
  isBulkImageUploadModalOpen = false;
  isCreatingProduct = false;

  // Estado de descarga de plantilla
  readonly isExporting = signal(false);

  // ───────────────────────────────────────────────────────────────────────────
  // CP-PURCHASE-TRANSPARENCY D.9 — estado del castigo por archivado
  // ───────────────────────────────────────────────────────────────────────────

  /** Visibilidad del diálogo enriquecido. Two-way con el modal. */
  readonly isArchiveWriteOffModalOpen = signal(false);
  /** El plan que el operador está mirando. Del preview o del 409, indistinto. */
  readonly archiveWriteOffPlan = signal<ArchiveWriteOffPlan | null>(null);
  /** Producto sobre el que se está decidiendo. */
  readonly archiveTarget = signal<Product | null>(null);
  readonly archiveTargetName = computed(() => this.archiveTarget()?.name ?? '');
  /** El `DELETE` confirmado está en vuelo. */
  readonly isArchiving = signal(false);
  /** Error del intento de confirmación, pintado DENTRO del modal. */
  readonly archiveErrorMessage = signal<string | null>(null);
  /** El preview está en vuelo: evita disparar dos veces desde la lista. */
  readonly isPreparingArchive = signal(false);

  constructor() {
    // Asegurar que la moneda esté cargada
    this.currencyService.loadCurrency();

    // Vexi opera esta pantalla mientras esté montada. Se desregistra con
    // `destroyRef` en vez de `ngOnDestroy` porque el componente ya usa ese
    // camino para sus suscripciones, y un host registrado tras el teardown
    // aceptaría comandos cuyo efecto nadie vería.
    this.vexiHosts.register(this.vexiHostAdapter);
    this.destroyRef.onDestroy(() => this.vexiHosts.unregister(this.vexiHostAdapter));

    // Subscribe to queryParams for pagination persistence
    this.route.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const page = params['page'];
        if (page) {
          this.pagination.update(p => ({ ...p, page: parseInt(page, 10) || 1 }));
        }
      });

    // Subscribe to userStore$ observable to get the store ID
    this.authFacade.userStore$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((store: any) => {
        const storeId = store?.id;
        if (storeId && !this.storeId) {
          this.storeId = String(storeId);
          this.loadStats();
        }
      });

    this.loadProducts();
    this.loadCategories();
    this.loadBrands();
  }

  loadProducts(): void {
    this.isLoading.set(true);
    const pag = this.pagination();
    const query: ProductQueryDto = {
      ...(this.searchTerm && { search: this.searchTerm }),
      ...this.currentFilters,
      page: pag.page,
      limit: pag.limit,
    };

    this.productsService.getProducts(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          if (response.data) {
            this.products.set(response.data);
          } else {
            this.products.set([]);
          }

          // Extract pagination metadata
          if (response.pagination) {
            this.pagination.update(p => ({ ...p, ...response.pagination }));
          }

          // Edge case: if current page is empty but not the first page, go back
          if (this.products().length === 0 && this.pagination().page > 1) {
            this.pagination.update(p => ({ ...p, page: p.page - 1 }));
            this.loadProducts();
            return;
          }

          this.isLoading.set(false);
        },
        error: (error: any) => {
          console.error('Error loading products:', error);
          const message = extractApiErrorMessage(error);
          this.toastService.error(message, 'Error al cargar productos');
          this.isLoading.set(false);
        },
      });
  }

  loadStats(): void {
    if (!this.storeId) return;

    this.productsService.getProductStats(parseInt(this.storeId, 10))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          if (response) this.stats.set(response);
        },
        error: (error: any) => {
          console.error('Error loading stats:', error);
          const message = extractApiErrorMessage(error);
          this.toastService.error(message, 'Error al cargar estadísticas');
        },
      });
  }

  loadCategories(): void {
    this.categoriesService
      .getCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((cats) => this.categories.set(cats));
  }

  loadBrands(): void {
    this.brandsService
      .getBrands()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((brands) => this.brands.set(brands));
  }

  // ── Host de Vexi ────────────────────────────────────────────────────────
  //
  // Registrado como objeto adaptador y no implementando la interfaz en el
  // componente: `loadProducts` y `onFilter` ya son la API de esta pantalla, y el
  // adaptador las expone sin añadirle nombres genéricos que colisionen.

  private readonly vexiHostAdapter: VexiUiHost = {
    vexiModuleKey: 'products',
    readScreen: () => {
      const pagination = this.pagination();

      return {
        module_key: 'products',
        title: 'Productos',
        visible_count: this.products().length,
        filters: {
          search: this.searchTerm || undefined,
          ...this.currentFilters,
        },
        // Los dos números se nombran por separado a propósito: "61 productos" y
        // "10 en pantalla" son cosas distintas, y una nota que solo diga el total
        // hace que Vexi le diga a la persona que está viendo 61 filas.
        notes: this.isLoading()
          ? 'La lista todavía está cargando.'
          : this.vexiOpenModalNote() ??
            `En esta página se ven ${this.products().length}; hay ${pagination.total} en total ` +
              `(página ${pagination.page} de ${pagination.totalPages || 1}).`,
      };
    },
    listActions: () => [
      { id: 'nuevo_producto', label: 'Abrir el formulario de nuevo producto' },
      { id: 'carga_masiva', label: 'Abrir la carga masiva de productos' },
      { id: 'carga_imagenes', label: 'Abrir la carga masiva de imágenes' },
      { id: 'edicion_masiva', label: 'Ir a la edición masiva' },
    ],
    runAction: async (id) => {
      switch (id) {
        case 'nuevo_producto':
          this.openCreateModal();
          return {
            status: 'needs_user_input' as const,
            message:
              'Abrí el formulario de nuevo producto, vacío y sin guardar. La persona tiene que completarlo.',
          };
        case 'carga_masiva':
          this.openBulkUploadModal();
          return {
            status: 'needs_user_input' as const,
            message: 'Abrí la carga masiva para que suba el archivo desde ahí.',
          };
        case 'carga_imagenes':
          this.openBulkImageUploadModal();
          return {
            status: 'needs_user_input' as const,
            message:
              'Abrí la carga masiva de imágenes. El ZIP se sube desde ese modal, no por el chat.',
          };
        case 'edicion_masiva':
          this.navigateToBulkEditPage();
          return {
            status: 'ok' as const,
            message: 'Lo llevé a la edición masiva de productos.',
          };
        default:
          return {
            status: 'not_found' as const,
            message: `La pantalla de Productos no tiene una acción "${id}".`,
          };
      }
    },
    setFilter: async (values) => {
      // Delegated to `onSearch` / `onFilter`, the same handlers the list's own
      // controls call. Setting `searchTerm` and reloading by hand would skip the
      // page reset those do, so the person would land on page 4 of a filtered list
      // that has one page.
      const applied: string[] = [];

      if (typeof values['search'] === 'string') {
        this.onSearch(values['search']);
        applied.push('búsqueda');
      }

      const rest = Object.fromEntries(
        Object.entries(values).filter(([key]) => key !== 'search'),
      );

      if (Object.keys(rest).length) {
        this.onFilter(rest as Partial<ProductQueryDto>);
        applied.push(Object.keys(rest).join(', '));
      }

      // Deliberadamente SIN conteo. `onSearch` dispara un refetch asíncrono, así
      // que `products()` acá todavía tiene la página anterior: devolver su
      // longitud hacía que Vexi dijera "quedaron 10" sobre una lista que terminó
      // en 2. Si el conteo importa, el modelo llama ui_read_screen después, que
      // lee la lista ya asentada.
      return applied.length
        ? {
            status: 'ok' as const,
            message: `Filtré la lista por ${applied.join(' y ')}. La lista se está recargando; si necesitas el conteo, léelo de la pantalla después.`,
          }
        : {
            status: 'not_found' as const,
            message: 'No me pasaste ningún filtro que esta lista entienda.',
          };
    },
    openModal: (id) => this.vexiHostAdapter.runAction!(id),
    refresh: () => {
      this.loadProducts();
      return { status: 'ok' as const, message: 'Recargué la lista de productos.' };
    },
  };

  /** Nombra el modal abierto, para que Vexi no actúe como si la pantalla estuviera libre. */
  private vexiOpenModalNote(): string | undefined {
    if (this.isCreateModalOpen) return 'Hay un formulario de nuevo producto abierto.';
    if (this.isBulkUploadModalOpen) return 'La carga masiva está abierta.';
    if (this.isBulkImageUploadModalOpen) return 'La carga de imágenes está abierta.';
    return undefined;
  }

  // Event Handlers
  onSearch(term: string): void {
    this.searchTerm = term;
    this.pagination.update(p => ({ ...p, page: 1 }));
    this.loadProducts();
  }

  onFilter(filters: Partial<ProductQueryDto>): void {
    this.currentFilters = filters;
    this.pagination.update(p => ({ ...p, page: 1 }));
    this.loadProducts();
  }

  changePage(page: number): void {
    this.pagination.update(p => ({ ...p, page }));
    this.loadProducts();
  }

  openCreateModal(): void {
    this.isCreateModalOpen = true;
  }

  navigateToEditPage(product: Product): void {
    this.router.navigate(['/admin/products/edit', product.id], {
      queryParams: { fromPage: this.pagination().page }
    });
  }

  /** QUI-567: único punto de entrada a la vista dedicada de edición masiva. */
  navigateToBulkEditPage(): void {
    this.router.navigate(['/admin/products/bulk-edit']);
  }

  onModalClose(): void {
    this.isCreateModalOpen = false;
  }
  onSaveProduct(data: any): void {
    this.createProduct(data);
  }

  createProduct(data: CreateProductDto): void {
    this.isCreatingProduct = true;
    this.productsService.createProduct(data)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Producto creado exitosamente');
          this.isCreatingProduct = false;
          this.onModalClose();
          this.loadProducts();
          this.loadStats();
        },
        error: (error: any) => {
          const message = extractApiErrorMessage(error);
          this.toastService.error(message, 'Error al crear producto');
          this.isCreatingProduct = false;
        },
      });
  }

  onToggleProductState(product: Product): void {
    const nextState =
      product.state === ProductState.ACTIVE
        ? ProductState.INACTIVE
        : ProductState.ACTIVE;
    const verb = nextState === ProductState.ACTIVE ? 'activado' : 'desactivado';
    this.productsService
      .updateProduct(product.id, { state: nextState } as UpdateProductDto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updatedProduct) => {
          // Actualización optimista del signal local con la respuesta del
          // backend (que ya trae el producto completo vía findOne). Esto evita
          // depender de loadProducts() que puede devolver datos cacheados por
          // el browser (bug fixeado con Cache-Control: no-store + interceptor).
          this.products.update((list) =>
            list.map((p) => (p.id === updatedProduct.id ? updatedProduct : p)),
          );
          this.toastService.success(`Producto ${verb} correctamente`);
          this.loadStats();
        },
        error: (error: any) => {
          const message = extractApiErrorMessage(error);
          this.toastService.error(message, 'Error al actualizar producto');
        },
      });
  }

  /**
   * CP-PURCHASE-TRANSPARENCY D.9 — flujo de dos tiempos.
   *
   * ## LO QUE HABÍA, Y POR QUÉ NO PODÍA QUEDARSE
   *
   * Un `dialogService.confirm` genérico y, en el error,
   * `error: () => toastService.error('Error al eliminar producto')`: el objeto
   * entero se DESCARTABA. Con el archivado castigando inventario (D.4), el
   * backend responde 409 `PROD_VARIANT_HAS_STOCK_001` con el plan completo del
   * castigo en `details.archive_write_off`, y ese manejador lo tiraba a la
   * basura. El operador veía un toast rojo sin causa, no sabía que había
   * existencias, no sabía que existía una confirmación posible, y no tenía
   * botón que la ofreciera: el flujo quedaba muerto y volvía a hacer justo lo
   * que originó el reporte —borrar el producto y recargarlo—.
   *
   * (El rechazo llega ahora como un 409 de verdad. Antes el controller lo
   * envolvía en un `try/catch` que llamaba `responseService.error()`, que
   * RETORNA el sobre en vez de lanzarlo, así que el rechazo viajaba como HTTP
   * 200 con `success:false` y el `next` de este mismo `subscribe` lo celebraba
   * como éxito. Ese `try/catch` ya no está.)
   *
   * ## LOS TRES ESTADOS
   *
   * 1. `requires_confirmation === false` → NADA CAMBIA: el diálogo simple de
   *    siempre. Un producto sin existencias no gana fricción por este paso.
   * 2. `requires_confirmation && out_of_scope_units === 0` → diálogo
   *    enriquecido: unidades, valor, desglose y casilla.
   * 3. `out_of_scope_units > 0` → el mismo diálogo en su forma bloqueada, sin
   *    botón de confirmar y con las instrucciones para desbloquearlo.
   *
   * ## POR QUÉ SE PIDE LA VISTA PREVIA ANTES DE PREGUNTAR NADA
   *
   * Porque el estado 1 no debe abrir modal, y saber si estamos en el estado 1
   * exige preguntarle al backend. Preguntar primero y decidir después es lo
   * único que evita meter al producto sin existencias en un diálogo que no le
   * corresponde. Si la vista previa falla —permisos, red—, se degrada al
   * diálogo simple: el backend sigue siendo quien decide, y su 409 vuelve a
   * traer el plan.
   */
  deleteProduct(product: Product): void {
    if (this.isPreparingArchive() || this.isArchiving()) {
      return;
    }
    this.isPreparingArchive.set(true);

    this.productsService
      .previewArchiveWriteOff(product.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (plan) => {
          this.isPreparingArchive.set(false);
          if (!plan || (!plan.requires_confirmation && plan.out_of_scope_units === 0)) {
            this.confirmPlainArchive(product);
            return;
          }
          this.openArchiveWriteOffModal(product, plan);
        },
        error: (error: unknown) => {
          this.isPreparingArchive.set(false);
          // El plan también puede venir dentro del propio error (no debería en
          // una ruta de solo lectura, pero si viene se aprovecha: es el mismo
          // objeto y una sola fuente de verdad).
          const plan = readArchiveWriteOffPlan(error);
          if (plan) {
            this.openArchiveWriteOffModal(product, plan);
            return;
          }
          this.confirmPlainArchive(product);
        },
      });
  }

  /** Estado 1: el diálogo de toda la vida, sin cambios de comportamiento. */
  private confirmPlainArchive(product: Product): void {
    this.dialogService
      .confirm({
        title: 'Eliminar Producto',
        message: `¿Está seguro de que desea eliminar "${product.name}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        this.archiveTarget.set(product);
        this.runArchive(product, false);
      });
  }

  /** Estados 2 y 3: el diálogo que enseña qué se va a destruir. */
  private openArchiveWriteOffModal(
    product: Product,
    plan: ArchiveWriteOffPlan,
  ): void {
    this.archiveTarget.set(product);
    this.archiveWriteOffPlan.set(plan);
    this.archiveErrorMessage.set(null);
    this.isArchiveWriteOffModalOpen.set(true);
  }

  /** El operador marcó la casilla y pulsó. Sólo aquí viaja la confirmación. */
  onConfirmArchiveWriteOff(): void {
    const product = this.archiveTarget();
    if (!product || this.isArchiving()) {
      return;
    }
    this.runArchive(product, true);
  }

  /**
   * El `DELETE`, con o sin confirmación del castigo.
   *
   * `confirmStockWriteOff` NUNCA se pone a `true` desde la ruta del diálogo
   * simple: si el backend contesta que hay existencias cuando el preview decía
   * que no (porque llegó una recepción entre medias), lo correcto es enseñar el
   * plan fresco y volver a preguntar, no confirmar por el operador.
   */
  private runArchive(product: Product, confirmStockWriteOff: boolean): void {
    this.isArchiving.set(true);
    this.archiveErrorMessage.set(null);

    this.productsService
      .deleteProduct(product.id, confirmStockWriteOff)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // El mensaje se redacta ANTES de limpiar: el plan es la única fuente
          // de la cifra que se acaba de castigar y borrarlo primero la perdería.
          const message = this.describeArchiveSuccess(confirmStockWriteOff);
          this.isArchiving.set(false);
          this.isArchiveWriteOffModalOpen.set(false);
          this.archiveWriteOffPlan.set(null);
          this.archiveTarget.set(null);
          this.toastService.success(message);
          this.loadProducts();
          this.loadStats();
        },
        error: (error: unknown) => {
          this.isArchiving.set(false);
          this.handleArchiveRejection(product, error);
        },
      });
  }

  /** El toast dice lo que pasó de verdad, incluidas las bajas. */
  private describeArchiveSuccess(confirmStockWriteOff: boolean): string {
    const plan = this.archiveWriteOffPlan();
    if (!confirmStockWriteOff || !plan || plan.total_units <= 0) {
      return 'Producto eliminado exitosamente';
    }
    const units = plan.total_units;
    return `Producto eliminado y ${units} ${units === 1 ? 'unidad dada' : 'unidades dadas'} de baja`;
  }

  /**
   * El manejador que ya no descarta el error.
   *
   * Si el rechazo trae plan (409 `PROD_VARIANT_HAS_STOCK_001`), ese plan MANDA:
   * es más fresco que el del preview y describe el estado real del inventario
   * ahora mismo. Se sustituye y el modal se abre —o se queda abierto— con las
   * cifras nuevas; el modal retira el consentimiento al cambiar el plan, así
   * que el operador tiene que volver a mirar antes de volver a pulsar.
   *
   * Si no trae plan, se pinta el código: `parseApiError` da el mensaje del
   * backend cuando es presentable y el copy curado del catálogo cuando no, y el
   * código va en el título del toast para que un reporte de soporte lo incluya.
   */
  private handleArchiveRejection(product: Product, error: unknown): void {
    const freshPlan = readArchiveWriteOffPlan(error);
    if (freshPlan) {
      this.openArchiveWriteOffModal(product, freshPlan);
      return;
    }

    const { errorCode, userMessage } = parseApiError(error);
    const message = userMessage || extractApiErrorMessage(error);
    const title = errorCode
      ? `No se pudo eliminar el producto (${errorCode})`
      : 'No se pudo eliminar el producto';

    // Con el modal abierto el toast queda detrás y nadie lo lee: el error se
    // pinta dentro del propio diálogo, donde el operador está mirando.
    if (this.isArchiveWriteOffModalOpen()) {
      this.archiveErrorMessage.set(
        errorCode ? `${message} (${errorCode})` : message,
      );
      return;
    }
    this.toastService.error(message, title);
  }

  // Bulk Upload
  openBulkUploadModal(): void {
    this.isBulkUploadModalOpen = true;
  }

  onBulkUploadComplete(): void {
    this.isBulkUploadModalOpen = false;
    this.loadProducts();
    this.loadStats();
    this.toastService.success('Carga masiva completada');
  }

  // Bulk Image Upload
  openBulkImageUploadModal(): void {
    this.isBulkImageUploadModalOpen = true;
  }

  onBulkImageUploadComplete(): void {
    this.isBulkImageUploadModalOpen = false;
    this.loadProducts();
  }

  // Descargar Plantilla con Productos Actuales
  async onDownloadCurrentProducts(): Promise<void> {
    if (this.isExporting()) return;
    this.isExporting.set(true);
    try {
      const blob = await firstValueFrom(
        this.productsService.exportCurrentProducts(),
      );
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const dateStr = new Date().toISOString().split('T')[0];
      link.download = `productos_actuales_${dateStr}.xlsx`;
      link.click();
      window.URL.revokeObjectURL(url);
      this.notifyDownloadResult(true);
    } catch (err) {
      this.notifyDownloadResult(false, err);
    } finally {
      this.isExporting.set(false);
    }
  }

  /**
   * Feedback de usuario para la descarga de la plantilla.
   * Decidí qué mensajes mostrar y cómo extraer el mensaje real del error.
   * Pista: this.toastService expone .success() / .warning() / .error(msg, title?, duration?).
   * Para errores: extractApiErrorMessage(err) devuelve el mensaje legible del backend.
   */
  private notifyDownloadResult(success: boolean, err?: unknown): void {
    if (success) {
      this.toastService.success('Plantilla con productos descargada');
      return;
    }
    const message =
      extractApiErrorMessage(err) ||
      'Error al descargar la plantilla de productos';
    this.toastService.error(message, 'Error al exportar');
  }
  // Helpers
  getGrowthPercentage(val: number): string {
    return val > 0 ? `+${val}%` : `${val}%`;
  }

  formatCurrencyValue(value: number): string {
    return this.currencyService.format(value || 0);
  }
}
