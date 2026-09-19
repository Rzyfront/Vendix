import { Component, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { VideoLibraryAdminService } from '../../services/video-library-admin.service';
import { VideoCategory } from '../../../../store/help/video-library/models/video.model';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { StickyHeaderComponent } from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { ImageSourceModalComponent } from '../../../../../../shared/components/image-source-modal/image-source-modal.component';
import { dataUrlToFile } from '../../../../../../shared/utils/data-url.util';

@Component({
  selector: 'app-video-form',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    InputComponent,
    TextareaComponent,
    SelectorComponent,
    ToggleComponent,
    IconComponent,
    StickyHeaderComponent,
    ButtonComponent,
    ImageSourceModalComponent,
  ],
  template: `
    <div class="flex flex-col gap-5 p-4 md:p-6 max-w-5xl mx-auto w-full">
      <!-- Sticky Header -->
      <app-sticky-header
        [title]="isEditMode() ? 'Editar Video' : 'Nuevo Video'"
        [subtitle]="isEditMode() ? 'Modifica los datos del video de capacitación' : 'Publica un nuevo video tutorial oficial'"
        [icon]="isEditMode() ? 'video' : 'plus-circle'"
        [showBackButton]="true"
        backRoute="/super-admin/video-library"
        variant="glass"
      ></app-sticky-header>

      @if (loadingVideo()) {
        <div class="flex items-center justify-center py-20">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-6">
          <!-- Section 1: Basic Info -->
          <section class="bg-surface rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 shadow-sm flex flex-col gap-4">
            <div class="flex items-center gap-2 pb-2 border-b border-neutral-100 dark:border-neutral-800">
              <app-icon name="info" [size]="18" class="text-primary"></app-icon>
              <h2 class="text-sm font-bold text-neutral-900 dark:text-neutral-100 uppercase tracking-wide">
                Información del Video
              </h2>
            </div>

            <app-input
              label="Título del Video"
              placeholder="ej: Cómo emitir tu primera Factura Electrónica DIAN"
              [formControl]="$any(form.get('title'))"
              [required]="true"
            ></app-input>

            <app-textarea
              label="Resumen corto"
              placeholder="Breve introducción de 1 o 2 líneas sobre lo que aprenderán en este video"
              [formControl]="$any(form.get('summary'))"
              [rows]="2"
              [required]="true"
            ></app-textarea>

            <div>
              <app-textarea
                label="Descripción y Marcas de Tiempo"
                placeholder="Escribe detalles adicionales y agrega capítulos en formato:&#10;00:00 Introducción&#10;01:30 Creación del Producto&#10;03:45 Factura DIAN"
                [formControl]="$any(form.get('description'))"
                [rows]="6"
              ></app-textarea>
              <span class="text-[11px] text-neutral-400 mt-1 block">
                💡 Tip: Los tiempos escritos como <code class="bg-neutral-100 dark:bg-neutral-800 px-1 rounded">01:45</code> se convierten automáticamente en botones de salto interactivos en el reproductor.
              </span>
            </div>
          </section>

          <!-- Section 2: Video Media & Source -->
          <section class="bg-surface rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 shadow-sm flex flex-col gap-5">
            <div class="flex items-center gap-2 pb-3 border-b border-neutral-100 dark:border-neutral-800">
              <app-icon name="play-circle" [size]="18" class="text-primary"></app-icon>
              <h2 class="text-sm font-bold text-neutral-900 dark:text-neutral-100 uppercase tracking-wide">
                Contenido del Video (Enlace Externo)
              </h2>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <app-input
                label="URL del Video (YouTube, Loom, Vimeo)"
                placeholder="https://www.youtube.com/watch?v=... o https://youtu.be/..."
                [formControl]="$any(form.get('video_url'))"
                [required]="true"
                (blur)="onVideoUrlBlur()"
              ></app-input>

              <app-selector
                label="Plataforma de Video"
                placeholder="Selecciona origen"
                [options]="sourceOptions"
                [formControl]="$any(form.get('video_source'))"
              ></app-selector>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <app-input
                label="Duración manual (segundos)"
                placeholder="ej: 320 (para 5 min 20 seg)"
                type="number"
                [formControl]="$any(form.get('duration_seconds'))"
              ></app-input>

              <app-input
                label="ID Externo (Opcional)"
                placeholder="ej: ID de YouTube"
                [formControl]="$any(form.get('external_id'))"
              ></app-input>
            </div>

            <div class="p-3 bg-neutral-50 dark:bg-neutral-900/40 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs text-neutral-500 dark:text-neutral-400 flex items-start gap-2">
              <app-icon name="info" [size]="16" class="text-primary mt-0.5 shrink-0"></app-icon>
              <span>
                Recomendamos alojar los videos en YouTube (en modo <em>Oculto / Unlisted</em> o Público). Al pegar un enlace de YouTube, se autocompletará automáticamente la plataforma, el ID del video y la portada en alta resolución.
              </span>
            </div>
          </section>

          <!-- Section 3: Thumbnail Preview -->
          <section class="bg-surface rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 shadow-sm flex flex-col gap-4">
            <div class="flex items-center justify-between pb-2 border-b border-neutral-100 dark:border-neutral-800">
              <div class="flex items-center gap-2">
                <app-icon name="image" [size]="18" class="text-primary"></app-icon>
                <h2 class="text-sm font-bold text-neutral-900 dark:text-neutral-100 uppercase tracking-wide">
                  Miniatura / Portada (16:9)
                </h2>
              </div>
              <app-button
                variant="outline"
                size="sm"
                iconName="upload"
                (clicked)="isImageModalOpen.set(true)"
              >
                Subir Imagen
              </app-button>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div class="flex flex-col gap-2">
                <app-input
                  label="URL o Clave de Miniatura"
                  placeholder="https://..."
                  [formControl]="$any(form.get('thumbnail_url'))"
                ></app-input>
                <span class="text-xs text-neutral-400">
                  Si dejas este campo vacío con un enlace de YouTube, se autocompletará automáticamente con la carátula oficial en HD de YouTube. También puedes subir una imagen personalizada con el botón "Subir Imagen".
                </span>
              </div>

              <!-- Preview container 16:9 -->
              <div class="relative w-full aspect-video rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center">
                @if (form.get('thumbnail_url')?.value) {
                  <img
                    [src]="form.get('thumbnail_url')?.value"
                    alt="Preview"
                    class="w-full h-full object-cover"
                  />
                } @else {
                  <div class="flex flex-col items-center text-neutral-400 text-xs">
                    <app-icon name="image" [size]="28" class="mb-1"></app-icon>
                    <span>Vista previa de miniatura</span>
                  </div>
                }
              </div>
            </div>
          </section>

          <!-- Section 4: Classification & Status -->
          <section class="bg-surface rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 shadow-sm flex flex-col gap-4">
            <div class="flex items-center gap-2 pb-2 border-b border-neutral-100 dark:border-neutral-800">
              <app-icon name="tag" [size]="18" class="text-primary"></app-icon>
              <h2 class="text-sm font-bold text-neutral-900 dark:text-neutral-100 uppercase tracking-wide">
                Categorización & Visibilidad
              </h2>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <app-selector
                label="Categoría"
                placeholder="Selecciona una categoría"
                [options]="categoryOptions()"
                [formControl]="$any(form.get('category_id'))"
                [required]="true"
              ></app-selector>

              <app-input
                label="Módulo Relacionado"
                placeholder="ej: pos, invoicing, inventory, orders"
                [formControl]="$any(form.get('module'))"
              ></app-input>
            </div>

            <app-input
              label="Etiquetas (separadas por coma)"
              placeholder="facturación, dian, caja, tutorial"
              [formControl]="$any(form.get('tags_str'))"
            ></app-input>

            <div>
              <app-input
                label="Palabras clave / Keywords de búsqueda (separadas por coma)"
                placeholder="ej: cambiar cliente orden, crear producto, guardar pedido, borrar producto"
                [formControl]="$any(form.get('keywords_str'))"
              ></app-input>
              <span class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1 block">
                💡 <strong>Keywords de búsqueda:</strong> Agrega palabras o frases sobre lo que enseñas en este video. Permite que búsquedas en lenguaje natural (ej: <em>cómo cambiarle el cliente a una orden</em>) encuentren este video con máxima relevancia.
              </span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-neutral-100 dark:border-neutral-800">
              <app-toggle
                label="Video Destacado (Aparece al inicio del feed)"
                [formControl]="$any(form.get('is_featured'))"
              ></app-toggle>

              <app-toggle
                label="Publicar inmediatamente"
                [formControl]="$any(form.get('is_published'))"
              ></app-toggle>
            </div>
          </section>

          <!-- Bottom Submit -->
          <div class="flex justify-end gap-3 pb-10">
            <app-button
              variant="outline"
              size="md"
              routerLink="/super-admin/video-library"
            >
              Cancelar
            </app-button>
            <app-button
              variant="primary"
              size="md"
              type="submit"
              iconName="check"
              [disabled]="form.invalid || saving()"
            >
              {{ saving() ? 'Guardando...' : (isEditMode() ? 'Actualizar Video' : 'Publicar Video') }}
            </app-button>
          </div>
        </form>
      }

      <!-- Modal de Imagen -->
      <app-image-source-modal
        [(isOpen)]="isImageModalOpen"
        [singleImage]="true"
        headerTitle="Subir Miniatura del Video"
        (imagesAdded)="onImagesAdded($event)"
      ></app-image-source-modal>
    </div>
  `,
})
export class VideoFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private videoService = inject(VideoLibraryAdminService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  isEditMode = signal<boolean>(false);
  videoId = signal<number | null>(null);
  loadingVideo = signal<boolean>(false);
  saving = signal<boolean>(false);
  isImageModalOpen = signal<boolean>(false);
  categories = signal<VideoCategory[]>([]);

  sourceOptions: SelectorOption[] = [
    { label: 'YouTube', value: 'YOUTUBE' },
    { label: 'Loom', value: 'LOOM' },
    { label: 'Vimeo', value: 'VIMEO' },
  ];

  categoryOptions = computed<SelectorOption[]>(() =>
    this.categories().map((c) => ({ label: c.name, value: c.id.toString() })),
  );

  form: FormGroup = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(255)]],
    summary: ['', [Validators.required, Validators.maxLength(500)]],
    description: [''],
    video_url: ['', [Validators.required]],
    video_source: ['YOUTUBE', [Validators.required]],
    external_id: [''],
    duration_seconds: [0],
    thumbnail_url: [''],
    category_id: ['', [Validators.required]],
    module: [''],
    tags_str: [''],
    keywords_str: [''],
    is_featured: [false],
    is_published: [true],
  });

  ngOnInit() {
    this.loadCategories();

    const id = this.route.snapshot.params['id'];
    if (id) {
      this.isEditMode.set(true);
      this.videoId.set(+id);
      this.loadVideo(+id);
    }
  }

  loadCategories() {
    this.videoService
      .getCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cats) => this.categories.set(cats),
      });
  }

  loadVideo(id: number) {
    this.loadingVideo.set(true);
    this.videoService
      .getVideoById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (video) => {
          this.form.patchValue({
            title: video.title,
            summary: video.summary,
            description: video.description || '',
            video_url: video.video_url,
            video_source: video.video_source,
            external_id: video.external_id || '',
            duration_seconds: video.duration_seconds || 0,
            thumbnail_url: video.thumbnail_url || '',
            category_id: video.category_id.toString(),
            module: video.module || '',
            tags_str: video.tags ? video.tags.join(', ') : '',
            keywords_str: (video as any).keywords ? (video as any).keywords.join(', ') : '',
            is_featured: video.is_featured,
            is_published: video.status === 'PUBLISHED',
          });

          this.loadingVideo.set(false);
        },
        error: (err) => {
          const parsed = parseApiError(err);
          this.toast.error(parsed.userMessage || 'Error al cargar el video');
          this.loadingVideo.set(false);
          this.router.navigate(['/super-admin/video-library']);
        },
      });
  }

  onVideoUrlBlur() {
    const url = this.form.get('video_url')?.value;
    if (!url) return;

    // Detect YouTube
    const ytMatch = url.match(
      /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    );
    if (ytMatch) {
      const ytId = ytMatch[1];
      this.form.patchValue({
        video_source: 'YOUTUBE',
        external_id: ytId,
      });
      if (!this.form.get('thumbnail_url')?.value) {
        this.form.patchValue({
          thumbnail_url: `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`,
        });
      }
    }
  }

  onImagesAdded(images: string[]) {
    if (!images.length) return;
    const file = dataUrlToFile(images[0], `thumb-${Date.now()}.png`);
    this.videoService
      .uploadThumbnail(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.form.patchValue({ thumbnail_url: res.url });
          this.isImageModalOpen.set(false);
          this.toast.success('Miniatura subida exitosamente');
        },
        error: (err) => {
          const parsed = parseApiError(err);
          this.toast.error(parsed.userMessage || 'Error al subir la miniatura');
        },
      });
  }

  onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      if (!this.form.get('video_url')?.value) {
        this.toast.error('Por favor, ingresa la URL del video');
      }
      return;
    }

    this.saving.set(true);
    const val = this.form.value;

    const tags = val.tags_str
      ? val.tags_str.split(',').map((t: string) => t.trim()).filter(Boolean)
      : [];

    const keywords = val.keywords_str
      ? val.keywords_str.split(',').map((k: string) => k.trim()).filter(Boolean)
      : [];

    const payload = {
      title: val.title,
      summary: val.summary,
      description: val.description || null,
      video_url: val.video_url,
      video_source: val.video_source,
      external_id: val.external_id || null,
      duration_seconds: +val.duration_seconds || 0,
      thumbnail_url: val.thumbnail_url || null,
      status: val.is_published ? 'PUBLISHED' : 'DRAFT',
      category_id: +val.category_id,
      module: val.module || null,
      tags,
      keywords,
      is_featured: val.is_featured,
    };

    const op = this.isEditMode()
      ? this.videoService.updateVideo(this.videoId()!, payload)
      : this.videoService.createVideo(payload);

    op.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success(this.isEditMode() ? 'Video actualizado' : 'Video publicado');
        this.saving.set(false);
        this.router.navigate(['/super-admin/video-library']);
      },
      error: (err) => {
        const parsed = parseApiError(err);
        this.toast.error(parsed.userMessage || 'Error al guardar el video');
        this.saving.set(false);
      },
    });
  }
}
