import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';

import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { BadgeComponent } from '../../../../../../shared/components/badge/badge.component';
import { ConfirmationModalComponent } from '../../../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { SelectorComponent, SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { HelpCenterAdminService } from '../../../help-center/services/help-center-admin.service';
import { VideoLibraryAdminService } from '../../services/video-library-admin.service';
import { VideoSeriesAdminService } from '../../services/video-series-admin.service';
import { VideoSeriesListItem } from '../../models/video-series.model';

/** Selector values cannot be null: 0 stands for "no article". */
const NO_ARTICLE: SelectorOption = { label: 'Sin artículo', value: 0 };

interface EditorItem {
  video_id: number;
  title: string;
  article_id: number | null;
}

@Component({
  selector: 'app-video-series-tab',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    ButtonComponent,
    BadgeComponent,
    ConfirmationModalComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
    SpinnerComponent,
    TextareaComponent,
  ],
  template: `
    <div class="p-4 md:p-6 flex flex-col gap-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <p class="text-sm text-text-secondary m-0">
          Ordena videos en una ruta de aprendizaje. Las rutas publicadas se ven en el centro de ayuda de las tiendas.
        </p>
        <app-button variant="primary" size="sm" iconName="plus" (clicked)="openNew()">
          Nueva serie
        </app-button>
      </div>

      @if (loading()) {
        <div class="flex justify-center py-8"><app-spinner size="md"></app-spinner></div>
      } @else if (series().length === 0) {
        <div class="text-center py-10 text-text-secondary">
          <p class="font-semibold m-0">Aún no hay series.</p>
          <p class="text-sm m-0">Crea la primera para armar una ruta de aprendizaje.</p>
        </div>
      } @else {
        <ul class="flex flex-col gap-2 list-none p-0 m-0">
          @for (s of series(); track s.id) {
            <li class="flex items-center gap-3 flex-wrap p-3 rounded-xl border border-border bg-surface">
              <div class="flex-1 min-w-0">
                <p class="font-semibold m-0 truncate">{{ s.title }}</p>
                <p class="text-xs text-text-secondary m-0">
                  {{ s._count?.items || 0 }} videos @if (s.module) { · {{ s.module }} }
                </p>
              </div>
              <app-badge [variant]="s.status === 'PUBLISHED' ? 'success' : 'warning'" size="sm">
                {{ s.status === 'PUBLISHED' ? 'Publicada' : s.status === 'DRAFT' ? 'Borrador' : 'Archivada' }}
              </app-badge>
              <div class="flex items-center gap-1">
                <app-button variant="ghost" size="sm" iconName="edit-2" (clicked)="openEdit(s)">Editar</app-button>
                @if (s.status === 'PUBLISHED') {
                  <app-button variant="ghost" size="sm" (clicked)="togglePublish(s)">Despublicar</app-button>
                } @else {
                  <app-button variant="ghost" size="sm" (clicked)="togglePublish(s)">Publicar</app-button>
                }
                <app-button variant="danger" size="sm" iconName="trash-2" (clicked)="askDelete(s)" aria-label="Eliminar serie"></app-button>
              </div>
            </li>
          }
        </ul>
      }
    </div>

    <app-modal
      [(isOpen)]="isEditorOpen"
      size="lg"
      [title]="editingId() ? 'Editar serie' : 'Nueva serie'"
    >
      <form [formGroup]="form" class="flex flex-col gap-4 p-4" (ngSubmit)="save()" id="series-form">
        <app-input label="Título" [formControl]="form.controls.title" [required]="true"></app-input>
        <app-textarea label="Resumen" [rows]="2" [formControl]="form.controls.summary"></app-textarea>
        <app-input label="Módulo" placeholder="ej: inventario, pos" [formControl]="form.controls.module"></app-input>

        <fieldset class="flex flex-col gap-3 border-0 p-0 m-0">
          <legend class="text-sm font-semibold mb-1">Videos de la serie (en orden)</legend>

          @if (items().length === 0) {
            <p class="text-sm text-text-secondary m-0">Agrega al menos un video para poder publicar.</p>
          }
          <ol class="flex flex-col gap-2 list-none p-0 m-0">
            @for (item of items(); track item.video_id; let i = $index; let last = $last) {
              <li class="flex flex-col gap-2 p-3 rounded-xl border border-border bg-surface">
                <div class="flex items-center gap-2">
                  <span class="w-7 h-7 rounded-full grid place-items-center text-xs font-bold bg-background text-text-secondary">{{ i + 1 }}</span>
                  <span class="flex-1 min-w-0 text-sm font-semibold truncate">{{ item.title }}</span>
                  <app-button type="button" variant="ghost" size="sm" iconName="arrow-up" [disabled]="i === 0"
                    [attr.aria-label]="'Subir ' + item.title" (clicked)="move(i, -1)"></app-button>
                  <app-button type="button" variant="ghost" size="sm" iconName="arrow-down" [disabled]="last"
                    [attr.aria-label]="'Bajar ' + item.title" (clicked)="move(i, 1)"></app-button>
                  <app-button type="button" variant="danger" size="sm" iconName="x"
                    [attr.aria-label]="'Quitar ' + item.title" (clicked)="removeItem(i)"></app-button>
                </div>
                <app-selector
                  size="sm"
                  placeholder="Artículo opcional"
                  [options]="articleOptions()"
                  [ngModel]="item.article_id ?? 0"
                  [ngModelOptions]="{ standalone: true }"
                  (ngModelChange)="setArticle(i, $event)"
                ></app-selector>
              </li>
            }
          </ol>

          <div class="flex items-end gap-2 flex-wrap">
            <div class="flex-1 min-w-48">
              <app-selector
                label="Agregar video"
                placeholder="Elige un video"
                [options]="availableVideoOptions()"
                [formControl]="videoPicker"
              ></app-selector>
            </div>
            <app-button type="button" variant="secondary" size="md" iconName="plus"
              [disabled]="!videoPicker.value" (clicked)="addVideo()">Agregar</app-button>
          </div>
        </fieldset>
      </form>
      <div slot="footer" class="flex justify-end gap-2 p-4">
        <app-button type="button" variant="ghost" (clicked)="isEditorOpen.set(false)">Cancelar</app-button>
        <app-button type="submit" form="series-form" variant="primary" [loading]="saving()" [disabled]="form.invalid">Guardar</app-button>
      </div>
    </app-modal>

    <app-confirmation-modal
      [(isOpen)]="isDeleteOpen"
      title="Eliminar serie"
      [message]="'¿Eliminar la serie \\'' + (toDelete()?.title || '') + '\\'? Los videos no se borran.'"
      confirmText="Eliminar"
      confirmVariant="danger"
      (confirm)="confirmDelete()"
      (cancel)="isDeleteOpen.set(false)"
    ></app-confirmation-modal>
  `,
})
export class VideoSeriesTabComponent implements OnInit {
  private seriesService = inject(VideoSeriesAdminService);
  private videoService = inject(VideoLibraryAdminService);
  private helpService = inject(HelpCenterAdminService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly series = signal<VideoSeriesListItem[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);

  readonly isEditorOpen = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly items = signal<EditorItem[]>([]);

  readonly isDeleteOpen = signal(false);
  readonly toDelete = signal<VideoSeriesListItem | null>(null);

  private readonly allVideos = signal<{ id: number; title: string }[]>([]);
  readonly articleOptions = signal<SelectorOption[]>([NO_ARTICLE]);
  readonly availableVideoOptions = computed<SelectorOption[]>(() => {
    const used = new Set(this.items().map((i) => i.video_id));
    return this.allVideos()
      .filter((v) => !used.has(v.id))
      .map((v) => ({ label: v.title, value: v.id }));
  });

  readonly videoPicker = new FormControl<number | null>(null);
  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(255)] }),
    summary: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
    module: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(50)] }),
  });

  ngOnInit(): void {
    this.loadSeries();
    forkJoin({
      videos: this.videoService.getVideos({ limit: 100 }),
      articles: this.helpService.getArticles({ limit: 100, status: 'PUBLISHED' }),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ videos, articles }) => {
          this.allVideos.set((videos.data || []).map((v) => ({ id: v.id, title: v.title })));
          this.articleOptions.set([
            NO_ARTICLE,
            ...(articles.data || []).map((a) => ({ label: a.title, value: a.id })),
          ]);
        },
        error: () => this.toast.error('No se pudieron cargar los videos y artículos disponibles'),
      });
  }

  loadSeries(): void {
    this.loading.set(true);
    this.seriesService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.series.set(list || []);
          this.loading.set(false);
        },
        error: (err) => {
          this.toast.error(parseApiError(err).userMessage || 'Error al cargar las series');
          this.loading.set(false);
        },
      });
  }

  openNew(): void {
    this.editingId.set(null);
    this.form.reset({ title: '', summary: '', module: '' });
    this.items.set([]);
    this.videoPicker.reset(null);
    this.isEditorOpen.set(true);
  }

  openEdit(s: VideoSeriesListItem): void {
    this.seriesService
      .get(s.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (d) => {
          this.editingId.set(d.id);
          this.form.reset({ title: d.title, summary: d.summary ?? '', module: d.module ?? '' });
          this.items.set(
            d.items.map((i) => ({ video_id: i.video_id, title: i.video.title, article_id: i.article_id })),
          );
          this.videoPicker.reset(null);
          this.isEditorOpen.set(true);
        },
        error: (err) => this.toast.error(parseApiError(err).userMessage || 'No se pudo abrir la serie'),
      });
  }

  addVideo(): void {
    const id = this.videoPicker.value;
    const video = this.allVideos().find((v) => v.id === id);
    if (!video) return;
    this.items.update((list) => [...list, { video_id: video.id, title: video.title, article_id: null }]);
    this.videoPicker.reset(null);
  }

  removeItem(index: number): void {
    this.items.update((list) => list.filter((_, i) => i !== index));
  }

  move(index: number, delta: -1 | 1): void {
    const target = index + delta;
    this.items.update((list) => {
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  setArticle(index: number, articleId: number | string | null): void {
    this.items.update((list) =>
      list.map((item, i) => (i === index ? { ...item, article_id: Number(articleId) || null } : item)),
    );
  }

  save(): void {
    if (this.form.invalid || this.saving()) return;
    const { title, summary, module } = this.form.getRawValue();
    const payload = {
      title,
      summary: summary || undefined,
      module: module || undefined,
      items: this.items().map((i) => ({ video_id: i.video_id, article_id: i.article_id })),
    };
    const id = this.editingId();
    this.saving.set(true);
    (id ? this.seriesService.update(id, payload) : this.seriesService.create(payload))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Serie guardada');
          this.saving.set(false);
          this.isEditorOpen.set(false);
          this.loadSeries();
        },
        error: (err) => {
          this.toast.error(parseApiError(err).userMessage || 'No se pudo guardar la serie');
          this.saving.set(false);
        },
      });
  }

  togglePublish(s: VideoSeriesListItem): void {
    const publishing = s.status !== 'PUBLISHED';
    (publishing ? this.seriesService.publish(s.id) : this.seriesService.unpublish(s.id))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success(publishing ? 'Serie publicada' : 'Serie despublicada');
          this.loadSeries();
        },
        error: (err) => this.toast.error(parseApiError(err).userMessage || 'No se pudo cambiar el estado'),
      });
  }

  askDelete(s: VideoSeriesListItem): void {
    this.toDelete.set(s);
    this.isDeleteOpen.set(true);
  }

  confirmDelete(): void {
    const s = this.toDelete();
    if (!s) return;
    this.seriesService
      .remove(s.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Serie eliminada');
          this.isDeleteOpen.set(false);
          this.loadSeries();
        },
        error: (err) => {
          this.toast.error(parseApiError(err).userMessage || 'No se pudo eliminar la serie');
          this.isDeleteOpen.set(false);
        },
      });
  }
}
