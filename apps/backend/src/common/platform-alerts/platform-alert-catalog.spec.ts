import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  QUEUE_CATALOG,
  describeHttpRoute,
  describeJob,
} from './platform-alert-catalog';

const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'node_modules') sourceFiles(path, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
      out.push(path);
    }
  }
  return out;
}

/** Nombres de cola de todos los `registerQueue` del código, con las constantes resueltas. */
function registeredQueueNames(): string[] {
  const files = sourceFiles(SRC);
  const constants = new Map<string, string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*'([a-z0-9-]+)'/g)) {
      constants.set(m[1], m[2]);
    }
  }
  const names = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('registerQueue(')) continue;
    for (const call of text.matchAll(/registerQueue\(([\s\S]*?)\)/g)) {
      for (const m of call[1].matchAll(/name:\s*(?:'([a-z0-9-]+)'|([A-Z][A-Z0-9_]*))/g)) {
        const name = m[1] ?? constants.get(m[2]);
        if (!name) throw new Error(`Constante de cola sin resolver: ${m[2]} en ${file}`);
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

describe('catálogo de procesos del monitor (QUI-1031)', () => {
  it('toda cola registrada en el código tiene módulo y acción en el catálogo', () => {
    const queues = registeredQueueNames();
    // Las 24 colas que existían al cerrar QUI-1031: si el escáner deja de
    // verlas, la prueba de cobertura dejó de probar algo.
    expect(queues.length).toBeGreaterThanOrEqual(24);
    expect(queues).toEqual(expect.arrayContaining(['ai-embedding', 'email-notifications', 'bulk-upload-jobs']));
    const missing = queues.filter((queue) => !QUEUE_CATALOG[queue]);
    expect(missing).toEqual([]);
  });

  it('ai-embedding/embed de un producto: «Productos · indexar el producto para la búsqueda con IA», con su registro y su cupo', () => {
    expect(
      describeJob('ai-embedding', 'embed', {
        store_id: 105,
        organization_id: 82,
        entity_type: 'product',
        entity_id: 123,
        content: 'Kit de freno NKD',
      }),
    ).toEqual({
      module: 'Productos',
      action: 'indexar el producto para la búsqueda con IA',
      entity: { type: 'product', id: 123 },
      aiFeature: 'rag_embeddings',
    });
  });

  it('el mismo trabajo cambia de módulo según lo que indexa y según el trabajo', () => {
    expect(describeJob('ai-embedding', 'embed', { entity_type: 'customer', entity_id: 9 })).toMatchObject({
      module: 'Clientes',
      entity: { type: 'customer', id: 9 },
    });
    expect(describeJob('ai-embedding', 'delete-embedding', { entity_type: 'product', entity_id: 4 }).action).toBe(
      'quitar el producto del índice de búsqueda con IA',
    );
    expect(describeJob('ai-embedding', 'index-knowledge', { documents: [] })).toMatchObject({
      module: 'Vexi',
      entity: null,
    });
  });

  it('acción por nombre de trabajo y registro desde el data (también anidado en context)', () => {
    expect(describeJob('email-notifications', 'trial.ending.email', { storeId: 3 }).action).toBe(
      'avisar que la prueba gratis está por terminar',
    );
    expect(describeJob('email-notifications', 'nuevo.email', {}).action).toBe('enviar el correo «nuevo.email»');
    expect(describeJob('purchase-order-receive', 'receive', { purchase_order_id: 77 }).entity).toEqual({
      type: 'purchase_order',
      id: 77,
    });
    expect(describeJob('dian-test-set', 'run', { context: { config_id: 5 } }).entity).toEqual({ type: 'dian_config', id: 5 });
    expect(describeJob('dian-test-set', 'run', { config_id: 'x' }).entity).toBeNull();
    expect(describeJob('ai-scan', 'rut', { kind: 'rut' }).action).toBe('escaneo del RUT');
  });

  it('una cola sin entrada sigue siendo legible', () => {
    expect(describeJob('cola-nueva', 'hacer', {})).toEqual({
      module: 'Cola cola-nueva',
      action: 'ejecutar el trabajo hacer',
      entity: null,
      aiFeature: null,
    });
  });

  it('HTTP: módulo deducido de la ruta y acción del método o del último segmento', () => {
    expect(describeHttpRoute('POST', '/api/store/orders/:id/payments')).toMatchObject({
      module: 'Ventas',
      action: 'crear pagos',
    });
    expect(describeHttpRoute('POST', '/store/orders/:id/cancel').action).toBe('cancelar');
    expect(describeHttpRoute('GET', '/api/store/products')).toMatchObject({ module: 'Productos', action: 'listar' });
    expect(describeHttpRoute('GET', '/api/store/products/:id').action).toBe('consultar un registro');
    expect(describeHttpRoute('DELETE', '/api/store/products/:id').action).toBe('eliminar');
    expect(describeHttpRoute('PATCH', '/api/superadmin/subscriptions/:id').module).toBe('Superadmin · Suscripción');
    expect(describeHttpRoute('POST', '/api/store/cosas-raras').module).toBe('Cosas raras');
    expect(describeHttpRoute('GET', '/api').module).toBe('API');
  });
});
