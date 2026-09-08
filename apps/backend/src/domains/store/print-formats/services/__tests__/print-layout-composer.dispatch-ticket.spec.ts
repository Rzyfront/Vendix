/**
 * Plan despacho-rapido-domiciliario — el footer del tiquete de despacho
 * (`renderDispatchTicketSection`) debe pintar al domiciliario cuando el
 * provider lo publica en `custom_variables.courier_name`, y quedar
 * idéntico al histórico cuando no hay nombre.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrintLayoutComposerService } from '../print-layout-composer.service';
import { PrintTemplateCompilerService } from '../print-template-compiler.service';
import { StandardPrintDataModel } from '../../interfaces/standard-print-data.model';

describe('PrintLayoutComposerService — dispatch ticket courier_name', () => {
  let composer: PrintLayoutComposerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrintLayoutComposerService, PrintTemplateCompilerService],
    }).compile();

    composer = module.get<PrintLayoutComposerService>(
      PrintLayoutComposerService,
    );
  });

  function baseData(courierName?: string): any {
    return {
      store: { name: 'Mi Tienda' },
      document: {
        id: 1,
        number: 'ORD-1',
        date: '2026-09-08',
        date_formatted: '2026-09-08',
      },
      customer: { name: 'Cliente' },
      items: [],
      taxes: [],
      totals: {
        subtotal: 0,
        subtotal_formatted: '',
        discount_total: 0,
        discount_total_formatted: '',
        shipping_total: 0,
        shipping_total_formatted: '',
        tax_total: 0,
        tax_total_formatted: '',
        grand_total: 0,
        grand_total_formatted: '',
      },
      ...(courierName !== undefined
        ? { custom_variables: { courier_name: courierName } }
        : {}),
    };
  }

  function renderTicket(
    data: StandardPrintDataModel,
    mode: 'dummy' | 'tokenized' = 'dummy',
  ): string {
    // Método privado: se invoca por cast para no pelear con el pipeline
    // completo de compose() (requiere PrintFormatDefinition v2 entera).
    return (composer as any).renderDispatchTicketSection({}, data, mode);
  }

  it('1. con courier_name → el footer pinta el nombre tras "Despachado por:"', () => {
    const html = renderTicket(baseData('Juan Pérez'));
    expect(html).toContain('Despachado por: Juan Pérez');
  });

  it('2. sin courier_name → footer idéntico al histórico, sin nombre', () => {
    const html = renderTicket(baseData());
    expect(html).toContain('Despachado por:</div>');
    expect(html).not.toContain('Domiciliario');
  });

  it('3. el nombre se escapa (nunca HTML crudo en el ticket)', () => {
    const html = renderTicket(baseData('<script>alert(1)</script>'));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('4. modo tokenized → pill {{ courier_name }} para el editor', () => {
    const html = renderTicket(baseData(), 'tokenized');
    expect(html).toContain('data-token="custom_variables.courier_name"');
    expect(html).toContain('{{ courier_name }}');
  });
});
