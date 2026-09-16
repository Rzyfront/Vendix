import { validate } from 'class-validator';
import {
  CreateAIAppDto,
  AI_APP_FEATURE_CATEGORIES,
} from './create-ai-app.dto';

describe('CreateAIAppDto ai_feature_category (F1)', () => {
  const buildDto = (): CreateAIAppDto => {
    const dto = new CreateAIAppDto();
    dto.key = 'test_app';
    dto.name = 'Test App';
    dto.ai_feature_category = 'text_generation';
    return dto;
  };

  it('accepts each of the 7 canonical feature keys', async () => {
    expect(AI_APP_FEATURE_CATEGORIES).toHaveLength(7);

    for (const category of AI_APP_FEATURE_CATEGORIES) {
      const dto = buildDto();
      dto.ai_feature_category = category;

      await expect(validate(dto)).resolves.toHaveLength(0);
    }
  });

  it('rejects a missing ai_feature_category (400 surface)', async () => {
    const dto = buildDto();
    // Simulate a client that omits the field entirely.
    delete (dto as any).ai_feature_category;

    const errors = await validate(dto);

    expect(
      errors.find((e) => e.property === 'ai_feature_category'),
    ).toBeDefined();
  });

  it('rejects an invalid ai_feature_category like foobar', async () => {
    const dto = buildDto();
    (dto as any).ai_feature_category = 'foobar';

    const errors = await validate(dto);

    const categoryError = errors.find(
      (e) => e.property === 'ai_feature_category',
    );
    expect(categoryError).toBeDefined();
    expect(categoryError?.constraints).toEqual(
      expect.objectContaining({ isIn: expect.any(String) }),
    );
  });

  it('rejects the legacy null category left by pre-F1 rows', async () => {
    const dto = buildDto();
    (dto as any).ai_feature_category = null;

    const errors = await validate(dto);

    expect(
      errors.find((e) => e.property === 'ai_feature_category'),
    ).toBeDefined();
  });
});
