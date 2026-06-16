import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  InputButtonOption,
  InputButtonsComponent,
  InputComponent,
  InputsearchComponent,
  ModalComponent,
  StickyHeaderComponent,
  StickyHeaderTab,
  TextareaComponent,
  ToastService,
} from '../../../../../../shared/components';
import {
  Product,
  ProductImage,
} from '../../../products/interfaces/product.interface';
import { ProductsService } from '../../../products/services/products.service';
import { ManualAdEditorComponent } from '../components/manual-ad-editor.component';
import {
  AdCreativeFormat,
  CreateManualMarketingAdCreativeDto,
  CreateMarketingAdCreativeDto,
  MarketingAdCreative,
} from '../anuncios.interface';
import { AnunciosService } from '../anuncios.service';
import { AdCreativeAssetService } from '../services/ad-creative-asset.service';

type CreationMode = 'ai' | 'manual';
type DetailsTarget = 'ai' | 'manual';

interface AiFormControls {
  prompt: FormControl<string>;
  format: FormControl<AdCreativeFormat>;
}

interface ManualFormControls {
  format: FormControl<AdCreativeFormat>;
}

interface DetailsFormControls {
  title: FormControl<string>;
  description: FormControl<string>;
}

interface GalleryImage {
  product: Product;
  image: ProductImage;
}

@Component({
  selector: 'app-anuncio-create-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    InputButtonsComponent,
    InputComponent,
    InputsearchComponent,
    ManualAdEditorComponent,
    ModalComponent,
    StickyHeaderComponent,
    TextareaComponent,
  ],
  template: `
    <div class="min-h-screen">
      <app-sticky-header
        title="Crear anuncio"
        subtitle="Genera una pieza promocional desde productos e imagenes."
        icon="image-plus"
        [showBackButton]="true"
        [backRoute]="['/admin/marketing/anuncios']"
        [tabs]="creationTabs"
        [activeTab]="activeMode()"
        [badgeText]="selectedProductsBadge()"
        badgeColor="blue"
        (tabChanged)="setMode($event)"
      ></app-sticky-header>

      <div class="p-2 md:p-6">
        <div
          class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_360px]"
        >
          <div class="space-y-4">
            @if (resultFocused()) {
              <app-card [responsive]="true" [padding]="false">
                <div
                  class="border-b border-[var(--color-border)] px-4 py-4 md:px-6"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="flex min-w-0 items-center gap-3">
                      <span
                        class="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                      >
                        <app-icon
                          [name]="generating() ? 'loader-2' : 'image'"
                          [size]="20"
                          [spin]="generating()"
                        ></app-icon>
                      </span>
                      <div class="min-w-0">
                        <h2
                          class="text-base font-semibold text-[var(--color-text-primary)] md:text-lg"
                        >
                          Resultado
                        </h2>
                        <p class="text-sm text-[var(--color-text-secondary)]">
                          {{
                            generating()
                              ? generationMessage()
                              : 'Anuncio listo para usar'
                          }}
                        </p>
                      </div>
                    </div>

                    @if (!generating() && activeResult()) {
                      <app-button
                        variant="outline"
                        size="sm"
                        type="button"
                        (clicked)="openDetailsModal(activeMode())"
                      >
                        <app-icon
                          slot="icon"
                          name="pencil"
                          [size]="15"
                        ></app-icon>
                        Guardar detalles
                      </app-button>
                    }
                  </div>
                </div>

                <div class="space-y-4 p-4 md:p-6">
                  <div
                    class="mx-auto flex min-h-[280px] w-full max-w-[760px] items-center justify-center overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)]"
                    [ngClass]="formatAspectClass(currentFormat())"
                  >
                    @if (activeResultImage()) {
                      <img
                        class="h-full w-full object-contain"
                        [src]="activeResultImage()"
                        alt="Anuncio generado"
                      />
                    } @else {
                      <div
                        class="flex flex-col items-center gap-3 text-sm text-[var(--color-text-secondary)]"
                      >
                        <app-icon
                          name="loader-2"
                          [size]="24"
                          [spin]="true"
                        ></app-icon>
                        {{ generationMessage() }}
                      </div>
                    }
                  </div>

                  @if (generationError()) {
                    <app-alert-banner variant="danger" icon="triangle-alert">
                      {{ generationError() }}
                    </app-alert-banner>
                  }

                  @if (activeResult()?.image_url) {
                    <div
                      class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end"
                    >
                      <app-button
                        variant="outline"
                        size="md"
                        type="button"
                        (clicked)="copyImage(activeResult()!)"
                      >
                        <app-icon
                          slot="icon"
                          name="copy"
                          [size]="16"
                        ></app-icon>
                        Copiar
                      </app-button>

                      <app-button
                        variant="outline"
                        size="md"
                        type="button"
                        (clicked)="downloadImage(activeResult()!)"
                      >
                        <app-icon
                          slot="icon"
                          name="download"
                          [size]="16"
                        ></app-icon>
                        Descargar
                      </app-button>

                      <app-button
                        variant="outline"
                        size="md"
                        type="button"
                        (clicked)="shareImage(activeResult()!)"
                      >
                        <app-icon
                          slot="icon"
                          name="share-2"
                          [size]="16"
                        ></app-icon>
                        Compartir
                      </app-button>
                    </div>
                  }
                </div>
              </app-card>
            }

            <app-card [responsive]="true" [padding]="false">
              <div
                class="border-b border-[var(--color-border)] px-4 py-4 md:px-6"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="flex min-w-0 items-center gap-3">
                    <span
                      class="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                    >
                      <app-icon
                        [name]="activeMode() === 'ai' ? 'sparkles' : 'palette'"
                        [size]="20"
                      ></app-icon>
                    </span>
                    <div class="min-w-0">
                      <h2
                        class="text-base font-semibold text-[var(--color-text-primary)] md:text-lg"
                      >
                        Zona de creacion
                      </h2>
                      <p class="text-sm text-[var(--color-text-secondary)]">
                        {{
                          activeMode() === 'ai'
                            ? 'Generacion con IA'
                            : 'Generacion manual'
                        }}
                      </p>
                    </div>
                  </div>

                  @if (resultFocused()) {
                    <app-button
                      variant="ghost"
                      size="sm"
                      type="button"
                      (clicked)="creationExpanded.update(toggleBoolean)"
                    >
                      {{
                        creationExpanded()
                          ? 'Contraer'
                          : activeMode() === 'ai'
                            ? 'Editar prompt'
                            : 'Editar manual'
                      }}
                    </app-button>
                  }
                </div>
              </div>

              <div class="p-4 md:p-6">
                @if (resultFocused() && !creationExpanded()) {
                  <div
                    class="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 text-sm text-[var(--color-text-secondary)]"
                  >
                    <div class="flex flex-wrap items-center gap-3">
                      <span class="inline-flex items-center gap-2">
                        <app-icon name="image" [size]="16"></app-icon>
                        {{ formatLabel(currentFormat()) }}
                      </span>
                      <span class="inline-flex items-center gap-2">
                        <app-icon name="package" [size]="16"></app-icon>
                        {{ selectedProductIds().length }} productos
                      </span>
                      <span class="inline-flex items-center gap-2">
                        <app-icon name="images" [size]="16"></app-icon>
                        {{ selectedImageCount() }} imagenes
                      </span>
                    </div>
                    @if (activeMode() === 'ai' && aiPromptPreview()) {
                      <p class="line-clamp-2">{{ aiPromptPreview() }}</p>
                    }
                  </div>
                } @else if (activeMode() === 'ai') {
                  <form
                    class="space-y-5"
                    [formGroup]="aiForm"
                    (ngSubmit)="createAiAnuncio()"
                  >
                    <app-textarea
                      formControlName="prompt"
                      label="Instrucciones"
                      [placeholder]="aiPromptPlaceholder()"
                      [rows]="6"
                    ></app-textarea>

                    <app-input-buttons
                      formControlName="format"
                      label="Formato para redes"
                      [options]="formatOptions"
                      [hideLabelsOnMobile]="false"
                    ></app-input-buttons>

                    <div
                      class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3"
                    >
                      <div class="flex flex-wrap items-center gap-3 text-sm">
                        <span class="inline-flex items-center gap-2">
                          <app-icon name="package" [size]="16"></app-icon>
                          {{ selectedProductIds().length }} productos
                        </span>
                        <span class="inline-flex items-center gap-2">
                          <app-icon name="images" [size]="16"></app-icon>
                          {{ selectedImageIds().length }} imagenes de contexto
                        </span>
                        <span class="inline-flex items-center gap-2">
                          <app-icon name="image" [size]="16"></app-icon>
                          {{ formatLabel(selectedAiFormat()) }}
                        </span>
                      </div>
                    </div>

                    @if (generationError()) {
                      <div class="pt-2">
                        <app-alert-banner
                          variant="danger"
                          icon="triangle-alert"
                        >
                          {{ generationError() }}
                        </app-alert-banner>
                      </div>
                    }

                    <div
                      class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <app-button
                        variant="outline"
                        size="md"
                        type="button"
                        (clicked)="goBack()"
                      >
                        Cancelar
                      </app-button>

                      <app-button
                        variant="primary"
                        size="md"
                        type="submit"
                        [loading]="creating() || generating()"
                        [disabled]="aiSubmitDisabled()"
                      >
                        <app-icon
                          slot="icon"
                          name="sparkles"
                          [size]="16"
                        ></app-icon>
                        Crear con IA
                      </app-button>
                    </div>
                  </form>
                } @else {
                  <form class="space-y-5" [formGroup]="manualForm">
                    <app-input-buttons
                      formControlName="format"
                      label="Formato para redes"
                      [options]="formatOptions"
                      [hideLabelsOnMobile]="false"
                    ></app-input-buttons>

                    <app-manual-ad-editor
                      [imageUrl]="selectedManualImageProxyUrl()"
                      [format]="selectedManualFormat()"
                    ></app-manual-ad-editor>

                    <div
                      class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <app-button
                        variant="outline"
                        size="md"
                        type="button"
                        (clicked)="downloadManualCanvas()"
                        [disabled]="!selectedManualImage()"
                      >
                        <app-icon
                          slot="icon"
                          name="download"
                          [size]="16"
                        ></app-icon>
                        Descargar lienzo
                      </app-button>

                      <app-button
                        variant="primary"
                        size="md"
                        type="button"
                        [loading]="savingManual()"
                        [disabled]="manualSubmitDisabled()"
                        (clicked)="createManualAnuncio()"
                      >
                        <app-icon
                          slot="icon"
                          name="save"
                          [size]="16"
                        ></app-icon>
                        Guardar manual
                      </app-button>
                    </div>
                  </form>
                }
              </div>
            </app-card>
          </div>

          <div class="space-y-4">
            @if (resultFocused() && !resourcesExpanded()) {
              <app-card [responsive]="true" [padding]="false">
                <div class="space-y-4 p-4 md:p-5">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <h2
                        class="text-base font-semibold text-[var(--color-text-primary)]"
                      >
                        Recursos
                      </h2>
                      <p class="text-sm text-[var(--color-text-secondary)]">
                        {{ selectedProductIds().length }} productos,
                        {{ selectedImageCount() }} imagenes
                      </p>
                    </div>
                    <app-icon
                      name="layers"
                      [size]="20"
                      class="text-[var(--color-primary)]"
                    ></app-icon>
                  </div>

                  <div class="space-y-2">
                    @for (product of selectedProducts(); track product.id) {
                      <div
                        class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2"
                      >
                        <div
                          class="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-[var(--color-background)]"
                        >
                          @if (productPreview(product)) {
                            <img
                              class="h-full w-full object-cover"
                              [src]="productPreview(product)"
                              [alt]="product.name"
                            />
                          } @else {
                            <div
                              class="flex h-full w-full items-center justify-center"
                            >
                              <app-icon name="image" [size]="14"></app-icon>
                            </div>
                          }
                        </div>
                        <span
                          class="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text-primary)]"
                        >
                          {{ product.name }}
                        </span>
                      </div>
                    }
                  </div>

                  <app-button
                    variant="outline"
                    size="md"
                    type="button"
                    [fullWidth]="true"
                    (clicked)="resourcesExpanded.set(true)"
                  >
                    <app-icon slot="icon" name="pencil" [size]="16"></app-icon>
                    Editar recursos
                  </app-button>
                </div>
              </app-card>
            } @else {
              <app-card [responsive]="true" [padding]="false">
                <div
                  class="border-b border-[var(--color-border)] px-4 py-4 md:px-5"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <h2
                        class="text-base font-semibold text-[var(--color-text-primary)]"
                      >
                        Productos
                      </h2>
                      <p class="text-sm text-[var(--color-text-secondary)]">
                        {{ selectedProductIds().length }} seleccionados
                      </p>
                    </div>
                    <app-icon
                      name="package"
                      [size]="20"
                      class="text-[var(--color-primary)]"
                    ></app-icon>
                  </div>
                </div>

                <div class="space-y-3 p-4 md:p-5">
                  <app-inputsearch
                    size="sm"
                    placeholder="Buscar productos..."
                    [debounceTime]="300"
                    [formControl]="productSearchControl"
                    (searchChange)="productSearch.set($event)"
                  ></app-inputsearch>

                  @if (productsLoading()) {
                    <div
                      class="flex min-h-40 items-center justify-center text-sm text-[var(--color-text-secondary)]"
                    >
                      <app-icon
                        name="loader-2"
                        [size]="18"
                        [spin]="true"
                      ></app-icon>
                      <span class="ml-2">Cargando productos...</span>
                    </div>
                  } @else if (productsError()) {
                    <app-empty-state
                      size="sm"
                      icon="triangle-alert"
                      iconColor="error"
                      title="No se pudieron cargar productos"
                      [description]="productsError()!"
                      [showActionButton]="false"
                      [showRefreshButton]="true"
                      (refreshClick)="loadProducts(true)"
                    ></app-empty-state>
                  } @else if (!filteredProducts().length) {
                    <app-empty-state
                      size="sm"
                      icon="package"
                      title="Sin productos"
                      description="No hay productos para la busqueda actual."
                      [showActionButton]="false"
                    ></app-empty-state>
                  } @else {
                    <div
                      class="max-h-[250px] overflow-y-auto rounded-xl border border-[var(--color-border)]"
                    >
                      @for (product of filteredProducts(); track product.id) {
                        <button
                          type="button"
                          class="flex w-full items-center gap-3 border-b border-l-4 border-b-[var(--color-border)] px-3 py-2.5 text-left last:border-b-0 hover:bg-[var(--color-surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/35"
                          [style.border-left-color]="
                            isProductSelected(product.id)
                              ? 'var(--color-primary)'
                              : 'transparent'
                          "
                          [style.background]="
                            isProductSelected(product.id)
                              ? 'rgba(var(--color-primary-rgb), 0.12)'
                              : null
                          "
                          [style.box-shadow]="
                            isProductSelected(product.id)
                              ? 'inset 0 0 0 1px rgba(var(--color-primary-rgb), 0.28)'
                              : null
                          "
                          (click)="toggleProduct(product)"
                        >
                          <div
                            class="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[var(--color-surface-muted)]"
                          >
                            @if (productPreview(product)) {
                              <img
                                class="h-full w-full object-cover"
                                [src]="productPreview(product)"
                                [alt]="product.name"
                              />
                            } @else {
                              <div
                                class="flex h-full w-full items-center justify-center"
                              >
                                <app-icon name="image" [size]="18"></app-icon>
                              </div>
                            }

                            @if (isProductSelected(product.id)) {
                              <span
                                class="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-text-on-primary)] shadow-sm"
                              >
                                <app-icon name="check" [size]="12"></app-icon>
                              </span>
                            }

                            @if (isProductImagesLoading(product.id)) {
                              <span
                                class="absolute inset-0 flex items-center justify-center bg-black/35 text-white"
                              >
                                <app-icon
                                  name="loader-2"
                                  [size]="16"
                                  [spin]="true"
                                ></app-icon>
                              </span>
                            }
                          </div>

                          <div class="min-w-0 flex-1">
                            <p class="truncate text-sm font-medium">
                              {{ product.name }}
                            </p>
                            <p class="truncate text-xs opacity-75">
                              {{ product.sku || 'Sin SKU' }}
                            </p>
                          </div>

                          @if (isProductSelected(product.id)) {
                            <span
                              class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-text-on-primary)] shadow-sm"
                            >
                              <app-icon name="check" [size]="16"></app-icon>
                            </span>
                          } @else {
                            <span
                              class="h-7 w-7 shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]"
                              aria-hidden="true"
                            ></span>
                          }
                        </button>
                      }
                    </div>
                  }
                </div>
              </app-card>

              <app-card [responsive]="true" [padding]="false">
                <div
                  class="border-b border-[var(--color-border)] px-4 py-4 md:px-5"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <h2
                        class="text-base font-semibold text-[var(--color-text-primary)]"
                      >
                        Galeria
                      </h2>
                      <p class="text-sm text-[var(--color-text-secondary)]">
                        {{ galleryImages().length }} imagenes disponibles
                      </p>
                    </div>
                    <app-icon
                      name="images"
                      [size]="20"
                      class="text-[var(--color-primary)]"
                    ></app-icon>
                  </div>
                </div>

                <div class="p-4 md:p-5">
                  @if (!selectedProductIds().length) {
                    <app-empty-state
                      size="sm"
                      icon="images"
                      title="Selecciona productos"
                      description="La galeria se llena con las imagenes disponibles."
                      [showActionButton]="false"
                    ></app-empty-state>
                  } @else if (isLoadingSelectedProductImages()) {
                    <div
                      class="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] text-sm text-[var(--color-text-secondary)]"
                    >
                      <app-icon
                        name="loader-2"
                        [size]="18"
                        [spin]="true"
                      ></app-icon>
                      <span class="ml-2">Cargando imagenes...</span>
                    </div>
                  } @else if (!galleryImages().length) {
                    <app-empty-state
                      size="sm"
                      icon="image-off"
                      title="Sin imagenes"
                      description="Los productos seleccionados no tienen imagenes disponibles."
                      [showActionButton]="false"
                    ></app-empty-state>
                  } @else {
                    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      @for (item of galleryImages(); track item.image.id) {
                        <button
                          type="button"
                          class="group relative aspect-square overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40"
                          [class.ring-2]="
                            isReferenceImageSelected(item.image.id) ||
                            isManualImageSelected(item.image.id)
                          "
                          [class.ring-primary]="
                            isReferenceImageSelected(item.image.id) ||
                            isManualImageSelected(item.image.id)
                          "
                          (click)="selectGalleryImage(item.image)"
                          [attr.aria-label]="
                            'Seleccionar imagen de ' + item.product.name
                          "
                        >
                          <img
                            class="h-full w-full object-cover"
                            [src]="item.image.image_url"
                            [alt]="item.product.name"
                          />

                          <span
                            class="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-xs font-medium text-white"
                          >
                            {{ item.product.name }}
                          </span>

                          <span
                            class="absolute left-1 top-1 flex flex-wrap gap-1"
                          >
                            @if (isReferenceImageSelected(item.image.id)) {
                              <span
                                class="rounded-full bg-[var(--color-primary)] px-2 py-0.5 text-[10px] font-semibold text-white"
                              >
                                IA
                              </span>
                            }
                            @if (isManualImageSelected(item.image.id)) {
                              <span
                                class="rounded-full bg-black/75 px-2 py-0.5 text-[10px] font-semibold text-white"
                              >
                                Manual
                              </span>
                            }
                          </span>
                        </button>
                      }
                    </div>
                  }
                </div>
              </app-card>
            }
          </div>
        </div>
      </div>

      <app-modal
        [isOpen]="detailsModalOpen()"
        (isOpenChange)="detailsModalOpen.set($event)"
        title="Guardar detalles"
        subtitle="Nombre y descripcion opcionales para encontrar el anuncio despues."
        size="md"
      >
        <form
          id="ad-details-form"
          class="space-y-4"
          [formGroup]="detailsForm"
          (ngSubmit)="saveDetails()"
        >
          <app-input
            formControlName="title"
            label="Nombre"
            placeholder="Anuncio para redes"
            [control]="detailsForm.controls.title"
          ></app-input>

          <app-textarea
            formControlName="description"
            label="Descripcion"
            placeholder="Referencia interna para tu equipo"
            [rows]="3"
            [control]="detailsForm.controls.description"
          ></app-textarea>
        </form>

        <div
          slot="footer"
          class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
        >
          <app-button
            variant="outline"
            size="md"
            type="button"
            (clicked)="detailsModalOpen.set(false)"
          >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            size="md"
            type="submit"
            form="ad-details-form"
            [loading]="savingDetails()"
          >
            <app-icon slot="icon" name="save" [size]="16"></app-icon>
            Guardar
          </app-button>
        </div>
      </app-modal>
    </div>
  `,
})
export class AnuncioCreatePageComponent {
  private readonly anunciosService = inject(AnunciosService);
  private readonly assetService = inject(AdCreativeAssetService);
  private readonly productsService = inject(ProductsService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private readonly manualEditor = viewChild(ManualAdEditorComponent);
  private readonly aiFormVersion = signal(0);
  private readonly manualFormVersion = signal(0);

  protected readonly activeMode = signal<CreationMode>('ai');
  protected readonly creationExpanded = signal(true);
  protected readonly resourcesExpanded = signal(true);
  protected readonly detailsModalOpen = signal(false);
  protected readonly detailsTarget = signal<DetailsTarget>('ai');
  protected readonly selectedAiFormat = signal<AdCreativeFormat>('square');
  protected readonly selectedManualFormat = signal<AdCreativeFormat>('square');
  protected readonly products = signal<Product[]>([]);
  protected readonly productsLoading = signal(false);
  protected readonly productsLoaded = signal(false);
  protected readonly productsError = signal<string | null>(null);
  protected readonly loadingProductImageIds = signal<number[]>([]);
  protected readonly loadedProductImageIds = signal<number[]>([]);
  protected readonly selectedProductIds = signal<number[]>([]);
  protected readonly selectedImageIds = signal<number[]>([]);
  protected readonly manualImageId = signal<number | null>(null);
  protected readonly productSearch = signal('');
  protected readonly creating = signal(false);
  protected readonly generating = signal(false);
  protected readonly savingManual = signal(false);
  protected readonly savingDetails = signal(false);
  protected readonly generationMessage = signal('Preparando recursos...');
  protected readonly generationPreview = signal<string | null>(null);
  protected readonly generationResult = signal<MarketingAdCreative | null>(
    null,
  );
  protected readonly manualResult = signal<MarketingAdCreative | null>(null);
  protected readonly generationError = signal<string | null>(null);

  protected readonly toggleBoolean = (value: boolean) => !value;

  protected readonly creationTabs: StickyHeaderTab[] = [
    {
      id: 'ai',
      label: 'Generacion con IA',
      shortLabel: 'IA',
      icon: 'sparkles',
    },
    {
      id: 'manual',
      label: 'Generacion manual',
      shortLabel: 'Manual',
      icon: 'palette',
    },
  ];

  protected readonly formatOptions: InputButtonOption[] = [
    { value: 'square', label: '1:1 Feed', icon: 'layout-grid' },
    { value: 'story', label: '9:16 Stories', icon: 'smartphone' },
    { value: 'landscape', label: '16:9 Banner', icon: 'monitor' },
  ];

  private readonly aiPromptPlaceholders = [
    'Ejemplo: Crea una pieza premium para Instagram feed con composicion limpia, producto protagonista en primer plano, fondo de cocina moderna con luz natural, reflejos suaves, paleta blanco/calido/verde oliva, texto corto de oferta integrado en una zona con alto contraste y sensacion de marca confiable.',
    'Ejemplo: Genera una historia vertical 9:16 para lanzamiento relampago, estilo editorial de tienda boutique, producto con sombras realistas, capa visual de urgencia sin saturar, espacio superior para frase fuerte, detalle de precio destacado y cierre visual que invite a comprar hoy.',
    'Ejemplo: Disena un anuncio horizontal para banner de ecommerce, con jerarquia clara: producto principal a la derecha, beneficios resumidos a la izquierda, profundidad con elementos de contexto del hogar, iluminacion cinematografica suave, acabados realistas y apariencia lista para pauta digital.',
    'Ejemplo: Construye una imagen de promocion para varios productos seleccionados, agrupados como kit de valor, con composicion balanceada, texturas reales, fondo neutro sofisticado, acentos de color de temporada, mensaje comercial elegante y lectura inmediata en pantalla movil.',
    'Ejemplo: Crea una creatividad tipo flyer moderno para redes, producto muy nitido, ambiente aspiracional pero creible, contraste alto para texto, sin exceso de elementos, sensacion de descuento exclusivo, llamado visual a descubrir la oferta y acabado profesional de campana.',
  ];

  protected readonly aiPromptPlaceholder = signal(
    this.pickAiPromptPlaceholder(),
  );

  protected readonly aiForm = new FormGroup<AiFormControls>({
    prompt: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(2000)],
    }),
    format: new FormControl<AdCreativeFormat>('square', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  protected readonly manualForm = new FormGroup<ManualFormControls>({
    format: new FormControl<AdCreativeFormat>('square', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  protected readonly detailsForm = new FormGroup<DetailsFormControls>({
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(255)],
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(1000)],
    }),
  });

  protected readonly productSearchControl = new FormControl('', {
    nonNullable: true,
  });

  protected readonly resultFocused = computed(() => {
    if (this.activeMode() === 'manual') return !!this.manualResult();
    return this.generating() || !!this.generationPreview();
  });

  protected readonly activeResult = computed(() =>
    this.activeMode() === 'manual'
      ? this.manualResult()
      : this.generationResult(),
  );

  protected readonly activeResultImage = computed(() =>
    this.activeMode() === 'manual'
      ? this.manualResult()?.image_url || null
      : this.generationPreview(),
  );

  protected readonly currentFormat = computed(() =>
    this.activeMode() === 'manual'
      ? this.selectedManualFormat()
      : this.selectedAiFormat(),
  );

  protected readonly selectedImageCount = computed(() =>
    this.activeMode() === 'manual'
      ? this.selectedManualImage()
        ? 1
        : 0
      : this.selectedImageIds().length,
  );

  protected readonly aiPromptPreview = computed(() =>
    this.aiForm.controls.prompt.value.trim(),
  );

  protected readonly filteredProducts = computed(() => {
    const query = this.productSearch().trim().toLowerCase();
    if (!query) return this.products();

    return this.products().filter((product) => {
      const sku = product.sku?.toLowerCase() || '';
      return product.name.toLowerCase().includes(query) || sku.includes(query);
    });
  });

  protected readonly selectedProducts = computed(() => {
    const ids = new Set(this.selectedProductIds());
    return this.products().filter((product) => ids.has(product.id));
  });

  protected readonly galleryImages = computed<GalleryImage[]>(() =>
    this.selectedProducts().flatMap((product) =>
      (product.product_images || []).map((image) => ({ product, image })),
    ),
  );

  protected readonly selectedManualImage = computed(
    () =>
      this.galleryImages().find(
        (item) => item.image.id === this.manualImageId(),
      )?.image || null,
  );

  protected readonly selectedManualImageProxyUrl = computed(() => {
    const image = this.selectedManualImage();
    return image ? this.anunciosService.productImageProxyUrl(image.id) : null;
  });

  protected readonly isLoadingSelectedProductImages = computed(() => {
    const loadingIds = new Set(this.loadingProductImageIds());
    return this.selectedProductIds().some((id) => loadingIds.has(id));
  });

  protected readonly selectedProductsBadge = computed(() => {
    const count = this.selectedProductIds().length;
    return count === 1 ? '1 producto' : `${count} productos`;
  });

  protected readonly aiSubmitDisabled = computed(() => {
    this.aiFormVersion();
    return (
      this.aiForm.invalid ||
      !this.selectedProductIds().length ||
      this.creating() ||
      this.generating() ||
      this.productsLoading() ||
      this.isLoadingSelectedProductImages()
    );
  });

  protected readonly manualSubmitDisabled = computed(() => {
    this.manualFormVersion();
    return (
      this.manualForm.invalid ||
      !this.selectedProductIds().length ||
      !this.selectedManualImage() ||
      this.savingManual() ||
      this.productsLoading() ||
      this.isLoadingSelectedProductImages()
    );
  });

  private pickAiPromptPlaceholder(): string {
    const index = Math.floor(Math.random() * this.aiPromptPlaceholders.length);
    return this.aiPromptPlaceholders[index] || this.aiPromptPlaceholders[0];
  }

  constructor() {
    this.aiForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.aiFormVersion.update((current) => current + 1);
        if (value.format) this.selectedAiFormat.set(value.format);
      });

    this.manualForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.manualFormVersion.update((current) => current + 1);
        if (value.format) this.selectedManualFormat.set(value.format);
      });

    void this.loadProducts();
  }

  protected async loadProducts(force = false): Promise<void> {
    if (!force && (this.productsLoaded() || this.productsLoading())) return;

    this.productsLoading.set(true);
    this.productsError.set(null);

    try {
      const response = await firstValueFrom(
        this.productsService.getProducts({ limit: 80 }),
      );
      this.products.set(response.data || []);
      this.productsLoaded.set(true);
    } catch (error: any) {
      this.products.set([]);
      this.productsLoaded.set(false);
      this.productsError.set(extractApiErrorMessage(error));
    } finally {
      this.productsLoading.set(false);
    }
  }

  protected setMode(tabId: string): void {
    if (tabId === 'ai' || tabId === 'manual') {
      this.activeMode.set(tabId);
      this.creationExpanded.set(!this.resultFocused());
      this.resourcesExpanded.set(!this.resultFocused());
    }
  }

  protected async toggleProduct(product: Product): Promise<void> {
    const exists = this.selectedProductIds().includes(product.id);

    if (exists) {
      this.selectedProductIds.set(
        this.selectedProductIds().filter((id) => id !== product.id),
      );
      const productImageIds = new Set(
        (product.product_images || []).map((image) => image.id),
      );
      this.selectedImageIds.set(
        this.selectedImageIds().filter((id) => !productImageIds.has(id)),
      );
      if (
        this.manualImageId() !== null &&
        productImageIds.has(this.manualImageId()!)
      ) {
        this.manualImageId.set(null);
      }
      return;
    }

    this.selectedProductIds.set([...this.selectedProductIds(), product.id]);
    await this.ensureProductImagesLoaded(product.id);

    const hydratedProduct =
      this.products().find((item) => item.id === product.id) || product;
    const mainImage =
      hydratedProduct.product_images?.find((image) => image.is_main) ||
      hydratedProduct.product_images?.[0];

    if (mainImage && !this.selectedImageIds().includes(mainImage.id)) {
      this.selectedImageIds.set([...this.selectedImageIds(), mainImage.id]);
    }

    if (mainImage && this.manualImageId() === null) {
      this.manualImageId.set(mainImage.id);
    }
  }

  protected selectGalleryImage(image: ProductImage): void {
    if (this.activeMode() === 'manual') {
      this.manualImageId.set(image.id);
      return;
    }

    this.toggleReferenceImage(image.id);
  }

  protected toggleReferenceImage(imageId: number): void {
    const selected = this.selectedImageIds();
    this.selectedImageIds.set(
      selected.includes(imageId)
        ? selected.filter((id) => id !== imageId)
        : [...selected, imageId],
    );
  }

  protected async createAiAnuncio(): Promise<void> {
    if (this.aiSubmitDisabled()) {
      this.toastService.error('Selecciona al menos un producto.');
      return;
    }

    this.creating.set(true);
    this.generationError.set(null);
    this.generationPreview.set(null);
    this.generationResult.set(null);
    this.creationExpanded.set(false);
    this.resourcesExpanded.set(false);

    try {
      const raw = this.aiForm.getRawValue();
      const dto: CreateMarketingAdCreativeDto = {
        title: this.defaultTitle('Anuncio IA'),
        prompt: raw.prompt.trim() || undefined,
        format: raw.format,
        product_ids: this.selectedProductIds(),
        product_image_ids: this.selectedImageIds(),
      };
      const response = await firstValueFrom(
        this.anunciosService.createAnuncio(dto),
      );
      this.startGeneration(response.data.id);
    } catch (error: any) {
      this.creationExpanded.set(true);
      this.resourcesExpanded.set(true);
      this.generationError.set(extractApiErrorMessage(error));
    } finally {
      this.creating.set(false);
    }
  }

  protected async createManualAnuncio(): Promise<void> {
    if (this.manualSubmitDisabled()) {
      this.toastService.error('Selecciona productos y una imagen de galeria.');
      return;
    }

    const imageBase64 = this.manualEditor()?.exportImage();
    if (!imageBase64) return;

    this.savingManual.set(true);
    try {
      const raw = this.manualForm.getRawValue();
      const imageId = this.selectedManualImage()!.id;
      const dto: CreateManualMarketingAdCreativeDto = {
        title: this.defaultTitle('Anuncio manual'),
        prompt: 'Creacion manual desde editor visual',
        format: raw.format,
        product_ids: this.selectedProductIds(),
        product_image_ids: [imageId],
        image_base64: imageBase64,
      };
      const response = await firstValueFrom(
        this.anunciosService.createManualAnuncio(dto),
      );
      this.manualResult.set(response.data);
      this.creationExpanded.set(false);
      this.resourcesExpanded.set(false);
      this.toastService.success('Anuncio manual guardado.');
    } catch (error: any) {
      this.toastService.error(extractApiErrorMessage(error));
    } finally {
      this.savingManual.set(false);
    }
  }

  protected openDetailsModal(target: DetailsTarget): void {
    const creative =
      target === 'manual' ? this.manualResult() : this.generationResult();
    if (!creative) return;

    this.detailsTarget.set(target);
    this.detailsForm.reset({
      title: creative.title || this.defaultTitle('Anuncio'),
      description: creative.description || '',
    });
    this.detailsModalOpen.set(true);
  }

  protected async saveDetails(): Promise<void> {
    const target = this.detailsTarget();
    const creative =
      target === 'manual' ? this.manualResult() : this.generationResult();

    if (!creative || this.savingDetails()) return;

    this.savingDetails.set(true);
    try {
      const raw = this.detailsForm.getRawValue();
      const response = await firstValueFrom(
        this.anunciosService.updateAnuncioDetails(creative.id, {
          title: raw.title.trim() || creative.title || this.defaultTitle(),
          description:
            raw.description.trim() ||
            creative.description ||
            this.defaultDescription(),
        }),
      );

      if (target === 'manual') {
        this.manualResult.set(response.data);
      } else {
        this.generationResult.set(response.data);
        this.generationPreview.set(response.data.image_url || null);
      }

      this.detailsModalOpen.set(false);
      this.toastService.success('Detalles guardados.');
    } catch (error: any) {
      this.toastService.error(extractApiErrorMessage(error));
    } finally {
      this.savingDetails.set(false);
    }
  }

  protected downloadManualCanvas(): void {
    const imageBase64 = this.manualEditor()?.exportImage();
    if (!imageBase64) return;

    this.downloadDataUrl(
      imageBase64,
      `${this.fileSlug(this.defaultTitle())}.png`,
    );
  }

  protected goBack(): void {
    void this.router.navigate(['/admin/marketing/anuncios']);
  }

  protected isProductSelected(id: number): boolean {
    return this.selectedProductIds().includes(id);
  }

  protected isProductImagesLoading(id: number): boolean {
    return this.loadingProductImageIds().includes(id);
  }

  protected isReferenceImageSelected(id: number): boolean {
    return this.selectedImageIds().includes(id);
  }

  protected isManualImageSelected(id: number): boolean {
    return this.manualImageId() === id;
  }

  protected productPreview(product: Product): string | null {
    return (
      product.product_images?.find((image) => image.is_main)?.image_url ||
      product.product_images?.[0]?.image_url ||
      product.image_url ||
      null
    );
  }

  protected formatLabel(format: AdCreativeFormat): string {
    const labels: Record<AdCreativeFormat, string> = {
      square: '1:1 Feed',
      story: '9:16 Stories/Reels',
      landscape: '16:9 Banner',
    };
    return labels[format];
  }

  protected formatAspectClass(format: AdCreativeFormat): string {
    const classes: Record<AdCreativeFormat, string> = {
      square: 'aspect-square',
      story: 'aspect-[9/16]',
      landscape: 'aspect-[16/9]',
    };
    return classes[format];
  }

  protected copyImage(creative: MarketingAdCreative): Promise<void> {
    return this.assetService.copy(creative);
  }

  protected downloadImage(creative: MarketingAdCreative): Promise<void> {
    return this.assetService.download(creative);
  }

  protected shareImage(creative: MarketingAdCreative): Promise<void> {
    return this.assetService.share(creative);
  }

  private startGeneration(id: number): void {
    if (this.generating()) return;

    this.generating.set(true);
    this.generationMessage.set('Preparando recursos...');

    this.anunciosService
      .streamGenerate(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => {
          if (event.type === 'progress') {
            this.generationMessage.set(event.message || 'Generando imagen...');
          }

          if (event.type === 'partial_image' && event.imageBase64) {
            this.generationMessage.set('Recibiendo vista previa...');
            this.generationPreview.set(
              `data:image/png;base64,${event.imageBase64}`,
            );
          }

          if (event.type === 'completed' && event.creative) {
            this.generationResult.set(event.creative);
            this.generationPreview.set(event.creative.image_url || null);
            this.generationMessage.set('Anuncio listo.');
          }

          if (event.type === 'done') {
            this.generating.set(false);
          }

          if (event.type === 'error') {
            this.generating.set(false);
            this.creationExpanded.set(true);
            this.generationError.set(
              event.error || 'No se pudo generar la imagen.',
            );
          }
        },
        error: () => {
          this.generating.set(false);
          this.creationExpanded.set(true);
          this.generationError.set('No se pudo conectar con la generacion.');
        },
      });
  }

  private async ensureProductImagesLoaded(productId: number): Promise<void> {
    if (
      this.loadedProductImageIds().includes(productId) ||
      this.loadingProductImageIds().includes(productId)
    ) {
      return;
    }

    const currentProduct = this.products().find(
      (product) => product.id === productId,
    );
    if (currentProduct?.product_images?.length) {
      this.loadedProductImageIds.set([
        ...this.loadedProductImageIds(),
        productId,
      ]);
      return;
    }

    this.loadingProductImageIds.set([
      ...this.loadingProductImageIds(),
      productId,
    ]);

    try {
      const product = await firstValueFrom(
        this.productsService.getProductById(productId),
      );
      this.products.set(
        this.products().map((item) =>
          item.id === productId
            ? {
                ...item,
                ...product,
                product_images: product.product_images || [],
              }
            : item,
        ),
      );
      this.loadedProductImageIds.set([
        ...this.loadedProductImageIds(),
        productId,
      ]);
    } catch (error: any) {
      this.toastService.error(extractApiErrorMessage(error));
    } finally {
      this.loadingProductImageIds.set(
        this.loadingProductImageIds().filter((id) => id !== productId),
      );
    }
  }

  private downloadDataUrl(dataUrl: string, filename: string): void {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.click();
  }

  private defaultTitle(prefix = 'Anuncio'): string {
    return `${prefix} ${this.dateLabel()}`;
  }

  private defaultDescription(): string {
    return `Creado desde Anuncios el ${this.dateLabel()}.`;
  }

  private dateLabel(): string {
    return new Intl.DateTimeFormat('es-CO', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
  }

  private fileSlug(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
  }
}
