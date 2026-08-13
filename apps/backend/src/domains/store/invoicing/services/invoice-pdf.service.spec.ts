import { RequestContextService } from '@common/context/request-context.service';
import { InvoicePdfService } from './invoice-pdf.service';

/**
 * Guarda de la asimetría lectura/emisión en el PDF de factura.
 *
 * `previewPdf` es la vista previa de la PLANTILLA en configuración: no consume
 * numeración, no toca la DIAN y no persiste nada. Existe justamente para que el
 * comerciante compruebe si sus datos legales caben en el formato elegido — o sea,
 * la abre precisamente quien todavía NO ha terminado de cargarlos.
 *
 * El resolvedor estricto llegó cableado aquí y hacía lanzar
 * «No hay municipio DIAN para el NIT …», dejando la pantalla inaccesible para ese
 * tenant. El defecto era invisible porque este servicio no tenía spec: el mismo
 * error en `subscription-billing-profile` sí salió, y solo porque allí había uno.
 *
 * `generatePdf` conserva el resolvedor estricto a propósito y no se toca aquí: ese
 * documento se entrega al cliente y debe cuadrar con el XML firmado.
 */
describe('InvoicePdfService — asimetría vista previa / emisión', () => {
  const requestContext = {
    organization_id: 1,
    store_id: 10,
    user_id: 1,
  } as any;

  /** Tenant a medio cargar: NIT y razón social sí, municipio DIAN todavía no. */
  const INCOMPLETE_FISCAL_DATA = {
    nit: '900123456',
    legal_name: 'COMERCIAL A MEDIO CARGAR S.A.S.',
  };

  const createService = (fiscalData: Record<string, unknown> | null) => {
    const baseClient = {
      stores: {
        findFirst: jest.fn().mockResolvedValue({
          id: 10,
          name: 'Tienda Centro',
          legal_name: null,
          logo_url: null,
          // Sin fila de dirección: el municipio no puede salir de `addresses`.
          addresses: [],
          store_settings: { settings: { fiscal_data: fiscalData } },
        }),
      },
      organizations: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          name: 'Comercial A Medio Cargar',
          legal_name: null,
          tax_id: null,
          phone: null,
          email: 'facturacion@medio.co',
          logo_url: null,
          // `fiscal_scope` STORE ⇒ la identidad se lee de `store_settings`.
          fiscal_scope: 'STORE',
          addresses: [],
          organization_settings: { settings: {} },
        }),
      },
    };

    const prisma = {
      withoutScope: () => baseClient,
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;

    const s3 = { downloadImage: jest.fn() } as any;
    const events = { emit: jest.fn() } as any;
    const qr = { renderPng: jest.fn().mockResolvedValue(Buffer.from('')) } as any;

    return new InvoicePdfService(prisma, s3, events, qr);
  };

  it('renderiza la vista previa con identidad fiscal incompleta en vez de lanzar', async () => {
    const service = createService(INCOMPLETE_FISCAL_DATA);

    const buffer = await RequestContextService.run(requestContext, () =>
      service.previewPdf('pos_58mm' as any),
    );

    // Lo que importa es que RESUELVA: el comerciante ve su plantilla y puede
    // seguir completando sus datos. Antes esto rechazaba con «municipio DIAN».
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('renderiza la vista previa incluso sin `fiscal_data` cargado', async () => {
    // El caso del tenant recién creado, que es el primero que abre esta pantalla.
    const service = createService(null);

    const buffer = await RequestContextService.run(requestContext, () =>
      service.previewPdf('a4' as any),
    );

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
  });

  /**
   * `generatePdf` decide la severidad por el DOCUMENTO, no por la superficie:
   * estricto si la factura es electrónica, permisivo si es un recibo interno.
   *
   * Medido en producción: de 48 tiendas con `fiscal_data`, UNA tiene municipio
   * fiscal resoluble. Siete tiendas con alcance STORE y facturas ya emitidas
   * —cinco SIN configuración DIAN— habrían dejado de poder imprimir facturas que
   * ya existen.
   *
   * Estos dos tests miran solo el punto de decisión: si el resolvedor corta el
   * flujo o no. No montan el pipeline completo de PDF ni S3, así que el caso
   * permisivo puede fallar más adelante por otra razón — lo que se afirma es que
   * NO falla por el municipio.
   */
  describe('generatePdf — electrónico vs recibo interno', () => {
    const invoiceWith = (dian_status: string) => ({
      id: 1,
      dian_status,
      invoice_number: 'FV-1',
      customer_address: null,
      customer: null,
      customer_name: 'Consumidor Final',
      resolution: null,
      invoice_items: [],
      invoice_taxes: [],
      organization: {
        id: 1,
        name: 'Comercial A Medio Cargar',
        legal_name: null,
        tax_id: null,
        phone: null,
        email: 'facturacion@medio.co',
        logo_url: null,
        fiscal_scope: 'STORE',
        addresses: [],
        organization_settings: { settings: {} },
      },
      store: {
        id: 10,
        name: 'Tienda Centro',
        legal_name: null,
        logo_url: null,
        addresses: [],
        // Identidad a medias: NIT y razón social sí, municipio DIAN no.
        store_settings: {
          settings: {
            fiscal_data: {
              nit: '900123456',
              legal_name: 'COMERCIAL A MEDIO CARGAR S.A.S.',
            },
          },
        },
      },
    });

    const serviceFor = (dian_status: string) => {
      const prisma = {
        invoices: {
          findFirst: jest.fn().mockResolvedValue(invoiceWith(dian_status)),
          update: jest.fn().mockResolvedValue({}),
        },
        withoutScope: () => ({
          stores: { findFirst: jest.fn().mockResolvedValue(null) },
          organizations: { findFirst: jest.fn().mockResolvedValue(null) },
        }),
      } as any;
      const s3 = {
        downloadImage: jest.fn(),
        uploadBuffer: jest.fn().mockResolvedValue({ key: 'k', url: 'u' }),
      } as any;
      const qr = { renderPng: jest.fn().mockResolvedValue(Buffer.from('')) } as any;
      return new InvoicePdfService(prisma, s3, { emit: jest.fn() } as any, qr);
    };

    it('recibo interno (not_applicable): NO corta por el municipio', async () => {
      const error = await RequestContextService.run(requestContext, () =>
        serviceFor('not_applicable')
          .generatePdf(1)
          .then(() => null)
          .catch((e) => e),
      );

      expect(String(error?.message ?? '')).not.toMatch(/municipio DIAN/);
    });

    it('documento electrónico (accepted): SÍ corta por el municipio', async () => {
      // Aquí existe un XML firmado con el que el PDF debe cuadrar, así que
      // imprimir un dato fabricado sería peor que no imprimir.
      const error = await RequestContextService.run(requestContext, () =>
        serviceFor('accepted')
          .generatePdf(1)
          .then(() => null)
          .catch((e) => e),
      );

      expect(String(error?.message ?? '')).toMatch(/municipio DIAN/);
    });
  });
});
