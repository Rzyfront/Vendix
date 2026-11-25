import { Component, input, model, output, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';

import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { BuilderPreviewPaneComponent } from '../builder/builder-preview-pane.component';
import type { BuilderDevice } from '../builder/builder.types';
import type { StoreAppDetail } from '../interfaces/store-app.interface';
import { StoreAppsService } from '../services/store-apps.service';
import {
  VexDesignChatService,
  VexDesignStreamChunk,
} from '../services/vex-design-chat.service';
import { APP_PAGE_SCHEMA_VERSION, AppPageDocument } from '../templates';
import { AppPageBuilderPageComponent } from './app-page-builder-page.component';
import type { AppPageBuilderAdapter } from './page-builder.types';
import { PRODUCT_PAGE_BUILDER_CATALOG } from './product-page/product-page-builder';
import { STORE_HOME_BUILDER_CATALOG } from './store-home/store-home-builder';
import {
  VexDesignApplyEvent,
  VexDesignChatPanelComponent,
  VexDesignDiscardEvent,
} from './vex-design-chat-panel.component';

function baseDraft(): AppPageDocument {
  return {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    hero: { title: 'Portada inicial', variant: 'centered' },
    blocks: [
      { id: 'benefits', type: 'benefits', enabled: true, props: { title: 'Beneficios' } },
    ],
  };
}

function darkHeroDraft(): AppPageDocument {
  return {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    theme: { surface_color: '#0F172A', text_color: '#F1F5F9' },
    hero: {
      title: 'Portada inicial',
      variant: 'background',
      background_image_url: 'https://api.vendix.online/api/public/apps/media/11111111-1111-4111-8111-111111111111',
    },
    blocks: [
      { id: 'benefits', type: 'benefits', enabled: true, props: { title: 'Beneficios' } },
    ],
  };
}

describe('VexDesignChatPanelComponent (F4)', () => {
  let fixture: ComponentFixture<VexDesignChatPanelComponent>;
  let chatService: jasmine.SpyObj<VexDesignChatService>;
  let stream$: Subject<VexDesignStreamChunk>;
  let applied: VexDesignApplyEvent[];
  let discarded: VexDesignDiscardEvent[];
  let closedCount: number;

  beforeEach(async () => {
    stream$ = new Subject<VexDesignStreamChunk>();
    applied = [];
    discarded = [];
    closedCount = 0;

    chatService = jasmine.createSpyObj('VexDesignChatService', [
      'createStreamIntent',
      'streamDesign',
      'discardLast',
      'resetConversation',
    ]);
    chatService.createStreamIntent.and.returnValue(
      of({
        conversation_id: 77,
        stream_id: 'stream-1',
        draft: baseDraft(),
        history_depth: 0,
        can_discard: false,
      }),
    );
    chatService.streamDesign.and.returnValue(stream$.asObservable());
    chatService.discardLast.and.returnValue(
      of({
        ok: true,
        app_kind: 'product_page',
        document: baseDraft(),
        discarded_summary: 'Portada: fondo oscuro',
        touched_block_id: 'hero',
        history_depth: 0,
        can_discard: false,
      }),
    );
    chatService.resetConversation.and.returnValue(
      of({
        ok: true,
        app_kind: 'product_page',
        document: baseDraft(),
        history_depth: 0,
        can_discard: false,
      }),
    );

    await TestBed.configureTestingModule({
      imports: [VexDesignChatPanelComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: VexDesignChatService, useValue: chatService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VexDesignChatPanelComponent);
    fixture.componentRef.setInput('kind', 'product_page');
    fixture.componentRef.setInput('draft', baseDraft());
    fixture.componentRef.setInput('open', true);
    fixture.componentInstance.applyDraft.subscribe((e) => applied.push(e));
    fixture.componentInstance.discardDraft.subscribe((e) => discarded.push(e));
    fixture.componentInstance.close.subscribe(() => (closedCount += 1));
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('muestra estado vacío con sugerencias y permite enviar un pedido', () => {
    expect(el().querySelector('[data-testid="vex-design-empty"]')).toBeTruthy();

    fixture.componentInstance.promptText.set('Pon el hero con la foto de la galería y fondo oscuro');
    fixture.detectChanges();
    fixture.componentInstance.sendPrompt(fixture.componentInstance.promptText());
    fixture.detectChanges();

    expect(chatService.createStreamIntent).toHaveBeenCalledWith(
      'product_page',
      jasmine.objectContaining({
        content: 'Pon el hero con la foto de la galería y fondo oscuro',
      }),
    );
    expect(el().querySelector('[data-testid="vex-design-loading"]')).toBeTruthy();
    expect(el().querySelector('[data-testid="vex-design-stop"]')).toBeTruthy();
  });

  it('muestra resumen, Aplicar y Descartar al recibir cambios y emite eventos', () => {
    fixture.componentInstance.sendPrompt('Pon el hero con foto y fondo oscuro');
    fixture.detectChanges();

    stream$.next({
      type: 'design_draft',
      app_kind: 'product_page',
      op: 'set_theme',
      document: darkHeroDraft(),
      summary: 'Portada: fondo oscuro',
      touched_block_id: 'hero',
      history_depth: 1,
      can_discard: true,
    });
    stream$.next({
      type: 'design_draft',
      app_kind: 'product_page',
      op: 'set_block_media',
      document: darkHeroDraft(),
      summary: 'imagen de la galería',
      touched_block_id: 'hero',
      history_depth: 2,
      can_discard: true,
    });
    stream$.next({ type: 'text', content: 'Listo, actualicé la portada.' });
    stream$.next({ type: 'done' });
    stream$.complete();
    fixture.detectChanges();

    const summary = el().querySelector('[data-testid="vex-design-proposal-summary"]')?.textContent?.trim();
    expect(summary).toBe('Portada: fondo oscuro; imagen de la galería');

    // Aplicar
    const applyBtn = el().querySelector('[data-testid="vex-design-apply"]') as HTMLButtonElement;
    expect(applyBtn).toBeTruthy();
    applyBtn.click();
    fixture.detectChanges();

    expect(applied.length).toBe(1);
    expect(applied[0].touchedBlockId).toBe('hero');
    expect(applied[0].document.theme?.surface_color).toBe('#0F172A');

    // Descartar
    const discardBtn = el().querySelector('[data-testid="vex-design-discard"]') as HTMLButtonElement;
    discardBtn.click();
    fixture.detectChanges();

    expect(chatService.discardLast).toHaveBeenCalledWith('product_page', 77);
    expect(discarded.length).toBe(1);
    expect(discarded[0].document.theme).toBeUndefined();
  });

  it('detiene el stream activo con el botón Detener y maneja errores con Reintentar', () => {
    fixture.componentInstance.sendPrompt('Cambia el estilo');
    fixture.detectChanges();
    expect(fixture.componentInstance.streaming()).toBe(true);

    (el().querySelector('[data-testid="vex-design-stop"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.streaming()).toBe(false);
    expect(el().querySelector('[data-testid="vex-design-live-status"]')?.textContent).toContain('detenida');

    // Error al crear intent
    chatService.createStreamIntent.and.returnValue(throwError(() => new Error('Sin conexión')));
    fixture.componentInstance.sendPrompt('Otro cambio');
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="vex-design-error"]')).toBeTruthy();
    expect(el().querySelector('[data-testid="vex-design-retry"]')).toBeTruthy();
  });

  it('cierra el panel con la tecla Escape sin bloquear el editor', () => {
    fixture.debugElement.triggerEventHandler('keydown.escape', new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(closedCount).toBe(1);
  });

  it('descartar una propuesta pendiente la marca descartada sin emitir discardDraft ni tocar el borrador', () => {
    fixture.componentInstance.sendPrompt('Propuesta sin aplicar');
    fixture.detectChanges();

    stream$.next({
      type: 'design_draft',
      app_kind: 'product_page',
      op: 'set_theme',
      document: darkHeroDraft(),
      summary: 'Portada: fondo oscuro',
      touched_block_id: 'hero',
      history_depth: 1,
      can_discard: true,
    });
    stream$.next({ type: 'done' });
    stream$.complete();
    fixture.detectChanges();

    // Sin pulsar «Aplicar», la propuesta sigue `pending`.
    const proposalCard = el().querySelector('[data-testid="vex-design-proposal"]');
    expect(proposalCard?.getAttribute('data-status')).toBe('pending');

    const discardBtn = el().querySelector('[data-testid="vex-design-discard"]') as HTMLButtonElement;
    discardBtn.click();
    fixture.detectChanges();

    expect(discarded.length).toBe(0);
    expect(proposalCard?.getAttribute('data-status')).toBe('discarded');
    expect(chatService.discardLast).toHaveBeenCalledWith('product_page', 77);
  });

  it('impide descartar una propuesta aplicada anterior cuando existe otra aplicada más reciente', () => {
    // Turno 1 -> aplicar
    fixture.componentInstance.sendPrompt('Primer cambio');
    fixture.detectChanges();
    stream$.next({
      type: 'design_draft',
      app_kind: 'product_page',
      op: 'set_theme',
      document: darkHeroDraft(),
      summary: 'Cambio 1',
      touched_block_id: 'hero',
      history_depth: 1,
      can_discard: true,
    });
    stream$.next({ type: 'done' });
    stream$.complete();
    fixture.detectChanges();

    const applyButtons1 = el().querySelectorAll('[data-testid="vex-design-apply"]');
    (applyButtons1[0] as HTMLButtonElement).click();
    fixture.componentRef.setInput('draft', darkHeroDraft());
    fixture.detectChanges();

    // Turno 2 -> aplicar
    const stream2$ = new Subject<VexDesignStreamChunk>();
    chatService.streamDesign.and.returnValue(stream2$.asObservable());
    const secondDraft: AppPageDocument = {
      ...darkHeroDraft(),
      hero: { ...darkHeroDraft().hero, title: 'Segundo título' },
    };

    fixture.componentInstance.sendPrompt('Segundo cambio');
    fixture.detectChanges();
    stream2$.next({
      type: 'design_draft',
      app_kind: 'product_page',
      op: 'set_block_prop',
      document: secondDraft,
      summary: 'Cambio 2',
      touched_block_id: 'hero',
      history_depth: 2,
      can_discard: true,
    });
    stream2$.next({ type: 'done' });
    stream2$.complete();
    fixture.detectChanges();

    const applyButtons2 = el().querySelectorAll('[data-testid="vex-design-apply"]');
    (applyButtons2[0] as HTMLButtonElement).click();
    fixture.componentRef.setInput('draft', secondDraft);
    fixture.detectChanges();

    // La propuesta 1 ya no puede descartarse mientras la propuesta 2 siga aplicada.
    const discardButtons = el().querySelectorAll('[data-testid="vex-design-discard"]');
    expect(discardButtons.length).toBe(2);
    expect((discardButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((discardButtons[1] as HTMLButtonElement).disabled).toBe(false);

    // Incluso llamando el método directamente, no revierte la propuesta 1.
    const firstMsgId = fixture.componentInstance.messages().find((m) => m.proposal)?.id!;
    fixture.componentInstance.discardProposal(firstMsgId);
    expect(discarded.length).toBe(0);

    // Al descartar la propuesta 2, restaura el estado previo al turno 2 (`darkHeroDraft`)
    // y vuelve a habilitar el descarte de la propuesta 1.
    (discardButtons[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(discarded.length).toBe(1);
    expect(discarded[0].document.hero?.title).toBe('Portada inicial');
    expect((el().querySelectorAll('[data-testid="vex-design-discard"]')[0] as HTMLButtonElement).disabled).toBe(false);
  });
});

@Component({
  selector: 'app-builder-preview-pane',
  standalone: true,
  template: '<div data-testid="preview-pane"></div>',
})
class StubBuilderPreviewPane {
  readonly frameSrc = input<string>('');
  readonly payload = input<any>(null);
  readonly selectedBlockId = input<string | null>(null);
  readonly device = model<BuilderDevice>('mobile');
  readonly blockSelect = output<string>();
}

function makeAdapter(kind: 'product_page' | 'store_home'): AppPageBuilderAdapter<Record<string, unknown>, Record<string, unknown>> {
  return {
    kind,
    icon: 'box',
    noun: kind === 'store_home' ? 'la tienda' : 'la página de producto',
    publishedToast: 'Publicada',
    catalog: kind === 'store_home' ? STORE_HOME_BUILDER_CATALOG : PRODUCT_PAGE_BUILDER_CATALOG,
    addressHint: 'https://mi.vendix.online',
    emptyContext: {},
    initialPage: () => baseDraft(),
    settings$: () => of({}),
    saveSettings$: () => of({}),
    context$: () => of({}),
    domains$: () => null,
    publishBlocker: () => null,
    publish$: () => of({}),
    unpublish$: () => of({}),
  };
}

describe('AppPageBuilderPageComponent · integración chat Vex (F4)', () => {
  async function mount(kind: 'product_page' | 'store_home', canManage: boolean) {
    const apps = jasmine.createSpyObj('StoreAppsService', ['get', 'savePage', 'activate', 'deactivate']);
    apps.get.and.returnValue(
      of({
        success: true,
        data: {
          key: kind,
          name: kind === 'store_home' ? 'Tienda en línea' : 'Product page',
          description: '',
          applies_to_store_industries: true,
          status: 'draft',
          enabled: true,
          domain: null,
          public_url: 'https://tienda.vendix.online',
          published_at: null,
          config: { page: baseDraft() },
        } as StoreAppDetail,
      }),
    );
    apps.savePage.and.returnValue(of({ success: true, data: { page: baseDraft() } }));

    await TestBed.configureTestingModule({
      imports: [AppPageBuilderPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        { provide: StoreAppsService, useValue: apps },
        {
          provide: AuthFacade,
          useValue: {
            userStoreName: signal('Mi Tienda'),
            userStore: signal({ logo_url: null }),
            hasPermission: (p: string) => canManage && p === 'store:apps:manage',
          },
        },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info']),
        },
      ],
    })
      .overrideComponent(AppPageBuilderPageComponent, {
        remove: { imports: [BuilderPreviewPaneComponent] },
        add: { imports: [StubBuilderPreviewPane] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(AppPageBuilderPageComponent);
    fixture.componentRef.setInput('adapter', makeAdapter(kind));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, apps };
  }

  it('oculta el chat en store_home incluso cuando el usuario tiene permiso', async () => {
    const { fixture } = await mount('store_home', true);
    expect(fixture.componentInstance.canUseDesignChat()).toBe(false);
    expect(fixture.componentInstance.actions().some((a) => a.id === 'design-chat')).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="vex-design-chat-panel"]')).toBeNull();
  });

  it('oculta el chat en product_page si el usuario no tiene permiso store:apps:manage', async () => {
    const { fixture } = await mount('product_page', false);
    expect(fixture.componentInstance.canUseDesignChat()).toBe(false);
    expect(fixture.componentInstance.actions().some((a) => a.id === 'design-chat')).toBe(false);
  });

  it('abre el panel, refresca la vista previa y resalta el bloque al aplicar, sin guardar solo', async () => {
    const { fixture, apps } = await mount('product_page', true);
    const cmp = fixture.componentInstance;

    expect(cmp.canUseDesignChat()).toBe(true);
    cmp.onAction('design-chat');
    fixture.detectChanges();

    expect(cmp.designChatOpen()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="vex-design-chat-panel"]')).toBeTruthy();

    // Aplicar cambio de Vex -> actualiza borrador, refresca previewPayload y resalta bloque
    cmp.onDesignChatApply({
      document: darkHeroDraft(),
      touchedBlockId: 'hero',
      summary: 'Portada: fondo oscuro',
    });
    fixture.detectChanges();

    expect(cmp.previewPayload().page.theme?.surface_color).toBe('#0F172A');
    expect(cmp.previewPayload().highlightedBlockId).toBe('hero');
    expect(cmp.highlightedBlockId()).toBe('hero');
    expect(cmp.dirty()).toBe(true);
    expect(apps.savePage).not.toHaveBeenCalled();

    // Descartar cambio -> revierte borrador y refresca previewPayload
    cmp.onDesignChatDiscard({
      document: baseDraft(),
      touchedBlockId: 'hero',
    });
    fixture.detectChanges();

    expect(cmp.previewPayload().page.theme).toBeUndefined();
    expect(apps.savePage).not.toHaveBeenCalled();
  });

  it('preserva historial, conversationId y propuestas al ocultar el panel o cambiar de pestaña', async () => {
    const { fixture } = await mount('product_page', true);
    const cmp = fixture.componentInstance;

    // Abre el panel y carga estado en la instancia montada.
    cmp.onAction('design-chat');
    fixture.detectChanges();

    const panelDebug = fixture.debugElement.query(
      (de) => de.componentInstance instanceof VexDesignChatPanelComponent,
    );
    expect(panelDebug).toBeTruthy();
    const panel = panelDebug.componentInstance as VexDesignChatPanelComponent;
    panel.conversationId.set(912);
    panel.messages.set([
      { id: 'u1', role: 'user', content: 'Cambia el fondo' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Listo.',
        proposal: {
          document: darkHeroDraft(),
          previousDocument: baseDraft(),
          summary: 'Portada: fondo oscuro',
          touchedBlockId: 'hero',
          status: 'pending',
        },
      },
    ]);
    fixture.detectChanges();

    // 1. Ocultar el panel con el botón del encabezado no destruye su estado.
    cmp.onAction('design-chat');
    fixture.detectChanges();
    expect(cmp.designChatOpen()).toBe(false);

    // 2. Cambiar a Estilo y General y volver a Contenido mantiene la misma instancia.
    cmp.setTab('style');
    fixture.detectChanges();
    cmp.setTab('general');
    fixture.detectChanges();
    cmp.onAction('design-chat');
    fixture.detectChanges();

    expect(cmp.tab()).toBe('content');
    expect(cmp.designChatVisible()).toBe(true);

    const panelAfter = fixture.debugElement.query(
      (de) => de.componentInstance instanceof VexDesignChatPanelComponent,
    )?.componentInstance as VexDesignChatPanelComponent;
    expect(panelAfter).toBe(panel);
    expect(panelAfter.conversationId()).toBe(912);
    expect(panelAfter.messages().length).toBe(2);
    expect(panelAfter.messages()[1].proposal?.status).toBe('pending');
  });
});
