import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';

import {
  StoreSettingsRequestOptions,
  StoreSettingsService,
} from './store-settings.service';
import {
  PRINT_DEFAULTS,
  PrintFormat,
  PrintingSettings,
  ReceiptsSettings,
  StoreSettings,
} from '../../../../../../core/models/store-settings.interface';
import { InvoicingService } from '../../../invoicing/services/invoicing.service';
import type { DianEmissionStatus } from '../../../invoicing/interfaces/invoice.interface';
import type { EmissionStage } from '../components/receipts-settings-form/receipts-settings-form.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import type {
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { ConfigFacade } from '../../../../../../core/store/config';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';

/**
 * Estado compartido de Configuración General.
 *
 * **No es `providedIn: 'root'` a propósito.** Se provee en la ruta del shell
 * (`general-settings.routes.ts`), así que su ciclo de vida es el de la pantalla:
 * el borrador sin guardar sobrevive al cambio de pestaña —que ahora es una
 * navegación real y desmonta la página anterior— y muere al salir del módulo.
 *
 * Antes todo esto vivía en `GeneralSettingsComponent`, cuando las 13 secciones
 * estaban apiladas en una sola vista. Al partirlas en rutas hijas, dejar el
 * estado en el componente habría significado perder los cambios pendientes en
 * cada clic de pestaña.
 *
 * OJO con el ciclo de vida: el router cachea el inyector de la ruta en
 * `route._injector` y no lo destruye al salir, así que esta instancia sobrevive
 * a la navegación y su `DestroyRef` nunca dispara. De eso se ocupa `init()`,
 * que resetea el estado transitorio en cada montaje del shell.
 */
@Injectable()
export class GeneralSettingsStore {
  private readonly destroyRef = inject(DestroyRef);
  private readonly settingsService = inject(StoreSettingsService);
  private readonly toastService = inject(ToastService);
  private readonly configFacade = inject(ConfigFacade);
  private readonly authFacade = inject(AuthFacade);
  private readonly invoicingService = inject(InvoicingService);

  // ─── Estado base ────────────────────────────────────────

  readonly settings = signal<StoreSettings>({} as StoreSettings);
  readonly isLoading = signal(true);
  readonly settingsLoaded = signal(false);
  readonly isSaving = signal(false);
  readonly hasUnsavedChanges = signal(false);
  readonly lastSaved = signal<Date | null>(null);

  readonly storeAppUrl = signal<string | null>(null);

  readonly showTemplates = signal(false);
  readonly templates = signal<any[]>([]);

  readonly pendingAppLogo = signal<{ file: File; preview: string } | null>(null);
  readonly pendingAppFavicon = signal<{ file: File; preview: string } | null>(
    null,
  );

  /**
   * `true` cuando se navega desde el dominio de Vendix y no desde el dominio
   * propio de la tienda. Es un `computed` y no un `effect` que escribe una
   * señal: `getCurrentConfig()` ya lee la señal `appConfig` del facade, así que
   * derivarlo es reactivo por sí solo y no arriesga el ciclo lee-y-escribe.
   */
  readonly isVendixDomain = computed(
    () => !!this.configFacade.getCurrentConfig()?.domainConfig?.isVendixDomain,
  );

  /**
   * True cuando la tienda activa es un restaurante. Gatea la pestaña "Mesas".
   * La fuente de verdad es la cascada de industrias que resuelve
   * `AuthFacade.isRestaurant` (settings → login → []).
   */
  readonly isRestaurant = this.authFacade.isRestaurant;

  /**
   * True cuando la tienda activa es un gimnasio. Gatea la sección "Zona Fit"
   * dentro de Logística. Misma cascada que `isRestaurant`.
   */
  readonly isGym = this.authFacade.isGym;

  // ─── Puente con el formulario de Identidad ──────────────

  /**
   * Valor actual del sub-formulario `services` del `GeneralSettingsForm`.
   *
   * Se SIEMBRA desde el settings que devuelve el backend, no sólo desde el
   * formulario. Antes el padre lo leía por `viewChild` en el momento de
   * guardar; con rutas hijas la pestaña Negocio puede estar desmontada (o no
   * haberse montado nunca) y `services` no viajaría en el payload, borrando la
   * dirección persistida al guardar desde cualquier otra pestaña.
   */
  readonly servicesValue = signal<any>(null);

  /**
   * Validez del `GeneralSettingsForm`. `null` = desconocida (nunca se montó),
   * y en ese caso el guardado NO valida — comportamiento idéntico al de antes,
   * cuando `viewChild()` devolvía `undefined` y la validación se salteaba.
   */
  readonly generalFormValid = signal<boolean | null>(null);

  /**
   * Contador que el formulario de Identidad observa para marcar todos sus
   * controles como touched+dirty. Es un contador y no un booleano para que dos
   * intentos de guardado seguidos vuelvan a pintar los errores.
   */
  readonly markTouchedRequest = signal(0);

  /**
   * Contador que el shell observa para navegar a la pestaña Negocio. El store
   * no puede navegar por sí mismo: se provee en la ruta, así que su inyector
   * no ve el `ActivatedRoute` del shell y navegar en absoluto acoplaría el
   * store al prefijo `/admin`.
   */
  readonly focusBusinessTabRequest = signal(0);

  // ─── Estado de emisión electrónica ──────────────────────

  /**
   * Estado real de emisión, de `GET dian-config/emission-status`.
   *
   * Antes se derivaba de `fiscal_status.invoicing.state` (ACTIVE o LOCKED), que
   * sólo significa que el wizard fiscal se completó. Una tienda con su set de
   * pruebas DIAN pendiente veía "Facturación electrónica activa" y perdía los
   * controles de recibo de venta que debe seguir usando hasta que la
   * habilitación llegue a producción.
   */
  private readonly emissionStatus = signal<DianEmissionStatus | null>(null);

  readonly electronicInvoicingActive = computed(
    () => this.emissionStatus()?.is_live === true,
  );

  /**
   * `pending` = HAY configuración DIAN pero todavía no emite, así que la
   * sección conserva los controles de recibo y explica el trámite. `receipts` =
   * nada configurado (también el fallback cuando el estado no se puede leer, que
   * nunca debe pasar una tienda a sólo-factura en silencio).
   */
  readonly emissionStage = computed<EmissionStage>(() => {
    const status = this.emissionStatus();
    if (!status) return 'receipts';
    if (status.is_live) return 'live';
    return status.configuration_id ? 'pending' : 'receipts';
  });

  readonly emissionReason = computed(
    () => this.emissionStatus()?.reason ?? null,
  );

  readonly emissionBlockers = computed(() =>
    (this.emissionStatus()?.blockers ?? []).map((blocker) => ({
      label: blocker.label,
      action: blocker.action,
    })),
  );

  // ─── Derivados del bloque `receipts` ────────────────────

  /** El bloque `receipts` tal como lo esperan los dos formularios que lo editan. */
  readonly receiptsSettings = computed<ReceiptsSettings | undefined>(
    () => this.settings().receipts,
  );

  /** `pos.auto_print_receipt`, editado también desde la sección Recibos. */
  readonly posAutoPrint = computed(
    () => this.settings().pos?.auto_print_receipt ?? false,
  );

  /**
   * Formato que debe renderizar la vista previa del tiquete POS, resuelto por
   * la misma cascada que usa la pantalla de impresión: `printing.pos_ticket` →
   * clave plana deprecada → `PRINT_DEFAULTS`. La sección Recibos ya no edita el
   * formato — sólo lo previsualiza —, así que una copia local rancia mostraría
   * un documento que la impresora nunca produciría.
   */
  readonly posTicketPrintFormat = computed<PrintFormat>(() => {
    const receipts = this.settings().receipts;
    return (
      receipts?.printing?.pos_ticket?.format ??
      receipts?.pos_ticket_format ??
      PRINT_DEFAULTS.pos_ticket.format
    );
  });

  readonly invoicePrintFormat = computed<PrintFormat>(() => {
    const receipts = this.settings().receipts;
    return (
      receipts?.printing?.invoice?.format ??
      receipts?.invoice_format ??
      PRINT_DEFAULTS.invoice.format
    );
  });

  /**
   * ADR-7: Habilitar tiquete de despacho globalmente. Default true para que
   * las tiendas nuevas puedan imprimirlo manual sin tocar settings. Phase E.1/E.2
   * consumen este signal como guard del POS auto y del botón manual.
   */
  readonly printDispatchTicketEnabled = computed(
    () => this.settings().receipts?.print_dispatch_ticket_enabled ?? true,
  );

  /**
   * ADR-7: Auto-imprimir tiquete de despacho junto con POS/factura cuando la
   * venta incluye envío y `shipping_method !== 'direct_delivery'`. Default
   * false (opt-in por admin).
   */
  readonly printDispatchTicketAutoWithPos = computed(
    () => this.settings().receipts?.print_dispatch_ticket_auto_with_pos ?? false,
  );

  /**
   * ADR-7: Auto-imprimir tiquete de despacho al confirmar una venta postventa.
   * Default false (opt-in por admin). La key técnica conserva `_on_postventa`.
   * Se lee cast porque la key aún no está tipada en el modelo de core fuera de
   * alcance de este step (mismo patrón que `(this.settings() as any).shipping`).
   */
  readonly printDispatchTicketAutoOnPostventa = computed(
    () =>
      (this.settings().receipts as any)?.print_dispatch_ticket_auto_on_postventa ??
      false,
  );

  // ─── Cabecera sticky ────────────────────────────────────

  readonly badgeText = computed(() =>
    this.hasUnsavedChanges() ? 'Pendiente de Guardar' : 'Sincronizado',
  );

  readonly badgeColor = computed<StickyHeaderBadgeColor>(() =>
    this.hasUnsavedChanges() ? 'yellow' : 'green',
  );

  readonly badgePulse = computed(() => this.hasUnsavedChanges());

  readonly metadataContent = computed(() =>
    this.lastSaved() ? `Último guardado: ${this.formatLastSaved()}` : '',
  );

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'reset',
      label: 'Restablecer',
      variant: 'outline-danger',
      icon: 'rotate-ccw',
    },
    {
      id: 'save',
      label: 'Guardar Cambios',
      variant: 'primary',
      icon: 'save',
      loading: this.isSaving(),
      disabled: !this.hasUnsavedChanges() && !this.isSaving(),
    },
  ]);

  // ─── Comandos ───────────────────────────────────────────

  /**
   * Carga inicial de la pantalla. La llama el shell en su constructor, o sea
   * una vez por montaje del módulo.
   *
   * **Resetea el estado transitorio a propósito.** El router CACHEA el inyector
   * de una ruta con `providers` en el propio objeto de configuración
   * (`route._injector`, creado una sola vez) y NO lo destruye al desactivarla:
   * la MISMA instancia de este store atiende la próxima visita. Sin el reset se
   * volvería con el badge "Pendiente de Guardar" de la visita anterior, sin
   * spinner de carga, y —lo grave— con un `focusBusinessTabRequest` viejo que el
   * effect del shell interpretaría como una petición nueva y secuestraría un
   * deep-link a otra pestaña.
   */
  init(): void {
    this.isLoading.set(true);
    this.settingsLoaded.set(false);
    this.hasUnsavedChanges.set(false);
    this.lastSaved.set(null);
    this.pendingAppLogo.set(null);
    this.pendingAppFavicon.set(null);
    this.markTouchedRequest.set(0);
    this.focusBusinessTabRequest.set(0);
    // Validez desconocida hasta que el formulario de Identidad se monte y la
    // publique — igual que un componente recién creado.
    this.generalFormValid.set(null);

    // forceRefresh: true también en el montaje — la cache de 60s devolvería la
    // respuesta rancia previa al guardado tras navegar, y el formulario se
    // volvería a montar sin la sub-sección `services` persistida.
    this.loadSettings({ forceRefresh: true });
    this.resolveStoreAppUrl();
    this.loadEmissionStatus();
  }

  loadSettings(options: StoreSettingsRequestOptions = {}): void {
    this.settingsService
      .getSettings(options)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = { ...(response.data as StoreSettings) };
          if ((data as any).shipping) {
            delete (data as any).shipping;
          }
          this.settings.set(data);
          this.isLoading.set(false);
          this.hasUnsavedChanges.set(false);
          this.settingsLoaded.set(true);

          // El payload persistido es la semilla de `services`: garantiza que la
          // dirección viaje en el próximo guardado aunque el usuario nunca abra
          // la pestaña Negocio.
          this.servicesValue.set((data as any).services ?? null);

          // QUI-289 — el sidebar (y el header móvil) pintan el logo desde
          // `user.store.logo_url` del snapshot de auth, que sólo se hidrataba en
          // login: guardar un logo nuevo persistía bien pero el panel seguía
          // mostrando el viejo hasta re-loguear. Este GET es la fuente
          // autoritativa — el backend firma la clave S3 aquí —, así que cada
          // lectura canónica (montaje, post-guardado, post-reset) resincroniza el
          // snapshot. `null` es válido: significa que la tienda quedó sin logo.
          this.authFacade.updateStoreLogo(data.general?.logo_url ?? null);
        },
        error: (error) => {
          console.error('Error loading settings:', error);
          this.toastService.error('Error loading settings');
          this.isLoading.set(false);
        },
      });
  }

  loadTemplates(): void {
    this.settingsService
      .getSystemTemplates()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.templates.set(response.data);
        },
        error: (error) => {
          console.error('Error loading templates:', error);
          this.toastService.error('Error loading templates');
        },
      });
  }

  onSectionChange(section: keyof StoreSettings, newSettings: any): void {
    this.settings.update((s) => ({ ...s, [section]: newSettings }));
    this.hasUnsavedChanges.set(true);
    this.lastSaved.set(null);
  }

  /**
   * La sección Recibos edita `pos.auto_print_receipt`, que pertenece al bloque
   * POS. Se enruta aquí en vez de copiar la bandera dentro de `receipts` para
   * que el ajuste conserve un único hogar.
   */
  onPosAutoPrintChange(value: boolean): void {
    this.onSectionChange('pos', {
      ...(this.settings().pos ?? {}),
      auto_print_receipt: value,
    });
  }

  /**
   * `receipts` lo editan dos formularios hermanos —la sección Recibos y la
   * sección Impresión—, así que se MEZCLA en vez de reemplazarse. Reemplazarlo
   * (lo que hace `onSectionChange`) significaba que el formulario que emitía
   * último borraba las claves del otro, y `printing` desaparecía en silencio en
   * el siguiente toggle de recibos.
   */
  onReceiptsChange(value: Partial<ReceiptsSettings>): void {
    this.onSectionChange('receipts', {
      ...(this.settings().receipts ?? {}),
      ...value,
    });
  }

  /**
   * Persiste el bloque completo por documento y espeja los dos documentos que
   * todavía tienen claves planas deprecadas.
   *
   * El espejo no es redundancia por gusto: `pos_ticket_format` /
   * `pos_ticket_copies` los lee el servicio de tiquete del POS y el flujo de
   * impresión masiva, e `invoice_format` el constructor de PDF de factura del
   * backend. Escribirlas junto a `printing` hace que esta pantalla surta efecto
   * para esos consumidores de inmediato, en vez de sólo después de que cada uno
   * migre su ruta de lectura.
   */
  onPrintingChange(printing: PrintingSettings): void {
    const posTicket = printing.pos_ticket;
    const invoice = printing.invoice;

    this.onReceiptsChange({
      printing,
      ...(posTicket
        ? {
            pos_ticket_format: posTicket.format,
            pos_ticket_copies: posTicket.copies,
          }
        : {}),
      ...(invoice
        ? { invoice_format: invoice.format, invoice_copies: invoice.copies }
        : {}),
    });
  }

  onPendingAppLogo(event: { file: File; preview: string } | null): void {
    this.pendingAppLogo.set(event);
    this.hasUnsavedChanges.set(true);
  }

  onPendingAppFavicon(event: { file: File; preview: string } | null): void {
    this.pendingAppFavicon.set(event);
    this.hasUnsavedChanges.set(true);
  }

  /** Lo emite `GeneralSettingsForm` cada vez que cambia su sub-grupo `services`. */
  setServicesValue(value: any): void {
    if (!value) return;
    this.servicesValue.set(value);
  }

  /** Lo emite `GeneralSettingsForm` cada vez que cambia su estado de validez. */
  setGeneralFormValidity(valid: boolean): void {
    this.generalFormValid.set(valid);
  }

  async saveAllSettings(): Promise<void> {
    this.isSaving.set(true);

    // Validación del GeneralSettingsForm (que embebe el sub-formulario de
    // servicios) antes de cualquier guardado. Si el usuario habilitó "¿Ofrece
    // servicio a domicilio?" y dejó vacíos los campos obligatorios de
    // dirección, el formulario es inválido y el toast dice el motivo concreto.
    //
    // `null` = el formulario nunca se montó y su validez es desconocida: se
    // saltea la validación, igual que cuando el `viewChild` del padre devolvía
    // `undefined`. `false` = está inválido de verdad, así que hay que llevar al
    // usuario a la pestaña donde vive el error y pintarlo.
    if (this.generalFormValid() === false) {
      this.focusBusinessTabRequest.update((n) => n + 1);
      this.markTouchedRequest.update((n) => n + 1);
      this.toastService.error('Ingrese la dirección en el apartado de Servicio');
      this.isSaving.set(false);
      return;
    }

    if ((this.settings() as any).shipping) {
      this.settings.update((s) => {
        const { shipping, ...rest } = s as any;
        return rest as StoreSettings;
      });
    }

    try {
      const uploads: Promise<void>[] = [];

      const pendingLogo = this.pendingAppLogo();
      if (pendingLogo) {
        const logoFile = pendingLogo.file;
        uploads.push(
          firstValueFrom(this.settingsService.uploadStoreLogo(logoFile)).then(
            (result) => {
              this.settings.update((s) => ({
                ...s,
                app: { ...s.app, logo_url: result.key },
                general: { ...s.general, logo_url: result.key },
              }));
              this.pendingAppLogo.set(null);
            },
          ),
        );
      } else if (this.settings().app?.logo_url == null) {
        // QUI-289 — el logo de la app y el de la tienda son el mismo dato en dos
        // lugares: `settings.branding.logo_url` y `stores.logo_url`. Al subir se
        // espejan ambos (ver arriba), así que al borrar hay que espejar el null
        // también. Si `general` conservara la URL firmada anterior, el bloque
        // `general` del backend reescribiría `stores.logo_url` con la clave
        // vieja y desharía el borrado dentro de la misma petición.
        this.settings.update((s) => ({
          ...s,
          general: { ...s.general, logo_url: null },
        }));
      }

      const pendingFavicon = this.pendingAppFavicon();
      if (pendingFavicon) {
        const faviconFile = pendingFavicon.file;
        uploads.push(
          firstValueFrom(
            this.settingsService.uploadStoreFavicon(faviconFile),
          ).then((result) => {
            this.settings.update((s) => ({
              ...s,
              app: { ...s.app, favicon_url: result.key },
            }));
            this.pendingAppFavicon.set(null);
          }),
        );
      }

      if (uploads.length > 0) {
        await Promise.all(uploads);
      }

      const knownSections: (keyof StoreSettings)[] = [
        'general',
        'inventory',
        'checkout',
        'notifications',
        'pos',
        'receipts',
        'app',
        'operations',
        'dispatch',
        'carrier',
        'restaurant',
        'membership',
        'panel_ui',
        'reservations',
        'promotions',
      ];
      const currentSettings = this.settings();
      const sanitizedSettings = knownSections.reduce((acc, key) => {
        if (currentSettings[key] !== undefined) {
          (acc as any)[key] = currentSettings[key];
        }
        return acc;
      }, {} as Partial<StoreSettings>);

      // El sub-formulario 'services' vive fuera de las secciones de primer
      // nivel (es un sub-form renderizado como su propia tarjeta). El valor sale
      // del store —sembrado del backend y refrescado por el formulario cuando
      // está montado— y se persiste como `store_settings.settings.services.*`.
      const servicesValue = this.servicesValue();
      if (servicesValue) {
        (sanitizedSettings as any).services = servicesValue;
      }

      // Guardar todo. Tras el éxito, re-leer los settings del backend para que
      // la señal `settings` refleje el estado canónico — incluidos los defaults
      // que el backend pueda aplicar a campos que el frontend no envió. Sin esa
      // re-lectura, salir y volver re-montaría el GeneralSettingsForm con el
      // valor en memoria, que puede estar rancio si el backend normalizó algo.
      this.settingsService
        .saveSettingsNow(sanitizedSettings)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.isSaving.set(false);
            this.hasUnsavedChanges.set(false);
            this.lastSaved.set(new Date());
            // CRÍTICO: forceRefresh: true para saltear la cache de 60s de
            // settings. Sin esto, loadSettings() devuelve la respuesta rancia
            // previa al guardado (que no trae `services`), y el formulario se
            // re-monta con los campos de dirección vacíos aunque el guardado
            // haya persistido correctamente.
            this.loadSettings({ forceRefresh: true });
          },
          error: (error) => {
            this.isSaving.set(false);

            // QUI-560 — antes se mostraba un literal en inglés y se descartaba
            // `error_code`, así que un rechazo del guard de transición llegaba al
            // usuario como "Error saving settings" y sin decirle qué hacer.
            const parsed = parseApiError(error);
            console.error(
              `Error saving settings [${parsed.errorCode ?? 'sin código'}]:`,
              parsed.devMessage ?? error,
            );
            this.toastService.error(parsed.userMessage);

            // El estado local quedó con el valor rechazado; sin resincronizar, la
            // UI mostraría un settings que la DB nunca aceptó.
            this.loadSettings();
          },
        });
    } catch (error) {
      this.isSaving.set(false);
      console.error('Error uploading files:', error);
      this.toastService.error('Error al subir archivos');
    }
  }

  resetToDefaults(): void {
    if (
      confirm(
        '¿Estás seguro de restablecer todas las configuraciones a valores por defecto?',
      )
    ) {
      this.settingsService
        .resetToDefault()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => this.loadSettings(),
          error: (error) => {
            console.error('Error resetting settings:', error);
            this.toastService.error('Error resetting settings');
          },
        });
    }
  }

  openTemplates(): void {
    this.showTemplates.set(true);
    this.loadTemplates();
  }

  applyTemplate(templateName: string): void {
    if (
      confirm(
        `¿Aplicar la plantilla "${templateName}"? Esto reemplazará toda la configuración actual.`,
      )
    ) {
      this.settingsService
        .applyTemplate(templateName)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (response) => {
            this.settings.set(response.data);
            this.showTemplates.set(false);
            this.toastService.success('Plantilla aplicada correctamente');
          },
          error: (error) => {
            console.error('Error applying template:', error);
            this.toastService.error('Error aplicando plantilla');
          },
        });
    }
  }

  // ─── Internos ───────────────────────────────────────────

  private resolveStoreAppUrl(): void {
    const hostname = this.authFacade.userDomainHostname();
    const slug = this.authFacade.userOrganizationSlug();
    if (hostname) {
      this.storeAppUrl.set(`${window.location.protocol}//${hostname}`);
    } else if (slug) {
      this.storeAppUrl.set('/' + slug);
    }
  }

  private loadEmissionStatus(): void {
    this.invoicingService
      .getDianEmissionStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.emissionStatus.set(response?.data ?? null),
        // Caer a `receipts` en error/403 es la dirección segura: mostrar
        // controles de recibo a una tienda que ya factura es una molestia
        // cosmética, mientras esconderlos a una tienda que todavía los necesita
        // la deja sin poder documentar sus ventas.
        error: () => this.emissionStatus.set(null),
      });
  }

  private formatLastSaved(): string {
    const lastSaved = this.lastSaved();
    if (!lastSaved) return '';
    const date = new Date(lastSaved);
    return date.toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
}
