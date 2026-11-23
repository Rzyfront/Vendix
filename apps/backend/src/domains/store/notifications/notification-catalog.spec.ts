import {
  CONFIGURABLE_NOTIFICATION_TYPES,
  NOTIFICATION_CATALOG,
  NOTIFICATION_GROUPS,
  getNotificationCatalogEntry,
  resolveEffectiveChannels,
} from './notification-catalog';

/** Tipos que `update-subscription.dto.ts` aceptaba antes del catálogo. */
const LEGACY_DTO_TYPES = [
  'new_order',
  'order_status_change',
  'low_stock',
  'new_customer',
  'payment_received',
  'layaway_payment_received',
  'layaway_payment_reminder',
  'layaway_overdue',
  'layaway_completed',
  'layaway_cancelled',
  'new_review',
  'ap_installment_due_soon',
  'ap_installment_overdue',
  'credit_installment_reminder',
  'kitchen_ticket_ready',
  'lodging_rnt_renewal',
];

const CRM_TYPES = [
  'crm_task_assigned',
  'crm_task_due',
  'crm_task_due_soon',
  'crm_task_reassigned',
  'crm_task_closed',
  'crm_task_digest',
];

describe('NOTIFICATION_CATALOG', () => {
  it('D1: el correo arranca apagado en todos los tipos', () => {
    for (const entry of NOTIFICATION_CATALOG) {
      expect({ type: entry.type, email: entry.defaults.email }).toEqual({
        type: entry.type,
        email: false,
      });
    }
  });

  it('cubre los tipos del DTO anterior y los seis de tareas CRM', () => {
    for (const type of [...LEGACY_DTO_TYPES, ...CRM_TYPES]) {
      expect(CONFIGURABLE_NOTIFICATION_TYPES).toContain(type);
    }
  });

  it('deja fuera los tipos con correo propio (D3): reminder_due y workflow_task', () => {
    expect(getNotificationCatalogEntry('reminder_due')).toBeUndefined();
    expect(getNotificationCatalogEntry('workflow_task')).toBeUndefined();
  });

  it('el dispositivo conserva el comportamiento actual: encendido salvo el resumen diario', () => {
    for (const entry of NOTIFICATION_CATALOG) {
      expect({ type: entry.type, push: entry.defaults.push }).toEqual({
        type: entry.type,
        push: entry.type !== 'crm_task_digest',
      });
    }
  });

  it('solo los avisos personales de CRM ofrecen correo', () => {
    const withEmail = NOTIFICATION_CATALOG.filter((e) => e.channels.email).map(
      (e) => e.type,
    );
    expect(withEmail.sort()).toEqual([...CRM_TYPES].sort());
  });

  it('el resumen diario de tareas solo ofrece correo (F1)', () => {
    expect(getNotificationCatalogEntry('crm_task_digest')?.channels).toEqual({
      push: false,
      email: true,
    });
    expect(
      NOTIFICATION_CATALOG.filter((e) => !e.channels.push).map((e) => e.type),
    ).toEqual(['crm_task_digest']);
  });

  it('el aviso de reprogramación comparte el tipo de reasignación', () => {
    expect(getNotificationCatalogEntry('crm_task_reassigned')?.label).toBe(
      'Tarea reasignada o reprogramada',
    );
  });

  it('cada tipo pertenece a un grupo conocido y no se repite', () => {
    const groups = new Set(NOTIFICATION_GROUPS.map((g) => g.key));
    const seen = new Set<string>();
    for (const entry of NOTIFICATION_CATALOG) {
      expect(groups.has(entry.group)).toBe(true);
      expect(seen.has(entry.type)).toBe(false);
      seen.add(entry.type);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveEffectiveChannels', () => {
  it('sin fila aplica el default del tipo', () => {
    expect(resolveEffectiveChannels('crm_task_assigned')).toEqual({
      push: true,
      email: false,
    });
    expect(resolveEffectiveChannels('crm_task_digest', null)).toEqual({
      push: false,
      email: false,
    });
  });

  it('con fila manda la fila', () => {
    expect(
      resolveEffectiveChannels('crm_task_due', { in_app: false, email: true }),
    ).toEqual({ push: false, email: true });
  });

  it('un canal que el tipo no ofrece queda apagado aunque la fila lo encienda', () => {
    expect(
      resolveEffectiveChannels('new_order', { in_app: true, email: true }),
    ).toEqual({ push: true, email: false });
  });

  it('el dispositivo del resumen diario queda apagado aunque la fila lo encienda', () => {
    expect(
      resolveEffectiveChannels('crm_task_digest', { in_app: true, email: true }),
    ).toEqual({ push: false, email: true });
  });

  it('un tipo fuera del catálogo: dispositivo según su fila o encendido, nunca correo', () => {
    expect(resolveEffectiveChannels('booking_attending')).toEqual({
      push: true,
      email: false,
    });
    expect(
      resolveEffectiveChannels('workflow_task', { in_app: false, email: true }),
    ).toEqual({ push: false, email: false });
  });
});
