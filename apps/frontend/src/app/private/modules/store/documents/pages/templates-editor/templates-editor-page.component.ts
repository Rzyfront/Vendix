import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, map, of, switchMap } from 'rxjs';
import {
  AlertBannerComponent,
  BadgeComponent,
  CardComponent,
  ConfirmationModalComponent,
  InputComponent,
  ScrollableTab,
  ScrollableTabsComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import {
  apiErrorMessage,
  isPlanLimit,
  toWorkflowError,
} from '../../../workflows/utils/workflow-errors.util';
import {
  BasePdfBody,
  BasePdfPage,
  BlocksBody,
  TemplateDetail,
  TemplateStatus,
  TemplateVersionRow,
} from '../../interfaces/document-template.interfaces';
import { DocumentTemplatesApiService } from '../../services/document-templates-api.service';
import { TemplateBasePdfEditorComponent } from './template-base-pdf-editor.component';
import { TemplateBlocksEditorComponent } from './template-blocks-editor.component';
import { TemplateVariablesPanelComponent } from './template-variables-panel.component';
import { TemplateVersionsComponent } from './template-versions.component';

type EditorTab = 'design' | 'versions';

const TABS: ScrollableTab[] = [
  { id: 'design', label: 'Diseño', icon: 'pencil' },
  { id: 'versions', label: 'Versiones', icon: 'history' },
];

const STATUS_TEXT: Record<TemplateStatus, string> = {
  draft: 'Borrador',
  published: 'Publicada',
  archived: 'Archivada',
};

/** Problems the API lists in `details.errors` (one per invalid thing in the body). */
function problemsOf(error: unknown): string[] {
  const list = (error as { error?: { details?: { errors?: unknown } } } | null)?.error?.details?.errors;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
}

/** A failed blob request carries its JSON error inside a Blob. */
async function messageOf(error: unknown): Promise<string> {
  const body = (error as { error?: unknown } | null)?.error;
  if (body instanceof Blob) {
    try {
      const parsed = JSON.parse(await body.text()) as { message?: unknown };
      if (typeof parsed.message === 'string') return parsed.message;
    } catch {
      // Not JSON: fall through to the generic message.
    }
  }
  return apiErrorMessage(error);
}

/**
 * Template editor: block or base-PDF design on one side, the real PDF preview
 * on the other, variables panel, publishing and the version list.
 */
@Component({
  selector: 'app-templates-editor-page',
  standalone: true,
  imports: [
    FormsModule,
    StickyHeaderComponent,
    CardComponent,
    InputComponent,
    BadgeComponent,
    AlertBannerComponent,
    ScrollableTabsComponent,
    ConfirmationModalComponent,
    TemplateBlocksEditorComponent,
    TemplateBasePdfEditorComponent,
    TemplateVariablesPanelComponent,
    TemplateVersionsComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        [title]="name() || 'Plantilla'"
        [subtitle]="subtitle()"
        icon="file-text"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/documents/templates"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      />

      @if (loading()) {
        <div class="p-6 text-center">
          <div class="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Cargando plantilla...</p>
        </div>
      } @else if (loadError()) {
        <app-alert-banner variant="danger" icon="alert-triangle">{{ loadError() }}</app-alert-banner>
      } @else if (template(); as t) {
        <div class="flex flex-col gap-3 p-2 md:p-4">
          @if (problems().length > 0) {
            <app-alert-banner variant="danger" icon="alert-triangle">
              <p class="font-medium">Revisa la plantilla antes de continuar:</p>
              <ul class="mt-1 list-disc pl-5 text-sm" data-testid="problems">
                @for (problem of problems(); track $index) {
                  <li>{{ problem }}</li>
                }
              </ul>
            </app-alert-banner>
          }

          <app-card [responsivePadding]="true">
            <div class="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <app-input label="Nombre de la plantilla" [ngModel]="name()" (ngModelChange)="name.set($event ?? '')" />
              <div class="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                <app-badge [variant]="t.status === 'published' ? 'success' : t.status === 'archived' ? 'neutral' : 'warning'" size="xs">
                  {{ statusText() }}
                </app-badge>
                <span>Clave: {{ t.key }}</span>
                @if (dirty()) {
                  <span class="font-medium text-warning" data-testid="dirty">Cambios sin guardar</span>
                }
              </div>
            </div>
          </app-card>

          <app-scrollable-tabs
            [tabs]="tabs"
            [activeTab]="tab()"
            size="md"
            ariaLabel="Secciones de la plantilla"
            (tabChange)="onTab($event)"
          />

          @if (tab() === 'design') {
            <div class="grid gap-4 lg:grid-cols-2">
              <div class="flex min-w-0 flex-col gap-3">
                <details class="rounded-xl border border-border bg-surface p-3" open>
                  <summary class="cursor-pointer text-sm font-semibold text-text-primary">Variables</summary>
                  <div class="mt-3">
                    <app-template-variables-panel (insert)="insertVariable($event)" />
                  </div>
                </details>

                <div (focusin)="trackFocus($event)">
                  @if (blocksBody(); as body) {
                    <app-template-blocks-editor [body]="body" (bodyChange)="draftBody.set($event)" />
                  } @else if (basePdfBody(); as body) {
                    <app-template-base-pdf-editor
                      [body]="body"
                      [pages]="pages()"
                      [uploading]="uploading()"
                      (bodyChange)="draftBody.set($event)"
                      (fileSelected)="uploadBase($event)"
                    />
                  }
                </div>
              </div>

              <div class="min-w-0">
                <app-card title="Vista previa" [responsivePadding]="true" overflow="visible">
                  @if (previewUrl(); as url) {
                    <iframe
                      class="h-[75vh] w-full rounded-lg border border-border"
                      title="Vista previa del PDF"
                      data-testid="preview-frame"
                      [src]="url"
                    ></iframe>
                  } @else {
                    <p class="text-sm text-text-secondary" data-testid="preview-empty">
                      {{ previewing() ? 'Generando la vista previa...' : 'Pulsa «Vista previa» para ver el PDF con datos de ejemplo.' }}
                    </p>
                  }
                </app-card>
              </div>
            </div>
          } @else {
            <app-card [responsivePadding]="true" overflow="visible">
              <app-template-versions [versions]="versions()" [currentId]="t.published_version?.id ?? null" />
            </app-card>
          }
        </div>
      }
    </div>

    <app-confirmation-modal
      [isOpen]="archiveOpen()"
      (isOpenChange)="archiveOpen.set($event)"
      title="Archivar plantilla"
      message="Una plantilla archivada ya no se puede emitir ni elegir en los flujos. Los documentos ya emitidos se conservan."
      confirmText="Archivar"
      confirmVariant="danger"
      (confirm)="archive()"
    />
  `,
})
export class TemplatesEditorPageComponent implements OnInit {
  private readonly api = inject(DocumentTemplatesApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  readonly tabs = TABS;
  readonly tab = signal<EditorTab>('design');
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly template = signal<TemplateDetail | null>(null);
  readonly name = signal('');
  /** Draft body being edited. */
  readonly draftBody = signal<BlocksBody | BasePdfBody>({ page: { size: 'A4' }, blocks: [] });
  readonly pages = signal<BasePdfPage[]>([]);
  readonly versions = signal<TemplateVersionRow[]>([]);
  readonly problems = signal<string[]>([]);
  readonly saving = signal(false);
  readonly publishing = signal(false);
  readonly previewing = signal(false);
  readonly uploading = signal(false);
  readonly archiveOpen = signal(false);
  readonly previewUrl = signal<SafeResourceUrl | null>(null);

  private objectUrl: string | null = null;
  /** What the server holds (name + body) as JSON, to know when there are unsaved changes. */
  private readonly snapshot = signal('');
  private lastField: HTMLInputElement | HTMLTextAreaElement | null = null;
  private templateId = 0;

  readonly blocksBody = computed(() =>
    this.template()?.kind === 'blocks' ? (this.draftBody() as BlocksBody) : null,
  );
  readonly basePdfBody = computed(() =>
    this.template()?.kind === 'base_pdf' ? (this.draftBody() as BasePdfBody) : null,
  );
  readonly dirty = computed(() => JSON.stringify({ name: this.name(), body: this.draftBody() }) !== this.snapshot());
  readonly archived = computed(() => this.template()?.status === 'archived');
  readonly statusText = computed(() => {
    const t = this.template();
    if (!t) return '';
    const version = t.published_version ? ` · v${t.published_version.version}` : '';
    return `${STATUS_TEXT[t.status]}${version}`;
  });
  readonly subtitle = computed(() =>
    this.template()?.kind === 'base_pdf' ? 'Formato desde un PDF base' : 'Documento por bloques',
  );

  readonly headerActions = computed(() => {
    const busy = this.saving() || this.publishing() || this.previewing();
    const closed = this.archived();
    return [
      { id: 'preview', label: 'Vista previa', icon: 'eye', variant: 'outline' as const, loading: this.previewing(), disabled: busy || closed },
      { id: 'save', label: 'Guardar borrador', icon: 'save', variant: 'outline' as const, loading: this.saving(), disabled: busy || closed || !this.dirty() },
      { id: 'publish', label: 'Publicar', icon: 'send', variant: 'primary' as const, loading: this.publishing(), disabled: busy || closed },
      { id: 'archive', label: 'Archivar', icon: 'archive', variant: 'outline-danger' as const, disabled: busy || closed },
    ];
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.revokePreview());
  }

  ngOnInit(): void {
    this.templateId = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isInteger(this.templateId) || this.templateId < 1) {
      this.loading.set(false);
      this.loadError.set('La plantilla no existe.');
      return;
    }
    this.load();
  }

  // ---- Loading ---------------------------------------------------------------

  private apply(detail: TemplateDetail): void {
    this.template.set(detail);
    this.name.set(detail.name);
    this.draftBody.set(detail.body);
    this.snapshot.set(JSON.stringify({ name: detail.name, body: detail.body }));
  }

  private load(): void {
    this.api
      .get(this.templateId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.apply(detail);
          this.loading.set(false);
          this.loadVersions();
          if (detail.kind === 'base_pdf' && detail.base_file_id) this.loadPages();
        },
        error: (error) => {
          this.loading.set(false);
          this.loadError.set(apiErrorMessage(error));
        },
      });
  }

  private loadVersions(): void {
    this.api
      .versions(this.templateId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (rows) => this.versions.set(rows), error: (e) => this.toast.error(apiErrorMessage(e)) });
  }

  private loadPages(): void {
    this.api
      .basePages(this.templateId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (pages) => this.pages.set(pages), error: (e) => this.toast.error(apiErrorMessage(e)) });
  }

  // ---- Interaction -------------------------------------------------------------

  onTab(id: string): void {
    if (id === 'design' || id === 'versions') this.tab.set(id);
  }

  onHeaderAction(id: string): void {
    if (id === 'preview') this.preview();
    else if (id === 'save') this.save();
    else if (id === 'publish') this.publish();
    else if (id === 'archive') this.archiveOpen.set(true);
  }

  trackFocus(event: FocusEvent): void {
    const target = event.target;
    if (
      (target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'search')) ||
      target instanceof HTMLTextAreaElement
    ) {
      this.lastField = target;
    }
  }

  /** Puts the variable where the cursor was in the last text field of the editor. */
  insertVariable(token: string): void {
    const el = this.lastField;
    if (!el?.isConnected) {
      this.toast.info('Haz clic en el texto donde quieres la variable y vuelve a elegirla.');
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.value = el.value.slice(0, start) + token + el.value.slice(end);
    // The form controls listen to `input`: this updates the model like typing would.
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    const caret = start + token.length;
    el.setSelectionRange(caret, caret);
  }

  // ---- Save / preview / publish --------------------------------------------------

  private fail(error: unknown): void {
    this.problems.set(problemsOf(error));
    this.toast.error(apiErrorMessage(error));
  }

  /** Saves the draft when it has changes; completes with the stored template. */
  private ensureSaved(): Observable<TemplateDetail | null> {
    if (!this.dirty()) return of(null);
    return this.api.saveDraft(this.templateId, { name: this.name().trim(), body: this.draftBody() }).pipe(
      map((detail) => {
        // Keep what is on screen (it equals what was just saved).
        this.template.set({ ...detail });
        this.snapshot.set(JSON.stringify({ name: this.name(), body: this.draftBody() }));
        return detail;
      }),
    );
  }

  save(): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.problems.set([]);
    this.ensureSaved()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success('Borrador guardado');
        },
        error: (error) => {
          this.saving.set(false);
          this.fail(error);
        },
      });
  }

  preview(): void {
    if (this.previewing()) return;
    this.previewing.set(true);
    this.problems.set([]);
    this.ensureSaved()
      .pipe(
        switchMap(() => this.api.preview(this.templateId)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (blob) => {
          this.previewing.set(false);
          this.revokePreview();
          this.objectUrl = URL.createObjectURL(blob);
          this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
          this.tab.set('design');
        },
        error: async (error) => {
          this.previewing.set(false);
          this.problems.set(problemsOf(error));
          this.toast.error(await messageOf(error));
        },
      });
  }

  publish(): void {
    if (this.publishing()) return;
    this.publishing.set(true);
    this.problems.set([]);
    this.ensureSaved()
      .pipe(
        switchMap(() => this.api.publish(this.templateId)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          this.publishing.set(false);
          this.toast.success(
            result.created ? `Versión ${result.version} publicada` : 'No hay cambios: la versión publicada sigue siendo la misma',
          );
          this.api
            .get(this.templateId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({ next: (detail) => this.template.set(detail) });
          this.loadVersions();
        },
        error: (error) => {
          this.publishing.set(false);
          this.fail(error);
        },
      });
  }

  uploadBase(file: File): void {
    if (this.uploading()) return;
    this.uploading.set(true);
    this.api
      .uploadBasePdf(this.templateId, file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.uploading.set(false);
          this.template.set({ ...detail });
          this.toast.success('PDF base recibido');
          this.loadPages();
        },
        error: (error) => {
          this.uploading.set(false);
          // The storage cap of the plan already opened the paywall: no toast on top.
          if (isPlanLimit(toWorkflowError(error))) return;
          this.fail(error);
        },
      });
  }

  archive(): void {
    this.api
      .archive(this.templateId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Plantilla archivada');
          this.router.navigate(['/admin/documents/templates']);
        },
        error: (error) => this.fail(error),
      });
  }

  private revokePreview(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}
