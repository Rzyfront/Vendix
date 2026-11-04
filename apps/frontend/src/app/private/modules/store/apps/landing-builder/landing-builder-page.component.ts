import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, forkJoin, interval, of } from 'rxjs';
import { catchError, map, switchMap, take, takeWhile } from 'rxjs/operators';

import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  CRM_LANDING_SCHEMA_VERSION,
  CrmBlock,
  CrmLandingDocument,
  CrmLandingSeo,
  CrmLandingTheme,
  emptyCrmLandingDocument,
} from '../../../../../public/dynamic-landing/blocks/landing-blocks.types';
import { visibleBlocks } from '../../../../../public/dynamic-landing/components/landing-document-view/landing-view.util';
import {
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
  StickyHeaderComponent,
  StickyHeaderTab,
} from '../../../../../shared/components/sticky-header/sticky-header.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import type { CrmLandingState } from '../../crm/models/crm.model';
import { CrmService } from '../../crm/services/crm.service';
import { ProductsService } from '../../products/services/products.service';
import {
  AppStatus,
  LandingPageConfig,
  ProductPageCustomDomain,
  StoreAppDetail,
  appDomainAliasIds,
} from '../interfaces/store-app.interface';
import { StoreAppsService } from '../services/store-apps.service';
import { APPS_ROUTE } from '../utils/app-routes.util';
import {
  cleanBlockLists,
  duplicateBlock,
  insertBlock,
  moveBlock,
  removeBlock,
  setBlockProp,
  toggleBlockHidden,
} from '../builder/builder-blocks';
import { BuilderInspectorComponent, BuilderPropChange } from '../builder/builder-inspector.component';
import { BuilderOutlineComponent } from '../builder/builder-outline.component';
import { BuilderPreviewPaneComponent } from '../builder/builder-preview-pane.component';
import type { BuilderBlock, BuilderDevice } from '../builder/builder.types';
import { LANDING_BUILDER_CATALOG, LANDING_OPERATION_MODE } from './landing-builder.catalog';
import { LandingGeneralPanelComponent, LandingGenerationState } from './landing-general-panel.component';
import {
  LANDING_PREVIEW_FRAME_ROUTE,
  LandingOfferDraft,
  LandingPreviewContext,
  LandingPreviewPayload,
  resolvePreviewOffer,
} from './landing-preview';
import { LandingSeoPanelComponent } from './landing-seo-panel.component';
import { LandingStylePanelComponent } from './landing-style-panel.component';

export type LandingBuilderTab = 'general' | 'content' | 'style' | 'seo' | 'preview';

const TABS: StickyHeaderTab[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'content', label: 'Contenido', icon: 'layout-list' },
  { id: 'style', label: 'Estilo', icon: 'paintbrush' },
  { id: 'seo', label: 'SEO', icon: 'search' },
  { id: 'preview', label: 'Vista previa', icon: 'eye' },
];

const STATUS_BADGE: Record<AppStatus, { label: string; color: StickyHeaderBadgeColor }> = {
  published: { label: 'Publicada', color: 'green' },
  draft: { label: 'Borrador', color: 'yellow' },
  disabled: { label: 'Apagada', color: 'gray' },
  not_installed: { label: 'No instalada', color: 'gray' },
};

const EMPTY_OFFER: LandingOfferDraft = { mode: 'info', title: '', description: '', product: null };
const EMPTY_CONTEXT: LandingPreviewContext = { products: [], ecommerce_base_url: null };
const HTTPS = /^https:\/\//i;

/** Stable text of a value, to compare a draft against what the server holds. */
function snapshot(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function readDocument(content: unknown): CrmLandingDocument {
  const doc = content as Partial<CrmLandingDocument> | null;
  if (doc && typeof doc === 'object' && Array.isArray(doc.blocks)) {
    return { ...doc, schema_version: CRM_LANDING_SCHEMA_VERSION, blocks: doc.blocks } as CrmLandingDocument;
  }
  return emptyCrmLandingDocument();
}

/**
 * F6-A — `/admin/apps/landing`: the landing page builder. One sticky header
 * holds the app name, its status, its address, the only Save / Publish /
 * Unpublish actions and the five tabs (General, Contenido, Estilo, SEO,
 * Vista previa). The draft (`content_json`) and the offer are edited locally;
 * the preview renders that draft with the public page components.
 *
 * Publish does the whole chain once: save the draft if it changed, publish the
 * content, save the offer, publish the app on its domain.
 */
@Component({
  selector: 'app-landing-builder-page',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    IconComponent,
    BuilderOutlineComponent,
    BuilderInspectorComponent,
    BuilderPreviewPaneComponent,
    LandingGeneralPanelComponent,
    LandingStylePanelComponent,
    LandingSeoPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKeydown($event)',
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
  template: `
    <div class="w-full" data-app-view="landing" data-testid="landing-builder">
      <app-sticky-header
        [title]="title()"
        [subtitle]="subtitle()"
        icon="sparkles"
        [showBackButton]="true"
        [backRoute]="catalogRoute"
        [badgeText]="badge()?.label ?? ''"
        [badgeColor]="badge()?.color ?? 'gray'"
        [actions]="actions()"
        [tabs]="tabs"
        [activeTab]="tab()"
        tabsAriaLabel="Secciones de la landing"
        (actionClicked)="onAction($event)"
        (tabChanged)="setTab($event)"
      />

      @if (loading() && !loaded()) {
        <p class="px-6 py-10 text-center text-sm text-[var(--color-text-secondary)]">Cargando tu landing…</p>
      } @else if (loadError()) {
        <div class="mx-auto max-w-lg px-6 py-10 text-center" role="alert">
          <p class="text-sm text-[var(--color-text-primary)]">{{ loadError() }}</p>
          <button type="button" class="mt-3 text-sm font-semibold text-[var(--color-primary)]" (click)="load()">Reintentar</button>
        </div>
      } @else if (detail() && !detail()!.applies_to_store_industries) {
        <p class="px-6 py-10 text-center text-sm text-[var(--color-text-secondary)]">Esta app no aplica a la industria de tu tienda.</p>
      } @else {
        @if (isOff() && tab() !== 'general') {
          <div class="mx-3 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm md:mx-6" data-testid="landing-off-banner">
            <span>La landing está apagada: puedes editarla, pero para publicarla primero enciéndela.</span>
            <button type="button" class="font-semibold text-[var(--color-primary)]" (click)="setTab('general')">Ir a General</button>
          </div>
        }

        <!-- Contenido y Vista previa comparten la misma vista previa (un solo iframe) -->
        @if (tab() === 'content' || tab() === 'preview') {
          <div class="grid gap-3 p-3 md:px-6"
               [class]="tab() === 'content'
                 ? 'lg:h-[calc(100dvh-10.5rem)] lg:grid-cols-[minmax(0,17rem)_minmax(0,22rem)_minmax(0,1fr)]'
                 : 'h-[calc(100dvh-10.5rem)] grid-cols-1'">
            @if (tab() === 'content') {
              <aside class="min-h-0 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] lg:h-full">
                <app-builder-outline
                  [catalog]="catalog"
                  [mode]="mode"
                  [blocks]="blocks()"
                  [selectedId]="selectedId()"
                  (select)="selectedId.set($event)"
                  (add)="addBlock($event)"
                  (move)="move($event.from, $event.to)"
                  (duplicate)="duplicate($event)"
                  (toggleHidden)="toggleHidden($event)"
                  (remove)="remove($event)"
                />
              </aside>
              <section class="min-h-0 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] lg:h-full" aria-label="Campos de la sección">
                <app-builder-inspector [catalog]="catalog" [block]="selectedBlock()" (propChange)="setProp($event)" />
              </section>
            }
            <section class="min-h-[32rem] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] lg:h-full"
                     [class.hidden]="tab() === 'content'"
                     [class.lg:block]="tab() === 'content'"
                     aria-label="Vista previa">
              <app-builder-preview-pane
                [frameSrc]="frameSrc"
                [payload]="previewPayload()"
                [selectedBlockId]="selectedId()"
                [(device)]="device"
                (blockSelect)="onPreviewSelect($event)"
              />
            </section>
          </div>
        }

        @if (tab() === 'general') {
          <div class="mx-auto max-w-3xl p-3 md:px-6 md:py-4">
            <app-landing-general-panel
              [detail]="detail()"
              [generation]="generation()"
              [generating]="generating()"
              [publishedAt]="publishedAt()"
              [busy]="busy()"
              [domains]="domains()"
              [aliasHostnames]="aliasHostnames()"
              [(offer)]="offer"
              [(customDomainId)]="customDomainId"
              (power)="switchApp($event)"
              (regenerate)="regenerate()"
            />
          </div>
        }

        @if (tab() === 'style') {
          <div class="mx-auto max-w-3xl p-3 md:px-6 md:py-4">
            <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <app-landing-style-panel [theme]="theme()" (themeChange)="patchTheme($event)" />
            </div>
          </div>
        }

        @if (tab() === 'seo') {
          <div class="mx-auto max-w-3xl p-3 md:px-6 md:py-4">
            <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <app-landing-seo-panel [seo]="seo()" [storeName]="storeName()" [host]="host()" (seoChange)="setSeo($event)" />
            </div>
          </div>
        }
      }
    </div>
  `,
})
export class LandingBuilderPageComponent {
  private readonly crmService = inject(CrmService);
  private readonly appsService = inject(StoreAppsService);
  private readonly productsService = inject(ProductsService);
  private readonly auth = inject(AuthFacade);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly catalogRoute = APPS_ROUTE;
  readonly catalog = LANDING_BUILDER_CATALOG;
  readonly mode = LANDING_OPERATION_MODE;
  readonly tabs = TABS;
  readonly frameSrc = LANDING_PREVIEW_FRAME_ROUTE;

  readonly tab = signal<LandingBuilderTab>('content');
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly generating = signal(false);

  readonly detail = signal<StoreAppDetail | null>(null);
  readonly crm = signal<CrmLandingState | null>(null);
  readonly domains = signal<ProductPageCustomDomain[]>([]);
  readonly context = signal<LandingPreviewContext>(EMPTY_CONTEXT);

  readonly draft = signal<CrmLandingDocument>(emptyCrmLandingDocument());
  private readonly savedDraft = signal(snapshot(emptyCrmLandingDocument()));
  readonly offer = signal<LandingOfferDraft>(EMPTY_OFFER);
  private readonly savedOffer = signal(snapshot(EMPTY_OFFER));
  readonly customDomainId = signal<number | null>(null);

  readonly selectedId = signal<string | null>(null);
  readonly device = signal<BuilderDevice>('mobile');

  // ── Derived state ──────────────────────────────────────────────────────
  readonly blocks = computed(() => this.draft().blocks as BuilderBlock[]);
  readonly selectedBlock = computed(() => this.blocks().find((b) => b.id === this.selectedId()) ?? null);
  readonly theme = computed<CrmLandingTheme>(() => this.draft().theme ?? {});
  readonly seo = computed<CrmLandingSeo>(() => this.draft().seo ?? {});

  readonly contentDirty = computed(() => snapshot(this.draft()) !== this.savedDraft());
  readonly offerDirty = computed(() => snapshot(this.offer()) !== this.savedOffer());
  readonly dirty = computed(() => this.contentDirty() || this.offerDirty());

  /** The domain the app serves now (the radio it starts on). */
  private readonly currentDomainId = computed(() => {
    const id = this.detail()?.domain?.id;
    return this.domains().some((d) => d.id === id) ? (id as number) : null;
  });
  readonly isOff = computed(() => {
    const status = this.detail()?.status;
    return status === 'not_installed' || status === 'disabled';
  });
  readonly isPublished = computed(() => this.detail()?.status === 'published');
  /** Something the public page does not show yet: local edits, an unpublished draft, another domain. */
  readonly pendingPublish = computed(() => {
    const crm = this.crm();
    return (
      !this.isPublished() ||
      this.dirty() ||
      !crm?.published_json ||
      snapshot(crm.content_json) !== snapshot(crm.published_json) ||
      this.customDomainId() !== this.currentDomainId()
    );
  });
  readonly visibleCount = computed(() => visibleBlocks(this.draft()).length);

  readonly generation = computed<LandingGenerationState>(() => this.crm()?.generation_status ?? 'idle');
  readonly publishedAt = computed(() => {
    const at = this.crm()?.published_at;
    return at ? new Date(at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  });
  readonly aliasHostnames = computed(() => {
    const domains = this.domains();
    return appDomainAliasIds(this.detail()?.config).map(
      (id) => domains.find((d) => d.id === id)?.hostname ?? `Dominio #${id}`,
    );
  });

  readonly storeName = computed(() => this.auth.userStoreName() ?? '');
  readonly host = computed(() => {
    const app = this.detail();
    if (!app) return null;
    if (app.domain?.hostname) return app.domain.hostname;
    return app.public_url ? app.public_url.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;
  });

  readonly title = computed(() => this.detail()?.name ?? 'Landing page');
  readonly subtitle = computed(() => {
    const where = this.detail()?.public_url ?? this.detail()?.domain?.hostname ?? 'Sin dominio';
    if (this.dirty()) return `${where} · Cambios sin guardar`;
    if (this.isPublished() && this.pendingPublish()) return `${where} · Cambios sin publicar`;
    return where;
  });
  readonly badge = computed(() => {
    const status = this.detail()?.status;
    return status ? STATUS_BADGE[status] : null;
  });

  /** Why publishing is not possible now, or `null`. Shown as the button title. */
  readonly publishBlocker = computed(() => {
    if (this.isOff()) return 'Enciende la landing en General para publicarla.';
    if (this.generating()) return 'Espera a que termine la generación con IA.';
    if (this.visibleCount() === 0) return 'Agrega al menos una sección visible.';
    return null;
  });

  readonly actions = computed<StickyHeaderActionButton[]>(() => {
    const busy = this.busy();
    const actions: StickyHeaderActionButton[] = [];
    if (this.dirty()) {
      actions.push({ id: 'save', label: 'Guardar', variant: 'outline', icon: 'save', disabled: busy, title: 'Guardar borrador (Ctrl/Cmd + S)' });
    }
    if (this.isPublished() && this.detail()?.domain) {
      actions.push({ id: 'unpublish', label: 'Despublicar', variant: 'outline', icon: 'eye-off', disabled: busy });
    }
    if (this.pendingPublish()) {
      const blocker = this.publishBlocker();
      actions.push({
        id: 'publish',
        label: this.isPublished() ? 'Publicar cambios' : 'Publicar',
        variant: 'primary',
        icon: 'globe',
        loading: busy,
        disabled: busy || !!blocker,
        title: blocker ?? undefined,
      });
    }
    return actions;
  });

  readonly previewPayload = computed<LandingPreviewPayload>(() => {
    const logo = this.auth.userStore()?.logo_url;
    return {
      document: this.draft(),
      context: this.context(),
      offer: resolvePreviewOffer(this.offer()),
      storeName: this.storeName(),
      storeLogoUrl: typeof logo === 'string' && HTTPS.test(logo) ? logo : null,
    };
  });

  constructor() {
    this.load();
  }

  // ── Navigation and shortcuts ──────────────────────────────────────────
  setTab(id: string): void {
    if (TABS.some((t) => t.id === id)) this.tab.set(id as LandingBuilderTab);
  }

  onPreviewSelect(blockId: string): void {
    this.selectedId.set(blockId);
    if (this.tab() === 'preview') this.tab.set('content');
  }

  onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (this.dirty() && !this.busy()) this.save();
      return;
    }
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || this.tab() !== 'content') return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const index = this.blocks().findIndex((b) => b.id === this.selectedId());
    if (index < 0) return;
    event.preventDefault();
    this.move(index, event.key === 'ArrowUp' ? index - 1 : index + 1);
  }

  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  // ── Draft edits (pure engine operations) ──────────────────────────────
  private setBlocks(blocks: BuilderBlock[]): void {
    this.draft.update((doc) => ({ ...doc, blocks: blocks as CrmBlock[] }));
  }

  addBlock(type: string): void {
    const selected = this.blocks().findIndex((b) => b.id === this.selectedId());
    const { blocks, block } = insertBlock(this.blocks(), type, selected < 0 ? undefined : selected + 1);
    this.setBlocks(blocks);
    this.selectedId.set(block.id);
  }

  move(from: number, to: number): void {
    this.setBlocks(moveBlock(this.blocks(), from, to));
  }

  duplicate(id: string): void {
    const result = duplicateBlock(this.blocks(), id);
    if (!result) return;
    this.setBlocks(result.blocks);
    this.selectedId.set(result.block.id);
  }

  toggleHidden(id: string): void {
    this.setBlocks(toggleBlockHidden(this.blocks(), id));
  }

  remove(id: string): void {
    const index = this.blocks().findIndex((b) => b.id === id);
    const next = removeBlock(this.blocks(), id);
    this.setBlocks(next);
    if (this.selectedId() === id) this.selectedId.set(next[Math.min(index, next.length - 1)]?.id ?? null);
  }

  setProp(change: BuilderPropChange): void {
    this.setBlocks(setBlockProp(this.blocks(), change.blockId, change.key, change.value));
  }

  patchTheme(change: Partial<CrmLandingTheme>): void {
    this.draft.update((doc) => {
      const theme: Record<string, unknown> = { ...(doc.theme ?? {}), ...change };
      for (const key of Object.keys(theme)) if (theme[key] === undefined) delete theme[key];
      return { ...doc, theme: theme as CrmLandingTheme };
    });
  }

  setSeo(seo: CrmLandingSeo): void {
    this.draft.update((doc) => {
      const { seo: _previous, ...rest } = doc;
      return Object.keys(seo).length === 0 ? rest : { ...rest, seo };
    });
  }

  // ── Header actions ─────────────────────────────────────────────────────
  onAction(id: string): void {
    if (id === 'save') this.save();
    else if (id === 'publish') this.publish();
    else if (id === 'unpublish') this.unpublish();
  }

  /** The draft as it is stored: blank list items dropped. */
  private cleanDraft(): CrmLandingDocument {
    return { ...this.draft(), blocks: cleanBlockLists(this.catalog, this.blocks()) as CrmBlock[] };
  }

  private offerProblem(): string | null {
    const offer = this.offer();
    return offer.mode === 'product' && !offer.product ? 'Elige el producto de la oferta en General.' : null;
  }

  private saveOffer$(): Observable<unknown> {
    const offer = this.offer();
    return this.appsService.saveLandingConfig({
      offer_mode: offer.mode,
      offer_title: offer.title.trim() || null,
      offer_description: offer.description.trim() || null,
      offer_product_id: offer.mode === 'product' ? (offer.product?.id ?? null) : null,
    });
  }

  /** Saves the draft and the offer that changed. Returns the chain so publish can continue it. */
  private save$(): Observable<void> {
    const doc = this.cleanDraft();
    const content$ = this.contentDirty()
      ? this.crmService.saveDraft(doc).pipe(
          map((res) => {
            this.crm.set(res.data);
            this.draft.set(doc);
            this.savedDraft.set(snapshot(doc));
          }),
        )
      : of(undefined);
    const offerSnapshot = snapshot(this.offer());
    const offer$ = this.offerDirty()
      ? this.saveOffer$().pipe(map(() => this.savedOffer.set(offerSnapshot)))
      : of(undefined);
    return content$.pipe(switchMap(() => offer$));
  }

  save(): void {
    const problem = this.offerProblem();
    if (problem && this.offerDirty()) {
      this.toast.error(problem);
      this.tab.set('general');
      return;
    }
    this.busy.set(true);
    this.save$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.toast.success('Cambios guardados');
        },
        error: (err) => this.fail(err, 'No se pudieron guardar los cambios.'),
      });
  }

  /** Save what changed → publish the content → save the offer → publish the app on its domain. */
  publish(): void {
    const problem = this.offerProblem();
    if (problem) {
      this.toast.error(problem);
      this.tab.set('general');
      return;
    }
    if (this.publishBlocker()) return;
    this.busy.set(true);
    const offerSnapshot = snapshot(this.offer());
    this.save$()
      .pipe(
        switchMap(() => this.crmService.publish()),
        map((res) => this.crm.set(res.data)),
        switchMap(() => this.saveOffer$()),
        map(() => this.savedOffer.set(offerSnapshot)),
        switchMap(() => this.appsService.publishLanding(this.customDomainId())),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.toast.success('Landing publicada');
          this.refreshApp(null);
        },
        error: (err) => this.fail(err, 'No se pudo publicar la landing.'),
      });
  }

  unpublish(): void {
    this.busy.set(true);
    this.appsService
      .unpublishLanding()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.toast.success('Landing despublicada de su dominio');
          this.refreshApp(null);
        },
        error: (err) => this.fail(err, 'No se pudo despublicar la landing.'),
      });
  }

  // ── General: on/off and AI generation ─────────────────────────────────
  switchApp(action: 'activate' | 'deactivate'): void {
    this.busy.set(true);
    const app$ = action === 'activate' ? this.appsService.activate('landing') : this.appsService.deactivate('landing');
    app$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.refreshApp(res?.data ?? null);
        this.toast.success(action === 'activate' ? 'Landing encendida' : 'Landing apagada');
        // First time on: the content does not exist yet, the AI writes it.
        if (action === 'activate' && !this.crm()?.enabled) this.generate();
      },
      error: (err) => this.fail(err, 'No se pudo completar la acción.'),
    });
  }

  regenerate(): void {
    this.generate();
  }

  /** `POST /store/crm/activate` (idempotent) enqueues the generation; poll it while the view is open. */
  private generate(): void {
    this.generating.set(true);
    this.crmService
      .activate()
      .pipe(
        switchMap((res) => {
          this.crm.set(res.data);
          const jobId = res.data.last_job_id;
          if (!jobId) return of(null);
          return interval(3000).pipe(
            take(40),
            switchMap(() => this.crmService.getGenerationJobStatus(jobId)),
            takeWhile((job) => job.data?.status !== 'completed' && job.data?.status !== 'failed', true),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (job) => {
          const status = job?.data?.status;
          if (status === 'completed') this.toast.success('Tu landing está lista');
          if (status === 'failed') this.toast.error(job?.data?.error || 'La generación con IA terminó con error');
        },
        error: (err) => {
          this.generating.set(false);
          this.toast.error(parseApiError(err).userMessage ?? 'No se pudo generar la landing.');
        },
        complete: () => {
          this.generating.set(false);
          this.reloadContent();
        },
      });
  }

  // ── Loading ────────────────────────────────────────────────────────────
  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    forkJoin({
      crm: this.crmService.getLanding().pipe(map((res) => res.data)),
      detail: this.appsService.get('landing').pipe(map((res) => res.data)),
      domains: this.appsService.landingCustomDomains().pipe(
        map((res) => res.data ?? []),
        catchError(() => of([] as ProductPageCustomDomain[])),
      ),
      context: this.crmService.getPreviewContext().pipe(
        map((res) => res.data ?? EMPTY_CONTEXT),
        catchError(() => of(EMPTY_CONTEXT)),
      ),
    })
      .pipe(
        switchMap((data) => {
          const config = (data.detail?.config ?? {}) as Partial<LandingPageConfig>;
          const productId =
            config.offer_mode === 'product' && typeof config.offer_product_id === 'number' ? config.offer_product_id : null;
          const product$ = productId
            ? this.productsService.getProductById(productId).pipe(catchError(() => of(null)))
            : of(null);
          return product$.pipe(map((product) => ({ ...data, config, product })));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ crm, detail, domains, context, config, product }) => {
          this.crm.set(crm);
          this.detail.set(detail);
          this.domains.set(domains);
          this.context.set(context);
          this.resetDraft(crm);
          const offer: LandingOfferDraft = {
            mode: config.offer_mode === 'product' ? 'product' : 'info',
            title: config.offer_title ?? '',
            description: config.offer_description ?? '',
            product: product ? { id: product.id, name: product.name, slug: product.slug } : null,
          };
          this.offer.set(offer);
          this.savedOffer.set(snapshot(offer));
          this.customDomainId.set(this.currentDomainId());
          this.loading.set(false);
          this.loaded.set(true);
          if (this.isOff()) this.tab.set('general');
        },
        error: (err) => {
          this.loading.set(false);
          this.loadError.set(parseApiError(err).userMessage ?? 'No se pudo cargar la landing.');
        },
      });
  }

  private resetDraft(crm: CrmLandingState | null): void {
    const doc = readDocument(crm?.content_json);
    this.draft.set(doc);
    this.savedDraft.set(snapshot(doc));
    if (!doc.blocks.some((b) => b.id === this.selectedId())) this.selectedId.set(doc.blocks[0]?.id ?? null);
  }

  /** After a generation: the new draft replaces the local one. */
  private reloadContent(): void {
    this.crmService
      .getLanding()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.crm.set(res.data);
          this.resetDraft(res.data);
        },
        error: () => this.toast.error('No se pudo recargar el contenido de la landing.'),
      });
  }

  private refreshApp(detail: StoreAppDetail | null): void {
    if (detail) {
      this.detail.set(detail);
      this.customDomainId.set(this.currentDomainId());
      return;
    }
    this.appsService
      .get('landing')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.detail.set(res.data);
          this.customDomainId.set(this.currentDomainId());
        },
      });
  }

  private fail(err: unknown, fallback: string): void {
    this.busy.set(false);
    this.toast.error(parseApiError(err).userMessage ?? fallback);
  }
}
