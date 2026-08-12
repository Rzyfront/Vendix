import { DianSendBillResponse } from './interfaces/dian-response.interface';
import { DianSoapClient } from './dian-soap.client';

/**
 * El parseo de la respuesta de la DIAN es un SCRAPE POR REGEX, y no tenía una
 * sola prueba.
 *
 * Eso no es una laguna de cobertura cualquiera: de estos regex sale el veredicto
 * de cada documento electrónico que emite la plataforma, y un regex que no
 * matchea no falla — devuelve el literal por defecto y el sistema sigue como si
 * la DIAN no hubiera dicho nada.
 *
 * EL DEFECTO QUE MOTIVA ESTE ARCHIVO: el regex de `<b:StatusDescription>` usaba
 * `.` sin el flag `s`, que NO cruza saltos de línea. La DIAN enumera las reglas
 * violadas de un rechazo en varias líneas dentro de ese elemento, así que la
 * descripción de un rechazo real no matcheaba, `status_message` caía al literal
 * `'No status message in response'` y el motivo desaparecía del veredicto. El
 * regex de `<b:StatusCode>` ya se había corregido por esta misma razón; este
 * quedó atrás.
 *
 * `parseSoapResponse` es privado a propósito —nadie debe parsear XML de la DIAN
 * fuera de este cliente— y se invoca aquí por cast. La alternativa sería
 * exponerlo solo para probarlo, que es peor: ampliaría la superficie pública del
 * cliente para satisfacer al test.
 */
describe('DianSoapClient · parseSoapResponse', () => {
  const client = new DianSoapClient();

  const parse = (xml: string, http_status = 200): DianSendBillResponse =>
    (
      client as unknown as {
        parseSoapResponse: (
          xml: string,
          http_status: number,
          duration_ms: number,
        ) => DianSendBillResponse;
      }
    ).parseSoapResponse(xml, http_status, 0);

  const envelope = (body: string) =>
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:b="http://schemas.datacontract.org/2004/07/DianResponse"><s:Body>${body}</s:Body></s:Envelope>`;

  describe('StatusDescription multilínea — el defecto', () => {
    it('lee una descripción repartida en varias líneas', () => {
      const xml = envelope(
        `<b:StatusCode>99</b:StatusCode>
         <b:StatusDescription>Documento con errores en campos mandatorios.
Regla: FAB24a, Rechazo: No se encuentra informado el campo.
Regla: FAB25b, Rechazo: Valor no corresponde.</b:StatusDescription>
         <b:IsValid>false</b:IsValid>`,
      );

      const result = parse(xml);

      expect(result.status_code).toBe('99');
      // Antes del arreglo esta aserción devolvía 'No status message in response'
      // y el operador se quedaba sin saber por qué la DIAN rechazó.
      expect(result.status_message).toContain('FAB24a');
      expect(result.status_message).toContain('FAB25b');
      expect(result.success).toBe(false);
    });

    it('lee un StatusMessage multilínea, que tiene el mismo modo de fallo', () => {
      const xml = envelope(
        `<b:StatusCode>00</b:StatusCode>
         <b:StatusMessage>Procesado correctamente.
Sin observaciones.</b:StatusMessage>
         <b:IsValid>true</b:IsValid>`,
      );

      const result = parse(xml);

      expect(result.status_message).toContain('Sin observaciones');
      expect(result.success).toBe(true);
    });

    it('recorta el sangrado del XML en vez de mostrarlo tal cual', () => {
      const xml = envelope(
        `<b:StatusCode>2</b:StatusCode>
         <b:StatusDescription>
           Set de prueba con identificador 16bea3b2 se encuentra Aceptado.
         </b:StatusDescription>`,
      );

      const result = parse(xml);

      expect(result.status_message).toBe(
        'Set de prueba con identificador 16bea3b2 se encuentra Aceptado.',
      );
    });

    it('una descripción de una sola línea sigue leyéndose igual', () => {
      const xml = envelope(
        `<b:StatusCode>00</b:StatusCode><b:StatusDescription>Procesado correctamente.</b:StatusDescription><b:IsValid>true</b:IsValid>`,
      );

      expect(parse(xml).status_message).toBe('Procesado correctamente.');
    });

    it('una descripción vacía cae al literal por defecto, no a una cadena vacía', () => {
      const xml = envelope(
        `<b:StatusCode>3</b:StatusCode><b:StatusDescription>   </b:StatusDescription>`,
      );

      expect(parse(xml).status_message).toBe('No status message in response');
    });
  });

  describe('veredicto vs. acuse de recibo', () => {
    it('un ZipKey sin StatusCode es un acuse, NO un veredicto', () => {
      const xml = envelope(
        `<b:StatusCode i:nil="true" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"/><b:ZipKey>fa6f3f51</b:ZipKey>`,
      );

      const result = parse(xml);

      expect(result.zip_key).toBe('fa6f3f51');
      expect(result.has_dian_verdict).toBe(false);
      expect(result.status_code).toBe('ZIP_ACCEPTED');
      // Un acuse NO es éxito: el veredicto se resuelve luego por GetStatusZip.
      expect(result.success).toBe(false);
    });

    it('un StatusCode vacío sin ZipKey no filtra el 200 de transporte', () => {
      const xml = envelope(`<b:StatusCode></b:StatusCode>`);

      const result = parse(xml);

      expect(result.status_code).toBe('NO_VERDICT');
      expect(result.has_dian_verdict).toBe(false);
    });

    it('StatusCode 00 es el único código que declara éxito', () => {
      expect(parse(envelope('<b:StatusCode>00</b:StatusCode>')).success).toBe(
        true,
      );
      expect(parse(envelope('<b:StatusCode>99</b:StatusCode>')).success).toBe(
        false,
      );
    });

    it('IsValid true declara éxito aunque el código no sea 00', () => {
      const xml = envelope(
        `<b:StatusCode>0</b:StatusCode><b:IsValid>true</b:IsValid>`,
      );

      expect(parse(xml).success).toBe(true);
    });
  });

  describe('lista de reglas violadas', () => {
    it('extrae los <c:string> de <b:ErrorMessage>', () => {
      const xml = envelope(
        `<b:StatusCode>99</b:StatusCode>
         <b:ErrorMessage xmlns:c="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
           <c:string>Regla: CBG04a, Rechazo: documento referenciado no existe</c:string>
           <c:string>Regla: DBG04a, Rechazo: documento referenciado no existe</c:string>
         </b:ErrorMessage>`,
      );

      expect(parse(xml).error_messages).toEqual([
        'Regla: CBG04a, Rechazo: documento referenciado no existe',
        'Regla: DBG04a, Rechazo: documento referenciado no existe',
      ]);
    });

    it('acepta <b:ErrorMessageList> y un item sin prefijo de namespace', () => {
      const xml = envelope(
        `<b:StatusCode>99</b:StatusCode><b:ErrorMessageList><string>Regla: FAB07b</string></b:ErrorMessageList>`,
      );

      expect(parse(xml).error_messages).toEqual(['Regla: FAB07b']);
    });

    it('un contenedor nil autocerrado no inventa una lista vacía', () => {
      const xml = envelope(
        `<b:StatusCode>00</b:StatusCode><b:ErrorMessage i:nil="true" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"/>`,
      );

      expect(parse(xml).error_messages).toBeUndefined();
    });
  });

  describe('fallos que no son veredictos', () => {
    it('un SOAP Fault se marca como tal y conserva su razón', () => {
      const xml = envelope(
        `<s:Fault><s:Code><s:Value>s:Sender</s:Value></s:Code><s:Reason><s:Text xml:lang="en">InvalidSecurity</s:Text></s:Reason></s:Fault>`,
      );

      const result = parse(xml, 500);

      expect(result.is_soap_fault).toBe(true);
      expect(result.status_message).toBe('InvalidSecurity');
      expect(result.success).toBe(false);
    });

    it('un error HTTP no SOAP se reporta con su código de transporte', () => {
      const result = parse('<html>415 Unsupported Media Type</html>', 415);

      expect(result.status_code).toBe('415');
      expect(result.is_soap_fault).toBeUndefined();
      expect(result.success).toBe(false);
    });
  });
});
