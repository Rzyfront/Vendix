import { InvoiceCalculatorService } from '../services/invoice-calculator.service';

import { ProfilePreviewService } from './profile-preview.service';
import {
  PREVIEW_CUFE,
  PREVIEW_INVOICE_NUMBER,
} from './preview-numbering.guard';

/**
 * Configuración de perfil mínima pero COMPLETA — las 7 secciones.
 *
 * Se construye a mano en vez de importar una plantilla: una plantilla puede
 * cambiar por razones de producto y arrastraría estos specs con ella, y lo que
 * acá se afirma son invariantes del anexo, no la plantilla del mes.
 */
function config(overrides: any = {}): any {
  return {
    config_version: 1,
    general: { description: null, internal_note: null },
    aiu: {
      regime: 'et_462_1',
      contract_object: 'Servicios de aseo para sede norte',
      enforce_minimum_base: true,
      minimum_base_percent: '10.00',
      components: {
        administracion: '10.00',
        imprevistos: '5.00',
        utilidad: '85.00',
      },
      ...(overrides.aiu ?? {}),
    },
    accounting: {},
    taxes: {
      rules: overrides.rules ?? [
        { bucket: 'administracion', taxable: true, tax_code: '01', rate: '19.00' },
        { bucket: 'imprevistos', taxable: true, tax_code: '01', rate: '19.00' },
        { bucket: 'utilidad', taxable: true, tax_code: '01', rate: '19.00' },
        { bucket: 'costo', taxable: false, tax_code: '01', rate: '0.00' },
      ],
    },
    model_lines: [],
    format: {},
    dian: {},
    ...(overrides.root ?? {}),
  };
}

function build(profile_overrides: any = {}, config_overrides: any = {}) {
  const profiles = {
    findOne: jest.fn().mockResolvedValue({
      id: 8,
      name: 'Aseo AIU',
      operation_type: '09',
      current_version: 3,
      current_config: config(config_overrides),
      ...profile_overrides,
    }),
  };
  // El calculador REAL, no un doble. Es puro y sin dependencias, y sustituirlo
  // haría que estos specs verificaran el doble en vez de la aritmética que se
  // emite — que es justamente lo que este servicio existe para no duplicar.
  const service = new ProfilePreviewService(
    profiles as any,
    new InvoiceCalculatorService(),
  );
  return { service, profiles };
}

const CONTRACT = { contract_value: 100000000, issue_date: '2026-08-22' };

/** Valor del primer `cbc:X` dentro del primer `cac:Wrapper` del XML. */
function readIn(xml: string, wrapper: string, field: string): string | null {
  const group = new RegExp(`<cac:${wrapper}>([\\s\\S]*?)</cac:${wrapper}>`).exec(xml);
  if (!group) return null;
  const value = new RegExp(`<cbc:${field}[^>]*>([^<]*)</cbc:${field}>`).exec(group[1]);
  return value ? value[1] : null;
}

describe('ProfilePreviewService', () => {
  describe('no numera, no firma, no transmite', () => {
    it('el XML lleva el consecutivo marcado, nunca un número', async () => {
      const { service } = build();
      const result = await service.preview(8, CONTRACT as any);

      expect(result.xml).toContain(PREVIEW_INVOICE_NUMBER);
      expect(result.xml).toContain(PREVIEW_CUFE);
      expect(result.not_performed).toEqual({
        numbering_reserved: false,
        signed: false,
        transmitted: false,
        persisted: false,
      });
    });

    it('no emite nada que se pueda confundir con una identidad fiscal real', async () => {
      const { service } = build();
      const { xml } = await service.preview(8, CONTRACT as any);

      // Un NIT colombiano de empresa son 9 dígitos. Si el XML de muestra lleva
      // uno, un pantallazo o una línea de log es indistinguible de una emisión.
      const company_ids = [...xml.matchAll(/<cbc:CompanyID[^>]*>([^<]*)</g)].map(
        (match) => match[1],
      );
      expect(company_ids.length).toBeGreaterThan(0);
      company_ids.forEach((id) => expect(id).not.toMatch(/^\d{9,10}$/));

      // Y un CUFE real son 96 hex.
      expect(xml).not.toMatch(/<cbc:UUID[^>]*>[0-9a-f]{96}</i);
    });

    it('el ambiente declarado es SIEMPRE pruebas', async () => {
      const { service } = build();
      const { xml } = await service.preview(8, CONTRACT as any);
      // `cbc:ProfileExecutionID` es el campo que declara ante la DIAN si el
      // documento es productivo. Un XML de muestra que se declarara de producción
      // sería, en todo lo legible, un documento de producción sin firmar.
      // El prefijo es `cbc:`, no `sts:` — está en el cuerpo UBL, no en la
      // extensión DIAN, y afirmarlo con el prefijo equivocado da un falso rojo.
      expect(xml).toContain('<cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>');
      expect(xml).not.toContain('<cbc:ProfileExecutionID>1</cbc:ProfileExecutionID>');
    });
  });

  describe('el desglose es el XML, no una segunda cuenta', () => {
    /**
     * REGRESIÓN. La primera versión publicaba `totals.total_before_tax` del
     * calculador —el valor del contrato— como `tax_exclusive_amount`. En este
     * mismo caso el XML declara 10.000.000 (la base gravable) y la pantalla
     * mostraba 100.000.000: el operador leía un IVA del que no se estaba
     * declarando la décima parte.
     */
    it('tax_exclusive_amount coincide con cbc:TaxExclusiveAmount del XML', async () => {
      const { service } = build();
      const result = await service.preview(8, CONTRACT as any);

      const in_xml = readIn(result.xml, 'LegalMonetaryTotal', 'TaxExclusiveAmount');
      expect(in_xml).toBe('10000000.00');
      expect(result.breakdown.totals.tax_exclusive_amount).toBe(in_xml);
      // Y no es lo mismo que el valor del contrato: si lo fuera, el spec pasaría
      // por accidente incluso con el defecto puesto.
      expect(result.breakdown.totals.line_extension_amount).toBe('100000000.00');
    });

    it('los cinco totales del desglose salen del XML', async () => {
      const { service } = build();
      const result = await service.preview(8, CONTRACT as any);
      const t = result.breakdown.totals;

      expect(t.line_extension_amount).toBe(
        readIn(result.xml, 'LegalMonetaryTotal', 'LineExtensionAmount'),
      );
      expect(t.tax_inclusive_amount).toBe(
        readIn(result.xml, 'LegalMonetaryTotal', 'TaxInclusiveAmount'),
      );
      expect(t.payable_amount).toBe(
        readIn(result.xml, 'LegalMonetaryTotal', 'PayableAmount'),
      );
      expect(t.discount_amount).toBe(
        readIn(result.xml, 'LegalMonetaryTotal', 'AllowanceTotalAmount'),
      );
    });
  });

  describe('la base gravable depende del RÉGIMEN, no de la matriz', () => {
    it('et_462_1 grava A + I + U y deja el costo fuera', async () => {
      const { service } = build();
      const result = await service.preview(8, CONTRACT as any);

      const omitted = result.breakdown.lines
        .filter((line) => line.omit_tax_total)
        .map((line) => line.bucket);
      expect(omitted).toEqual(['costo']);
      expect(result.aiu_summary?.taxable_base).toBe('10000000.00');
      expect(result.aiu_summary?.minimum_base).toBe('10000000.00');
    });

    it('decreto_1372_1992 grava SÓLO la utilidad, y no fija piso', async () => {
      const { service } = build(
        {},
        {
          aiu: { regime: 'decreto_1372_1992' },
          rules: [
            { bucket: 'administracion', taxable: false, tax_code: '01', rate: '0.00' },
            { bucket: 'imprevistos', taxable: false, tax_code: '01', rate: '0.00' },
            { bucket: 'utilidad', taxable: true, tax_code: '01', rate: '19.00' },
            { bucket: 'costo', taxable: false, tax_code: '01', rate: '0.00' },
          ],
        },
      );
      const result = await service.preview(8, CONTRACT as any);

      expect(
        result.breakdown.lines.filter((line) => line.omit_tax_total).map((l) => l.bucket),
      ).toEqual(['administracion', 'imprevistos', 'costo']);
      // 85 % de los 10 M de AIU.
      expect(result.aiu_summary?.taxable_base).toBe('8500000.00');
      // El decreto no fija piso: exigirlo aquí bloquearía contratos legítimos.
      expect(result.aiu_summary?.minimum_base).toBe('0.00');
      expect(
        result.validations.find((v) => v.rule === 'AIU-PISO-LEGAL')?.passed,
      ).toBe(true);
    });
  });

  describe('la nota del contrato (CAV03)', () => {
    it('va en la línea de Administración y SÓLO en ella', async () => {
      const { service } = build();
      const result = await service.preview(8, CONTRACT as any);

      const with_note = result.breakdown.lines.filter((line) => line.note);
      expect(with_note).toHaveLength(1);
      expect(with_note[0].bucket).toBe('administracion');
      expect(with_note[0].note).toMatch(
        /^Contrato de servicios AIU por concepto de: /,
      );
      // Una sola en el XML también: el anexo la pide en ese ítem, no en el
      // documento.
      expect((result.xml.match(/<cbc:Note>/g) ?? [])).toHaveLength(1);
    });

    it('un perfil sin objeto de contrato falla CAV03 con el código de la emisión', async () => {
      const { service } = build({}, { aiu: { contract_object: '' } });
      const result = await service.preview(8, CONTRACT as any);

      const cav03 = result.validations.find((v) => v.rule === 'CAV03');
      expect(cav03?.passed).toBe(false);
      expect(cav03?.severity).toBe('blocker');
      // El mismo identificador que vería al emitir. Si la previsualización
      // inventara su propio código, el aviso no sería creíble.
      expect(cav03?.code).toBe('INVOICING_AIU_002');
      // Y NO se emite el prefijo solo: 42 caracteres de literal pasarían el piso
      // de 20 del anexo describiendo un contrato que no se nombró.
      expect(result.xml).not.toContain('<cbc:Note>');
    });

    it('la factura puede aportar el objeto que el perfil no trae', async () => {
      const { service } = build({}, { aiu: { contract_object: '' } });
      const result = await service.preview(8, {
        ...CONTRACT,
        contract_object: 'Mantenimiento de ascensores torre B',
      } as any);

      expect(result.validations.find((v) => v.rule === 'CAV03')?.passed).toBe(true);
      expect(result.aiu_summary?.note).toContain('ascensores');
    });
  });

  describe('el piso legal del art. 462-1', () => {
    it('un AIU por debajo del piso se reporta con INVOICING_AIU_001', async () => {
      const { service } = build();
      const result = await service.preview(8, {
        ...CONTRACT,
        aiu_value: 5000000,
      } as any);

      const floor = result.validations.find((v) => v.rule === 'AIU-PISO-LEGAL');
      expect(floor?.passed).toBe(false);
      expect(floor?.code).toBe('INVOICING_AIU_001');
    });

    it('la muestra derivada queda EXACTAMENTE en el piso, así que lo alcanza', async () => {
      // Es la muestra más conservadora posible: cualquier AIU real será mayor o
      // igual. Y deja el piso a la vista, que es el parámetro que se está
      // configurando.
      const { service } = build();
      const result = await service.preview(8, CONTRACT as any);
      expect(result.aiu_summary?.aiu_value).toBe(result.aiu_summary?.minimum_base);
      expect(result.validations.find((v) => v.rule === 'AIU-PISO-LEGAL')?.passed).toBe(
        true,
      );
    });
  });

  describe('muestras inutilizables', () => {
    const cases: Array<[string, any]> = [
      ['lines y contract_value a la vez', { ...CONTRACT, lines: [{ bucket: 'utilidad', unit_price: 1000 }] }],
      ['ninguno de los dos', { issue_date: '2026-08-22' }],
      ['AIU mayor que el contrato', { contract_value: 1000000, aiu_value: 5000000 }],
    ];

    it.each(cases)('%s → INVOICING_PREVIEW_002', async (_label, dto) => {
      const { service } = build();
      await expect(service.preview(8, dto as any)).rejects.toMatchObject({
        response: { error_code: 'INVOICING_PREVIEW_002' },
      });
    });
  });

  describe('un perfil sin versión comprometida', () => {
    it('no se previsualiza, y lo dice con el código del historial', async () => {
      const { service } = build({ current_config: null, current_version: 2 });
      await expect(service.preview(8, CONTRACT as any)).rejects.toMatchObject({
        response: { error_code: 'INVOICING_PROFILE_VERSION_001' },
      });
    });
  });

  describe('el perfil se lee por ProfilesService, no por Prisma directo', () => {
    it('delega en findOne, que es donde vive el filtro de tenant', async () => {
      const { service, profiles } = build();
      await service.preview(8, CONTRACT as any);
      // Un segundo camino de lectura del perfil sería un segundo sitio donde
      // olvidar el `store_id`. El 404 indistinguible de «existe pero es de otra
      // tienda» también vive ahí.
      expect(profiles.findOne).toHaveBeenCalledWith(8);
      expect(profiles.findOne).toHaveBeenCalledTimes(1);
    });
  });
});
