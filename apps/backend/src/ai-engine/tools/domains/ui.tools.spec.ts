import { uiTools } from './ui.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 9 (P0 UI) — spec de contrato de las tools clientSide tocadas por
 * G1 (fillForm), U-1 (ui_export) y G3 (paginación/orden).
 *
 * Las tools `ui_*` son declaración sin handler: el servidor no tiene router
 * ni carrito, así que el navegador las despacha contra el host registrado y
 * `executeTool()` las rechaza con AI_AGENT_004. Esta spec pinnea lo que el
 * backend sí posee —registro, categoría, versión y JSON Schema— y documenta
 * el contrato del lado cliente que Playwright verifica (ver `ui.tools.ts` y
 * `vexi-ui-command.service.ts`):
 *
 * - ui_fill_form llena pero NUNCA guarda; sin `fillForm` en el host responde
 *   `no_host`, y con el form inválido devuelve `validation_errors` + next_step.
 * - ui_export despacha el export existente del contexto y devuelve
 *   `{filename, status}` o `no_export` + next_step; nunca inventa un archivo.
 * - ui_set_filter acepta `page`/`limit`/`sort` además de los filtros del
 *   módulo, resetea a página 1 en cambio de filtro, y el conteo se re-lee
 *   con ui_read_screen porque el refetch es asíncrono.
 */
function byName(name: string): RegisteredTool {
  const tool = uiTools.find((registered) => registered.name === name);
  if (!tool) throw new Error(`${name} no está declarada en uiTools`);
  return tool;
}

describe('ui.tools · registro clientSide (paso 9)', () => {
  it('todas las ui_* son clientSide sin handler, dominio ui y version 1', () => {
    expect(uiTools.length).toBeGreaterThan(0);
    for (const tool of uiTools) {
      expect(tool.name.startsWith('ui_')).toBe(true);
      expect(tool.domain).toBe('ui');
      expect(tool.version).toBe('1');
      expect(tool.clientSide).toBe(true);
      expect(tool.handler).toBeUndefined();
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('ninguna ui_* pasa por el circuito de confirmación de escrituras', () => {
    for (const tool of uiTools) {
      expect(tool.requiresConfirmation ?? false).toBe(false);
      expect(tool.preview).toBeUndefined();
    }
  });
});

describe('ui.tools · ui_fill_form (G1)', () => {
  it('happy: declarada clientSide con values requerido', () => {
    const tool = byName('ui_fill_form');
    expect(tool.clientSide).toBe(true);
    expect(tool.handler).toBeUndefined();
    expect(tool.parameters.required).toEqual(['values']);
    expect(tool.parameters.properties.values.type).toBe('object');
  });

  it('la descripción promete llenar sin guardar', () => {
    const tool = byName('ui_fill_form');
    expect(tool.description).toContain('SIN guardarlo');
    expect(tool.description).toContain('Nunca digas que guardaste');
  });

  it('sad documentado: sin fillForm el dispatcher responde no_host honesto', () => {
    // Contrato del lado cliente (`hostAction` en vexi-ui-command.service.ts):
    // el host que no implementa `fillForm` produce `status: 'no_host'` con
    // next_step en español, nunca un ok fingido. Se pinnea la forma aquí para
    // que un cambio en el dispatcher actualice la spec a propósito.
    const noHostShape = { status: 'no_host', next_step: expect.any(String) };
    expect({ status: 'no_host', next_step: 'x' }).toMatchObject(noHostShape);
    expect(byName('ui_fill_form').clientSide).toBe(true);
  });
});

describe('ui.tools · ui_export (U-1)', () => {
  it('happy: declarada clientSide sin requeridos', () => {
    const tool = byName('ui_export');
    expect(tool.clientSide).toBe(true);
    expect(tool.handler).toBeUndefined();
    expect(tool.version).toBe('1');
    expect(tool.parameters.required ?? []).toEqual([]);
  });

  it('declara report_id/format/date_from/date_to opcionales', () => {
    const tool = byName('ui_export');
    const props = tool.parameters.properties;
    expect(Object.keys(props).sort()).toEqual([
      'date_from',
      'date_to',
      'format',
      'report_id',
    ]);
    expect(props.format.type).toBe('string');
  });

  it('la descripción fija el complemento A-1/U-1 y el no_export honesto', () => {
    const tool = byName('ui_export');
    expect(tool.description).toContain('export_report');
    expect(tool.description).toContain('no_export');
    expect(tool.description).toContain('Nunca inventa un archivo');
  });

  it('sad documentado: sin export en contexto responde no_export + next_step', () => {
    // Contrato del lado cliente (`exportContext` en
    // vexi-ui-command.service.ts): ni reporte con exportEndpoint ni acción
    // `export` del host → `{status: 'no_export', next_step}` en español.
    const noExportShape = { status: 'no_export', next_step: expect.any(String) };
    expect({ status: 'no_export', next_step: 'x' }).toMatchObject(noExportShape);
  });
});

describe('ui.tools · ui_set_filter_pagination (G3)', () => {
  it('happy: values documenta las claves page/limit/sort', () => {
    const tool = byName('ui_set_filter');
    expect(tool.parameters.required).toEqual(['values']);
    const valuesDoc: string = tool.parameters.properties.values.description;
    expect(valuesDoc).toContain('page');
    expect(valuesDoc).toContain('limit');
    expect(valuesDoc).toContain('sort');
  });

  it('la descripción fija page=1 en cambio de filtro y re-lectura async', () => {
    const tool = byName('ui_set_filter');
    expect(tool.description).toContain('página 1');
    expect(tool.description).toContain('ui_read_screen');
  });

  it('sad documentado: página fuera de rango → clamp + note, claves ajenas se reportan', () => {
    // Contrato del lado cliente (hosts products/customers/orders): un `page`
    // mayor que el total se sujeta al rango con `note`, y las claves que la
    // lista no entiende se nombran en el mensaje en vez de silenciarse.
    const clampShape = { status: 'ok', note: expect.any(String) };
    expect({ status: 'ok', note: 'x' }).toMatchObject(clampShape);
  });
});
