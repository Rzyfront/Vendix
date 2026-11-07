import { FakeWorkflowDb } from '../../../../testing/workflows/fake-workflow-prisma';
import { WorkflowEmailService } from './workflow-email.service';

describe('WorkflowEmailService', () => {
  let db: FakeWorkflowDb;
  let svc: WorkflowEmailService;
  const email = { sendEmail: jest.fn() };
  const input = { storeId: 1, userId: 4, instanceId: 9, subject: 'FLU-000009 · Aprobación', message: 'Tienes una tarea <pendiente>' };

  beforeEach(() => {
    db = new FakeWorkflowDb();
    db.insert('users', { id: 4, email: 'ana@example.com', first_name: 'Ana' });
    db.insert('domain_settings', { id: 1, store_id: 1, app_type: 'STORE_ECOMMERCE', status: 'active', hostname: 'tienda.com', is_primary: true });
    db.insert('domain_settings', { id: 2, store_id: 1, app_type: 'STORE_ADMIN', status: 'active', hostname: 'admin.tienda.com', is_primary: false });
    email.sendEmail.mockReset().mockResolvedValue({ success: true });
    svc = new WorkflowEmailService(db.asStorePrisma(), email as any);
  });

  it('envía asunto, texto corto y enlace al panel de la tienda', async () => {
    expect(await svc.send(input)).toBe('sent');
    const [to, subject, html, text] = email.sendEmail.mock.calls[0];
    expect(to).toBe('ana@example.com');
    expect(subject).toBe('FLU-000009 · Aprobación');
    expect(html).toContain('Hola Ana,');
    expect(html).toContain('Tienes una tarea &lt;pendiente&gt;');
    expect(html).toContain('href="https://admin.tienda.com/admin/workflows/instances/9"');
    expect(text).toContain('https://admin.tienda.com/admin/workflows/instances/9');
  });

  it('sin dominio de administración envía el correo sin enlace', async () => {
    db.tables['domain_settings'] = [];
    expect(await svc.send(input)).toBe('sent');
    expect(email.sendEmail.mock.calls[0][2]).not.toContain('href=');
  });

  it('sin correo registrado o con la preferencia apagada se omite', async () => {
    db.table('users')[0].email = null;
    expect(await svc.send(input)).toBe('skipped');
    db.table('users')[0].email = 'ana@example.com';
    db.insert('notification_subscriptions', { store_id: 1, user_id: 4, type: 'workflow_task', email: false });
    expect(await svc.send(input)).toBe('skipped');
    db.table('notification_subscriptions')[0].email = true;
    expect(await svc.send(input)).toBe('sent');
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('si el proveedor falla devuelve failed (el outbox reintenta)', async () => {
    email.sendEmail.mockResolvedValue({ success: false, error: 'smtp' });
    expect(await svc.send(input)).toBe('failed');
  });
});
