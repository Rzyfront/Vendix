import {Component, OnInit, inject, signal, computed, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { HelpCenterAdminService } from '../../services/help-center-admin.service';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { MarkdownEditorComponent } from '../../../../../../shared/components/markdown-editor/markdown-editor.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { StickyHeaderComponent } from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ImageSourceModalComponent } from '../../../../../../shared/components/image-source-modal/image-source-modal.component';
import { dataUrlToFile } from '../../../../../../shared/utils/data-url.util';

@Component({
  selector: 'app-article-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    TextareaComponent,
    SelectorComponent,
    ToggleComponent,
    MarkdownEditorComponent,
    IconComponent,
    StickyHeaderComponent,
    ButtonComponent,
    ModalComponent,
    ImageSourceModalComponent
],
  template: `
    <div class="flex flex-col gap-4 md:gap-6">
      <!-- Sticky Header -->
      <app-sticky-header
        [title]="isEditMode() ? 'Editar Artículo' : 'Nuevo Artículo'"
        [subtitle]="isEditMode() ? 'Modifica el contenido del artículo' : 'Crea un nuevo artículo para el centro de ayuda'"
        [icon]="isEditMode() ? 'file-text' : 'plus-circle'"
        [showBackButton]="true"
        backRoute="/super-admin/help-center"
        variant="glass"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      ></app-sticky-header>
    
      <!-- Loading -->
      @if (loadingArticle()) {
        <div class="flex items-center justify-center py-20">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      }
    
      <!-- Form -->
      @if (!loadingArticle()) {
        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4 md:gap-6 p-3 md:p-4 max-w-5xl mx-auto w-full">
          <!-- Section 1: Basic Info -->
          <section class="bg-white rounded-2xl border border-gray-100 p-4 md:p-6 shadow-sm">
            <div class="flex items-center gap-2 mb-4">
              <app-icon name="info" size="18" class="text-primary-600"></app-icon>
              <h2 class="text-base font-bold text-gray-900">Información básica</h2>
            </div>
            <div class="flex flex-col gap-4">
              <app-input
                label="Título"
                placeholder="Título del artículo"
                [formControl]="$any(form.get('title'))"
                [required]="true"
              ></app-input>
              <app-textarea
                label="Resumen"
                placeholder="Breve descripción del artículo"
                [formControl]="$any(form.get('summary'))"
                [rows]="3"
                [required]="true"
              ></app-textarea>
            </div>
          </section>
          <!-- Section 2: Classification -->
          <section class="bg-white rounded-2xl border border-gray-100 p-4 md:p-6 shadow-sm">
            <div class="flex items-center gap-2 mb-4">
              <app-icon name="tag" size="18" class="text-primary-600"></app-icon>
              <h2 class="text-base font-bold text-gray-900">Clasificación</h2>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
              <app-selector
                label="Tipo"
                placeholder="Selecciona un tipo"
                [options]="typeOptions"
                [formControl]="$any(form.get('type'))"
              ></app-selector>
              <div class="flex gap-2 items-end">
                <app-selector
                  class="flex-1"
                  label="Categoría"
                  placeholder="Selecciona una categoría"
                  [options]="categoryOptions()"
                  [formControl]="$any(form.get('category_id'))"
                ></app-selector>
                <app-button variant="outline" (clicked)="isCategoryCreateOpen = true"
                  customClasses="!w-[42px] !h-[42px] !p-0 flex items-center justify-center mb-0.5">
                  <app-icon slot="icon" name="plus" size="20"></app-icon>
                </app-button>
              </div>
              <app-selector
                label="Estado"
                placeholder="Estado"
                [options]="statusOptions"
                [formControl]="$any(form.get('status'))"
              ></app-selector>
              <app-input
                label="Módulo (opcional)"
                placeholder="Ej: POS, Inventario, etc."
                [formControl]="$any(form.get('module'))"
              ></app-input>
            </div>
          </section>
          <!-- Section 3: Cover Image -->
          <section class="bg-white rounded-2xl border border-gray-100 p-4 md:p-6 shadow-sm">
            <div class="flex items-center gap-2 mb-4">
              <app-icon name="image" size="18" class="text-primary-600"></app-icon>
              <h2 class="text-base font-bold text-gray-900">Imagen de portada</h2>
            </div>
            <div class="flex flex-col gap-3">
              @if (coverPreviewUrl()) {
                <div class="relative w-fit">
                  <img
                    [src]="coverPreviewUrl()"
                    alt="Portada"
                    class="max-h-40 rounded-lg border border-gray-200 object-contain"
                  />
                </div>
              } @else {
                <div
                  class="flex flex-col items-center justify-center gap-2 py-8 px-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 text-center"
                >
                  <app-icon name="image" size="28" class="text-gray-400"></app-icon>
                  <p class="text-sm text-gray-500">Sin imagen de portada</p>
                </div>
              }
              <div class="flex items-center gap-2">
                <app-button
                  variant="outline"
                  size="sm"
                  type="button"
                  [loading]="coverUploading()"
                  [disabled]="coverUploading()"
                  (clicked)="coverModalOpen.set(true)"
                >
                  <app-icon slot="icon" name="image" size="16"></app-icon>
                  {{ coverPreviewUrl() ? 'Cambiar portada' : 'Subir portada' }}
                </app-button>
                @if (coverPreviewUrl()) {
                  <app-button
                    variant="ghost"
                    size="sm"
                    type="button"
                    [disabled]="coverUploading()"
                    (clicked)="onCoverImageRemoved()"
                  >
                    <app-icon slot="icon" name="trash-2" size="16"></app-icon>
                    Quitar
                  </app-button>
                }
              </div>
            </div>

            <app-image-source-modal
              [(isOpen)]="coverModalOpen"
              [singleImage]="true"
              headerTitle="Portada"
              (imagesAdded)="onCoverImages($event)"
            ></app-image-source-modal>
          </section>
          <!-- Section 4: Content -->
          <section class="bg-white rounded-2xl border border-gray-100 p-4 md:p-6 shadow-sm">
            <div class="flex items-center gap-2 mb-4">
              <app-icon name="file-text" size="18" class="text-primary-600"></app-icon>
              <h2 class="text-base font-bold text-gray-900">Contenido</h2>
            </div>
            <app-markdown-editor
              [content]="contentValue()"
              [uploadFn]="imageUploadFn"
              (contentChange)="onContentChange($event)"
              (uploadError)="toast.error($event)"
            ></app-markdown-editor>
            @if (contentError()) {
              <p class="mt-2 text-sm text-[var(--color-destructive)]">
                {{ contentError() }}
              </p>
            }
          </section>
          <!-- Section 5: Extra -->
          <section class="bg-white rounded-2xl border border-gray-100 p-4 md:p-6 shadow-sm">
            <div class="flex items-center gap-2 mb-4">
              <app-icon name="settings" size="18" class="text-primary-600"></app-icon>
              <h2 class="text-base font-bold text-gray-900">Opciones adicionales</h2>
            </div>
            <div class="flex flex-col gap-4">
              <app-input
                label="Tags (separados por coma)"
                placeholder="Ej: inventario, productos, tutorial"
                [formControl]="$any(form.get('tags'))"
              ></app-input>
              <div class="flex items-center gap-6">
                <app-toggle
                  label="Artículo destacado"
                  [formControl]="$any(form.get('is_featured'))"
                ></app-toggle>
              </div>
              <app-input
                label="Orden de aparición"
                type="number"
                placeholder="0"
                [formControl]="$any(form.get('sort_order'))"
              ></app-input>
            </div>
          </section>
        </form>
      }
    
      <!-- Quick Create Category Modal -->
      <app-modal
        [(isOpen)]="isCategoryCreateOpen"
        title="Nueva Categoría"
        size="sm"
        >
        <form [formGroup]="categoryForm" (ngSubmit)="onCategoryCreated()" class="flex flex-col gap-4">
          <app-input
            label="Nombre"
            placeholder="Nombre de la categoría"
            [formControl]="$any(categoryForm.get('name'))"
            [required]="true"
          ></app-input>
    
          <app-textarea
            label="Descripción"
            placeholder="Breve descripción (opcional)"
            [formControl]="$any(categoryForm.get('description'))"
            [rows]="2"
          ></app-textarea>
    
          <div class="flex justify-end gap-3 mt-2">
            <app-button variant="outline" size="sm" (clicked)="isCategoryCreateOpen = false">
              Cancelar
            </app-button>
            <app-button
              variant="primary"
              size="sm"
              type="submit"
              [disabled]="categorySubmitting() || categoryForm.invalid"
              >
              {{ categorySubmitting() ? 'Guardando...' : 'Crear' }}
            </app-button>
          </div>
        </form>
      </app-modal>
    </div>
    `,
})
export class ArticleFormComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  private service = inject(HelpCenterAdminService);
  toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  isEditMode = signal(false);
  loadingArticle = signal(false);
  submitting = signal(false);
  contentValue = signal('');
  /** S3 key persisted into `cover_image_url`. */
  coverImageKey = signal<string | null>(null);
  /** Signed/display URL used only for the preview <img>. */
  coverPreviewUrl = signal<string | null>(null);
  coverModalOpen = signal(false);
  coverUploading = signal(false);
  categoryOptions = signal<SelectorOption[]>([]);
  formValid = signal(false);

  // Quick create category
  isCategoryCreateOpen = false;
  categorySubmitting = signal(false);
  categoryForm: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    description: ['', [Validators.maxLength(500)]],
  });

  headerActions = computed(() => [
    {
      id: 'cancel',
      label: 'Cancelar',
      variant: 'outline' as const,
      icon: 'x',
    },
    {
      id: 'save',
      label: this.submitting()
        ? 'Guardando...'
        : this.isEditMode()
          ? 'Guardar cambios'
          : 'Crear artículo',
      variant: 'primary' as const,
      icon: 'save',
      loading: this.submitting(),
      disabled: this.submitting() || !this.formValid(),
    },
  ]);

  private articleId: number | null = null;

  typeOptions: SelectorOption[] = [
    { label: 'Tutorial', value: 'TUTORIAL' },
    { label: 'FAQ', value: 'FAQ' },
    { label: 'Guía', value: 'GUIDE' },
    { label: 'Anuncio', value: 'ANNOUNCEMENT' },
    { label: 'Nota de versión', value: 'RELEASE_NOTE' },
  ];

  statusOptions: SelectorOption[] = [
    { label: 'Borrador', value: 'DRAFT' },
    { label: 'Publicado', value: 'PUBLISHED' },
    { label: 'Archivado', value: 'ARCHIVED' },
  ];

  form: FormGroup = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(255)]],
    summary: ['', [Validators.required, Validators.maxLength(500)]],
    type: ['GUIDE', Validators.required],
    category_id: [null as number | null, Validators.required],
    status: ['DRAFT'],
    module: ['', [Validators.maxLength(50)]],
    tags: [''],
    is_featured: [false],
    sort_order: [0],
  });

  contentError = signal<string | null>(null);

  // Bind upload function for markdown editor
  imageUploadFn = (file: File): Observable<{ key: string; url: string }> => {
    return this.service.uploadImage(file);
  };

  ngOnInit() {
    this.loadCategories();

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.articleId = +id;
      this.isEditMode.set(true);
      this.loadArticle(this.articleId);
    }

    this.form.statusChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.formValid.set(this.form.valid);
    });
  }

  onHeaderAction(id: string): void {
    if (id === 'cancel') this.goBack();
    if (id === 'save') this.onSubmit();
  }

  loadCategories() {
    this.service.getCategories().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (categories) => {
        this.categoryOptions.set(
          categories.map((c) => ({ label: c.name, value: c.id })),
        );
      },
      error: (err) => console.error('Error loading categories', err),
    });
  }

  loadArticle(id: number) {
    this.loadingArticle.set(true);
    this.service.getArticle(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (article) => {
        this.form.patchValue({
          title: article.title,
          summary: article.summary,
          type: article.type,
          category_id: article.category_id,
          status: article.status,
          module: article.module || '',
          tags: article.tags?.join(', ') || '',
          is_featured: article.is_featured,
          sort_order: article.sort_order,
        });
        this.contentValue.set(article.content);
        if (article.cover_image_url) {
          // Backend returns a signed URL on read. Use it for the preview and
          // resubmit it untouched on update (backend re-extracts the S3 key).
          this.coverImageKey.set(article.cover_image_url);
          this.coverPreviewUrl.set(article.cover_image_url);
        }
        this.loadingArticle.set(false);
      },
      error: (err) => {
        const parsed = parseApiError(err);
        console.error('Error loading article', parsed.devMessage ?? err);
        this.toast.error(parsed.errorCode ? parsed.userMessage : 'Error al cargar el artículo');
        this.loadingArticle.set(false);
        this.goBack();
      },
    });
  }

  onContentChange(content: string) {
    this.contentValue.set(content);
    if (this.contentError() && content && content.trim()) {
      this.contentError.set(null);
    }
  }

  onCoverImages(dataUrls: string[]) {
    const dataUrl = dataUrls[0];
    if (!dataUrl) return;

    const file = dataUrlToFile(dataUrl, `cover-${Date.now()}.jpg`);
    this.coverUploading.set(true);
    this.service.uploadImage(file).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        // Persist the S3 key; show the signed URL in the preview.
        this.coverImageKey.set(result.key);
        this.coverPreviewUrl.set(result.url);
        this.coverUploading.set(false);
      },
      error: (err) => {
        const parsed = parseApiError(err);
        console.error('Error uploading cover image', parsed.devMessage ?? err);
        this.toast.error(parsed.errorCode ? parsed.userMessage : 'Error al subir la imagen de portada');
        this.coverUploading.set(false);
      },
    });
  }

  onCoverImageRemoved() {
    this.coverImageKey.set(null);
    this.coverPreviewUrl.set(null);
  }

  onSubmit() {
    const contentEmpty = !this.contentValue() || !this.contentValue().trim();
    this.contentError.set(contentEmpty ? 'El contenido es requerido.' : null);

    if (this.form.invalid || contentEmpty) {
      this.form.markAllAsTouched();
      this.toast.error('Revisa los campos marcados.');
      return;
    }

    this.submitting.set(true);

    const formValue = this.form.value;
    const tags = formValue.tags
      ? formValue.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t)
      : [];

    const dto: any = {
      title: formValue.title,
      summary: formValue.summary,
      content: this.contentValue(),
      type: formValue.type,
      status: formValue.status,
      category_id: formValue.category_id,
      module: formValue.module || undefined,
      tags,
      cover_image_url: this.coverImageKey() || undefined,
      is_featured: formValue.is_featured,
      sort_order: formValue.sort_order || 0,
    };

    const request$ = this.isEditMode()
      ? this.service.updateArticle(this.articleId!, dto)
      : this.service.createArticle(dto);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success(
          this.isEditMode() ? 'Artículo actualizado' : 'Artículo creado',
        );
        this.submitting.set(false);
        this.goBack();
      },
      error: (err) => {
        const parsed = parseApiError(err);
        console.error('Error saving article', parsed.devMessage ?? err);
        const fallback = this.isEditMode()
          ? 'Error al actualizar el artículo'
          : 'Error al crear el artículo';
        this.toast.error(parsed.errorCode ? parsed.userMessage : fallback);
        this.submitting.set(false);
      },
    });
  }

  goBack() {
    this.router.navigate(['/super-admin/help-center']);
  }

  onCategoryCreated() {
    if (this.categoryForm.invalid) {
      this.categoryForm.markAllAsTouched();
      return;
    }

    this.categorySubmitting.set(true);
    this.service.createCategory(this.categoryForm.value).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success('Categoría creada');
        this.isCategoryCreateOpen = false;
        this.categoryForm.reset({ name: '', description: '' });
        this.categorySubmitting.set(false);
        this.loadCategories();
      },
      error: (err) => {
        const parsed = parseApiError(err);
        console.error('Error creating category', parsed.devMessage ?? err);
        this.toast.error(parsed.errorCode ? parsed.userMessage : 'Error al crear la categoría');
        this.categorySubmitting.set(false);
      },
    });
  }
}
