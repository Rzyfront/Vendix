import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRecipeItemDto } from './create-recipe-item.dto';
import { UpdateRecipeItemDto } from './update-recipe-item.dto';
import { RecipeItemInputDto } from './replace-recipe-items.dto';

/**
 * `notes` > 500 caracteres debe devolver 400 (error de validación), no
 * guardarse recortado en silencio.
 */
describe.each([
  ['CreateRecipeItemDto', CreateRecipeItemDto, { component_product_id: 1, quantity: 1 }],
  ['UpdateRecipeItemDto', UpdateRecipeItemDto, {}],
  ['RecipeItemInputDto', RecipeItemInputDto, { component_product_id: 1, quantity: 1 }],
])('%s · notes', (_name, Dto, base) => {
  const errorsFor = async (notes: unknown) => {
    const dto = plainToInstance(Dto as any, { ...base, notes });
    const errors = await validate(dto as object);
    return { dto: dto as any, notes: errors.filter((e) => e.property === 'notes') };
  };

  it('rechaza más de 500 caracteres con error de MaxLength', async () => {
    const { notes } = await errorsFor('a'.repeat(501));
    expect(notes).toHaveLength(1);
    expect(notes[0].constraints).toHaveProperty('maxLength');
  });

  it('acepta 500 caracteres y recorta espacios', async () => {
    const { dto, notes } = await errorsFor(`  ${'a'.repeat(500)}  `);
    expect(notes).toHaveLength(0);
    expect(dto.notes).toHaveLength(500);
  });

  it('vacío o solo espacios queda en null', async () => {
    const { dto, notes } = await errorsFor('   ');
    expect(notes).toHaveLength(0);
    expect(dto.notes).toBeNull();
  });
});
