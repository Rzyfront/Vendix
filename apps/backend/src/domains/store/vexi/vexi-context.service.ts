import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { SettingsService } from '../settings/settings.service';
import { WeeklyReportService } from '../weekly-report/weekly-report.service';
import { SubscriptionResolverService } from '../subscriptions/services/subscription-resolver.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VexiAttachmentsService } from './vexi-attachments.service';
import type { VexiUiContext } from './vexi-stream-intent.service';

/**
 * Keys this service guarantees. `AIEngineService.interpolate()` leaves an
 * unmatched `{{placeholder}}` in the prompt verbatim, so a missing key does
 * not degrade — it leaks template syntax to the model. Every key below is
 * therefore always present, carrying a human-readable "unavailable" string
 * when the underlying source fails.
 */
export const VEXI_SNAPSHOT_KEYS = [
  'store_profile',
  'business_metrics',
  'active_modules',
  'subscription_state',
  'user_identity',
  'current_datetime',
  'ui_context',
  'turn_attachments',
] as const;

export type VexiSnapshot = Record<(typeof VEXI_SNAPSHOT_KEYS)[number], string>;

const UNAVAILABLE = 'No disponible en este momento.';

/**
 * A store can expose ~100 module keys. Listing all of them twice (visible and
 * hidden) would spend more of the window on the sidebar than on the
 * conversation, so the tail is dropped; the model has `ui_list_modules` for
 * the complete picture when it actually needs it.
 */
const MAX_REPORTED_MODULES = 40;

@Injectable()
export class VexiContextService {
  private readonly logger = new Logger(VexiContextService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly settings: SettingsService,
    private readonly weeklyReport: WeeklyReportService,
    private readonly subscriptions: SubscriptionResolverService,
    private readonly attachments: VexiAttachmentsService,
  ) {}

  /**
   * Structural facts about the commerce Vexi is running inside, pre-rendered
   * as Markdown fragments ready for prompt interpolation.
   *
   * Every section is resolved independently and failure-isolated: a broken
   * KPI query must degrade that one paragraph, never abort the user's turn.
   * The sections are small, deterministic and needed on every single message,
   * which is exactly why they belong in the system prompt rather than behind
   * a tool call the model has to remember to make.
   */
  async buildSnapshot(options?: {
    uiContext?: VexiUiContext;
    attachmentIds?: string[];
  }): Promise<VexiSnapshot> {
    const [
      storeProfile,
      businessMetrics,
      activeModules,
      subscriptionState,
      currentDatetime,
      turnAttachments,
    ] = await Promise.all([
      this.section('store_profile', () => this.buildStoreProfile()),
      this.section('business_metrics', () => this.buildBusinessMetrics()),
      this.section('active_modules', () => this.buildActiveModules()),
      this.section('subscription_state', () => this.buildSubscriptionState()),
      this.section('current_datetime', () => this.buildCurrentDatetime()),
      this.section('turn_attachments', () =>
        this.buildTurnAttachments(options?.attachmentIds),
      ),
    ]);

    return {
      store_profile: storeProfile,
      business_metrics: businessMetrics,
      active_modules: activeModules,
      subscription_state: subscriptionState,
      // Synchronous and can only read from the request context, so it has no
      // failure mode worth isolating.
      user_identity: this.buildUserIdentity(),
      current_datetime: currentDatetime,
      ui_context: this.buildUiContext(options?.uiContext),
      turn_attachments: turnAttachments,
    };
  }

  // ── Sections ────────────────────────────────────────────────────────────

  private async buildStoreProfile(): Promise<string> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) return 'Sin tienda en contexto.';

    // `stores` is exposed unscoped by StorePrismaService (it has no `store_id`
    // column to filter on), so the tenant boundary has to be the explicit id.
    const store = await this.prisma.stores.findFirst({
      where: { id: storeId },
      select: {
        name: true,
        slug: true,
        legal_name: true,
        store_type: true,
        industries: true,
        timezone: true,
        organizations: { select: { name: true } },
      },
    });

    if (!store) return 'Sin tienda en contexto.';

    const currency = await this.settings.getStoreCurrency();

    const lines = [
      `- Comercio: **${store.name}**${store.legal_name ? ` (razón social: ${store.legal_name})` : ''}`,
      `- Organización: ${store.organizations?.name ?? 'sin organización'}`,
      `- Industrias: ${store.industries?.length ? store.industries.join(', ') : 'retail'}`,
      `- Tipo de tienda: ${store.store_type}`,
      `- Moneda: ${currency}`,
      `- Zona horaria: ${store.timezone ?? 'America/Bogota'}`,
    ];

    return lines.join('\n');
  }

  private async buildBusinessMetrics(): Promise<string> {
    // Returns null for commerces younger than the report's age gate; that is a
    // legitimate state, not an error, and Vexi must say so rather than invent.
    const snapshot = await this.weeklyReport.getLatestForCurrentStore();
    const metrics = snapshot?.metrics;

    if (!metrics) {
      return 'Todavía no hay reporte semanal para este comercio (es demasiado reciente o aún no se ha generado). Si el usuario pregunta por métricas, usa las herramientas de consulta en vez de este resumen.';
    }

    const lines = [
      `- Ingresos de la semana: ${metrics.total_revenue}`,
      `- Órdenes: ${metrics.total_orders}`,
      `- Ticket promedio: ${metrics.average_ticket}`,
      `- Unidades vendidas: ${metrics.total_units_sold}`,
      `- Clientes nuevos: ${metrics.new_customers}`,
    ];

    if (metrics.top_product) {
      lines.push(
        `- Producto más vendido: ${metrics.top_product.name} (${metrics.top_product.units} u.)`,
      );
    }
    if (metrics.best_day) {
      lines.push(
        `- Mejor día: ${metrics.best_day.date} (${metrics.best_day.orders} órdenes)`,
      );
    }
    if (metrics.channel_breakdown?.length) {
      const channels = metrics.channel_breakdown
        .map((c) => `${c.display_name} ${c.percentage}%`)
        .join(', ');
      lines.push(`- Canales: ${channels}`);
    }

    lines.push(
      'Estas cifras son del último corte semanal cerrado, no del día de hoy.',
    );

    return lines.join('\n');
  }

  private async buildActiveModules(): Promise<string> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) return UNAVAILABLE;

    const row = await this.prisma.store_settings.findUnique({
      where: { store_id: storeId },
      select: { settings: true },
    });

    const panelUi = (row?.settings as Record<string, any> | null)?.panel_ui as
      | Record<string, unknown>
      | undefined;

    if (!panelUi || typeof panelUi !== 'object') {
      return 'Este comercio usa la configuración de módulos por defecto (sin personalización de panel_ui).';
    }

    const enabled = Object.entries(panelUi)
      .filter(([, value]) => this.isModuleEnabled(value))
      .map(([key]) => key);

    if (!enabled.length) {
      return 'Este comercio usa la configuración de módulos por defecto (sin personalización de panel_ui).';
    }

    return `Módulos habilitados en el panel: ${enabled.join(', ')}.`;
  }

  /**
   * `panel_ui` entries are either a bare boolean or an object carrying
   * `{ enabled }` alongside ordering metadata, depending on when the tenant's
   * settings were written. Both shapes mean the same thing.
   */
  private isModuleEnabled(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (value && typeof value === 'object') {
      const enabled = (value as { enabled?: unknown }).enabled;
      return enabled === undefined ? true : enabled === true;
    }
    return false;
  }

  private async buildSubscriptionState(): Promise<string> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) return UNAVAILABLE;

    const resolved = await this.subscriptions.resolveSubscription(storeId);
    if (!resolved.found) {
      return 'Este comercio no tiene una suscripción activa registrada.';
    }

    const lines = [
      `- Estado: ${resolved.state}`,
      `- Plan: ${resolved.planCode || 'sin plan'}`,
    ];

    if (resolved.currentPeriodEnd) {
      lines.push(
        `- Periodo vigente hasta: ${resolved.currentPeriodEnd.toISOString().slice(0, 10)}`,
      );
    }

    return lines.join('\n');
  }

  /**
   * The screen the user is on, as the browser reported it.
   *
   * **Untrusted by construction.** It is rendered into the prompt so Vexi can
   * say "veo que estás en el POS" and so it can explain a hidden module using
   * the layer the sidebar itself computed — never to decide what Vexi may do.
   * Every capability check happens elsewhere: the tool catalog is filtered by
   * the caller's real permissions and every endpoint keeps its guards. A
   * client that lies here gets a wrong sentence, not extra access.
   */
  private buildUiContext(uiContext?: VexiUiContext): string {
    if (!uiContext) {
      return 'No hay información de la pantalla actual (la petición no vino del panel o el cliente no la envió). No supongas dónde está el usuario: pregúntaselo si lo necesitas.';
    }

    const lines: string[] = [];

    if (uiContext.route) {
      lines.push(`- El usuario está viendo la ruta \`${uiContext.route}\`.`);
    }

    if (uiContext.pos) {
      const { item_count, total, customer } = uiContext.pos;
      lines.push(
        `- Carrito del POS: ${item_count ?? 0} línea(s)${
          total !== undefined ? `, total ${total}` : ''
        }${customer ? `, cliente ${customer}` : ', sin cliente asignado'}.`,
      );
    }

    if (uiContext.visible_modules?.length) {
      lines.push(
        `- Módulos visibles ahora mismo: ${uiContext.visible_modules.slice(0, MAX_REPORTED_MODULES).join(', ')}.`,
      );
    }

    if (uiContext.hidden_modules?.length) {
      const hidden = uiContext.hidden_modules
        .slice(0, MAX_REPORTED_MODULES)
        .map((m) => `${m.key} (bloqueado por ${m.blocked_by})`)
        .join(', ');
      lines.push(
        `- Módulos que este usuario NO ve, con su causa: ${hidden}. Si pregunta por alguno, explícale exactamente esa causa; no inventes otra.`,
      );
    }

    return lines.length
      ? lines.join('\n')
      : 'El cliente envió contexto de pantalla vacío.';
  }

  /**
   * The documents the person attached to THIS message.
   *
   * In the prompt rather than behind a tool for the same reason as the screen
   * context: the model has to know the document exists before it can decide to
   * read it. Discovered through a tool call, an attached invoice would be found
   * only if the model happened to go looking — and the observed failure is worse
   * than that, because it answers the text ("¿registro este gasto?") as if the
   * photo had never arrived.
   *
   * Only metadata is rendered. The bytes stay in S3 behind the handle, which is
   * the whole point of the design: the orchestrating conversation never carries
   * a document, no matter how many pages it has.
   */
  private async buildTurnAttachments(
    attachmentIds?: string[],
  ): Promise<string> {
    if (!attachmentIds?.length) {
      return 'La persona no adjuntó ningún documento en este mensaje. Si lo que pide necesita uno (una factura, un recibo, una planilla), pídeselo: no inventes datos ni asumas que ya lo tienes.';
    }

    const documents = await this.attachments.describeMany(attachmentIds);

    if (!documents.length) {
      return 'La persona intentó adjuntar un documento pero ya no está disponible. Pídele que lo vuelva a adjuntar.';
    }

    const lines = documents.map((document) => {
      const size = `${Math.max(1, Math.round(document.size_bytes / 1024))} KB`;
      const already = document.linked_entity_type
        ? ` — YA se usó para crear un registro de tipo ${document.linked_entity_type}, no lo vuelvas a procesar sin que la persona lo pida`
        : '';

      return `- \`${document.attachment_id}\`: ${document.original_name} (${document.mime_type}, ${size})${already}`;
    });

    return [
      'Documentos que la persona adjuntó en este mensaje:',
      ...lines,
      'Para leerlos usa `ai_extract_document` con su `attachment_id` y el tipo de documento que corresponda; nunca describas el contenido sin haberlo extraído. Después cruza lo extraído con `validate_extraction` antes de proponerle nada. Si vas a registrarlo en el sistema, pásale el mismo `attachment_id` a la operación de escritura para que el documento quede guardado junto al registro.',
    ].join('\n');
  }

  private buildUserIdentity(): string {
    const context = RequestContextService.getContext();
    if (!context?.user_id) return 'Usuario no identificado.';

    const roles = context.roles?.length
      ? context.roles.join(', ')
      : 'sin roles declarados';

    return [
      `- Estás hablando con el usuario #${context.user_id}${context.email ? ` (${context.email})` : ''}`,
      `- Roles: ${roles}${context.is_owner ? ' — es el dueño del comercio' : ''}`,
    ].join('\n');
  }

  private async buildCurrentDatetime(): Promise<string> {
    const storeId = RequestContextService.getStoreId();
    let timezone = 'America/Bogota';

    if (storeId) {
      const store = await this.prisma.stores.findFirst({
        where: { id: storeId },
        select: { timezone: true },
      });
      if (store?.timezone) timezone = store.timezone;
    }

    // `hourCycle: 'h23'` is not cosmetic: the container's ICU renders midnight
    // as hour 24 of the previous day by default, which reads as a date bug to
    // anyone the model relays it to.
    const formatted = new Intl.DateTimeFormat('es-CO', {
      timeZone: timezone,
      dateStyle: 'full',
      timeStyle: 'short',
      hourCycle: 'h23',
    }).format(new Date());

    return `Ahora mismo son las ${formatted} (zona horaria ${timezone}).`;
  }

  // ── Failure isolation ───────────────────────────────────────────────────

  private async section(
    key: string,
    build: () => Promise<string>,
  ): Promise<string> {
    try {
      return await build();
    } catch (error: any) {
      this.logger.warn(
        `Vexi snapshot section "${key}" failed: ${error?.message ?? error}`,
      );
      return UNAVAILABLE;
    }
  }
}
