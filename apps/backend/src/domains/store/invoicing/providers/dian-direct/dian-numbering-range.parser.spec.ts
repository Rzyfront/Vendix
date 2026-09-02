import { parseNumberingRangeResponse } from './dian-numbering-range.parser';

/**
 * El parser de `GetNumberingRange` es la única pieza puramente determinista de
 * este flujo, es 100 % regex, y de ella depende que el diagnóstico del rechazo
 * `FAD06` se cierre o no.
 *
 * POR QUÉ MERECE SPEC PROPIA: su modo de fallo es SILENCIOSO. Un cambio de
 * nomenclatura de la DIAN, o un prefijo de namespace que nadie previó, no
 * producen una excepción: producen `ranges: []`, y la pantalla dice «la DIAN no
 * reporta numeración» — indistinguible de un tenant que legítimamente no tiene
 * resoluciones autorizadas. Ninguna prueba de integración distingue esos dos
 * casos; ésta sí.
 */
describe('parseNumberingRangeResponse', () => {
  /**
   * Respuesta nominal con DOS rangos y prefijos de namespace MEZCLADOS dentro
   * del mismo documento: `a:`, `b:` y elementos sin prefijo.
   *
   * No es un XML rebuscado por gusto. La DIAN contesta con prefijos variables
   * según la operación y la versión del WSDL, y anclarse a uno concreto es
   * exactamente el defecto que dejó a `DianSoapClient.parseSoapResponse` sin ver
   * `<b:NumberRangeResponse>` y devolviendo `NO_VERDICT` sobre una consulta
   * perfectamente exitosa.
   */
  it('lee los ocho campos de cada rango con prefijos de namespace distintos', () => {
    const xml = `<?xml version="1.0"?>
      <s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
        <s:Header><a:Action>GetNumberingRangeResponse</a:Action></s:Header>
        <s:Body>
          <GetNumberingRangeResponse xmlns="http://wcf.dian.colombia">
            <GetNumberingRangeResult xmlns:a="http://schemas.datacontract.org/2004/07/">
              <a:OperationCode>100</a:OperationCode>
              <a:ResponseList>
                <a:NumberRangeResponse>
                  <a:ResolutionNumber>18764113258848</a:ResolutionNumber>
                  <b:ResolutionDate>2026-07-29</b:ResolutionDate>
                  <a:Prefix>FAD</a:Prefix>
                  <FromNumber>1</FromNumber>
                  <b:ToNumber>5000</b:ToNumber>
                  <a:ValidDateFrom>2026-07-29T00:00:00</a:ValidDateFrom>
                  <ValidDateTo>2028-07-29T00:00:00</ValidDateTo>
                  <b:TechnicalKey>fc8eac422eba16e22ffd8c6f94b3f40a6e38162c</b:TechnicalKey>
                </a:NumberRangeResponse>
                <b:NumberRangeResponse>
                  <b:ResolutionNumber>18760000001</b:ResolutionNumber>
                  <a:ResolutionDate>2026-01-15</a:ResolutionDate>
                  <b:Prefix>SETP</b:Prefix>
                  <a:FromNumber>990000000</a:FromNumber>
                  <ToNumber>995000000</ToNumber>
                  <b:ValidDateFrom>2026-01-15</b:ValidDateFrom>
                  <a:ValidDateTo>2027-01-15</a:ValidDateTo>
                  <TechnicalKey>0a1b2c3d4e5f60718293a4b5c6d7e8f901234567</TechnicalKey>
                </b:NumberRangeResponse>
              </a:ResponseList>
            </GetNumberingRangeResult>
          </GetNumberingRangeResponse>
        </s:Body>
      </s:Envelope>`;

    const { ranges, element_names, outcome, operation_code } =
      parseNumberingRangeResponse(xml);

    expect(outcome).toBe('ranges');
    // El veredicto de la DIAN se publica TAMBIÉN cuando sí hubo rangos: vive
    // fuera de la lista y no depende de que ésta traiga ítems.
    expect(operation_code).toBe('100');
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual({
      resolution_number: '18764113258848',
      prefix: 'FAD',
      range_from: 1,
      range_to: 5000,
      valid_from: '2026-07-29T00:00:00.000Z',
      valid_to: '2028-07-29T00:00:00.000Z',
      resolution_date: '2026-07-29T00:00:00.000Z',
      technical_key: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
    });
    expect(ranges[1]).toEqual({
      resolution_number: '18760000001',
      prefix: 'SETP',
      range_from: 990000000,
      range_to: 995000000,
      valid_from: '2026-01-15T00:00:00.000Z',
      valid_to: '2027-01-15T00:00:00.000Z',
      resolution_date: '2026-01-15T00:00:00.000Z',
      technical_key: '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567',
    });
    // Con rangos leídos no se gasta esfuerzo en catalogar el cuerpo.
    expect(element_names).toEqual([]);
  });

  /**
   * ── LA FECHA NO PUEDE RETROCEDER ─────────────────────────────────────────
   *
   * La DIAN manda `2026-07-29` o `2026-07-29T00:00:00`, las dos SIN zona.
   * `new Date()` interpreta la segunda forma en la zona del PROCESO, así que
   * serializarla a ISO desplaza el instante — y en cualquier zona con offset
   * positivo el DÍA retrocede. Una vigencia corrida un día es lo que la DIAN
   * rechaza con FAB07b/FAB08b.
   *
   * El aserto es el ISO EXACTO, no `slice(0, 10)`: en Bogotá (UTC-5) un parseo
   * local produce `2026-07-29T05:00:00.000Z`, cuyo día sigue siendo 29 y pasaría
   * un aserto por día. Exigir `T00:00:00.000Z` falla en TODA zona con offset
   * distinto de cero, que es lo que hace este test capaz de detectar la
   * regresión en la máquina del dev y no sólo en CI.
   */
  it('ancla las fechas en UTC: el día no se mueve en ninguna zona horaria', () => {
    const xml = `<s:Body><a:NumberRangeResponse>
        <a:Prefix>FAD</a:Prefix>
        <a:ValidDateFrom>2026-07-29</a:ValidDateFrom>
        <a:ValidDateTo>2026-07-29T00:00:00</a:ValidDateTo>
      </a:NumberRangeResponse></s:Body>`;

    const { ranges } = parseNumberingRangeResponse(xml);

    // Las dos formas de entrada tienen que aterrizar en el MISMO instante.
    expect(ranges[0].valid_from).toBe('2026-07-29T00:00:00.000Z');
    expect(ranges[0].valid_to).toBe('2026-07-29T00:00:00.000Z');
    expect(new Date(ranges[0].valid_from as string).getUTCDate()).toBe(29);
  });

  /**
   * Cinturón y tirantes del test anterior: en CI la zona del proceso suele ser
   * UTC, donde un parseo local y uno anclado coinciden y la regresión pasaría
   * inadvertida. Aquí se fuerza una zona con offset POSITIVO —la dirección en
   * la que el día retrocede— para que el fallo aparezca también allí.
   */
  it('no retrocede el día ni con el proceso en una zona UTC+14', () => {
    const original_tz = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
      const { ranges } = parseNumberingRangeResponse(
        `<s:Body><a:NumberRangeResponse><a:Prefix>FAD</a:Prefix>` +
          `<a:ValidDateFrom>2026-07-29T00:00:00</a:ValidDateFrom>` +
          `</a:NumberRangeResponse></s:Body>`,
      );
      expect(ranges[0].valid_from).toBe('2026-07-29T00:00:00.000Z');
    } finally {
      process.env.TZ = original_tz;
    }
  });

  /**
   * Los alias existen porque el WSDL de habilitación y el de producción no
   * siempre han coincidido en la nomenclatura. Aceptarlos cuesta una comparación
   * de cadena; NO aceptarlos cuesta una consulta que afirma que el tenant no
   * tiene rangos autorizados cuando sí los tiene.
   */
  it('acepta la nomenclatura alterna en castellano', () => {
    const xml = `<s:Body>
        <a:NumberRangeResponse>
          <a:NumeroResolucion>18764113258848</a:NumeroResolucion>
          <a:FechaResolucion>2026-07-29</a:FechaResolucion>
          <a:Prefijo>FAD</a:Prefijo>
          <a:NumeroInicial>1</a:NumeroInicial>
          <a:NumeroFinal>5000</a:NumeroFinal>
          <a:FechaVigenciaDesde>2026-07-29</a:FechaVigenciaDesde>
          <a:FechaVigenciaHasta>2028-07-29</a:FechaVigenciaHasta>
          <a:ClaveTecnica>fc8eac422eba16e22ffd8c6f94b3f40a6e38162c</a:ClaveTecnica>
        </a:NumberRangeResponse>
      </s:Body>`;

    const { ranges, outcome } = parseNumberingRangeResponse(xml);

    expect(outcome).toBe('ranges');
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({
      resolution_number: '18764113258848',
      prefix: 'FAD',
      range_from: 1,
      range_to: 5000,
      valid_from: '2026-07-29T00:00:00.000Z',
      valid_to: '2028-07-29T00:00:00.000Z',
      resolution_date: '2026-07-29T00:00:00.000Z',
      technical_key: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
    });
  });

  /**
   * ── EL TEST QUE HACE DEPURABLE UN CAMBIO DE CONTRATO ────────────────────
   *
   * Si la DIAN renombra un campo, `ranges` queda vacío y la pantalla afirma algo
   * FALSO sobre el negocio del comerciante. `element_names` es lo único que
   * distingue «la DIAN cambió los nombres» de «no tienes rangos», y lo hace sin
   * volcar el XML — que trae la ClTec en claro y no puede salir a un log ni a
   * una respuesta HTTP.
   */
  it('cataloga los nombres de elemento cuando no logra leer ningún rango', () => {
    const xml = `<s:Envelope><s:Body>
        <GetNumberingRangeResponse>
          <RangoDeNumeracion>
            <IdentificadorResolucion>187641</IdentificadorResolucion>
            <IdentificadorResolucion>187642</IdentificadorResolucion>
            <SerieAutorizada>FAD</SerieAutorizada>
          </RangoDeNumeracion>
        </GetNumberingRangeResponse>
      </s:Body></s:Envelope>`;

    const { ranges, element_names, outcome } =
      parseNumberingRangeResponse(xml);

    expect(ranges).toEqual([]);
    // Sin `GetNumberingRangeResult` ni `ResponseList` no hay prueba de que la
    // DIAN haya hablado su contrato: acusar al software es lo honesto aquí.
    expect(outcome).toBe('unrecognized_contract');
    expect(element_names.length).toBeGreaterThan(0);
    // Nombres ÚTILES: los del cuerpo, sin prefijo de namespace y sin repetir.
    expect(element_names).toContain('IdentificadorResolucion');
    expect(element_names).toContain('SerieAutorizada');
    expect(element_names).toContain('RangoDeNumeracion');
    expect(new Set(element_names).size).toBe(element_names.length);
    // Acotado al Body: las cabeceras del sobre no dicen nada del negocio.
    expect(element_names).not.toContain('Envelope');
  });

  /**
   * NO LANZA NUNCA. Lanzar convertiría un SOAP Fault —o una respuesta vacía por
   * caída de red— en un 500 sin pista, justo en la herramienta que existe para
   * diagnosticar. El fallo de transporte lo juzga el llamador leyendo la
   * respuesta SOAP; aquí sólo se reporta que no había rangos que leer.
   */
  it('no lanza ante un SOAP Fault ni ante una respuesta vacía', () => {
    const fault = `<s:Envelope><s:Body><s:Fault>
        <s:Code><s:Value>s:Sender</s:Value></s:Code>
        <s:Reason><s:Text xml:lang="en">An error occurred when verifying security for the message.</s:Text></s:Reason>
      </s:Fault></s:Body></s:Envelope>`;

    expect(() => parseNumberingRangeResponse(fault)).not.toThrow();
    expect(parseNumberingRangeResponse(fault).ranges).toEqual([]);
    expect(parseNumberingRangeResponse(fault).outcome).toBe(
      'unrecognized_contract',
    );

    for (const empty of ['', '   ', undefined as unknown as string]) {
      expect(() => parseNumberingRangeResponse(empty)).not.toThrow();
      expect(parseNumberingRangeResponse(empty).ranges).toEqual([]);
      /**
       * Un cuerpo vacío NO puede salir como `empty_list`. No hubo respuesta que
       * interpretar, y decirle al comerciante «la DIAN no te reporta
       * numeración» a partir de la nada sería la misma mentira que este parser
       * existe para no repetir, en la dirección contraria.
       */
      expect(parseNumberingRangeResponse(empty).outcome).toBe(
        'unrecognized_contract',
      );
    }
  });

  /**
   * ── LA SALVAGUARDA DEL FALLBACK DE RANGO ÚNICO ──────────────────────────
   *
   * Sin envoltorio de ítem reconocible, el parser lee el cuerpo entero como UN
   * rango — pero SÓLO si trae a lo sumo una clave técnica. Con dos, los campos
   * de dos resoluciones distintas se mezclarían en una sola fila, y aplicar esa
   * fila escribiría la ClTec de una resolución sobre la otra: cada factura de la
   * serie afectada quedaría rechazada con FAD06 y sus consecutivos autorizados
   * perdidos. Es el peor resultado posible de todo este flujo, y peor que no
   * leer nada.
   */
  it('no mezcla dos resoluciones: el fallback de rango único se desactiva con dos ClTec', () => {
    const dos_claves = `<s:Body>
        <Fila>
          <Prefix>FAD</Prefix>
          <FromNumber>1</FromNumber>
          <TechnicalKey>fc8eac422eba16e22ffd8c6f94b3f40a6e38162c</TechnicalKey>
        </Fila>
        <Fila>
          <Prefix>SETP</Prefix>
          <FromNumber>990000000</FromNumber>
          <TechnicalKey>0a1b2c3d4e5f60718293a4b5c6d7e8f901234567</TechnicalKey>
        </Fila>
      </s:Body>`;

    const { ranges, element_names, outcome } =
      parseNumberingRangeResponse(dos_claves);

    expect(ranges).toEqual([]);
    expect(outcome).toBe('unrecognized_contract');
    // Y deja el rastro para depurarlo, que es el punto de rendirse aquí.
    expect(element_names).toContain('Fila');
    expect(element_names).toContain('TechnicalKey');
  });

  /**
   * La cara opuesta de la salvaguarda: con UNA sola clave no hay nada que
   * mezclar, así que el cuerpo entero SÍ se lee como un rango. Cubre al tenant
   * con una única resolución autorizada cuyo WSDL omitió el envoltorio.
   */
  it('lee el cuerpo como un solo rango cuando no hay envoltorio y hay una sola ClTec', () => {
    const xml = `<s:Body><b:GetNumberingRangeResult>
        <b:ResolutionNumber>18764113258848</b:ResolutionNumber>
        <b:Prefix>FAD</b:Prefix>
        <b:FromNumber>1</b:FromNumber>
        <b:ToNumber>5000</b:ToNumber>
        <b:TechnicalKey>fc8eac422eba16e22ffd8c6f94b3f40a6e38162c</b:TechnicalKey>
      </b:GetNumberingRangeResult></s:Body>`;

    const { ranges, outcome } = parseNumberingRangeResponse(xml);

    // El envoltorio `GetNumberingRangeResult` está presente y la lectura del
    // cuerpo entero sí produjo campos: es `ranges`, no `empty_list`. Ésta es la
    // frontera exacta que la nueva clasificación no puede desplazar.
    expect(outcome).toBe('ranges');
    expect(ranges).toHaveLength(1);
    expect(ranges[0].prefix).toBe('FAD');
    expect(ranges[0].technical_key).toBe(
      'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
    );
    // Lo que la DIAN no reportó queda en null: no se rellena con nada.
    expect(ranges[0].valid_from).toBeNull();
    expect(ranges[0].resolution_date).toBeNull();
  });

  /**
   * Un elemento nil (`i:nil="true"`) es AUSENCIA del dato, no una cadena vacía.
   * Importa porque la ausencia de ClTec es lo que hace que el servicio deje la
   * clave local intacta en vez de sellarla en `null` y borrar la única copia que
   * existe de una clave que la DIAN emitió para un rango ya en uso.
   */
  it('trata un elemento nil autocerrado como dato ausente', () => {
    const xml = `<s:Body><a:NumberRangeResponse>
        <a:ResolutionNumber>18760000001</a:ResolutionNumber>
        <a:Prefix>SETP</a:Prefix>
        <a:TechnicalKey i:nil="true"/>
      </a:NumberRangeResponse></s:Body>`;

    const { ranges } = parseNumberingRangeResponse(xml);

    expect(ranges).toHaveLength(1);
    expect(ranges[0].technical_key).toBeNull();
    expect(ranges[0].resolution_number).toBe('18760000001');
  });

  /**
   * ── EL CASO QUE MOTIVÓ LA TERCERA SALIDA ────────────────────────────────
   *
   * Cuerpo REAL de la configuración 20 (NIT 1123408049, ambiente de
   * habilitación): el contrato oficial COMPLETO —`GetNumberingRangeResponse`,
   * `GetNumberingRangeResult`, `OperationCode`, `OperationDescription`,
   * `ResponseList`— con la lista sin un solo `<NumberRangeResponse>` dentro. La
   * DIAN sencillamente no reporta numeración para ese NIT+software ahí.
   *
   * Con dos salidas esto caía en «no se pudo interpretar» y el panel acusaba a
   * la DIAN de un cambio de contrato que nunca ocurrió, mandando a depurar
   * durante horas algo que no estaba roto. El aserto que importa es
   * `element_names: []`: mientras esa lista salga llena, aguas arriba hay
   * material para volver a redactar la acusación falsa.
   */
  it('reporta lista vacía —no contrato roto— cuando la DIAN responde bien y sin rangos', () => {
    const xml = `<?xml version="1.0"?>
      <s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
        <s:Header><a:Action>GetNumberingRangeResponse</a:Action></s:Header>
        <s:Body>
          <GetNumberingRangeResponse xmlns="http://wcf.dian.colombia">
            <GetNumberingRangeResult xmlns:a="http://schemas.datacontract.org/2004/07/">
              <a:OperationCode>100</a:OperationCode>
              <a:OperationDescription>Consulta Exitosa</a:OperationDescription>
              <a:ResponseList/>
            </GetNumberingRangeResult>
          </GetNumberingRangeResponse>
        </s:Body>
      </s:Envelope>`;

    const result = parseNumberingRangeResponse(xml);

    expect(result.outcome).toBe('empty_list');
    expect(result.ranges).toEqual([]);
    // Nada que catalogar: el contrato se entendió. Publicar los nombres del
    // contrato NORMAL es lo que invita a leerlos como anomalía.
    expect(result.element_names).toEqual([]);
    // Y el diagnóstico que sí corresponde: lo que la DIAN misma dijo.
    expect(result.operation_code).toBe('100');
    expect(result.operation_description).toBe('Consulta Exitosa');
  });

  /**
   * El `<ResponseList></ResponseList>` con cierre explícito es la misma lista
   * vacía que `<ResponseList/>`. Se prueban las dos formas porque la detección
   * es por regex y una que exija `>` inmediato tras el nombre no ve la
   * autocerrada — el modo de fallo sería silencioso y devolvería al punto de
   * partida.
   */
  it('lee la lista vacía tanto autocerrada como con cierre explícito', () => {
    const explicito = `<s:Body>
        <GetNumberingRangeResponse>
          <GetNumberingRangeResult>
            <b:OperationCode>100</b:OperationCode>
            <b:ResponseList></b:ResponseList>
          </GetNumberingRangeResult>
        </GetNumberingRangeResponse>
      </s:Body>`;

    const result = parseNumberingRangeResponse(explicito);

    expect(result.outcome).toBe('empty_list');
    expect(result.element_names).toEqual([]);
    expect(result.operation_code).toBe('100');
    // Sin `OperationDescription` no se inventa texto: queda en null.
    expect(result.operation_description).toBeNull();
  });

  /**
   * ── EL ERROR SIMÉTRICO ──────────────────────────────────────────────────
   *
   * El envoltorio presente NO basta para declarar lista vacía. Si dentro hay
   * nombres ajenos al contrato conocido, la DIAN sí puso rangos ahí y fuimos
   * nosotros los que no supimos leerlos; llamar a eso `empty_list` afirmaría en
   * falso —ahora contra el comerciante— que no tiene numeración autorizada, y
   * además borraría `element_names`, que es lo único con lo que se depura un
   * renombre sin volcar el XML crudo con la ClTec dentro.
   *
   * Es el mismo defecto que se está corrigiendo, con los papeles cambiados.
   */
  it('no confunde un campo renombrado dentro del envoltorio con una lista vacía', () => {
    const renombrado = `<s:Body>
        <GetNumberingRangeResponse>
          <GetNumberingRangeResult>
            <a:OperationCode>100</a:OperationCode>
            <a:ResponseList>
              <a:RangoAutorizado>
                <a:SerieAutorizada>FAD</a:SerieAutorizada>
                <a:LlaveTecnica>fc8eac422eba16e22ffd8c6f94b3f40a6e38162c</a:LlaveTecnica>
              </a:RangoAutorizado>
            </a:ResponseList>
          </GetNumberingRangeResult>
        </GetNumberingRangeResponse>
      </s:Body>`;

    const result = parseNumberingRangeResponse(renombrado);

    expect(result.outcome).toBe('unrecognized_contract');
    expect(result.ranges).toEqual([]);
    expect(result.element_names).toContain('RangoAutorizado');
    expect(result.element_names).toContain('LlaveTecnica');
    // El estado se sigue publicando: ayuda a saber si la consulta fue exitosa
    // aunque no hayamos entendido su carga.
    expect(result.operation_code).toBe('100');
  });
});
