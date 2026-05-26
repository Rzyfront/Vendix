import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
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
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  InputButtonOption,
  InputButtonsComponent,
  InputsearchComponent,
  StepsLineComponent,
  StickyHeaderComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../shared/components';
import {
  Product,
  ProductImage,
} from '../../../products/interfaces/product.interface';
import { ProductImageSourceModalComponent } from '../../../products/components/product-image-source-modal.component';
import { ProductsService } from '../../../products/services/products.service';
import {
  EcommerceSettings,
  SettingsResponse as EcommerceSettingsResponse,
} from '../../../ecommerce/interfaces';
import { EcommerceService } from '../../../ecommerce/services/ecommerce.service';
import {
  AdCreativeFormat,
  CreateMarketingAdCreativeDto,
  MarketingAdCreative,
  MarketingAdReferenceImageDto,
} from '../anuncios.interface';
import { AnunciosService } from '../anuncios.service';

interface WizardFormControls {
  intent: FormControl<string>;
  channel: FormControl<string>;
  cta: FormControl<string>;
  visual_style: FormControl<string>;
  brief: FormControl<string>;
  prompt: FormControl<string>;
  format: FormControl<AdCreativeFormat>;
}

interface GalleryImage {
  product: Product;
  image: ProductImage;
}

interface ReferenceResource extends MarketingAdReferenceImageDto {
  id: string;
  label: string;
  preview_url: string;
}

interface SelectedResourcePreview {
  id: string;
  label: string;
  preview_url: string;
  source_type: string;
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
    InputsearchComponent,
    ProductImageSourceModalComponent,
    StepsLineComponent,
    StickyHeaderComponent,
    TextareaComponent,
  ],
  template: `
    <div class="ai-wizard-shell min-h-screen">
      <app-sticky-header
        title="Crear anuncio"
        subtitle="Crea una imagen y un post listo para publicar."
        icon="sparkles"
        [showBackButton]="true"
        [backRoute]="['/admin/marketing/anuncios']"
        [badgeText]="stepBadge()"
        badgeColor="blue"
      ></app-sticky-header>

      <div class="p-2 md:p-6">
        <div
          class="mx-auto grid max-w-7xl gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"
        >
          <div class="space-y-4">
            <app-card [responsive]="true" [padding]="false">
              <div class="ai-step-ribbon px-4 py-3 md:px-6">
                <app-steps-line
                  [steps]="wizardSteps"
                  [currentStep]="currentStep()"
                  [clickable]="true"
                  size="sm"
                  (stepClicked)="goToStep($event)"
                ></app-steps-line>
              </div>

              <form class="space-y-5 p-4 md:p-6" [formGroup]="form">
                @if (currentStep() === 0) {
                  <section class="space-y-5">
                    <div class="ai-hero-panel rounded-2xl p-4 md:p-5">
                      <div class="flex items-start gap-3">
                        <span
                          class="ai-icon-glow flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--color-primary)]"
                        >
                          <app-icon name="sparkles" [size]="20"></app-icon>
                        </span>
                        <div>
                          <h2
                            class="text-base font-semibold text-[var(--color-text-primary)]"
                          >
                            Que quieres comunicar?
                          </h2>
                          <p
                            class="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]"
                          >
                            Elige una intencion y escribe una idea corta. Puede
                            ser una tienda, un servicio, un producto, una
                            novedad o un QR.
                          </p>
                        </div>
                      </div>
                    </div>

                    <app-input-buttons
                      class="min-w-0"
                      formControlName="intent"
                      label="Objetivo"
                      [options]="intentOptions"
                      [hideLabelsOnMobile]="false"
                      [equalWidth]="false"
                      customWrapperClass="ai-choice-buttons"
                      customContainerClass="ai-choice-buttons__container flex-wrap h-auto"
                    ></app-input-buttons>

                    <app-input-buttons
                      class="min-w-0"
                      formControlName="channel"
                      label="Canal"
                      [options]="channelOptions"
                      [hideLabelsOnMobile]="false"
                      [equalWidth]="false"
                      customWrapperClass="ai-choice-buttons"
                      customContainerClass="ai-choice-buttons__container flex-wrap h-auto"
                    ></app-input-buttons>

                    <app-textarea
                      formControlName="brief"
                      label="Idea rapida"
                      placeholder="Ejemplo: quiero destacar mi tienda y que las personas escaneen el QR para ver el catalogo."
                      [rows]="5"
                    ></app-textarea>
                  </section>
                }

                @if (currentStep() === 1) {
                  <section class="space-y-5">
                    <div
                      class="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]"
                    >
                      <section
                        class="ai-glow-panel overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm"
                      >
                        <div
                          class="flex flex-col gap-4 border-b border-[var(--color-border)] px-4 py-4 sm:flex-row sm:items-start sm:justify-between md:px-5"
                        >
                          <div class="flex min-w-0 items-start gap-3">
                            <span
                              class="ai-icon-glow flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--color-primary)]"
                            >
                              <app-icon name="images" [size]="20"></app-icon>
                            </span>
                            <div class="min-w-0">
                              <h2
                                class="text-base font-semibold leading-6 text-[var(--color-text-primary)]"
                              >
                                Recursos de tienda
                              </h2>
                              <p
                                class="mt-1 max-w-xl text-sm leading-5 text-[var(--color-text-secondary)]"
                              >
                                Logo, QR, sliders y fotos propias para guiar la
                                pieza visual.
                              </p>
                            </div>
                          </div>

                          <div class="flex shrink-0 items-center gap-2">
                            <span
                              class="rounded-full bg-[var(--color-surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--color-text-secondary)]"
                            >
                              {{ selectedReferenceResources().length }}
                              seleccionados
                            </span>
                            <app-button
                              variant="outline"
                              size="sm"
                              type="button"
                              (clicked)="resourceModalOpen.set(true)"
                            >
                              <app-icon
                                slot="icon"
                                name="upload-cloud"
                                [size]="15"
                              ></app-icon>
                              Agregar
                            </app-button>
                          </div>
                        </div>

                        <div class="p-4 md:p-5">
                          @if (referenceResources().length) {
                            <div
                              class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
                            >
                              @for (
                                resource of referenceResources();
                                track resource.id
                              ) {
                                <button
                                type="button"
                                  class="ai-resource-card group relative overflow-hidden rounded-2xl border bg-[var(--color-background)] p-2 text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/35"
                                  [style.border-color]="
                                    isReferenceSelected(resource.id)
                                      ? 'var(--color-primary)'
                                      : 'var(--color-border)'
                                  "
                                  [style.box-shadow]="
                                    isReferenceSelected(resource.id)
                                      ? '0 12px 30px rgba(var(--color-primary-rgb), 0.14)'
                                      : null
                                  "
                                  (click)="toggleReferenceResource(resource.id)"
                                >
                                  <div
                                    class="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background)]"
                                  >
                                    <img
                                      class="h-full w-full object-contain p-3"
                                      [src]="resource.preview_url"
                                      [alt]="resource.label"
                                      (error)="hideBrokenImage($event)"
                                    />
                                  </div>
                                  <div class="min-w-0 px-1 pt-2">
                                    <p
                                      class="truncate text-sm font-semibold text-[var(--color-text-primary)]"
                                    >
                                      {{ resource.label }}
                                    </p>
                                    <p
                                      class="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]"
                                    >
                                      {{
                                        resource.source_type?.includes('qr')
                                          ? 'QR exacto'
                                          : 'Referencia visual'
                                      }}
                                    </p>
                                  </div>
                                  @if (isReferenceSelected(resource.id)) {
                                    <span
                                      class="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-primary)] text-white shadow-sm"
                                    >
                                      <app-icon
                                        name="check"
                                        [size]="14"
                                      ></app-icon>
                                    </span>
                                  }
                                </button>
                              }
                            </div>
                          } @else {
                            <app-empty-state
                              size="sm"
                              icon="images"
                              title="Sin recursos de tienda"
                              description="Puedes continuar sin imagenes o agregar una foto, QR o logo."
                              [showActionButton]="false"
                            ></app-empty-state>
                          }

                          @if (selectedQrCount()) {
                            <div class="mt-4">
                              <app-alert-banner variant="info" icon="barcode">
                                El QR seleccionado se insertara identico en la
                                imagen final, con buen contraste y sin tapar el
                                diseno.
                              </app-alert-banner>
                            </div>
                          }
                        </div>
                      </section>

                      <section
                        class="ai-glow-panel overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm"
                      >
                        <div
                          class="border-b border-[var(--color-border)] px-4 py-4 md:px-5"
                        >
                          <div class="flex items-start justify-between gap-3">
                            <div class="flex min-w-0 items-start gap-3">
                              <span
                                class="ai-icon-glow flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--color-primary)]"
                              >
                                <app-icon
                                  name="package"
                                  [size]="20"
                                ></app-icon>
                              </span>
                              <div class="min-w-0">
                                <h2
                                  class="text-base font-semibold leading-6 text-[var(--color-text-primary)]"
                                >
                                  Productos y servicios
                                </h2>
                                <p
                                  class="mt-1 text-sm leading-5 text-[var(--color-text-secondary)]"
                                >
                                  Elige solo lo que debe influir en el anuncio.
                                </p>
                              </div>
                            </div>
                            <span
                              class="shrink-0 rounded-full bg-[var(--color-surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--color-text-secondary)]"
                            >
                              {{ selectedProductIds().length }} elegidos
                            </span>
                          </div>

                          <div class="mt-4">
                            <app-inputsearch
                              size="sm"
                              placeholder="Buscar productos o servicios..."
                              [debounceTime]="300"
                              [formControl]="productSearchControl"
                              (searchChange)="productSearch.set($event)"
                            ></app-inputsearch>
                          </div>
                        </div>

                        <div class="p-3 md:p-4">
                          @if (productsLoading()) {
                            <div
                              class="flex min-h-36 items-center justify-center rounded-xl bg-[var(--color-surface-muted)] text-sm text-[var(--color-text-secondary)]"
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
                              icon="search-x"
                              title="Sin resultados"
                              description="Prueba con otro nombre o SKU."
                              [showActionButton]="false"
                            ></app-empty-state>
                          } @else {
                            <div class="max-h-[430px] space-y-2 overflow-y-auto pr-1">
                              @for (
                                product of filteredProducts();
                                track product.id
                              ) {
                                <button
                                  type="button"
                                  class="ai-list-item group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border bg-[var(--color-background)] px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/35"
                                  [style.border-color]="
                                    isProductSelected(product.id)
                                      ? 'var(--color-primary)'
                                      : 'var(--color-border)'
                                  "
                                  [style.background]="
                                    isProductSelected(product.id)
                                      ? 'rgba(var(--color-primary-rgb), 0.07)'
                                      : null
                                  "
                                  (click)="toggleProduct(product)"
                                >
                                  <div
                                    class="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[var(--color-surface-muted)]"
                                  >
                                    @if (productPreview(product)) {
                                      <img
                                        class="h-full w-full object-cover"
                                        [src]="productPreview(product)"
                                        [alt]="product.name"
                                        (error)="hideBrokenImage($event)"
                                      />
                                    } @else {
                                      <div
                                        class="flex h-full w-full items-center justify-center text-[var(--color-text-secondary)]"
                                      >
                                        <app-icon
                                          name="image"
                                          [size]="17"
                                        ></app-icon>
                                      </div>
                                    }
                                  </div>
                                  <div class="min-w-0 flex-1">
                                    <p
                                      class="truncate text-sm font-semibold text-[var(--color-text-primary)]"
                                    >
                                      {{ product.name }}
                                    </p>
                                    <p
                                      class="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]"
                                    >
                                      {{
                                        product.sku ||
                                          (product.product_type === 'service'
                                            ? 'Servicio'
                                            : 'Producto')
                                      }}
                                    </p>
                                  </div>

                                  @if (isProductSelected(product.id)) {
                                    <span
                                      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-white shadow-sm"
                                    >
                                      <app-icon
                                        name="check"
                                        [size]="14"
                                      ></app-icon>
                                    </span>
                                  }
                                </button>
                              }
                            </div>
                          }
                        </div>
                      </section>

                      <section
                        class="ai-glow-panel overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm xl:col-span-2"
                      >
                        <div
                          class="flex flex-col gap-3 border-b border-[var(--color-border)] px-4 py-4 sm:flex-row sm:items-start sm:justify-between md:px-5"
                        >
                          <div class="flex min-w-0 items-start gap-3">
                            <span
                              class="ai-icon-glow flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--color-primary)]"
                            >
                              <app-icon name="image" [size]="20"></app-icon>
                            </span>
                            <div class="min-w-0">
                              <h3
                                class="text-base font-semibold leading-6 text-[var(--color-text-primary)]"
                              >
                                Galeria de productos seleccionados
                              </h3>
                              <p
                                class="mt-1 text-sm leading-5 text-[var(--color-text-secondary)]"
                              >
                                Fotos disponibles de los productos y servicios
                                elegidos.
                              </p>
                            </div>
                          </div>
                          <div class="flex shrink-0 gap-2">
                            <span
                              class="rounded-full bg-[var(--color-surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--color-text-secondary)]"
                            >
                              {{ selectedImageIds().length }} elegidas
                            </span>
                            <span
                              class="rounded-full bg-[var(--color-surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--color-text-secondary)]"
                            >
                              {{ galleryImages().length }} disponibles
                            </span>
                          </div>
                        </div>

                        <div class="p-4 md:p-5">
                          @if (!selectedProductIds().length) {
                            <app-empty-state
                              size="sm"
                              icon="package"
                              title="Selecciona un producto o servicio"
                              description="Sus imagenes apareceran aqui."
                              [showActionButton]="false"
                            ></app-empty-state>
                          } @else if (!galleryImages().length) {
                            <app-empty-state
                              size="sm"
                              icon="image-off"
                              title="Sin imagenes"
                              description="Los productos seleccionados no tienen imagenes disponibles."
                              [showActionButton]="false"
                            ></app-empty-state>
                          } @else {
                            <div
                              class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6"
                            >
                              @for (
                                item of galleryImages();
                                track item.image.id
                              ) {
                                <button
                                  type="button"
                                  class="ai-resource-card group relative overflow-hidden rounded-2xl border bg-[var(--color-background)] p-2 text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/35"
                                  [style.border-color]="
                                    isReferenceImageSelected(item.image.id)
                                      ? 'var(--color-primary)'
                                      : 'var(--color-border)'
                                  "
                                  [style.box-shadow]="
                                    isReferenceImageSelected(item.image.id)
                                      ? '0 12px 30px rgba(var(--color-primary-rgb), 0.14)'
                                      : null
                                  "
                                  (click)="toggleReferenceImage(item.image.id)"
                                >
                                  <div
                                    class="aspect-square overflow-hidden rounded-xl bg-[var(--color-surface-muted)]"
                                  >
                                    <img
                                      class="h-full w-full object-cover transition duration-200 group-hover:scale-105"
                                      [src]="item.image.image_url"
                                      [alt]="item.product.name"
                                      (error)="hideBrokenImage($event)"
                                    />
                                  </div>
                                  <p
                                    class="mt-2 truncate px-1 text-xs font-medium text-[var(--color-text-primary)]"
                                  >
                                    {{ item.product.name }}
                                  </p>
                                  @if (
                                    isReferenceImageSelected(item.image.id)
                                  ) {
                                    <span
                                      class="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-primary)] text-white shadow-sm"
                                    >
                                      <app-icon
                                        name="check"
                                        [size]="14"
                                      ></app-icon>
                                    </span>
                                  }
                                </button>
                              }
                            </div>
                          }
                        </div>
                      </section>
                    </div>
                  </section>
                }

                @if (currentStep() === 2) {
                  <section class="ai-create-panel space-y-5 rounded-2xl p-4 md:p-5">
                    <app-input-buttons
                      formControlName="format"
                      label="Formato"
                      [options]="formatOptions"
                      [hideLabelsOnMobile]="false"
                    ></app-input-buttons>

                    <div
                      class="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                    >
                      <app-input-buttons
                        class="min-w-0"
                        formControlName="visual_style"
                        label="Estilo"
                        [options]="styleOptions"
                        [hideLabelsOnMobile]="false"
                        [equalWidth]="false"
                        customWrapperClass="ai-choice-buttons"
                        customContainerClass="ai-choice-buttons__container flex-wrap h-auto"
                      ></app-input-buttons>

                      <app-input-buttons
                        class="min-w-0"
                        formControlName="cta"
                        label="Accion"
                        [options]="ctaOptions"
                        [hideLabelsOnMobile]="false"
                        [equalWidth]="false"
                        customWrapperClass="ai-choice-buttons"
                        customContainerClass="ai-choice-buttons__container flex-wrap h-auto"
                      ></app-input-buttons>
                    </div>

                    <app-textarea
                      formControlName="prompt"
                      label="Prompt del anuncio"
                      placeholder="Puedes escribirlo o usar Sugerir anuncio."
                      [rows]="7"
                    ></app-textarea>

                    @if (suggestionNotes()) {
                      <app-alert-banner variant="info" icon="sparkles">
                        {{ suggestionNotes() }}
                      </app-alert-banner>
                    }

                    @if (generationError()) {
                      <app-alert-banner variant="danger" icon="triangle-alert">
                        {{ generationError() }}
                      </app-alert-banner>
                    }

                    <div
                      class="ai-action-dock flex flex-col gap-2 rounded-2xl p-3 sm:flex-row sm:items-center sm:justify-end"
                    >
                      <app-button
                        variant="outline"
                        size="md"
                        type="button"
                        [loading]="suggestingPrompt()"
                        [disabled]="
                          suggestingPrompt() || generating() || creating()
                        "
                        (clicked)="suggestPrompt()"
                      >
                        <app-icon
                          slot="icon"
                          name="sparkles"
                          [size]="16"
                        ></app-icon>
                        Sugerir anuncio
                      </app-button>
                      <app-button
                        variant="primary"
                        size="md"
                        type="button"
                        [loading]="creating() || generating()"
                        [disabled]="submitDisabled()"
                        (clicked)="createAiAnuncio()"
                      >
                        <app-icon
                          slot="icon"
                          name="image-plus"
                          [size]="16"
                        ></app-icon>
                        Generar anuncio
                      </app-button>
                    </div>
                  </section>
                }
              </form>

              <div
                class="ai-bottom-bar flex flex-col-reverse gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6"
              >
                <app-button
                  variant="outline"
                  size="md"
                  type="button"
                  (clicked)="goBack()"
                >
                  Cancelar
                </app-button>
                <div class="flex gap-2">
                  <app-button
                    variant="ghost"
                    size="md"
                    type="button"
                    [disabled]="currentStep() === 0"
                    (clicked)="previousStep()"
                  >
                    Atras
                  </app-button>
                  @if (currentStep() < 2) {
                    <app-button
                      variant="primary"
                      size="md"
                      type="button"
                      (clicked)="nextStep()"
                    >
                      Continuar
                    </app-button>
                  }
                </div>
              </div>
            </app-card>
          </div>

          <aside class="space-y-4">
            <app-card [responsive]="true" [padding]="false">
              <div class="ai-summary-panel space-y-4 p-4 md:p-5">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <h2
                      class="text-base font-semibold text-[var(--color-text-primary)]"
                    >
                      Resumen
                    </h2>
                    <p class="text-sm text-[var(--color-text-secondary)]">
                      {{ formatLabel(currentFormat()) }}
                    </p>
                  </div>
                  <app-icon
                    name="clipboard-check"
                    [size]="20"
                    class="ai-soft-pulse text-[var(--color-primary)]"
                  ></app-icon>
                </div>

                <div
                  class="space-y-2 text-sm text-[var(--color-text-secondary)]"
                >
                  <p class="flex items-center gap-2">
                    <app-icon name="megaphone" [size]="15"></app-icon>
                    {{ intentLabel() }}
                  </p>
                  <p class="flex items-center gap-2">
                    <app-icon name="package" [size]="15"></app-icon>
                    {{ selectedProductIds().length }} productos
                  </p>
                  <p class="flex items-center gap-2">
                    <app-icon name="images" [size]="15"></app-icon>
                    {{
                      selectedImageIds().length +
                        selectedReferenceResources().length
                    }}
                    recursos
                  </p>
                  @if (selectedQrCount()) {
                    <p
                      class="flex items-center gap-2 text-[var(--color-primary)]"
                    >
                      <app-icon name="barcode" [size]="15"></app-icon>
                      QR exacto incluido
                    </p>
                  }
                </div>

                <div class="border-t border-[var(--color-border)] pt-3">
                  <div class="flex items-center justify-between gap-3">
                    <p
                      class="text-sm font-semibold text-[var(--color-text-primary)]"
                    >
                      Recursos seleccionados
                    </p>
                    <span
                      class="rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs font-semibold text-[var(--color-text-secondary)]"
                    >
                      {{ selectedResourcePreviewItems().length }}
                    </span>
                  </div>

                  @if (selectedResourcePreviewItems().length) {
                    <div class="mt-2 flex flex-wrap gap-2">
                      @for (
                        resource of selectedResourcePreviewItems();
                        track resource.id
                      ) {
                        <div
                          class="ai-selected-chip relative flex max-w-full items-center gap-2 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-1 pr-2"
                        >
                          <div
                            class="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-[var(--color-surface-muted)]"
                          >
                            <img
                              class="h-full w-full object-cover"
                              [class.object-contain]="
                                resource.source_type.includes('qr')
                              "
                              [src]="resource.preview_url"
                              [alt]="resource.label"
                            />
                          </div>
                          <span
                            class="max-w-32 truncate text-xs font-medium text-[var(--color-text-primary)]"
                          >
                            {{ resource.label }}
                          </span>
                        </div>
                      }
                    </div>
                  } @else {
                    <p class="mt-2 text-xs text-[var(--color-text-secondary)]">
                      Aun no has elegido fotos, logos o QR.
                    </p>
                  }
                </div>
              </div>
            </app-card>

            @if (showResultPanel()) {
              <app-card [responsive]="true" [padding]="false">
                <div
                  class="ai-result-panel p-4 md:p-5"
                  [class.ai-generating]="generating()"
                >
                  <div class="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h2
                        class="text-base font-semibold text-[var(--color-text-primary)]"
                      >
                        Resultado
                      </h2>
                      <p class="text-sm text-[var(--color-text-secondary)]">
                        {{
                          generating() ? generationMessage() : 'Anuncio listo'
                        }}
                      </p>
                    </div>
                    @if (generating()) {
                      <app-icon
                        name="loader-2"
                        [size]="20"
                        [spin]="true"
                        class="ai-soft-pulse text-[var(--color-primary)]"
                      ></app-icon>
                    }
                  </div>

                  <div
                    class="ai-preview-stage flex min-h-[220px] items-center justify-center overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)]"
                    [ngClass]="formatAspectClass(currentFormat())"
                  >
                    @if (activeResultImage()) {
                      <img
                        class="h-full w-full object-contain"
                        [src]="activeResultImage()!"
                        alt="Anuncio generado"
                      />
                    } @else {
                      <div
                        class="ai-generation-copy px-6 text-center text-sm text-[var(--color-text-secondary)]"
                      >
                        {{ generationMessage() }}
                      </div>
                    }
                  </div>

                  @if (generationResult()?.post_copy) {
                    <div
                      class="ai-post-card mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3"
                    >
                      <div class="mb-2 flex items-center justify-between gap-3">
                        <p
                          class="text-sm font-semibold text-[var(--color-text-primary)]"
                        >
                          Post listo
                        </p>
                        <app-button
                          variant="ghost"
                          size="sm"
                          type="button"
                          (clicked)="copyPostCopy()"
                        >
                          <app-icon
                            slot="icon"
                            name="copy"
                            [size]="14"
                          ></app-icon>
                          Copiar
                        </app-button>
                      </div>
                      <p
                        class="whitespace-pre-line text-sm leading-6 text-[var(--color-text-secondary)]"
                      >
                        {{ generationResult()?.post_copy }}
                      </p>
                    </div>
                  }

                  @if (generationResult()?.image_url) {
                    <div class="mt-4 flex justify-end">
                      <app-button
                        variant="primary"
                        size="md"
                        type="button"
                        (clicked)="goBack()"
                      >
                        Ver biblioteca
                      </app-button>
                    </div>
                  }
                </div>
              </app-card>
            }
          </aside>
        </div>
      </div>

      <app-product-image-source-modal
        [isOpen]="resourceModalOpen()"
        (isOpenChange)="resourceModalOpen.set($event)"
        [remainingSlots]="8"
        (imagesAdded)="addCustomResources($event)"
      ></app-product-image-source-modal>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .ai-wizard-shell {
        position: relative;
        isolation: isolate;
      }

      .ai-wizard-shell::before {
        content: '';
        position: fixed;
        inset: 0;
        z-index: -1;
        pointer-events: none;
        background:
          linear-gradient(
            120deg,
            rgba(var(--color-primary-rgb), 0.08),
            transparent 28%,
            rgba(56, 189, 248, 0.06) 58%,
            transparent 78%
          );
        opacity: 0.75;
      }

      .ai-step-ribbon,
      .ai-bottom-bar {
        border-color: rgba(var(--color-primary-rgb), 0.18);
        background:
          linear-gradient(
            90deg,
            rgba(var(--color-primary-rgb), 0.08),
            rgba(56, 189, 248, 0.045),
            transparent
          );
      }

      .ai-hero-panel,
      .ai-create-panel,
      .ai-glow-panel,
      .ai-summary-panel,
      .ai-result-panel {
        position: relative;
        overflow: hidden;
      }

      .ai-hero-panel,
      .ai-create-panel {
        border: 1px solid rgba(var(--color-primary-rgb), 0.22);
        background:
          linear-gradient(
            135deg,
            rgba(var(--color-primary-rgb), 0.12),
            transparent 42%,
            rgba(56, 189, 248, 0.08)
          ),
          var(--color-surface);
        box-shadow:
          0 18px 45px rgba(var(--color-primary-rgb), 0.09),
          inset 0 1px 0 rgba(255, 255, 255, 0.35);
      }

      .ai-glow-panel,
      .ai-summary-panel,
      .ai-result-panel {
        box-shadow:
          0 14px 40px rgba(var(--color-primary-rgb), 0.07),
          inset 0 1px 0 rgba(255, 255, 255, 0.26);
      }

      .ai-glow-panel::before,
      .ai-summary-panel::before,
      .ai-result-panel::before,
      .ai-create-panel::before,
      .ai-hero-panel::before {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        border-radius: inherit;
        background:
          linear-gradient(
            120deg,
            rgba(255, 255, 255, 0.18),
            transparent 24%,
            transparent 68%,
            rgba(var(--color-primary-rgb), 0.12)
          );
        opacity: 0.8;
      }

      .ai-hero-panel > *,
      .ai-create-panel > *,
      .ai-glow-panel > *,
      .ai-summary-panel > *,
      .ai-result-panel > * {
        position: relative;
        z-index: 1;
      }

      .ai-glow-panel::after,
      .ai-result-panel::after,
      .ai-create-panel::after {
        content: '';
        position: absolute;
        top: 0;
        left: -45%;
        width: 38%;
        height: 1px;
        pointer-events: none;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(56, 189, 248, 0.95),
          rgba(var(--color-primary-rgb), 0.95),
          transparent
        );
        animation: ai-scan-line 4.8s ease-in-out infinite;
      }

      .ai-icon-glow {
        background:
          radial-gradient(
            circle at 35% 25%,
            rgba(255, 255, 255, 0.9),
            rgba(var(--color-primary-rgb), 0.14) 45%,
            rgba(56, 189, 248, 0.1)
          );
        box-shadow:
          0 0 0 1px rgba(var(--color-primary-rgb), 0.14),
          0 10px 26px rgba(var(--color-primary-rgb), 0.16);
      }

      .ai-resource-card,
      .ai-list-item,
      .ai-selected-chip,
      .ai-post-card {
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.035);
      }

      .ai-resource-card:hover,
      .ai-list-item:hover,
      .ai-selected-chip:hover {
        box-shadow:
          0 14px 34px rgba(var(--color-primary-rgb), 0.12),
          0 0 0 1px rgba(var(--color-primary-rgb), 0.12);
      }

      .ai-resource-card::before,
      .ai-list-item::before,
      .ai-selected-chip::before {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: linear-gradient(
          135deg,
          rgba(var(--color-primary-rgb), 0.08),
          transparent 36%,
          rgba(56, 189, 248, 0.07)
        );
        opacity: 0;
        transition: opacity 180ms ease;
      }

      .ai-resource-card:hover::before,
      .ai-list-item:hover::before,
      .ai-selected-chip:hover::before {
        opacity: 1;
      }

      .ai-action-dock {
        border: 1px solid rgba(var(--color-primary-rgb), 0.16);
        background:
          linear-gradient(
            90deg,
            rgba(var(--color-primary-rgb), 0.08),
            rgba(56, 189, 248, 0.055),
            rgba(var(--color-primary-rgb), 0.04)
          );
      }

      :host ::ng-deep .ai-choice-buttons {
        min-width: 0;
      }

      :host ::ng-deep .ai-choice-buttons__container {
        align-items: stretch;
        height: auto;
        min-height: 2.75rem;
        max-width: 100%;
      }

      :host ::ng-deep .ai-choice-buttons__container button {
        flex: 1 1 8.75rem;
        width: auto;
        max-width: 100%;
        min-width: min(8.75rem, 100%);
        height: auto;
        min-height: 2.25rem;
        padding-block: 0.5rem;
      }

      :host ::ng-deep .ai-choice-buttons__container button span {
        min-width: 0;
        max-width: 100%;
      }

      .ai-preview-stage {
        position: relative;
        border-color: rgba(var(--color-primary-rgb), 0.24);
        background:
          linear-gradient(
            135deg,
            rgba(var(--color-primary-rgb), 0.12),
            transparent 45%,
            rgba(56, 189, 248, 0.11)
          ),
          var(--color-surface-secondary, var(--color-surface));
        box-shadow: inset 0 0 38px rgba(var(--color-primary-rgb), 0.09);
      }

      .ai-preview-stage::before {
        content: '';
        position: absolute;
        inset: 12px;
        pointer-events: none;
        border: 1px solid rgba(var(--color-primary-rgb), 0.12);
        border-radius: 14px;
      }

      .ai-generating .ai-preview-stage {
        animation: ai-breathe 2.4s ease-in-out infinite;
      }

      .ai-generation-copy {
        position: relative;
        z-index: 1;
        font-weight: 600;
      }

      .ai-soft-pulse {
        filter: drop-shadow(0 0 10px rgba(var(--color-primary-rgb), 0.42));
        animation: ai-soft-pulse 2.4s ease-in-out infinite;
      }

      @keyframes ai-scan-line {
        0%,
        42% {
          transform: translateX(0);
          opacity: 0;
        }
        52% {
          opacity: 1;
        }
        100% {
          transform: translateX(390%);
          opacity: 0;
        }
      }

      @keyframes ai-breathe {
        0%,
        100% {
          box-shadow:
            inset 0 0 38px rgba(var(--color-primary-rgb), 0.09),
            0 0 0 rgba(var(--color-primary-rgb), 0);
        }
        50% {
          box-shadow:
            inset 0 0 48px rgba(var(--color-primary-rgb), 0.16),
            0 18px 48px rgba(var(--color-primary-rgb), 0.18);
        }
      }

      @keyframes ai-soft-pulse {
        0%,
        100% {
          opacity: 0.82;
          transform: scale(1);
        }
        50% {
          opacity: 1;
          transform: scale(1.05);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ai-glow-panel::after,
        .ai-result-panel::after,
        .ai-create-panel::after,
        .ai-generating .ai-preview-stage,
        .ai-soft-pulse {
          animation: none;
        }
      }

      @media (max-width: 420px) {
        :host ::ng-deep .ai-choice-buttons__container button {
          flex-basis: 100%;
        }
      }
    `,
  ],
})
export class AnuncioCreateWizardPageComponent {
  private readonly anunciosService = inject(AnunciosService);
  private readonly productsService = inject(ProductsService);
  private readonly ecommerceService = inject(EcommerceService);
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly wizardSteps = [
    { label: 'Idea' },
    { label: 'Recursos' },
    { label: 'Crear' },
  ];
  protected readonly currentStep = signal(0);
  protected readonly products = signal<Product[]>([]);
  protected readonly productsLoading = signal(false);
  protected readonly productsLoaded = signal(false);
  protected readonly productsError = signal<string | null>(null);
  protected readonly productSearch = signal('');
  protected readonly productSearchControl = new FormControl('', {
    nonNullable: true,
  });
  protected readonly loadingProductImageIds = signal<number[]>([]);
  protected readonly loadedProductImageIds = signal<number[]>([]);
  protected readonly selectedProductIds = signal<number[]>([]);
  protected readonly selectedImageIds = signal<number[]>([]);
  protected readonly selectedReferenceIds = signal<string[]>([]);
  protected readonly customResources = signal<ReferenceResource[]>([]);
  protected readonly ecommerceSettings = signal<EcommerceSettings | null>(null);
  protected readonly ecommerceQrCodeDataUrl = signal<string | null>(null);
  protected readonly resourceModalOpen = signal(false);
  protected readonly creating = signal(false);
  protected readonly generating = signal(false);
  protected readonly suggestingPrompt = signal(false);
  protected readonly suggestionNotes = signal('');
  protected readonly suggestedTitle = signal('');
  protected readonly generationMessage = signal('Preparando recursos...');
  protected readonly generationPreview = signal<string | null>(null);
  protected readonly generationResult = signal<MarketingAdCreative | null>(
    null,
  );
  protected readonly generationError = signal<string | null>(null);
  private readonly formVersion = signal(0);

  protected readonly intentOptions: InputButtonOption[] = [
    { value: 'highlight_store', label: 'Tienda', icon: 'store' },
    { value: 'highlight_product', label: 'Producto/servicio', icon: 'package' },
    { value: 'announcement', label: 'Novedad', icon: 'megaphone' },
    { value: 'contact', label: 'Contacto', icon: 'message-square' },
    { value: 'promotion', label: 'Promocion', icon: 'tag' },
    { value: 'qr', label: 'QR', icon: 'barcode' },
  ];
  protected readonly channelOptions: InputButtonOption[] = [
    { value: 'instagram_story', label: 'Historia', icon: 'smartphone' },
    { value: 'instagram_feed', label: 'Feed', icon: 'instagram' },
    { value: 'whatsapp', label: 'WhatsApp', icon: 'message-circle' },
    { value: 'ecommerce_banner', label: 'Banner', icon: 'monitor' },
  ];
  protected readonly styleOptions: InputButtonOption[] = [
    { value: 'profesional', label: 'Profesional', icon: 'briefcase' },
    { value: 'moderno', label: 'Moderno', icon: 'sparkles' },
    { value: 'minimalista', label: 'Minimalista', icon: 'layout' },
    { value: 'colorido', label: 'Colorido', icon: 'palette' },
  ];
  protected readonly ctaOptions: InputButtonOption[] = [
    { value: 'comprar', label: 'Comprar', icon: 'shopping-bag' },
    { value: 'contactar', label: 'Contactar', icon: 'send' },
    { value: 'visitar_tienda', label: 'Visitar tienda', icon: 'store' },
    { value: 'escanear_qr', label: 'Escanear QR', icon: 'barcode' },
  ];
  protected readonly formatOptions: InputButtonOption[] = [
    { value: 'square', label: '1:1 Feed', icon: 'layout-grid' },
    { value: 'story', label: '9:16 Story', icon: 'smartphone' },
    { value: 'landscape', label: '16:9 Banner', icon: 'monitor' },
  ];

  protected readonly form = new FormGroup<WizardFormControls>({
    intent: new FormControl('highlight_store', { nonNullable: true }),
    channel: new FormControl('instagram_story', { nonNullable: true }),
    cta: new FormControl('visitar_tienda', { nonNullable: true }),
    visual_style: new FormControl('profesional', { nonNullable: true }),
    brief: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(1500)],
    }),
    prompt: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(2000)],
    }),
    format: new FormControl<AdCreativeFormat>('story', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  protected readonly currentFormat = computed(() => {
    this.formVersion();
    return this.form.controls.format.value;
  });

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

  protected readonly storeReferenceResources = computed<ReferenceResource[]>(
    () => {
      const settings = this.settingsFacade.settings() as any;
      const branding = settings?.branding || {};
      const app = settings?.app || {};
      const general = settings?.general || {};
      const ecommerce = this.ecommerceSettings() || settings?.ecommerce || {};
      const resources: ReferenceResource[] = [];
      const seen = new Set<string>();
      const addUrlResource = (
        id: string,
        label: string,
        sourceType: string,
        value: unknown,
      ) => {
        const imageUrl = this.previewableImageUrl(value);
        if (!imageUrl || seen.has(imageUrl)) return;
        seen.add(imageUrl);
        resources.push({
          id,
          label,
          source_type: sourceType,
          image_url: imageUrl,
          preview_url: imageUrl,
        });
      };

      addUrlResource(
        'store-logo',
        'Logo de tienda',
        'store_logo',
        general.logo_url,
      );
      addUrlResource(
        'brand-logo',
        'Logo de marca',
        'brand_logo',
        app.logo_url || branding.logo_url,
      );
      addUrlResource(
        'ecommerce-logo',
        'Logo ecommerce',
        'ecommerce_logo',
        ecommerce?.inicio?.logo_url,
      );

      const photos = Array.isArray(ecommerce?.slider?.photos)
        ? ecommerce.slider.photos
        : [];
      photos.slice(0, 8).forEach((photo: any, index: number) => {
        addUrlResource(
          `slider-${index}`,
          photo.title || `Slider ecommerce ${index + 1}`,
          'ecommerce_slider',
          photo.url || photo.thumbnail,
        );
      });

      const qrDataUrl =
        this.ecommerceQrCodeDataUrl() || ecommerce?.general?.qr_code_data_url;
      if (qrDataUrl) {
        resources.push({
          id: 'store-qr',
          label: 'QR tienda',
          source_type: 'qr_store',
          image_base64: qrDataUrl,
          preview_url: qrDataUrl,
        });
      }

      return resources;
    },
  );

  protected readonly productQrResources = computed<ReferenceResource[]>(() =>
    this.selectedProducts()
      .filter((product) => !!product.online_purchase_qr_code)
      .map((product) => ({
        id: `product-qr-${product.id}`,
        label: `QR ${product.name}`,
        source_type: 'qr_product',
        image_base64: product.online_purchase_qr_code || undefined,
        preview_url: product.online_purchase_qr_code || '',
      })),
  );

  protected readonly referenceResources = computed(() => [
    ...this.storeReferenceResources(),
    ...this.productQrResources(),
    ...this.customResources(),
  ]);

  protected readonly selectedReferenceResources = computed(() => {
    const ids = new Set(this.selectedReferenceIds());
    return this.referenceResources().filter((resource) => ids.has(resource.id));
  });

  protected readonly selectedGalleryResourcePreviews = computed<
    SelectedResourcePreview[]
  >(() => {
    const selectedImageIds = new Set(this.selectedImageIds());
    return this.galleryImages()
      .filter((item) => selectedImageIds.has(item.image.id))
      .map((item) => ({
        id: `product-image-${item.image.id}`,
        label: item.product.name,
        preview_url: item.image.image_url,
        source_type: 'product',
      }));
  });

  protected readonly selectedResourcePreviewItems = computed<
    SelectedResourcePreview[]
  >(() => [
    ...this.selectedReferenceResources().map((resource) => ({
      id: resource.id,
      label: resource.label,
      preview_url: resource.preview_url,
      source_type: resource.source_type || 'reference',
    })),
    ...this.selectedGalleryResourcePreviews(),
  ]);

  protected readonly selectedQrCount = computed(
    () =>
      this.selectedReferenceResources().filter((resource) =>
        resource.source_type?.includes('qr'),
      ).length,
  );

  protected readonly submitDisabled = computed(() => {
    this.formVersion();
    return (
      this.form.invalid ||
      this.creating() ||
      this.generating() ||
      this.productsLoading() ||
      this.isLoadingSelectedProductImages()
    );
  });

  protected readonly activeResultImage = computed(
    () =>
      this.generationPreview() || this.generationResult()?.image_url || null,
  );

  protected readonly showResultPanel = computed(
    () =>
      this.generating() ||
      !!this.generationPreview() ||
      !!this.generationResult()?.image_url ||
      !!this.generationResult()?.post_copy,
  );

  protected readonly stepBadge = computed(() => `${this.currentStep() + 1}/3`);

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.formVersion.update((current) => current + 1));

    void this.loadProducts();
    void this.loadEcommerceSettings();
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

  private async loadEcommerceSettings(): Promise<void> {
    try {
      const response = await firstValueFrom(this.ecommerceService.getSettings());
      this.applyEcommerceSettingsResponse(response);
    } catch {
      this.ecommerceSettings.set(null);
      this.ecommerceQrCodeDataUrl.set(null);
    }
  }

  private applyEcommerceSettingsResponse(
    response: EcommerceSettingsResponse,
  ): void {
    this.ecommerceSettings.set(response.config || null);
    this.ecommerceQrCodeDataUrl.set(response.qrCodeDataUrl || null);
  }

  protected goToStep(index: number): void {
    this.currentStep.set(Math.max(0, Math.min(2, index)));
  }

  protected nextStep(): void {
    this.currentStep.update((step) => Math.min(2, step + 1));
  }

  protected previousStep(): void {
    this.currentStep.update((step) => Math.max(0, step - 1));
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
  }

  protected toggleReferenceImage(imageId: number): void {
    const selected = this.selectedImageIds();
    this.selectedImageIds.set(
      selected.includes(imageId)
        ? selected.filter((id) => id !== imageId)
        : [...selected, imageId],
    );
  }

  protected toggleReferenceResource(resourceId: string): void {
    const selected = this.selectedReferenceIds();
    this.selectedReferenceIds.set(
      selected.includes(resourceId)
        ? selected.filter((id) => id !== resourceId)
        : [...selected, resourceId],
    );
  }

  protected addCustomResources(images: string[]): void {
    const timestamp = Date.now();
    const resources = images.map((image, index) => ({
      id: `custom-${timestamp}-${index}`,
      label: `Recurso ${this.customResources().length + index + 1}`,
      source_type: 'uploaded',
      image_base64: image,
      preview_url: image,
    }));
    this.customResources.set([...this.customResources(), ...resources]);
    this.selectedReferenceIds.set([
      ...this.selectedReferenceIds(),
      ...resources.map((resource) => resource.id),
    ]);
  }

  protected async suggestPrompt(): Promise<void> {
    if (this.suggestingPrompt()) return;
    this.suggestingPrompt.set(true);
    this.suggestionNotes.set('');
    try {
      const raw = this.form.getRawValue();
      const response = await firstValueFrom(
        this.anunciosService.suggestPrompt({
          intent: raw.intent,
          channel: raw.channel,
          cta: raw.cta,
          visual_style: raw.visual_style,
          brief: raw.brief.trim(),
          format: raw.format,
          product_ids: this.selectedProductIds(),
        }),
      );
      const suggestion = response.data;
      this.form.controls.prompt.setValue(suggestion.suggested_prompt || '');
      this.suggestedTitle.set(suggestion.suggested_title || '');
      this.suggestionNotes.set(suggestion.notes || '');
      this.currentStep.set(2);
    } catch (error: any) {
      this.toastService.error(extractApiErrorMessage(error));
    } finally {
      this.suggestingPrompt.set(false);
    }
  }

  protected async createAiAnuncio(): Promise<void> {
    if (this.submitDisabled()) return;
    this.creating.set(true);
    this.generationError.set(null);
    this.generationPreview.set(null);
    this.generationResult.set(null);

    try {
      const raw = this.form.getRawValue();
      const dto: CreateMarketingAdCreativeDto = {
        title: this.suggestedTitle() || this.defaultTitle(),
        description: this.defaultDescription(),
        intent: raw.intent,
        channel: raw.channel,
        cta: raw.cta,
        visual_style: raw.visual_style,
        brief: raw.brief.trim() || undefined,
        prompt: raw.prompt.trim() || raw.brief.trim() || undefined,
        format: raw.format,
        product_ids: this.selectedProductIds(),
        product_image_ids: this.selectedImageIds(),
        reference_images: this.selectedReferenceResources().map((resource) => ({
          image_url: resource.image_url,
          image_base64: resource.image_base64,
          source_type: resource.source_type,
          label: resource.label,
        })),
      };
      const response = await firstValueFrom(
        this.anunciosService.createAnuncio(dto),
      );
      this.generationResult.set(response.data);
      this.startGeneration(response.data.id);
    } catch (error: any) {
      this.generationError.set(extractApiErrorMessage(error));
    } finally {
      this.creating.set(false);
    }
  }

  protected async copyPostCopy(): Promise<void> {
    const postCopy = this.generationResult()?.post_copy;
    if (!postCopy) return;
    await navigator.clipboard.writeText(postCopy);
    this.toastService.success('Post copiado.');
  }

  protected goBack(): void {
    void this.router.navigate(['/admin/marketing/anuncios']);
  }

  protected isProductSelected(id: number): boolean {
    return this.selectedProductIds().includes(id);
  }

  protected isReferenceImageSelected(id: number): boolean {
    return this.selectedImageIds().includes(id);
  }

  protected isReferenceSelected(id: string): boolean {
    return this.selectedReferenceIds().includes(id);
  }

  protected productPreview(product: Product): string | null {
    return (
      product.product_images?.find((image) => image.is_main)?.image_url ||
      product.product_images?.[0]?.image_url ||
      product.image_url ||
      null
    );
  }

  protected hideBrokenImage(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    if (!image) return;
    image.style.display = 'none';
  }

  private previewableImageUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('data:image/') ||
      trimmed.startsWith('blob:')
    ) {
      return trimmed;
    }
    return null;
  }

  protected formatLabel(format: AdCreativeFormat): string {
    const labels: Record<AdCreativeFormat, string> = {
      square: '1:1 Feed',
      story: '9:16 Historia',
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

  protected intentLabel(): string {
    const value = this.form.controls.intent.value;
    return (
      this.intentOptions.find((option) => option.value === value)?.label ||
      'Anuncio'
    );
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

  private isLoadingSelectedProductImages(): boolean {
    const loadingIds = new Set(this.loadingProductImageIds());
    return this.selectedProductIds().some((id) => loadingIds.has(id));
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
            this.generationError.set(
              event.error || 'No se pudo generar la imagen.',
            );
          }
        },
        error: () => {
          this.generating.set(false);
          this.generationError.set('No se pudo conectar con la generacion.');
        },
      });
  }

  private defaultTitle(): string {
    return `${this.intentLabel()} ${this.dateLabel()}`;
  }

  private defaultDescription(): string {
    const brief = this.form.controls.brief.value.trim();
    return brief || `Creado desde Anuncios el ${this.dateLabel()}.`;
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
}
