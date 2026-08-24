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

  /**
   * REGRESIÓN — el reparto A/I/U truncaba cada porción por separado y NO
   * repartía el residuo, así que la muestra perdía céntimos y el piso legal se
   * medía contra un contrato que el operador nunca escribió.
   *
   * La aritmética exacta del caso, en céntimos:
   *
   *     contrato 1.000.050,00 · AIU 10 % = 100.005,00 · 33,33 / 33,33 / 33,34
   *     33.331,66665 → 33.331,66   (se fuga 0,00665)
   *     33.331,66665 → 33.331,66   (se fuga 0,00665)
   *     33.341,66700 → 33.341,66   (se fuga 0,00700)
   *     Σ porciones  = 100.004,98            ← 0,02 menos que el AIU
   *     Σ líneas     = 100.004,98 + 900.045,00 = 1.000.049,98
   *     piso         = 10 % × 1.000.049,98 = 100.004,998 → truncado 100.004,99
   *     100.004,98 < 100.004,99  ⇒  INVOICING_AIU_001 sobre un perfil LEGAL
   *
   * Con una fuga de 0,01 el truncado del piso lo salvaba —de ahí que el caso
   * intuitivo (100.000.000 con 10/5/85, donde todo es exacto) pasara con el
   * defecto puesto—. Es una asimetría del truncado, no una casualidad.
   */
  describe('el reparto del AIU cuadra al céntimo (resto mayor)', () => {
    const THIRDS = {
      administracion: '33.33',
      imprevistos: '33.33',
      utilidad: '33.34',
    };

    /** El caso que fallaba: 1.000.050,00 repartido en tercios. */
    async function thirdsOf(contract_value: number) {
      const { service } = build({}, { aiu: { components: THIRDS } });
      return service.preview(8, {
        contract_value,
        issue_date: '2026-08-22',
      } as any);
    }

    function sum(values: string[]): string {
      // En céntimos enteros: sumar los `string` como float reintroduciría
      // exactamente el error que este describe existe para medir.
      const cents = values.reduce(
        (acc, value) => acc + Math.round(Number(value) * 100),
        0,
      );
      return (cents / 100).toFixed(2);
    }

    it('1.000.050,00 en tercios: las porciones suman el AIU EXACTO, no 0,02 menos', async () => {
      const result = await thirdsOf(1000050);

      const portions = result.breakdown.lines
        .filter((line) => line.bucket !== 'costo')
        .map((line) => line.line_extension_amount);

      // El invariante. Con el truncado por porción esto daba '100004.98'.
      expect(sum(portions)).toBe('100005.00');

      // Y el residuo cae donde lo manda la regla: los dos céntimos van a
      // Utilidad (resto mayor, 0,0067) y a Administración (empata con
      // Imprevistos en 0,00665 y gana por prioridad fiscal). Fijarlo acá es lo
      // que hace que el spec falle si alguien restaura el truncado por porción
      // en vez de sólo cambiar el destino del céntimo.
      expect(portions).toEqual(['33331.67', '33331.66', '33341.67']);
    });

    it('1.000.050,00 en tercios: Σ de TODAS las líneas es el contrato que escribió el operador', async () => {
      const result = await thirdsOf(1000050);

      const all = result.breakdown.lines.map(
        (line) => line.line_extension_amount,
      );
      expect(sum(all)).toBe('1000050.00');
      // Y la cabecera declara lo mismo: si la línea de costo se truncara
      // aparte, `LineExtensionAmount` sería 1.000.049,98.
      expect(result.breakdown.totals.line_extension_amount).toBe('1000050.00');
    });

    it('1.000.050,00 en tercios: el perfil LEGAL ya no se reporta con INVOICING_AIU_001', async () => {
      const result = await thirdsOf(1000050);

      const floor = result.validations.find((v) => v.rule === 'AIU-PISO-LEGAL');
      expect(floor?.passed).toBe(true);
      expect(floor?.code).toBeNull();
      // El piso y el AIU coinciden al céntimo, que es la promesa del docblock:
      // la muestra queda EXACTAMENTE en el piso.
      expect(result.aiu_summary?.aiu_value).toBe('100005.00');
      expect(result.aiu_summary?.minimum_base).toBe('100005.00');
    });

    /**
     * Los otros tres valores verificados con la misma aritmética. Todos perdían
     * 0,02 y todos caían por debajo del piso.
     */
    it.each([
      [1000002, '100000.20', '1000002.00'],
      [1000003, '100000.30', '1000003.00'],
      [1000005, '100000.50', '1000005.00'],
    ])(
      'contrato %s: AIU %s y Σ líneas %s, sin pérdida',
      async (contract_value, expected_aiu, expected_contract) => {
        const result = await thirdsOf(contract_value as number);

        expect(result.aiu_summary?.aiu_value).toBe(expected_aiu);
        expect(result.breakdown.totals.line_extension_amount).toBe(
          expected_contract,
        );
        expect(
          result.validations.find((v) => v.rule === 'AIU-PISO-LEGAL')?.passed,
        ).toBe(true);
      },
    );

    /**
     * PROPIEDAD. Para cualquier reparto que sume 100,00 y cualquier valor de
     * contrato, los dos invariantes se cumplen al céntimo:
     *
     * · Σ porciones A+I+U = el AIU declarado por el perfil.
     * · Σ TODAS las líneas = el valor del contrato.
     *
     * Y el corolario que motivó el arreglo: el AIU nunca queda por debajo del
     * piso legal, porque el piso se mide sobre una Σ de líneas que ya es el
     * contrato exacto.
     */
    describe('propiedad: ningún reparto que sume 100 pierde un céntimo', () => {
      const SPLITS: Array<[string, Record<string, string>]> = [
        ['33.33 / 33.33 / 33.34', { administracion: '33.33', imprevistos: '33.33', utilidad: '33.34' }],
        ['33.34 / 33.33 / 33.33', { administracion: '33.34', imprevistos: '33.33', utilidad: '33.33' }],
        ['16.67 / 16.66 / 66.67', { administracion: '16.67', imprevistos: '16.66', utilidad: '66.67' }],
        ['10.00 / 5.00 / 85.00', { administracion: '10.00', imprevistos: '5.00', utilidad: '85.00' }],
        ['0.01 / 0.01 / 99.98', { administracion: '0.01', imprevistos: '0.01', utilidad: '99.98' }],
        ['99.98 / 0.01 / 0.01', { administracion: '99.98', imprevistos: '0.01', utilidad: '0.01' }],
        ['7.77 / 11.11 / 81.12', { administracion: '7.77', imprevistos: '11.11', utilidad: '81.12' }],
      ];

      const CONTRACTS = [
        1000050, 1000002, 1000003, 1000005, 1000007, 1234567, 999999, 100000000,
        7, 13,
      ];

      it.each(SPLITS)('%s', async (_label, components) => {
        for (const contract_value of CONTRACTS) {
          const { service } = build({}, { aiu: { components } });
          const result = await service.preview(8, {
            contract_value,
            issue_date: '2026-08-22',
          } as any);

          const label = `${_label} @ ${contract_value}`;
          const lines = result.breakdown.lines;

          // 1. Σ porciones = AIU. El AIU de la muestra es el piso del perfil,
          //    o sea el 10 % del contrato, truncado como se emite.
          const expected_aiu = (
            Math.floor(contract_value * 10) / 100
          ).toFixed(2);
          const portions = lines.filter((line) => line.bucket !== 'costo');
          expect(`${label} → ${sum(portions.map((l) => l.line_extension_amount))}`).toBe(
            `${label} → ${expected_aiu}`,
          );

          // 2. Σ TODAS las líneas = el contrato.
          expect(`${label} → ${sum(lines.map((l) => l.line_extension_amount))}`).toBe(
            `${label} → ${contract_value.toFixed(2)}`,
          );

          // 3. Corolario: el piso legal se alcanza siempre.
          expect(`${label} → ${result.aiu_summary?.aiu_value}`).toBe(
            `${label} → ${result.aiu_summary?.minimum_base}`,
          );
        }
      });
    });

    /**
     * El reparto NO tapa el defecto que la previsualización existe para
     * delatar. Con porcentajes que no suman 100 el AIU de las líneas es
     * legítimamente distinto del declarado, y eso tiene que seguir cayendo por
     * debajo del piso: no es un céntimo de redondeo, es un perfil mal
     * configurado.
     */
    it('un reparto que NO suma 100 sigue reportando el piso incumplido', async () => {
      const { service } = build(
        {},
        {
          aiu: {
            components: {
              administracion: '30.00',
              imprevistos: '30.00',
              utilidad: '30.00',
            },
          },
        },
      );
      const result = await service.preview(8, {
        contract_value: 1000050,
        issue_date: '2026-08-22',
      } as any);

      // 90 % de los 100.005 declarados: el 10 % que falta se queda en la línea
      // de costo, así que el contrato sigue cuadrando…
      expect(result.breakdown.totals.line_extension_amount).toBe('1000050.00');
      expect(result.aiu_summary?.aiu_value).toBe('90004.50');
      // …y el piso, medido sobre el contrato entero, delata el perfil.
      expect(result.aiu_summary?.minimum_base).toBe('100005.00');
      const floor = result.validations.find((v) => v.rule === 'AIU-PISO-LEGAL');
      expect(floor?.passed).toBe(false);
      expect(floor?.code).toBe('INVOICING_AIU_001');
    });

    /** Determinismo: la misma entrada, dos corridas, el mismo reparto. */
    it('el reparto es determinista — nada depende del orden de claves del JSON', async () => {
      const first = await thirdsOf(1000050);
      const second = await thirdsOf(1000050);
      expect(first.breakdown.lines.map((l) => l.line_extension_amount)).toEqual(
        second.breakdown.lines.map((l) => l.line_extension_amount),
      );

      // Y el mismo reparto escrito con las claves en otro orden da lo mismo:
      // el orden de emisión y el del desempate salen de tuplas literales, no
      // del objeto persistido.
      const { service } = build(
        {},
        {
          aiu: {
            components: {
              utilidad: '33.34',
              administracion: '33.33',
              imprevistos: '33.33',
            },
          },
        },
      );
      const reordered = await service.preview(8, {
        contract_value: 1000050,
        issue_date: '2026-08-22',
      } as any);
      expect(
        reordered.breakdown.lines.map((l) => l.line_extension_amount),
      ).toEqual(first.breakdown.lines.map((l) => l.line_extension_amount));
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
