import { Component, OnInit, inject, signal, computed } from '@angular/core';

import { Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { HelpCenterAdminService } from '../../services/help-center-admin.service';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { FileUploadDropzoneComponent } from '../../../../../../shared/components/file-upload-dropzone/file-upload-dropzone.component';
import { MarkdownEditorComponent } from '../../../../../../shared/components/markdown-editor/markdown-editor.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { StickyHeaderComponent } from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';

@Component({
  selector: 'app-article-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    TextareaComponent,
    SelectorComponent,
    ToggleComponent,
    FileUploadDropzoneComponent,
    MarkdownEditorComponent,
    IconComponent,
    StickyHeaderComponent,
    ButtonComponent,
    ModalComponent
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
                  <app-icon name="plus" size="20"></app-icon>
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
            <app-file-upload-dropzone
              label="Subir imagen de portada"
              helperText="JPG, PNG o WebP"
              accept="image/*"
              icon="image"
              (fileSelected)="onCoverImageSelected($event)"
              (fileRemoved)="onCoverImageRemoved()"
            ></app-file-upload-dropzone>
            @if (existingCoverUrl() && !coverFile()) {
              <div class="mt-3">
                <img [src]="existingCoverUrl()" alt="Cover" class="max-h-32 rounded-lg border border-border object-contain" />
              </div>
            }
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
  private fb = inject(FormBuilder);
  private service = inject(HelpCenterAdminService);
  toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  isEditMode = signal(false);
  loadingArticle = signal(false);
  submitting = signal(false);
  contentValue = signal('');
  existingCoverUrl = signal<string | null>(null);
  coverFile = signal<File | null>(null);
  categoryOptions = signal<SelectorOption[]>([]);
  formValid = signal(false);

  // Quick create category
  isCategoryCreateOpen = false;
  categorySubmitting = signal(false);
  categoryForm: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    description: [''],
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
    module: [''],
    tags: [''],
    is_featured: [false],
    sort_order: [0],
  });

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

    this.form.statusChanges.subscribe(() => {
      this.formValid.set(this.form.valid);
    });
  }

  onHeaderAction(id: string): void {
    if (id === 'cancel') this.goBack();
    if (id === 'save') this.onSubmit();
  }

  loadCategories() {
    this.service.getCategories().subscribe({
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
    this.service.getArticle(id).subscribe({
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
          this.existingCoverUrl.set(article.cover_image_url);
        }
        this.loadingArticle.set(false);
      },
      error: (err) => {
        console.error('Error loading article', err);
        this.toast.error('Error al cargar el artículo');
        this.loadingArticle.set(false);
        this.goBack();
      },
    });
  }

  onContentChange(content: string) {
    this.contentValue.set(content);
  }

  onCoverImageSelected(file: File) {
    this.coverFile.set(file);
    // Upload immediately
    this.service.uploadImage(file).subscribe({
      next: (result) => {
        this.existingCoverUrl.set(result.url);
      },
      error: (err) => {
        console.error('Error uploading cover image', err);
        this.toast.error('Error al subir la imagen de portada');
        this.coverFile.set(null);
      },
    });
  }

  onCoverImageRemoved() {
    this.coverFile.set(null);
    this.existingCoverUrl.set(null);
  }

  onSubmit() {
    if (this.form.invalid) return;

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
      cover_image_url: this.existingCoverUrl() || undefined,
      is_featured: formValue.is_featured,
      sort_order: formValue.sort_order || 0,
    };

    const request$ = this.isEditMode()
      ? this.service.updateArticle(this.articleId!, dto)
      : this.service.createArticle(dto);

    request$.subscribe({
      next: () => {
        this.toast.success(
          this.isEditMode() ? 'Artículo actualizado' : 'Artículo creado',
        );
        this.submitting.set(false);
        this.goBack();
      },
      error: (err) => {
        console.error('Error saving article', err);
        this.toast.error(
          this.isEditMode() ? 'Error al actualizar el artículo' : 'Error al crear el artículo',
        );
        this.submitting.set(false);
      },
    });
  }

  goBack() {
    this.router.navigate(['/super-admin/help-center']);
  }

  onCategoryCreated() {
    if (this.categoryForm.invalid) return;

    this.categorySubmitting.set(true);
    this.service.createCategory(this.categoryForm.value).subscribe({
      next: () => {
        this.toast.success('Categoría creada');
        this.isCategoryCreateOpen = false;
        this.categoryForm.reset({ name: '', description: '' });
        this.categorySubmitting.set(false);
        this.loadCategories();
      },
      error: (err) => {
        console.error('Error creating category', err);
        this.toast.error('Error al crear la categoría');
        this.categorySubmitting.set(false);
      },
    });
  }
}
