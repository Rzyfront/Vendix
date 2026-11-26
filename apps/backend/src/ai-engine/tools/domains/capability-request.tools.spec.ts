import {
  createCapabilityRequestTools,
  normalizeCapabilityKey,
} from './capability-request.tools';
import type { CapabilityCorpusEntry } from '../capability-gap';

describe('request_capability (T5/T6)', () => {
  const CTX = { organization_id: 3, store_id: 7, user_id: 11 } as any;
  const PRICING_TOOL: CapabilityCorpusEntry = {
    kind: 'tool',
    name: 'set_product_tier_override',
    domain: 'pricing',
    text: 'Fija para un producto el precio de una tarifa concreta',
    permitted: true,
  };

  function build(corpus: CapabilityCorpusEntry[] = [PRICING_TOOL]) {
    const tickets = {
      findCapabilityRequest: jest.fn().mockResolvedValue({
        exists: false,
        already_voted: false,
        own: false,
        ticket_number: null,
        votes: 0,
      }),
      recordCapabilityRequest: jest.fn(),
    };
    const [tool] = createCapabilityRequestTools({ tickets, corpus: () => corpus });
    return { tool, tickets };
  }

  const ARGS = {
    capability_key: 'Storefront Cart Button Color',
    user_request: 'cámbiame el color del botón del carrito',
    title: 'Cambiar el color del botón del carrito',
    failure_kind: 'missing_capability',
  };

  it('registro: escritura con confirmación, pública con motivo, sin readOnly', () => {
    const { tool } = build();
    expect(tool.name).toBe('request_capability');
    expect(tool.requiresConfirmation).toBe(true);
    expect(tool.readOnly ?? false).toBe(false);
    expect(tool.access).toBe('public');
    expect(tool.accessReason).toContain('POST /support/tickets');
    expect(tool.parameters.required).toEqual([
      'capability_key',
      'user_request',
      'failure_kind',
    ]);
  });

  it('normaliza la clave de capacidad', () => {
    expect(normalizeCapabilityKey('Storefront Cart Button Color')).toBe(
      'storefront-cart-button-color',
    );
    expect(normalizeCapabilityKey('Botón  ñandú!!')).toBe('boton-nandu');
    expect(normalizeCapabilityKey('ab')).toBeNull();
  });

  it('preview de una capacidad nueva: tarjeta para pedir el ticket', async () => {
    const { tool } = build();
    const preview = await tool.preview!(ARGS, CTX);
    expect(preview).toMatchObject({
      status: 'ok',
      target: 'Pedir al equipo de Vendix: «Cambiar el color del botón del carrito»',
      message: 'Se crea un ticket de soporte para el equipo de Vendix.',
    });
  });

  it('handler crea el ticket y confirma su número', async () => {
    const { tool, tickets } = build();
    tickets.recordCapabilityRequest.mockResolvedValue({
      outcome: 'created',
      exists: true,
      already_voted: true,
      own: true,
      ticket_number: 'TKT30001',
      votes: 1,
    });
    const out = JSON.parse(await tool.handler!(ARGS, CTX));
    expect(tickets.recordCapabilityRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 3,
        storeId: 7,
        userId: 11,
        capabilityKey: 'storefront-cart-button-color',
        title: 'Cambiar el color del botón del carrito',
      }),
    );
    expect(out.summary).toBe(
      'Listo: le pedí al equipo de Vendix esta capacidad. Tu ticket es TKT30001.',
    );
  });

  it('desde otra tienda suma voto y no revela el ticket ajeno', async () => {
    const { tool, tickets } = build();
    tickets.findCapabilityRequest.mockResolvedValue({
      exists: true,
      already_voted: false,
      own: false,
      ticket_number: null,
      votes: 1,
    });
    tickets.recordCapabilityRequest.mockResolvedValue({
      outcome: 'voted',
      exists: true,
      already_voted: true,
      own: false,
      ticket_number: null,
      votes: 2,
    });
    const preview = await tool.preview!(ARGS, CTX);
    expect(preview.target).toBe('Sumar tu voto a una solicitud que ya existe');
    const out = JSON.parse(await tool.handler!(ARGS, CTX));
    expect(out.summary).toBe(
      'Otra tienda ya lo había pedido: sumé tu voto (2 tiendas lo piden).',
    );
    expect(out.data.ticket_number).toBeNull();
  });

  it('la misma tienda no vota dos veces: preview error, sin escribir', async () => {
    const { tool, tickets } = build();
    tickets.findCapabilityRequest.mockResolvedValue({
      exists: true,
      already_voted: true,
      own: true,
      ticket_number: 'TKT30001',
      votes: 1,
    });
    const preview = await tool.preview!(ARGS, CTX);
    expect(preview.status).toBe('error');
    expect(preview.message).toBe(
      'Esta tienda ya lo pidió: el ticket TKT30001 sigue abierto. No se crea otro.',
    );
    const out = JSON.parse(await tool.handler!(ARGS, CTX));
    expect(out.error).toContain('ya lo pidió');
    expect(tickets.recordCapabilityRequest).not.toHaveBeenCalled();
  });

  it.each(['permission', 'invalid_data', 'connection'])(
    '%s no es una capacidad faltante: nunca crea ticket',
    async (failure_kind) => {
      const { tool, tickets } = build();
      const preview = await tool.preview!({ ...ARGS, failure_kind }, CTX);
      expect(preview.status).toBe('error');
      expect(preview.message).toContain('no se crea ticket');
      await tool.handler!({ ...ARGS, failure_kind }, CTX);
      expect(tickets.findCapabilityRequest).not.toHaveBeenCalled();
      expect(tickets.recordCapabilityRequest).not.toHaveBeenCalled();
    },
  );

  it('T6: «aplicar tarifa a un producto» existe (set_product_tier_override): no hay ticket', async () => {
    const { tool, tickets } = build();
    const args = {
      capability_key: 'apply-price-tier-to-product',
      user_request: 'aplicar tarifa a un producto',
      failure_kind: 'missing_capability',
    };
    const preview = await tool.preview!(args, CTX);
    expect(preview.status).toBe('error');
    expect(preview.message).toContain('set_product_tier_override');
    await tool.handler!(args, CTX);
    expect(tickets.recordCapabilityRequest).not.toHaveBeenCalled();
  });

  it('T6: si existe pero el rol no la alcanza, es un tema de permisos (sin ticket)', async () => {
    const { tool, tickets } = build([{ ...PRICING_TOOL, permitted: false }]);
    const preview = await tool.preview!(
      {
        capability_key: 'apply-price-tier-to-product',
        user_request: 'aplicar tarifa a un producto',
        failure_kind: 'missing_capability',
      },
      CTX,
    );
    expect(preview.message).toBe(
      'Eso ya existe en Vendix, pero el rol de esta persona no lo permite. No se crea ticket: dile que se lo pida al dueño de la tienda.',
    );
    expect(tickets.findCapabilityRequest).not.toHaveBeenCalled();
  });

  it('una petición sin contenido no abre ticket a ciegas', async () => {
    const { tool, tickets } = build();
    const preview = await tool.preview!(
      { ...ARGS, user_request: 'hazlo ya por favor', title: 'hazlo' },
      CTX,
    );
    expect(preview.status).toBe('error');
    expect(preview.message).toContain('No queda claro qué capacidad falta');
    expect(tickets.findCapabilityRequest).not.toHaveBeenCalled();
  });

  it('sin tienda en contexto no hay solicitud', async () => {
    const { tool } = build();
    const preview = await tool.preview!(ARGS, { user_id: 11 } as any);
    expect(preview.status).toBe('error');
  });
});
