import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { HelpCenterAdminService } from '../../services/help-center-admin.service';
import { HelpArticle, HelpCategory } from '../../../../../modules/store/help/models/help-article.model';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
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

@Component({
  selector: 'app-article-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    SelectorComponent,
    ToggleComponent,
    FileUploadDropzoneComponent,
    MarkdownEditorComponent,
    IconComponent,
  ],
  template: `
    <div class="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      <!-- Header -->
      <div class="flex items-center gap-4">
        <button
          type="button"
          class="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          (click)="goBack()"
        >
          <app-icon name="arrow-left" size="20"></app-icon>
        </button>
        <div>
          <h1 class="text-xl font-semibold text-text-primary">
            {{ isEditMode() ? 'Editar Artículo' : 'Nuevo Artículo' }}
          </h1>
          <p class="text-sm text-text-secondary">
            {{ isEditMode() ? 'Modifica el contenido del artículo' : 'Crea un nuevo artículo para el centro de ayuda' }}
          </p>
        </div>
      </div>

      <!-- Loading -->
      <div *ngIf="loadingArticle()" class="flex items-center justify-center py-20">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>

      <!-- Form -->
      <form *ngIf="!loadingArticle()" [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-6">
        <!-- Section 1: Basic Info -->
        <div class="bg-surface border border-border rounded-xl p-6">
          <h2 class="text-base font-semibold text-text-primary mb-4">Información básica</h2>
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
        </div>

        <!-- Section 2: Classification -->
        <div class="bg-surface border border-border rounded-xl p-6">
          <h2 class="text-base font-semibold text-text-primary mb-4">Clasificación</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <app-selector
              label="Tipo"
              placeholder="Selecciona un tipo"
              [options]="typeOptions"
              [formControl]="$any(form.get('type'))"
            ></app-selector>

            <app-selector
              label="Categoría"
              placeholder="Selecciona una categoría"
              [options]="categoryOptions()"
              [formControl]="$any(form.get('category_id'))"
            ></app-selector>

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
        </div>

        <!-- Section 3: Cover Image -->
        <div class="bg-surface border border-border rounded-xl p-6">
          <h2 class="text-base font-semibold text-text-primary mb-4">Imagen de portada</h2>
          <app-file-upload-dropzone
            label="Subir imagen de portada"
            helperText="JPG, PNG o WebP"
            accept="image/*"
            icon="image"
            (fileSelected)="onCoverImageSelected($event)"
            (fileRemoved)="onCoverImageRemoved()"
          ></app-file-upload-dropzone>
          <div *ngIf="existingCoverUrl() && !coverFile()" class="mt-3">
            <img [src]="existingCoverUrl()" alt="Cover" class="max-h-32 rounded-lg border border-border object-contain" />
          </div>
        </div>

        <!-- Section 4: Content -->
        <div class="bg-surface border border-border rounded-xl p-6">
          <h2 class="text-base font-semibold text-text-primary mb-4">Contenido</h2>
          <app-markdown-editor
            [content]="contentValue()"
            [uploadFn]="imageUploadFn"
            (contentChange)="onContentChange($event)"
          ></app-markdown-editor>
        </div>

        <!-- Section 5: Extra -->
        <div class="bg-surface border border-border rounded-xl p-6">
          <h2 class="text-base font-semibold text-text-primary mb-4">Opciones adicionales</h2>
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
        </div>

        <!-- Footer Actions -->
        <div class="flex items-center justify-end gap-3 pb-6">
          <app-button variant="outline" size="md" (clicked)="goBack()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            size="md"
            type="submit"
            [disabled]="submitting() || form.invalid"
            iconName="save"
          >
            {{ submitting() ? 'Guardando...' : (isEditMode() ? 'Guardar cambios' : 'Crear artículo') }}
          </app-button>
        </div>
      </form>
    </div>
  `,
})
export class ArticleFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private service = inject(HelpCenterAdminService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  isEditMode = signal(false);
  loadingArticle = signal(false);
  submitting = signal(false);
  contentValue = signal('');
  existingCoverUrl = signal<string | null>(null);
  coverFile = signal<File | null>(null);
  categoryOptions = signal<SelectorOption[]>([]);

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
}
