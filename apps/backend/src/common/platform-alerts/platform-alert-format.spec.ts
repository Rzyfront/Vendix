import {
  contextLines,
  displayDetails,
  fallbackContext,
  formatAlertMessage,
  readStoredContext,
  scopeLabelOf,
  type AlertNames,
} from './platform-alert-format';
import type { PlatformAlertRow } from './platform-alert.types';

const row = (over: Partial<PlatformAlertRow> = {}): PlatformAlertRow =>
  ({
    id: 41,
    fingerprint: 'f',
    source: 'job',
    process: 'cola ai-embedding · embed',
    error_type: 'job_failed',
    severity: 'warning',
    status: 'open',
    title: 'Trabajo fallido en la cola ai-embedding',
    message: 'Error: boom',
    details: {
      Cola: 'ai-embedding',
      _context: {
        userId: 7,
        module: 'Productos',
        action: 'indexar el producto para la búsqueda con IA',
        origin: 'event:product.updated',
        entityType: 'product',
        entityId: 123,
      },
    },
    organization_id: 82,
    store_id: 105,
    affected_store_ids: [105],
    occurrences: 1,
    notified_occurrences: 0,
    first_seen_at: new Date('2026-11-10T15:00:00Z'),
    last_seen_at: new Date('2026-11-10T15:00:00Z'),
    escalated_at: null,
    resolved_at: null,
    resolution: null,
    resolved_by_user_id: null,
    ticket_number: null,
    telegram_message_id: null,
    ...over,
  }) as PlatformAlertRow;

const NAMES: AlertNames = {
  stores: new Map([[105, { name: 'Vendix Granizzo', slug: 'testbalmes' }]]),
  organizations: new Map([[82, 'Demo Vendix']]),
  users: new Map([[7, { name: 'Ana Pérez', email: 'ana.perez@vendix.test' }]]),
  entityName: 'Kit de freno NKD',
};

describe('formato de alertas (QUI-1031)', () => {
  it('con nombres: tienda, organización, usuario, módulo, acción, registro y origen; el id al final', () => {
    expect(contextLines(row(), NAMES)).toEqual([
      { label: 'Tienda', value: 'Vendix Granizzo (testbalmes, id 105)', href: '/super-admin/stores/105' },
      { label: 'Organización', value: 'Demo Vendix (id 82)', href: '/super-admin/organizations/82' },
      { label: 'Usuario', value: 'Ana Pérez · ana.perez@vendix.test (id 7)' },
      { label: 'Módulo', value: 'Productos' },
      { label: 'Acción', value: 'indexar el producto para la búsqueda con IA' },
      { label: 'Registro', value: 'producto «Kit de freno NKD» (id 123)' },
      { label: 'Origen', value: 'Evento product.updated' },
    ]);
  });

  it('sin nombres (búsqueda caída o registro borrado): las mismas líneas con ids', () => {
    expect(contextLines(row())).toEqual([
      { label: 'Tienda', value: 'id 105', href: '/super-admin/stores/105' },
      { label: 'Organización', value: 'id 82', href: '/super-admin/organizations/82' },
      { label: 'Usuario', value: 'id 7' },
      { label: 'Módulo', value: 'Productos' },
      { label: 'Acción', value: 'indexar el producto para la búsqueda con IA' },
      { label: 'Registro', value: 'producto (id 123)' },
      { label: 'Origen', value: 'Evento product.updated' },
    ]);
    expect(fallbackContext(row()).superadminUrl).toBeNull();
  });

  it('sin tienda ni organización: «Plataforma (sin tienda)»; otras tiendas con nombre y tope de 10', () => {
    expect(contextLines(row({ store_id: null, organization_id: null, affected_store_ids: [], details: null }))).toEqual([
      { label: 'Afecta a', value: 'Plataforma (sin tienda)' },
    ]);
    const many = Array.from({ length: 13 }, (_, i) => 200 + i);
    const others = contextLines(row({ affected_store_ids: [105, ...many] }), NAMES).find(
      (line) => line.label === 'Otras tiendas',
    );
    expect(others?.value).toMatch(/^id 200, id 201, .*id 209 y 3 más$/);
    expect(scopeLabelOf(row(), NAMES)).toBe('Vendix Granizzo (testbalmes, id 105)');
    expect(scopeLabelOf(row({ store_id: null }), NAMES)).toBe('Demo Vendix (id 82)');
  });

  it('«Límite de plan»: encabezado informativo, plan y cupo; los detalles no muestran el contexto interno', () => {
    const alert = row({
      severity: 'info',
      error_type: 'SUBSCRIPTION_006',
      title: 'Límite de plan: la tienda agotó el cupo de IA de su plan en el periodo',
      details: {
        'Error original': 'Error: AI quota exceeded for this billing period',
        _context: { category: 'plan_limit', planLimitCode: 'SUBSCRIPTION_006', storeId: 105 },
      },
    });
    const lines = contextLines(alert, { ...NAMES, plan: 'Pro (pro) · estado active', quota: '1.000 de 1.000' });
    expect(lines.slice(-2)).toEqual([
      { label: 'Plan', value: 'Pro (pro) · estado active' },
      { label: 'Cupo', value: '1.000 de 1.000' },
    ]);
    expect(contextLines(alert).at(-1)).toEqual({ label: 'Plan', value: 'no disponible' });

    const text = formatAlertMessage(alert, 'producción', {
      lines,
      scopeLabel: 'x',
      superadminUrl: 'https://vendix.com/super-admin/monitoring/alerts?alert=41',
    });
    expect(text.split('\n')[0]).toBe('🔵 <b>LÍMITE DE PLAN</b> · Informativa · producción');
    expect(text).toContain('<b>Cupo:</b> 1.000 de 1.000');
    expect(text).toContain('<a href="https://vendix.com/super-admin/monitoring/alerts?alert=41">Alerta #41</a>');
    expect(text).not.toContain('_context');
    expect(displayDetails(alert.details)).toEqual({
      'Error original': 'Error: AI quota exceeded for this billing period',
    });
  });

  it('sin contexto resuelto, formatAlertMessage sale igual con ids y sin enlace', () => {
    const text = formatAlertMessage(row(), 'staging');
    expect(text).toContain('<b>Tienda:</b> id 105');
    expect(text).toContain('<b>Módulo:</b> Productos');
    expect(text).toContain('Alerta #41 · Superadmin → Monitoreo → Alertas');
    expect(text).toContain('LEVE');
  });

  it('readStoredContext descarta lo que no tiene forma válida', () => {
    expect(
      readStoredContext({
        _context: { userId: 'x', entityType: 'nave', entityId: 5, category: 'otra', module: 'Ventas' },
      }),
    ).toMatchObject({ userId: null, entityType: null, entityId: null, category: null, module: 'Ventas' });
    expect(readStoredContext(null)).toEqual({});
  });
});
