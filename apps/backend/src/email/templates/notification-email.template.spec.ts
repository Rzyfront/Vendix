import { buildNotificationEmail } from './notification-email.template';

const base = {
  firstName: 'Ana',
  storeName: 'Tienda Centro',
  title: 'Tarea asignada',
  body: 'Llamar a la clienta',
  actionUrl: 'https://admin.tienda.co/admin/customers/tasks',
};

describe('buildNotificationEmail', () => {
  it('asunto con tienda y botón al dominio admin', () => {
    const email = buildNotificationEmail(base);
    expect(email.subject).toBe('Tarea asignada · Tienda Centro');
    expect(email.html).toContain('href="https://admin.tienda.co/admin/customers/tasks"');
    expect(email.html).toContain('Abrir en Vendix');
    expect(email.text).toContain('Abrir en Vendix: https://admin.tienda.co/admin/customers/tasks');
  });

  it('escapa el HTML de todo lo que viene del usuario', () => {
    const email = buildNotificationEmail({
      ...base,
      firstName: '<b>Ana</b>',
      storeName: 'Tienda "A&B"',
      title: '<script>alert(1)</script>',
      body: '<img src=x onerror=alert(1)>',
      actionUrl: 'https://admin.tienda.co/x?a=1&b="2"',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<img');
    expect(email.html).not.toContain('<b>Ana</b>');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(email.html).toContain('Tienda &quot;A&amp;B&quot;');
    expect(email.html).toContain('href="https://admin.tienda.co/x?a=1&amp;b=&quot;2&quot;"');
  });

  it('sin URL no hay botón: indica dónde encontrar el aviso', () => {
    const email = buildNotificationEmail({ ...base, actionUrl: null });
    expect(email.html).not.toContain('href=');
    expect(email.text).toContain('notificaciones del panel');
  });

  it('solo acepta colores hexadecimales de la marca', () => {
    const email = buildNotificationEmail({
      ...base,
      primaryColor: 'red;background:url(x)',
      secondaryColor: '#123ABC',
    });
    expect(email.html).not.toContain('url(x)');
    expect(email.html).toContain('#123ABC');
  });

  it('el asunto nunca lleva saltos de línea', () => {
    const email = buildNotificationEmail({ ...base, title: 'Tarea\r\nBcc: x@y.co' });
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});
