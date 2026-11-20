import * as XLSX from 'xlsx';
import { mapColumnsBySynonyms } from '@common/ai-ingest/sheets/column-mapper';
import { SheetParserService } from '@common/ai-ingest/sheets/sheet-parser.service';
import { AiExtractionService } from '@common/ai-ingest/extraction/ai-extraction.service';
import { IngestProfileRegistry } from '@common/ai-ingest/profiles/registry';
import { AIMessage } from '../../../../ai-engine/interfaces/ai-provider.interface';
import { CustomerAiImportService } from './customer-ai-import.service';
import {
  CUSTOMER_COLUMN_SYNONYMS,
  mergeCustomerRows,
  normalizeCustomerRow,
  parseDocument,
  splitAddressCity,
  splitPersonName,
} from './customer-ingest.profile';

function xlsx(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Clientes');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const scanFile = (buffer: Buffer, name = 'clientes.xlsx') => ({
  buffer,
  mimeType: 'application/octet-stream',
  originalName: name,
  size: buffer.length,
});

describe('perfil ai-ingest customers', () => {
  describe('mapeo por sinónimos', () => {
    it('reconoce encabezados en español sin importar tildes ni mayúsculas', () => {
      const mapping = mapColumnsBySynonyms(
        [
          'RAZÓN SOCIAL',
          'Nit / C.C.',
          'Teléfono',
          'Teléfono sede',
          'Dirección',
          'Ciudad',
          'Correo electrónico',
          'Observaciones',
        ],
        CUSTOMER_COLUMN_SYNONYMS,
      );
      expect(Object.fromEntries(mapping)).toEqual({
        'RAZÓN SOCIAL': 'legal_name',
        'Nit / C.C.': 'document_number',
        Teléfono: 'phone',
        'Teléfono sede': 'location_phone',
        Dirección: 'address',
        Ciudad: 'city',
        'Correo electrónico': 'email',
      });
    });

    it('"Tipo de documento" va al tipo y "Número de documento" al número', () => {
      const mapping = mapColumnsBySynonyms(
        ['Tipo de documento', 'Número de documento', 'Nombre completo'],
        CUSTOMER_COLUMN_SYNONYMS,
      );
      expect(Object.fromEntries(mapping)).toEqual({
        'Tipo de documento': 'document_type',
        'Número de documento': 'document_number',
        'Nombre completo': 'full_name',
      });
    });
  });

  describe('normalización determinista', () => {
    it('NIT con DV: número sin puntos y DV calculado; un DV errado se corrige y se avisa', () => {
      expect(parseDocument('900.123.456-8', undefined, undefined)).toEqual({
        document_type: 'NIT',
        document_number: '900123456',
        verification_digit: '8',
        needsAi: false,
        issues: [],
      });
      const wrong = parseDocument('900123456', 'NIT', '1');
      expect(wrong.verification_digit).toBe('8');
      expect(wrong.issues[0]).toContain('no corresponde');
    });

    it('lee el tipo escrito dentro del número y asume CC solo con aviso', () => {
      expect(parseDocument('C.C. 1.020.304.050', undefined, undefined)).toMatchObject({
        document_type: 'CC',
        document_number: '1020304050',
        needsAi: false,
      });
      const assumed = parseDocument('79123456', undefined, undefined);
      expect(assumed.document_type).toBe('CC');
      expect(assumed.issues).toHaveLength(1);
      expect(parseDocument('AB123456', undefined, undefined).needsAi).toBe(true);
    });

    it('nombres: 2 y 4 palabras se parten por código, 3 palabras van a la IA', () => {
      expect(splitPersonName('Ana Pérez')).toEqual({ first_name: 'Ana', last_name: 'Pérez', ambiguous: false });
      expect(splitPersonName('Ana María Pérez Gómez').ambiguous).toBe(false);
      expect(splitPersonName('Juan Pérez Gómez').ambiguous).toBe(true);
    });

    it('dirección con ciudad (y departamento) al final', () => {
      expect(splitAddressCity('Cra 7 # 12-34, Bogotá')).toEqual({
        address_line_1: 'Cra 7 # 12-34',
        city: 'Bogotá',
        state: null,
      });
      expect(splitAddressCity('Cl 10 # 5-20, Medellín, Antioquia')).toEqual({
        address_line_1: 'Cl 10 # 5-20',
        city: 'Medellín',
        state: 'Antioquia',
      });
      // Sin palabras tras el número no hay ciudad que buscar: no va a la IA.
      expect(normalizeCustomerRow({ full_name: 'Ana Pérez', address: 'Cra 1 # 2-3' }, { row: 2 }).record?.needs).toEqual([]);
      expect(normalizeCustomerRow({ full_name: 'Ana Pérez', address: 'Cl 10 # 5-20 Bogotá' }, { row: 3 }).record?.needs).toEqual(['address_city']);
    });

    it('una empresa en "nombre completo" va a razón social; una fila sin datos se omite con motivo', () => {
      const company = normalizeCustomerRow({ full_name: 'Distribuciones El Sol S.A.S.' }, { row: 4 });
      expect(company.record).toMatchObject({ legal_name: 'Distribuciones El Sol S.A.S.', person_type: 'JURIDICA', needs: [] });

      const empty = normalizeCustomerRow({ city: 'Cali' }, { row: 9 });
      expect(empty.record).toBeUndefined();
      expect(empty.skipMessage).toContain('Sin nombre');
    });

    it('filas con el mismo documento se agrupan; la que no trae nada nuevo es duplicada', () => {
      const base = {
        person_type: 'JURIDICA' as const,
        first_name: null,
        last_name: null,
        legal_name: 'Acme',
        document_type: 'NIT',
        document_number: '900123456',
        verification_digit: '8',
        email: null,
        phone: null,
      };
      const loc = (address: string) => ({
        label: null,
        address_line_1: address,
        address_line_2: null,
        city: 'Cali',
        state: null,
        municipality_code: null,
        phone: null,
      });
      const { customers, skipped } = mergeCustomerRows([
        { ...base, locations: [loc('Cra 1 # 2-3')], source_rows: [2] },
        { ...base, locations: [loc('Cl 9 # 8-7')], source_rows: [3] },
        { ...base, locations: [loc('CRA 1 #2-3')], source_rows: [4] },
      ]);
      expect(customers).toHaveLength(1);
      expect(customers[0].locations).toHaveLength(2);
      expect(customers[0].source_rows).toEqual([2, 3]);
      expect(skipped).toEqual([
        expect.objectContaining({ row: 4, reason: 'duplicate' }),
      ]);
    });
  });

  describe('carga de una hoja completa', () => {
    let run: jest.Mock;
    let service: CustomerAiImportService;
    let progress: jest.Mock;

    beforeEach(() => {
      run = jest.fn();
      progress = jest.fn().mockResolvedValue(undefined);
      service = new CustomerAiImportService(
        {} as any,
        {} as any,
        {} as any,
        { register: jest.fn() } as any,
        new SheetParserService(),
        new AiExtractionService({ run } as any),
        new IngestProfileRegistry(),
      );
    });

    it('800 clientes con encabezado en la fila 3: todos en la vista previa, sin IA y con omitidas por fila', async () => {
      const rows: unknown[][] = [['Clientes mayoristas'], [], ['Nombre', 'Cédula', 'Celular', 'Dirección', 'Ciudad']];
      for (let i = 1; i <= 800; i++) {
        rows.push([`Cliente${i} Apellido${i}`, 10000000 + i, 3000000000 + i, `Cl ${i} # 1-2`, 'Cali']);
      }
      rows.push([]);
      rows.push(['Cliente1 Apellido1', 10000001, 3000000001, 'Cl 1 # 1-2', 'Cali']); // repetida
      rows.push(['', '', '', '', 'Cali']); // sin datos de cliente
      rows.push(['Total', 800]);

      const scan = await service.scanFromFiles([scanFile(xlsx(rows))], progress);

      expect(run).not.toHaveBeenCalled();
      expect(scan.customers).toHaveLength(800);
      expect(scan.customers[0]).toMatchObject({
        first_name: 'Cliente1',
        last_name: 'Apellido1',
        document_type: 'CC',
        document_number: '10000001',
        phone: '3000000001',
        source_rows: [4],
      });
      expect(scan.customers[0].locations[0]).toMatchObject({ address_line_1: 'Cl 1 # 1-2', city: 'Cali' });
      expect(scan.skipped?.map((s) => [s.row, s.reason])).toEqual([
        [804, 'empty'],
        [805, 'duplicate'],
        [806, 'unreadable'],
        [807, 'total'],
      ]);
      expect(scan.stats).toMatchObject({ source: 'sheet', total_rows: 802, ai_rows: 0, mapping: 'synonyms' });
      // Tipo asumido: un aviso por fila con su número.
      expect(scan.row_issues?.[0]).toMatchObject({ row: 4, field: 'document_number' });
      const last = progress.mock.calls[progress.mock.calls.length - 1][0];
      expect(last).toMatchObject({ done: 802, total: 802, unit: 'filas' });
    });

    it('encabezados que no dicen nada: UNA llamada de mapeo y luego código para todas las filas', async () => {
      run.mockResolvedValue({
        success: true,
        content: JSON.stringify({
          columns: [
            { column: 'Col A', field: 'legal_name' },
            { column: 'Col B', field: 'document_number' },
            { column: 'Col C', field: 'ignore' },
          ],
        }),
      });
      const rows: unknown[][] = [['Col A', 'Col B', 'Col C']];
      for (let i = 1; i <= 300; i++) rows.push([`Empresa ${i} SAS`, `9001${String(i).padStart(5, '0')}`, 'x']);

      const scan = await service.scanFromFiles([scanFile(xlsx(rows))], progress);

      expect(run).toHaveBeenCalledTimes(1);
      const prompt = String((run.mock.calls[0][2] as AIMessage[])[0].content);
      expect(prompt).toContain('Sample rows');
      expect(prompt).not.toContain('Empresa 6 SAS'); // solo 5 filas de muestra
      expect(scan.customers).toHaveLength(300);
      expect(scan.customers[0]).toMatchObject({ legal_name: 'Empresa 1 SAS', document_type: 'NIT', person_type: 'JURIDICA' });
      expect(scan.stats?.mapping).toBe('ai');
      expect(scan.columns).toContainEqual({ column: 'Col C', field: null });
    });

    it('solo las filas ambiguas van a la IA, por lotes con row_id', async () => {
      run.mockImplementation(async (_a, _v, messages: AIMessage[]) => {
        const lines = String(messages[0].content)
          .split('\n')
          .filter((l) => l.startsWith('{'))
          .map((l) => JSON.parse(l) as { row_id: number; full_name: string });
        return {
          success: true,
          content: JSON.stringify({
            customers: lines.map((l) => {
              const [first, ...rest] = l.full_name.split(' ');
              return { row_id: l.row_id, first_name: `${first} Ana`, last_name: rest.slice(1).join(' ') };
            }),
          }),
        };
      });
      const rows: unknown[][] = [['Nombre completo', 'Documento']];
      for (let i = 1; i <= 120; i++) rows.push([`Juan Pérez${i} Gómez`, `${50000000 + i}`]);
      rows.push(['Ana Pérez', '59999999']);

      const scan = await service.scanFromFiles([scanFile(xlsx(rows))], progress);

      // 120 filas ambiguas en lotes de 50 → 3 llamadas; la fila clara no viaja.
      expect(run).toHaveBeenCalledTimes(3);
      expect(scan.stats?.ai_rows).toBe(120);
      expect(scan.customers).toHaveLength(121);
      expect(scan.customers[0]).toMatchObject({ first_name: 'Juan Ana', last_name: 'Gómez', source_rows: [2] });
      expect(scan.customers[120]).toMatchObject({ first_name: 'Ana', last_name: 'Pérez' });
      const sent = run.mock.calls
        .flatMap((c) => (c[2] as AIMessage[]).map((m) => String(m.content)))
        .join('\n');
      expect(sent).toContain('"full_name":"Juan Pérez1 Gómez"');
      expect(sent).not.toContain('"full_name":"Ana Pérez"');
    });
  });
});
