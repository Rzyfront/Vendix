import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { RegisteredTool } from '../interfaces/tool.interface';
import {
  createBrandTools,
  createCategoryTools,
} from './catalog-taxonomy.tools';

const CTX = { store_id: 3, organization_id: 1, user_id: 9 };

function byName(tools: RegisteredTool[], name: string): RegisteredTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} no registrada`);
  return tool;
}

const json = (raw: string) => JSON.parse(raw);

describe('catalog-taxonomy.tools · categorías', () => {
  function build(overrides: Record<string, jest.Mock> = {}) {
    const service = {
      findAll: jest.fn().mockResolvedValue({
        data: [
          { id: 1, name: 'Bebidas', state: 'active', product_count: 12 },
          { id: 2, name: 'Aseo', state: 'active', product_count: 0 },
        ],
        meta: { total: 2 },
      }),
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 1, name: 'Bebidas', state: 'active' }),
      getProductIds: jest
        .fn()
        .mockResolvedValue({ product_ids: [10, 11, 12], total: 3 }),
      assignProducts: jest
        .fn()
        .mockResolvedValue({ added: 1, removed: 0, unchanged: 1 }),
      ...overrides,
    };
    const tools = createCategoryTools({ categoriesService: service as any });
    return { service, tools };
  }

  it('declara nombres, permisos y categorías correctas', () => {
    const { tools } = build();
    const list = byName(tools, 'list_categories');
    const assign = byName(tools, 'assign_products_to_category');
    expect(list.readOnly).toBe(true);
    expect(list.requiredPermissions).toEqual(['store:categories:read']);
    expect(assign.requiresConfirmation).toBe(true);
    expect(assign.requiredPermissions).toEqual(['store:categories:update']);
    expect(typeof assign.preview).toBe('function');
    expect(assign.description).toContain('list_categories');
  });

  it('list_categories mapea product_count, limita y excluye inactivas por defecto', async () => {
    const { service, tools } = build();
    const out = json(
      await byName(tools, 'list_categories').handler!(
        { search: 'be', limit: 500 },
        CTX,
      ),
    );
    expect(service.findAll).toHaveBeenCalledWith({
      page: 1,
      limit: 50,
      search: 'be',
      state: 'active',
    });
    expect(out.categories).toEqual([
      { id: 1, name: 'Bebidas', state: 'active', product_count: 12 },
      { id: 2, name: 'Aseo', state: 'active', product_count: 0 },
    ]);
    expect(out.total).toBe(2);
    expect(out.has_more).toBe(false);
  });

  it('list_categories con include_inactive no filtra estado y usa límite por defecto', async () => {
    const { service, tools } = build();
    await byName(tools, 'list_categories').handler!(
      { include_inactive: true },
      CTX,
    );
    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  describe('resolución por nombre', () => {
    const args = { category_name: 'bebidas', mode: 'add', product_ids: [10] };

    it('una coincidencia exacta (sin distinguir mayúsculas) resuelve', async () => {
      const { service, tools } = build({
        findAll: jest.fn().mockResolvedValue({
          data: [
            { id: 1, name: 'Bebidas', state: 'active' },
            { id: 5, name: 'Bebidas frías', state: 'active' },
          ],
          meta: { total: 2 },
        }),
      });
      const preview = await byName(tools, 'assign_products_to_category')
        .preview!(args, CTX);
      expect(preview.status).toBe('ok');
      expect(preview.target).toBe('Categoría Bebidas');
      expect(service.getProductIds).toHaveBeenCalledWith(1);
    });

    it('cero coincidencias pide elegir y lista opciones parecidas', async () => {
      const { tools } = build({
        findAll: jest.fn().mockResolvedValue({
          data: [{ id: 5, name: 'Bebidas frías', state: 'active' }],
          meta: { total: 1 },
        }),
      });
      const out = json(
        await byName(tools, 'assign_products_to_category').handler!(args, CTX),
      );
      expect(out.error).toContain('No encontré una categoría llamada');
      expect(out.next_step).toContain('Bebidas frías');
    });

    it('varias coincidencias piden elegir', async () => {
      const { service, tools } = build({
        findAll: jest.fn().mockResolvedValue({
          data: [
            { id: 1, name: 'Bebidas', state: 'active' },
            { id: 8, name: 'bebidas', state: 'inactive' },
          ],
          meta: { total: 2 },
        }),
      });
      const preview = await byName(tools, 'assign_products_to_category')
        .preview!(args, CTX);
      expect(preview.status).toBe('error');
      expect(preview.message).toContain('Hay 2 categorías');
      expect(preview.message).toContain('inactiva');
      const out = json(
        await byName(tools, 'assign_products_to_category').handler!(args, CTX),
      );
      expect(out.error).toContain('Hay 2 categorías');
      expect(service.assignProducts).not.toHaveBeenCalled();
    });
  });

  it('preview add cuenta cuántos ya estaban y cuántos son nuevos', async () => {
    const { tools } = build();
    const preview = await byName(tools, 'assign_products_to_category').preview!(
      { category_id: 1, mode: 'add', product_ids: [10, 20, 21] },
      CTX,
    );
    expect(preview.status).toBe('ok');
    expect(preview.domain).toBe('products');
    expect(preview.changes[0]).toMatchObject({ from: 3, to: 5 });
    expect(preview.message).toContain('Se agregarán 2 productos');
    expect(preview.message).toContain('1 ya estaba');
  });

  it('preview remove cuenta los que se quitarán', async () => {
    const { tools } = build();
    const preview = await byName(tools, 'assign_products_to_category').preview!(
      { category_id: 1, mode: 'remove', product_ids: [10, 11, 99] },
      CTX,
    );
    expect(preview.changes[0]).toMatchObject({ from: 3, to: 1 });
    expect(preview.message).toContain('Se quitarán 2 productos');
  });

  it('preview rechaza modo inválido y listas vacías', async () => {
    const { tools } = build();
    const tool = byName(tools, 'assign_products_to_category');
    expect(
      (await tool.preview!({ category_id: 1, mode: 'x', product_ids: [1] }, CTX))
        .status,
    ).toBe('error');
    expect(
      (await tool.preview!({ category_id: 1, mode: 'add', product_ids: [] }, CTX))
        .status,
    ).toBe('error');
  });

  it('handler llama al servicio con el dto correcto y devuelve resultado verificable', async () => {
    const { service, tools } = build();
    const out = json(
      await byName(tools, 'assign_products_to_category').handler!(
        { category_id: 1, mode: 'add', product_ids: [10, 20, 20] },
        CTX,
      ),
    );
    expect(service.assignProducts).toHaveBeenCalledTimes(1);
    const [id, dto] = service.assignProducts.mock.calls[0];
    expect(id).toBe(1);
    expect(dto).toMatchObject({ action: 'add', product_ids: [10, 20] });
    expect(out.data).toEqual({
      category: { id: 1, name: 'Bebidas' },
      added: 1,
      removed: 0,
      unchanged: 1,
    });
    expect(out.summary).toContain('Bebidas');
    expect(out.error).toBeUndefined();
  });

  it('handler rechaza más de 500 productos sin llamar al servicio', async () => {
    const { service, tools } = build();
    const out = json(
      await byName(tools, 'assign_products_to_category').handler!(
        {
          category_id: 1,
          mode: 'add',
          product_ids: Array.from({ length: 501 }, (_, i) => i + 1),
        },
        CTX,
      ),
    );
    expect(out.error).toContain('máximo 500');
    expect(out.next_step).toBeDefined();
    expect(service.assignProducts).not.toHaveBeenCalled();
  });

  it('traduce CAT_FIND_001 a un error legible con next_step', async () => {
    const { tools } = build({
      assignProducts: jest
        .fn()
        .mockRejectedValue(new VendixHttpException(ErrorCodes.CAT_FIND_001)),
    });
    const out = json(
      await byName(tools, 'assign_products_to_category').handler!(
        { category_id: 1, mode: 'add', product_ids: [10] },
        CTX,
      ),
    );
    expect(out.error).toContain('La categoría ya no existe');
    expect(out.next_step).toBeDefined();
  });

  it('traduce PROD_FIND_001 diciendo qué ids no existen', async () => {
    const { tools } = build({
      assignProducts: jest.fn().mockRejectedValue(
        new VendixHttpException(ErrorCodes.PROD_FIND_001, undefined, {
          invalid_product_ids: [77, 78],
        }),
      ),
    });
    const out = json(
      await byName(tools, 'assign_products_to_category').handler!(
        { category_id: 1, mode: 'add', product_ids: [10, 77, 78] },
        CTX,
      ),
    );
    expect(out.error).toContain('77, 78');
    expect(out.error).toContain('no existen en la tienda');
    expect(out.next_step).toBeDefined();
  });
});

describe('catalog-taxonomy.tools · marcas', () => {
  function build(overrides: Record<string, jest.Mock> = {}) {
    const service = {
      findAll: jest.fn().mockResolvedValue({
        data: [{ id: 4, name: 'Nike', state: 'active', product_count: 7 }],
        meta: { total: 1 },
      }),
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 4, name: 'Nike', state: 'active' }),
      getProductIds: jest
        .fn()
        .mockResolvedValue({ product_ids: [10, 11], total: 2 }),
      previewAssignProducts: jest.fn().mockResolvedValue({
        already_in_brand: 1,
        without_brand: 1,
        to_move: [],
      }),
      assignProducts: jest.fn().mockResolvedValue({
        added: 2,
        removed: 0,
        unchanged: 1,
        moved_from_brands: [],
      }),
      ...overrides,
    };
    const tools = createBrandTools({ brandsService: service as any });
    return { service, tools };
  }

  it('declara nombres, permisos y categorías correctas', () => {
    const { tools } = build();
    const list = byName(tools, 'list_brands');
    const assign = byName(tools, 'assign_products_to_brand');
    expect(list.readOnly).toBe(true);
    expect(list.requiredPermissions).toEqual(['store:brands:read']);
    expect(assign.requiresConfirmation).toBe(true);
    expect(assign.requiredPermissions).toEqual(['store:brands:update']);
    expect(typeof assign.preview).toBe('function');
    expect(assign.description).toContain('list_brands');
  });

  it('list_brands mapea product_count', async () => {
    const { tools } = build();
    const out = json(await byName(tools, 'list_brands').handler!({}, CTX));
    expect(out.brands).toEqual([
      { id: 4, name: 'Nike', state: 'active', product_count: 7 },
    ]);
    expect(out.total).toBe(1);
  });

  it('preview sin movimientos queda ok', async () => {
    const { service, tools } = build();
    const preview = await byName(tools, 'assign_products_to_brand').preview!(
      { brand_name: 'nike', mode: 'add', product_ids: [10, 20] },
      CTX,
    );
    expect(service.previewAssignProducts).toHaveBeenCalledWith(4, {
      product_ids: [10, 20],
    });
    expect(preview.status).toBe('ok');
    expect(preview.target).toBe('Marca Nike');
  });

  it('preview con to_move expone el aviso de productos que dejan otra marca', async () => {
    const { tools } = build({
      previewAssignProducts: jest.fn().mockResolvedValue({
        already_in_brand: 0,
        without_brand: 1,
        to_move: [
          { brand_id: 9, brand_name: 'Adidas', count: 3, product_ids: [1, 2, 3] },
        ],
      }),
    });
    const preview = await byName(tools, 'assign_products_to_brand').preview!(
      { brand_id: 4, mode: 'add', product_ids: [1, 2, 3, 4] },
      CTX,
    );
    expect(preview.status).toBe('warning');
    expect(preview.message).toContain('3 productos dejarán la marca Adidas');
    expect(preview.changes).toContainEqual({
      field: 'moved_from_brand_9',
      label: 'Productos que dejan la marca Adidas',
      from: 3,
      to: 0,
    });
  });

  it('preview remove usa getProductIds', async () => {
    const { tools } = build();
    const preview = await byName(tools, 'assign_products_to_brand').preview!(
      { brand_id: 4, mode: 'remove', product_ids: [10, 99] },
      CTX,
    );
    expect(preview.changes[0]).toMatchObject({ from: 2, to: 1 });
    expect(preview.message).toContain('Quedarán sin marca');
  });

  it('handler llama al servicio con el dto correcto y reporta moved_from_brands', async () => {
    const moved = [{ brand_id: 9, brand_name: 'Adidas', count: 2 }];
    const { service, tools } = build({
      assignProducts: jest.fn().mockResolvedValue({
        added: 3,
        removed: 0,
        unchanged: 0,
        moved_from_brands: moved,
      }),
    });
    const out = json(
      await byName(tools, 'assign_products_to_brand').handler!(
        { brand_id: 4, mode: 'add', product_ids: [1, 2, 3] },
        CTX,
      ),
    );
    const [id, dto] = service.assignProducts.mock.calls[0];
    expect(id).toBe(4);
    expect(dto).toMatchObject({ action: 'add', product_ids: [1, 2, 3] });
    expect(out.data).toEqual({
      brand: { id: 4, name: 'Nike' },
      added: 3,
      removed: 0,
      unchanged: 0,
      moved_from_brands: moved,
    });
    expect(out.summary).toContain('2 productos dejaron la marca Adidas');
  });

  it('marca archivada se trata como inexistente', async () => {
    const { service, tools } = build({
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 4, name: 'Nike', state: 'archived' }),
    });
    const out = json(
      await byName(tools, 'assign_products_to_brand').handler!(
        { brand_id: 4, mode: 'add', product_ids: [1] },
        CTX,
      ),
    );
    expect(out.error).toContain('no existe o está archivada');
    expect(service.assignProducts).not.toHaveBeenCalled();
  });

  it('traduce BRAND_FIND_001 y PROD_FIND_001', async () => {
    const notFound = build({
      assignProducts: jest
        .fn()
        .mockRejectedValue(new VendixHttpException(ErrorCodes.BRAND_FIND_001)),
    });
    const a = json(
      await byName(notFound.tools, 'assign_products_to_brand').handler!(
        { brand_id: 4, mode: 'add', product_ids: [1] },
        CTX,
      ),
    );
    expect(a.error).toContain('La marca ya no existe');
    expect(a.next_step).toBeDefined();

    const invalid = build({
      assignProducts: jest.fn().mockRejectedValue(
        new VendixHttpException(ErrorCodes.PROD_FIND_001, undefined, {
          invalid_product_ids: [5],
        }),
      ),
    });
    const b = json(
      await byName(invalid.tools, 'assign_products_to_brand').handler!(
        { brand_id: 4, mode: 'add', product_ids: [1, 5] },
        CTX,
      ),
    );
    expect(b.error).toContain('Estos productos no existen en la tienda: 5');
  });
});
