import { WorkflowTemplateSummary } from '../../interfaces/workflow-templates.interfaces';
import {
  ALL_CATEGORIES,
  filterTemplates,
  stepsText,
  templateCategories,
} from './templates-gallery.util';

const tpl = (key: string, name: string, category: string, description = ''): WorkflowTemplateSummary => ({
  key,
  name,
  category,
  description,
  icon: 'file-text',
  stage_count: 3,
  stages: [],
});

const TEMPLATES = [
  tpl('compras', 'Compras con aprobación por monto', 'Compras', 'Solicitud de compra'),
  tpl('pqr', 'PQR', 'Servicio al cliente', 'Peticiones, quejas y reclamos'),
  tpl('caja', 'Cierre de caja', 'Finanzas', 'Cierre diario'),
];

describe('templates gallery util', () => {
  it('sin filtros devuelve todas', () => {
    expect(filterTemplates(TEMPLATES, '', ALL_CATEGORIES).length).toBe(3);
  });

  it('busca sin importar tildes ni mayúsculas', () => {
    expect(filterTemplates(TEMPLATES, 'APROBACION', ALL_CATEGORIES).map((t) => t.key)).toEqual(['compras']);
    expect(filterTemplates(TEMPLATES, 'peticiones', ALL_CATEGORIES).map((t) => t.key)).toEqual(['pqr']);
  });

  it('filtra por categoría y combina con la búsqueda', () => {
    expect(filterTemplates(TEMPLATES, '', 'Finanzas').map((t) => t.key)).toEqual(['caja']);
    expect(filterTemplates(TEMPLATES, 'pqr', 'Finanzas')).toEqual([]);
  });

  it('lista las categorías sin repetir', () => {
    expect(templateCategories([...TEMPLATES, tpl('x', 'X', 'Finanzas')])).toEqual([
      'Compras',
      'Servicio al cliente',
      'Finanzas',
    ]);
  });

  it('concuerda el singular de pasos', () => {
    expect(stepsText(1)).toBe('1 paso');
    expect(stepsText(5)).toBe('5 pasos');
  });
});
