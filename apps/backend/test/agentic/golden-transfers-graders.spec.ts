import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  GoldenTurnObservation,
  gradeGoldenTurn,
  mentionsToolName,
} from './graders';

/**
 * P4 transferencias multi-producto: la respuesta final nunca nombra
 * herramientas internas, y la suite trae los casos de pedido multi-producto
 * (confirmar → ejecutar → responder), destino externo y cajero sin permiso.
 */
const KNOWN = new Set([
  'create_stock_transfer',
  'find_transfer_products',
  'manage_stock_transfers',
]);
const observe = (visible: string): GoldenTurnObservation => ({
  agent: 'vexi',
  visible,
  tools: [],
  errorFrame: false,
  proposed: false,
  known: KNOWN,
});

describe('gradeGoldenTurn — nombres de herramientas en el texto visible', () => {
  it('reprueba una respuesta que nombra una herramienta registrada', () => {
    const checks = gradeGoldenTurn(
      {},
      observe('Listo, usé create_stock_transfer y quedó aplicada la TRF-0042.'),
    );
    expect(checks.no_tool_names).toBe(false);
  });

  it('aprueba la respuesta en lenguaje de comerciante', () => {
    const checks = gradeGoldenTurn(
      {},
      observe(
        'Listo: pasé 2 Samsung Galaxy S24, 1 iPhone 15 Pro (Black Titanium) y 1 MacBook Pro 14" (Silver) a la Tienda Tech Bogotá. La transferencia TRF-0042 quedó registrada a tu nombre.',
      ),
    );
    expect(checks.no_tool_names).toBe(true);
    expect(checks.no_jargon).toBe(true);
  });

  it('un token con guion bajo que no es herramienta no reprueba', () => {
    expect(mentionsToolName('El SKU es CAM_ROJA_M', KNOWN)).toBe(false);
    expect(mentionsToolName('Escríbele a ventas_norte@tienda.co', KNOWN)).toBe(
      false,
    );
    expect(mentionsToolName('Revisé Manage_Stock_Transfers', KNOWN)).toBe(true);
  });
});

describe('suite dorada — transferencias multi-producto', () => {
  const cases = readFileSync(
    resolve(__dirname, 'golden-conversations.es.jsonl'),
    'utf8',
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const byId = (id: string) => cases.find((c) => c.id === id);

  it('g62: pedido multi-producto con variantes, confirmación, ejecución y respuesta final', () => {
    const g62 = byId('g62-transferencia-multi-rapida');
    expect(g62).toBeDefined();
    expect(g62.agent).toBe('vexi');
    const [ask, followUp] = g62.turns;
    // Varios productos, dos de ellos por variante, en un solo mensaje.
    expect(ask.message).toMatch(/Samsung Galaxy S24/);
    expect(ask.message).toMatch(/Black Titanium/);
    expect(ask.message).toMatch(/Silver/);
    expect(ask.expect_write).toBe(true);
    expect(ask.approve).toBe('approve');
    expect(ask.expect_tools_any).toContain('create_stock_transfer');
    // El oráculo prueba el efecto: nada antes, una transferencia inmediata
    // de 3+ líneas después de aprobar, y no se repite en el turno siguiente.
    expect(ask.oracle.before).toBe('0');
    expect(ask.oracle.after_approve).toBe('>0');
    expect(ask.oracle.sql).toMatch(/movement_mode='quick'/);
    expect(ask.oracle.sql).toMatch(/>= 3/);
    expect(followUp.oracle.unchanged).toBe(true);
    expect(followUp.approve).toBeUndefined();
  });

  it('g63: destino externo no se mueve al instante y el rechazo no deja orden', () => {
    const g63 = byId('g63-transferencia-externa-rechazada');
    expect(g63.agent).toBe('vex');
    const [ask, reject] = g63.turns;
    expect(ask.expect_write).toBe(true);
    expect(ask.approve).toBeUndefined();
    expect(ask.oracle.unchanged).toBe(true);
    expect(reject.approve).toBe('reject');
    expect(reject.oracle.unchanged).toBe(true);
  });

  it('g64: el cajero sin permiso de crear no mueve inventario', () => {
    const g64 = byId('g64-transferencia-cajero-sin-permiso');
    expect(g64.principal).toBe('cashier');
    expect(g64.turns[0].permission_notice).toBe('allowed');
    expect(g64.turns[0].oracle.unchanged).toBe(true);
  });

  it('el fixture solo recarga stock de la tienda de prueba, sin borrar nada', () => {
    for (const id of [
      'g62-transferencia-multi-rapida',
      'g63-transferencia-externa-rechazada',
    ]) {
      const statements: string[] = byId(id).setup_sql;
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        expect(statement).not.toMatch(/\b(delete|truncate|drop)\b/i);
        expect(statement).toMatch(/slug='tech-bogota'/);
      }
    }
  });
});
