import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
  StickyHeaderComponent,
  StickyHeaderTab,
} from '../../../../../shared/components/sticky-header/sticky-header.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import {
  arrangeBlocks,
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
import type { AppStatus, ProductPageCustomDomain, StoreAppDetail } from '../interfaces/store-app.interface';
import { LandingSeoPanelComponent } from '../landing-builder/landing-seo-panel.component';
import { StoreAppsService } from '../services/store-apps.service';
import {
  AppPageBrand,
  AppPageDocument,
  AppPageSeo,
  AppPageTheme,
  AppPageVariant,
  applyVariant,
  effectiveMode,
} from '../templates';
import { APPS_ROUTE } from '../utils/app-routes.util';
import { AppPageGeneralPanelComponent } from './app-page-general-panel.component';
import { AppPageStyleBrandKey, AppPageStylePanelComponent } from './app-page-style-panel.component';
import { blocksToPage, emptyPage, pageToBlocks } from './page-builder-document';
import { AppPageBuilderAdapter, AppPagePreviewPayload, appPagePreviewFrameSrc } from './page-builder.types';

export type AppPageBuilderTab = 'general' | 'content' | 'style' | 'seo' | 'preview';

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

const HTTPS = /^https:\/\//i;

/** Stable text of a value, to compare a draft against what the server holds. */
function snapshot(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * F6-B — the configuration view of an app page (store home, product page,
 * service page, booking), same pattern as the landing builder (F6-A): one
 * sticky header with the app, its status, its address, the only Save /
 * Publish / Unpublish actions and the tabs General · Contenido · Estilo ·
 * SEO · Vista previa.
 *
 * The page (`config.page`) and the app's own settings are edited locally;
 * the preview renders that draft with the public page components. App pages
 * have no separate draft: once published, saving changes the live page, so
 * the header then offers only «Publicar cambios».
 *
 * Each app plugs in through its adapter (`page-builder/<app>/`) and projects
 * its own General settings, reading and writing `settings` of this view.
 */
@Component({
  selector: 'app-app-page-builder-page',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    BuilderOutlineComponent,
    BuilderInspectorComponent,
    BuilderPreviewPaneComponent,
    AppPageGeneralPanelComponent,
    AppPageStylePanelComponent,
    LandingSeoPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKeydown($event)',
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
  template: `
    <div class="w-full" [attr.data-app-view]="adapter().kind" data-testid="app-page-builder">
      <app-sticky-header
        [title]="title()"
        [subtitle]="subtitle()"
        [icon]="adapter().icon"
        [showBackButton]="true"
        [backRoute]="catalogRoute"
        [badgeText]="badge()?.label ?? ''"
        [badgeColor]="badge()?.color ?? 'gray'"
        [actions]="actions()"
        [tabs]="tabs"
        [activeTab]="tab()"
        tabsAriaLabel="Secciones de la app"
        (actionClicked)="onAction($event)"
        (tabChanged)="setTab($event)"
      />

      @if (loading() && !loaded()) {
        <p class="px-6 py-10 text-center text-sm text-[var(--color-text-secondary)]">Cargando…</p>
      } @else if (loadError()) {
        <div class="mx-auto max-w-lg px-6 py-10 text-center" role="alert">
          <p class="text-sm text-[var(--color-text-primary)]">{{ loadError() }}</p>
          <button type="button" class="mt-3 text-sm font-semibold text-[var(--color-primary)]" (click)="load()">Reintentar</button>
        </div>
      } @else if (detail() && !detail()!.applies_to_store_industries) {
        <p class="px-6 py-10 text-center text-sm text-[var(--color-text-secondary)]">Esta app no aplica a la industria de tu tienda.</p>
      } @else {
        @if (isOff() && tab() !== 'general') {
          <div class="mx-3 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm md:mx-6" data-testid="app-page-off-banner">
            <span>La app está apagada: puedes editarla, pero para publicarla primero enciéndela.</span>
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
                  [catalog]="adapter().catalog"
                  [mode]="mode()"
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
                <app-builder-inspector [catalog]="adapter().catalog" [block]="selectedBlock()" (propChange)="setProp($event)" />
              </section>
            }
            <section class="min-h-[32rem] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] lg:h-full"
                     [class.hidden]="tab() === 'content'"
                     [class.lg:block]="tab() === 'content'"
                     aria-label="Vista previa">
              <app-builder-preview-pane
                [frameSrc]="frameSrc()"
                [payload]="previewPayload()"
                [selectedBlockId]="selectedId()"
                [(device)]="device"
                (blockSelect)="onPreviewSelect($event)"
              />
            </section>
          </div>
        }

        <div class="mx-auto max-w-3xl p-3 md:px-6 md:py-4" [class.hidden]="tab() !== 'general'">
          <app-app-page-general-panel
            [kind]="adapter().kind"
            [detail]="detail()"
            [busy]="busy()"
            [domains]="domains()"
            [addressHint]="adapter().addressHint"
            [(customDomainId)]="customDomainId"
            (power)="switchApp($event)"
            (applyTemplate)="applyTemplate($event)"
          >
            <ng-content />
          </app-app-page-general-panel>
        </div>

        @if (tab() === 'style') {
          <div class="mx-auto max-w-3xl p-3 md:px-6 md:py-4">
            <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <app-app-page-style-panel [kind]="adapter().kind" [theme]="theme()" [brand]="brand()"
                                        (themeChange)="setTheme($event)" (brandChange)="setBrand($event.key, $event.value)" />
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
export class AppPageBuilderPageComponent<S = unknown, C = unknown> implements OnInit {
  private readonly appsService = inject(StoreAppsService);
  private readonly auth = inject(AuthFacade);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly adapter = input.required<AppPageBuilderAdapter<S, C>>();

  readonly catalogRoute = APPS_ROUTE;
  readonly tabs = TABS;

  readonly tab = signal<AppPageBuilderTab>('content');
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly busy = signal(false);

  readonly detail = signal<StoreAppDetail | null>(null);
  /** The store's own domains; `null` when the app has a fixed address. */
  readonly domains = signal<ProductPageCustomDomain[] | null>(null);
  readonly context = signal<C | null>(null);

  /** Everything of the page but its cover and blocks (mode, sales, brand, theme, SEO…). */
  readonly base = signal<AppPageDocument>(emptyPage());
  /** The cover (virtual block) and the blocks, as the builder edits them. */
  readonly blocks = signal<BuilderBlock[]>(pageToBlocks(emptyPage()));
  private readonly savedPage = signal(snapshot(null));
  /** The app's own settings (General); the app's panel reads and writes it. */
  readonly settings = signal<S | null>(null);
  private readonly savedSettings = signal(snapshot(null));
  readonly customDomainId = signal<number | null>(null);

  readonly selectedId = signal<string | null>(null);
  readonly device = signal<BuilderDevice>('mobile');

  // ── Derived state ──────────────────────────────────────────────────────
  readonly frameSrc = computed(() => appPagePreviewFrameSrc(this.adapter().kind));
  /** The page as it would be saved. */
  readonly page = computed(() => blocksToPage(this.adapter().kind, this.adapter().catalog, this.base(), this.blocks()));
  readonly mode = computed(() => effectiveMode(this.adapter().kind, this.page()));
  readonly selectedBlock = computed(() => this.blocks().find((b) => b.id === this.selectedId()) ?? null);
  readonly theme = computed<AppPageTheme>(() => this.base().theme ?? {});
  readonly brand = computed<AppPageBrand>(() => this.base().brand ?? {});
  readonly seo = computed<AppPageSeo>(() => this.base().seo ?? {});

  readonly pageDirty = computed(() => snapshot(this.page()) !== this.savedPage());
  readonly settingsDirty = computed(() => snapshot(this.settings()) !== this.savedSettings());
  readonly dirty = computed(() => this.pageDirty() || this.settingsDirty());

  /** The domain the app serves now (the radio it starts on). */
  private readonly currentDomainId = computed(() => {
    const id = this.detail()?.domain?.id;
    return (this.domains() ?? []).some((d) => d.id === id) ? (id as number) : null;
  });
  readonly domainChanged = computed(() => this.domains() !== null && this.customDomainId() !== this.currentDomainId());
  readonly isOff = computed(() => {
    const status = this.detail()?.status;
    return status === 'not_installed' || status === 'disabled';
  });
  readonly isPublished = computed(() => this.detail()?.status === 'published');

  readonly storeName = computed(() => this.auth.userStoreName() ?? '');
  readonly host = computed(() => {
    const app = this.detail();
    if (!app) return null;
    if (app.domain?.hostname) return app.domain.hostname;
    return app.public_url ? app.public_url.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;
  });

  readonly title = computed(() => this.detail()?.name ?? '');
  readonly subtitle = computed(() => {
    const where = this.detail()?.public_url ?? this.detail()?.domain?.hostname ?? 'Sin dirección';
    if (this.isPublished() && (this.dirty() || this.domainChanged())) return `${where} · Cambios sin publicar`;
    if (this.dirty()) return `${where} · Cambios sin guardar`;
    return where;
  });
  readonly badge = computed(() => {
    const status = this.detail()?.status;
    return status ? STATUS_BADGE[status] : null;
  });

  /** Why publishing is not possible now, or `null`. Shown as the button title. */
  readonly publishBlocker = computed(() => {
    if (this.isOff()) return 'Enciende la app en General para publicarla.';
    const settings = this.settings();
    return settings === null ? null : this.adapter().publishBlocker(settings, this.page());
  });

  readonly actions = computed<StickyHeaderActionButton[]>(() => {
    const busy = this.busy();
    const actions: StickyHeaderActionButton[] = [];
    const published = this.isPublished();
    // A published page has no separate draft: saving changes it live.
    if (this.dirty() && !published) {
      actions.push({ id: 'save', label: 'Guardar', variant: 'outline', icon: 'save', disabled: busy, title: 'Guardar (Ctrl/Cmd + S)' });
    }
    if (published) {
      actions.push({ id: 'unpublish', label: 'Despublicar', variant: 'outline', icon: 'eye-off', disabled: busy });
    }
    if (!published || this.dirty() || this.domainChanged()) {
      const blocker = this.publishBlocker();
      actions.push({
        id: 'publish',
        label: published ? 'Publicar cambios' : 'Publicar',
        variant: 'primary',
        icon: 'globe',
        loading: busy,
        disabled: busy || !!blocker,
        title: blocker ?? (published ? 'Publicar cambios (Ctrl/Cmd + S)' : undefined),
      });
    }
    return actions;
  });

  readonly previewPayload = computed<AppPagePreviewPayload<S | null, C | null>>(() => {
    const logo = this.auth.userStore()?.logo_url;
    return {
      kind: this.adapter().kind,
      page: this.page(),
      settings: this.settings(),
      context: this.context(),
      storeName: this.storeName(),
      storeLogoUrl: typeof logo === 'string' && HTTPS.test(logo) ? logo : null,
    };
  });

  ngOnInit(): void {
    this.load();
  }

  // ── Navigation and shortcuts ──────────────────────────────────────────
  setTab(id: string): void {
    if (TABS.some((t) => t.id === id)) this.tab.set(id as AppPageBuilderTab);
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

  // ── Page edits (pure engine operations) ───────────────────────────────
  /** Sets the blocks in the order the public page draws them (cover and pinned sections fixed). */
  private setBlocks(blocks: BuilderBlock[]): void {
    this.blocks.set(arrangeBlocks(this.adapter().catalog, blocks));
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

  setTheme(theme: AppPageTheme): void {
    this.base.update((page) => {
      const { theme: _previous, ...rest } = page;
      return Object.keys(theme).length ? { ...rest, theme } : rest;
    });
  }

  setBrand(key: AppPageStyleBrandKey, value: string | boolean | undefined): void {
    this.base.update((page) => {
      const brand: Record<string, unknown> = { ...(page.brand ?? {}) };
      if (value === undefined) delete brand[key];
      else brand[key] = value;
      // The floating button needs a number: without it the flag goes too.
      if (!brand['whatsapp_number']) delete brand['whatsapp_floating'];
      const { brand: _previous, ...rest } = page;
      return Object.keys(brand).length ? { ...rest, brand: brand as AppPageBrand } : rest;
    });
  }

  setSeo(seo: AppPageSeo): void {
    this.base.update((page) => {
      const { seo: _previous, ...rest } = page;
      return Object.keys(seo).length ? { ...rest, seo } : rest;
    });
  }

  /** A ready-made template replaces cover, sections and style; mode, brand and SEO stay. */
  applyTemplate(variant: AppPageVariant): void {
    this.setPage(applyVariant(this.page(), variant));
    this.toast.success(`Plantilla «${variant.name}» aplicada. Revísala y publica cuando quieras.`);
  }

  private setPage(page: AppPageDocument): void {
    const { hero: _hero, blocks: _blocks, ...base } = page;
    this.base.set({ ...base, blocks: [] });
    this.setBlocks(pageToBlocks(page));
    if (!this.blocks().some((b) => b.id === this.selectedId())) this.selectedId.set(this.blocks()[0]?.id ?? null);
  }

  // ── Header actions ─────────────────────────────────────────────────────
  onAction(id: string): void {
    if (id === 'save') this.save();
    else if (id === 'publish') this.publish();
    else if (id === 'unpublish') this.unpublish();
  }

  /** Saves the page and the settings that changed. Returns the chain so publish can continue it. */
  private save$(): Observable<void> {
    const adapter = this.adapter();
    const page = this.page();
    const page$ = this.pageDirty()
      ? this.appsService.savePage(adapter.kind, page).pipe(map(() => this.savedPage.set(snapshot(page))))
      : of(undefined);
    const settings = this.settings();
    const settings$ =
      this.settingsDirty() && settings !== null
        ? adapter.saveSettings$(settings).pipe(map(() => this.savedSettings.set(snapshot(settings))))
        : of(undefined);
    return page$.pipe(switchMap(() => settings$));
  }

  /** Not published: saves. Published: the change is live, so it is «Publicar cambios». */
  save(): void {
    if (this.isPublished()) {
      this.publish();
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

  /** Save what changed → publish the app (only when it is not published yet or its domain changed). */
  publish(): void {
    const blocker = this.publishBlocker();
    if (blocker) {
      this.toast.error(blocker);
      return;
    }
    const adapter = this.adapter();
    const mustPublish = !this.isPublished() || this.domainChanged();
    this.busy.set(true);
    this.save$()
      .pipe(
        switchMap(() => (mustPublish ? adapter.publish$(this.customDomainId()) : of(null))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.toast.success(mustPublish ? adapter.publishedToast : 'Cambios publicados');
          if (mustPublish) this.refreshApp();
        },
        error: (err) => this.fail(err, `No se pudo publicar ${adapter.noun}.`),
      });
  }

  unpublish(): void {
    const adapter = this.adapter();
    this.busy.set(true);
    adapter
      .unpublish$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.toast.success(`Despublicaste ${adapter.noun}`);
          this.refreshApp();
        },
        error: (err) => this.fail(err, `No se pudo despublicar ${adapter.noun}.`),
      });
  }

  switchApp(action: 'activate' | 'deactivate'): void {
    const kind = this.adapter().kind;
    this.busy.set(true);
    const app$ = action === 'activate' ? this.appsService.activate(kind) : this.appsService.deactivate(kind);
    app$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.busy.set(false);
        if (res?.data) this.setDetail(res.data);
        else this.refreshApp();
        this.toast.success(action === 'activate' ? 'App encendida' : 'App apagada');
      },
      error: (err) => this.fail(err, 'No se pudo completar la acción.'),
    });
  }

  // ── Loading ────────────────────────────────────────────────────────────
  load(): void {
    const adapter = this.adapter();
    this.loading.set(true);
    this.loadError.set(null);
    this.appsService
      .get(adapter.kind)
      .pipe(
        map((res) => res.data),
        switchMap((detail) =>
          forkJoin({
            settings: adapter.settings$(detail),
            context: adapter.context$().pipe(catchError(() => of(adapter.emptyContext))),
            domains: this.domains$(adapter),
          }).pipe(map((data) => ({ ...data, detail }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ detail, settings, context, domains }) => {
          this.domains.set(domains);
          this.setDetail(detail);
          this.context.set(context);
          this.settings.set(settings);
          this.savedSettings.set(snapshot(settings));
          this.setPage(adapter.initialPage(detail));
          this.savedPage.set(snapshot(this.page()));
          this.loading.set(false);
          this.loaded.set(true);
          if (this.isOff()) this.tab.set('general');
        },
        error: (err) => {
          this.loading.set(false);
          this.loadError.set(parseApiError(err).userMessage ?? `No se pudo cargar ${adapter.noun}.`);
        },
      });
  }

  /** The store's domains the app may use (`null` = fixed address); a failed read offers none. */
  private domains$(adapter: AppPageBuilderAdapter<S, C>): Observable<ProductPageCustomDomain[] | null> {
    const domains$ = adapter.domains$();
    return domains$ ? domains$.pipe(catchError(() => of([]))) : of(null);
  }

  private setDetail(detail: StoreAppDetail): void {
    this.detail.set(detail);
    this.customDomainId.set(this.currentDomainId());
  }

  private refreshApp(): void {
    this.appsService
      .get(this.adapter().kind)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (res) => this.setDetail(res.data) });
  }

  private fail(err: unknown, fallback: string): void {
    this.busy.set(false);
    this.toast.error(parseApiError(err).userMessage ?? fallback);
  }
}
