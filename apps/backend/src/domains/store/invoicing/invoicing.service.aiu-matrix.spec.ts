import { InvoicingService } from './invoicing.service';
import {
  InvoiceCalculatorInput,
  InvoiceCalculatorService,
} from './services/invoice-calculator.service';
import { AiuTaxableBasis } from './profiles/invoice-profile-config.contract';

/**
 * LA MATRIZ QUE SE PERSISTE — `invoices.aiu_taxable_matrix`.
 *
 * Es un `jsonb` con filas ya escritas y con lectores vivos fuera de este
 * servicio (el panel de trazabilidad de la factura lee `matrix.regime`). Cuando
 * `taxable_basis` reemplazó a `regime` como la pregunta que se le hace al
 * operador, la matriz dejó de escribir `regime` y esos lectores empezaron a leer
 * `undefined`: un documento emitido que SÍ dejó constancia de su base gravable
 * aparecía en pantalla como si no la hubiera dejado.
 *
 * Durante la ventana de transición se escriben las DOS claves. Este archivo es
 * lo que hace que retirar cualquiera de las dos sea un cambio visible: antes de
 * él, `buildAiuTaxableMatrix` no tenía un solo caso, y volver la clave a
 * `regime` —o quitarla— no rompía nada en ninguna dirección.
 *
 * ## Por qué se instancia por prototipo
 *
 * `buildAiuTaxableMatrix` es puro: recibe las líneas calculadas, el bloque AIU y
 * la etapa, y no toca `this` ni la base. Levantar el grafo de ~14 dependencias
 * de `InvoicingService` para ejercitarlo mediría el grafo, no la función. Mismo
 * patrón que `dian-events.service.spec.ts` con `DianDirectProvider`.
 */
describe('InvoicingService · matriz AIU persistida', () => {
  const calculator = new InvoiceCalculatorService();

  /**
   * Contrato de aseo por $100M: $90M de costo reembolsable (sin componente),
   * $6M de administración, $1M de imprevistos y $3M de utilidad, los tres
   * componentes con IVA 19 % declarado. Es el mismo contrato de
   * `invoice-calculator.service.spec.ts`, a propósito: la matriz describe lo que
   * el calculador produjo, así que tiene que partir de líneas REALES suyas.
   */
  const aiuContract = (
    aiu: InvoiceCalculatorInput['aiu'],
  ): InvoiceCalculatorInput => ({
    aiu,
    items: [
      {
        description: 'Costo reembolsable (nómina e insumos)',
        quantity: 1,
        unit_price: 90_000_000,
      },
      {
        description: 'Administración',
        quantity: 1,
        unit_price: 6_000_000,
        aiu_component: 'administracion',
        taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
      },
      {
        description: 'Imprevistos',
        quantity: 1,
        unit_price: 1_000_000,
        aiu_component: 'imprevistos',
        taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
      },
      {
        description: 'Utilidad',
        quantity: 1,
        unit_price: 3_000_000,
        aiu_component: 'utilidad',
        taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
      },
    ],
  });

  const buildMatrix = (
    taxable_basis: AiuTaxableBasis,
    stage = 'create',
  ): Record<string, any> => {
    const service = Object.create(InvoicingService.prototype) as any;
    const calculation = calculator.calculate(aiuContract({ taxable_basis }));
    return service.buildAiuTaxableMatrix(
      calculation.lines,
      { taxable_basis },
      stage,
    ) as Record<string, any>;
  };

  it('escribe `taxable_basis` Y el `regime` derivado, no una sola de las dos', () => {
    const matrix = buildMatrix('aiu');

    expect(matrix.taxable_basis).toBe('aiu');
    // La clave vieja sigue presente y con el literal que sus lectores esperan.
    expect(matrix.regime).toBe('et_462_1');
  });

  it('bajo «utilidad» el régimen derivado es el del Decreto 1372/1992', () => {
    const matrix = buildMatrix('utilidad');

    expect(matrix.taxable_basis).toBe('utilidad');
    expect(matrix.regime).toBe('decreto_1372_1992');
  });

  /**
   * `'subtotal'` no tiene régimen legal al que colapsar: declina el tratamiento
   * AIU, y no hay artículo que citar. Se escribe `null` EXPLÍCITO y no el
   * literal `'subtotal'`: un lector viejo que reciba `'subtotal'` en un campo
   * llamado `regime` lo trata como régimen desconocido y cae a su rama por
   * defecto, que declara una base distinta de la que el documento usó.
   *
   * La distinción entre `null` y clave ausente es la que importa acá, así que se
   * comprueba con `in` además del valor: `undefined` pasaría un `toBeNull()` mal
   * escrito y volvería a dejar al panel sin dato.
   */
  it('bajo «subtotal» el régimen es null EXPLÍCITO, no ausente', () => {
    const matrix = buildMatrix('subtotal');

    expect(matrix.taxable_basis).toBe('subtotal');
    expect('regime' in matrix).toBe(true);
    expect(matrix.regime).toBeNull();
  });

  it.each(['aiu', 'utilidad', 'subtotal'] as const)(
    'base «%s»: las dos claves viajan siempre, sea cual sea la base',
    (basis) => {
      const matrix = buildMatrix(basis);

      expect(Object.keys(matrix)).toEqual(
        expect.arrayContaining(['taxable_basis', 'regime']),
      );
      expect(matrix.taxable_basis).toBe(basis);
    },
  );

  /**
   * El resto de la matriz no cambia con esto, y hay que verlo: la clave de
   * compatibilidad se agregó AL LADO, no en lugar de nada. El piso sólo rige
   * bajo `'aiu'`, y `taxable` sale de `omit_tax_total` —lo que el calculador ya
   * derivó— y no de una segunda lectura de la base.
   */
  it('conserva componentes, gravabilidad y piso legal por base', () => {
    const con_piso = buildMatrix('aiu');
    expect(con_piso.minimum).toEqual({ enforced: true, percent: '10.00' });
    expect(
      con_piso.components.map((c: any) => [c.component, c.taxable]),
    ).toEqual([
      ['administracion', true],
      ['imprevistos', true],
      ['utilidad', true],
    ]);
    expect(con_piso.taxable_without_rate).toEqual([]);

    // Bajo el Decreto sólo la utilidad grava; los otros dos componentes siguen
    // en la matriz, declarados como NO gravables.
    const sin_piso = buildMatrix('utilidad');
    expect(sin_piso.minimum).toEqual({ enforced: false, percent: null });
    expect(
      sin_piso.components.map((c: any) => [c.component, c.taxable]),
    ).toEqual([
      ['administracion', false],
      ['imprevistos', false],
      ['utilidad', true],
    ]);

    // `'subtotal'` grava el contrato completo y tampoco tiene piso.
    const subtotal = buildMatrix('subtotal');
    expect(subtotal.minimum).toEqual({ enforced: false, percent: null });
    expect(
      subtotal.components.map((c: any) => [c.component, c.taxable]),
    ).toEqual([
      ['administracion', true],
      ['imprevistos', true],
      ['utilidad', true],
    ]);
    // La matriz está indexada por componente, así que la porción de costo
    // reembolsable —que bajo esta base SÍ grava— no tiene casilla donde
    // aparecer. Queda fijado para que darle un bucket `'costo'` sea un cambio
    // deliberado y no una sorpresa.
    expect(subtotal.components).toHaveLength(3);
  });

  it('la etapa viaja tal cual: es la que dice si la matriz es de creación o de edición', () => {
    expect(buildMatrix('aiu', 'update').stage).toBe('update');
  });
  /**
   * MODELO 1 (`'no_sumada'`) — la línea es el contrato entero.
   *
   * La casilla `taxable_amount` de la matriz acumulaba
   * `line_extension_amount`, que en el Modelo 2 coincide con la base porque
   * cada componente es su propia línea y grava por entero o no grava. En el
   * Modelo 1 no coincide: la factura 63 (`FVJL11`) escribió «contrato · Grava ·
   * Base $2.328.800» sobre una base real de $69.864, y ésa es la fila que el
   * operador lee en el panel antes de decidir si emite.
   */
  describe('Modelo 1 — la base de la matriz es la GRAVABLE, no el importe', () => {
    /** $2.328.800 de contrato con AIU del 10 %: A 5 %, I 2 %, U 3 %. */
    const noSumada = (taxable_basis: AiuTaxableBasis) => {
      const service = Object.create(InvoicingService.prototype) as any;
      const aiu = {
        taxable_basis,
        components_basis: 'contract' as const,
        components: { administracion: '5', imprevistos: '2', utilidad: '3' },
      };
      const calculation = calculator.calculate({
        aiu,
        items: [
          {
            description: 'Servicio de aseo — contrato AIU (no sumada)',
            quantity: 1,
            unit_price: '2328800',
            aiu_component: 'contrato',
            taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
          },
        ],
      } as InvoiceCalculatorInput);
      return service.buildAiuTaxableMatrix(
        calculation.lines,
        aiu,
        'create',
      ) as Record<string, any>;
    };

    it('bajo «utilidad» declara los $69.864 gravables, no los $2.328.800 del contrato', () => {
      const matrix = noSumada('utilidad');

      expect(matrix.components).toEqual([
        expect.objectContaining({
          component: 'contrato',
          taxable: true,
          taxable_amount: '69864.00',
          tax_amount: '13274.16',
        }),
      ]);
    });

    it('bajo «aiu» la base es el A+I+U completo: el 10 % del contrato', () => {
      const matrix = noSumada('aiu');

      expect(matrix.components[0].taxable_amount).toBe('232880.00');
    });

    it('bajo «subtotal» la base SÍ es el contrato entero, y ahí las dos cifras coinciden', () => {
      const matrix = noSumada('subtotal');

      expect(matrix.components[0].taxable_amount).toBe('2328800.00');
    });
  });
});
