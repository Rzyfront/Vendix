import { ValidationPipe } from '@nestjs/common';
import { ProductQueryDto } from './index';

/**
 * QUI-729 (D.1) — coerción de `ProductQueryDto.is_ingredient`.
 *
 * El test corre CONTRA EL PIPE REAL, no contra el DTO aislado. Un
 * `plainToInstance(ProductQueryDto, { is_ingredient: 'false' })` sin
 * `enableImplicitConversion` devuelve `false` y pasa en verde AUNQUE el
 * `@Transform` esté roto: es el falso positivo que este spec existe para
 * impedir.
 *
 * El `ValidationPipe` de `main.ts` (`main.ts:203-209`) usa
 * `transformOptions: { enableImplicitConversion: true }`. Con esa flag,
 * class-transformer coacciona `is_ingredient` a boolean ANTES del
 * `@Transform`, de modo que un `@Transform(({ value }) => value === 'true')`
 * recibe `true`/`false` ya convertidos y `?is_ingredient=false` —que debería
 * filtrar a favor de los productos— devuelve insumos. La única forma de
 * capturarlo es construir el pipe con las MISMAS opciones y pasar la cadena
 * cruda `'false'`.
 */
describe('ProductQueryDto.is_ingredient (ValidationPipe real)', () => {
  // Réplica exacta de las opciones del pipe global de main.ts.
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  });

  const transform = (payload: Record<string, unknown>) =>
    pipe.transform(payload, { type: 'query', metatype: ProductQueryDto });

  it("coacciona la cadena 'false' a boolean false (el bug que D.1 cierra)", async () => {
    const result = await transform({ is_ingredient: 'false' });
    // Con el @Transform roto (leyendo `value` ya coaccionado), este valor
    // sería `true` porque Boolean('false') === true. Test debe fallar así.
    expect(result.is_ingredient).toBe(false);
  });

  it("coacciona la cadena 'true' a boolean true", async () => {
    const result = await transform({ is_ingredient: 'true' });
    expect(result.is_ingredient).toBe(true);
  });

  it('omite is_ingredient cuando el parámetro no viene (tercer estado "Todos")', async () => {
    const result = await transform({});
    expect(result.is_ingredient).toBeUndefined();
  });

  it('trata la cadena vacía como ausencia (no como false explícito)', async () => {
    const result = await transform({ is_ingredient: '' });
    expect(result.is_ingredient).toBeUndefined();
  });

  it('conserva un booleano real del cuerpo JSON', async () => {
    const result = await transform({ is_ingredient: true });
    expect(result.is_ingredient).toBe(true);
  });

  it('deja intactos los defaults del resto del catálogo (page/limit)', async () => {
    const result = await transform({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
  });
});
