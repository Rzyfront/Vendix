import { DianResponseParserService } from './dian-response-parser.service';

/**
 * Fixtures sintéticos: sin datos de clientes reales. Cubren la separación de
 * severidad POR MENSAJE y la detección de la Regla 90 como único rechazo.
 */
describe('DianResponseParserService.parseApplicationResponse', () => {
  const parser = new DianResponseParserService();

  const soap = (opts: {
    is_valid: boolean;
    code: string;
    description?: string;
    strings?: string[];
    app_descriptions?: string[];
  }) => {
    const app = opts.app_descriptions
      ? Buffer.from(
          `<ar:ApplicationResponse xmlns:ar="x" xmlns:cbc="y">${opts.app_descriptions
            .map((d) => `<cbc:Description>${d}</cbc:Description>`)
            .join('')}</ar:ApplicationResponse>`,
        ).toString('base64')
      : '';
    const errors = opts.strings
      ? `<b:ErrorMessage>${opts.strings
          .map((t) => `<c:string>${t}</c:string>`)
          .join('')}</b:ErrorMessage>`
      : '<b:ErrorMessage i:nil="true"/>';
    return `<s:Envelope xmlns:s="s" xmlns:b="b" xmlns:c="c"><s:Body>
      <b:IsValid>${opts.is_valid}</b:IsValid>
      <b:StatusCode>${opts.code}</b:StatusCode>
      <b:StatusDescription>${opts.description ?? 'Procesado'}</b:StatusDescription>
      ${errors}
      <b:XmlBase64Bytes>${app}</b:XmlBase64Bytes>
    </s:Body></s:Envelope>`;
  };

  it('(a) solo Regla 90 => already_processed true', () => {
    const r = parser.parseApplicationResponse(
      soap({
        is_valid: false,
        code: '99',
        strings: [
          'Regla: 90, Rechazo: Documento con CUFE abc procesado anteriormente',
        ],
      }),
    );
    expect(r.rule_messages).toEqual([
      {
        code: '90',
        text: 'Documento con CUFE abc procesado anteriormente',
        severity: 'rechazo',
      },
    ]);
    expect(r.already_processed).toBe(true);
    expect(r.errors).toHaveLength(1);
  });

  it('(b) Regla 90 + CTG01 => already_processed false', () => {
    const r = parser.parseApplicationResponse(
      soap({
        is_valid: false,
        code: '99',
        strings: [
          'Regla: 90, Rechazo: Documento procesado anteriormente',
          'Regla: CTG01, Rechazo: Contingencia no valida',
        ],
      }),
    );
    expect(r.already_processed).toBe(false);
    expect(r.errors.map((e) => e.code)).toEqual(['90', 'CTG01']);
  });

  it('(c) éxito + RUT01 notificación => errors vacío, severidad notificacion', () => {
    const r = parser.parseApplicationResponse(
      soap({
        is_valid: true,
        code: '00',
        app_descriptions: [
          'Documento validado por la DIAN',
          'Regla: RUT01, Notificación: Responsabilidad no informada en el RUT',
        ],
      }),
    );
    expect(r.errors).toEqual([]);
    expect(r.already_processed).toBe(false);
    expect(r.rule_messages).toEqual([
      {
        code: 'RUT01',
        text: 'Responsabilidad no informada en el RUT',
        severity: 'notificacion',
      },
    ]);
  });

  it('(d) FAU04 rechazo se conserva y no es already_processed', () => {
    const r = parser.parseApplicationResponse(
      soap({
        is_valid: false,
        code: '99',
        strings: ['Regla: FAU04, Rechazo: Valor de la base no coincide'],
      }),
    );
    expect(r.rule_messages).toEqual([
      {
        code: 'FAU04',
        text: 'Valor de la base no coincide',
        severity: 'rechazo',
      },
    ]);
    expect(r.errors[0]).toMatchObject({ code: 'FAU04', severity: 'error' });
    expect(r.already_processed).toBe(false);
  });

  it('deduplica la misma regla venida de ErrorMessage y StatusDescription', () => {
    const r = parser.parseApplicationResponse(
      soap({
        is_valid: false,
        code: '99',
        description: 'Regla: FAU04, Rechazo: Valor de la base no coincide',
        strings: ['Regla: FAU04, Rechazo: Valor de la base no coincide'],
      }),
    );
    expect(r.rule_messages).toHaveLength(1);
  });
});
