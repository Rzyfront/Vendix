import { validate } from 'class-validator';
import { CreateAIConfigDto } from './create-ai-config.dto';

describe('CreateAIConfigDto', () => {
  const buildDto = (baseUrl: string | null): CreateAIConfigDto => {
    const dto = new CreateAIConfigDto();
    dto.provider = 'Ollama';
    dto.sdk_type = 'openai_compatible';
    dto.label = 'Local Ollama';
    dto.model_id = 'llama3';
    dto.base_url = baseUrl;
    return dto;
  };

  it('accepts localhost base URLs with an explicit protocol', async () => {
    await expect(
      validate(buildDto('http://localhost:11434/v1')),
    ).resolves.toHaveLength(0);
  });

  it('accepts null so updates can clear the base URL', async () => {
    await expect(validate(buildDto(null))).resolves.toHaveLength(0);
  });

  it('rejects text that is not a URL', async () => {
    const errors = await validate(buildDto('not a url'));

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('base_url');
  });

  describe('model_type', () => {
    it('accepts a valid model_type from the enum (e.g. image)', async () => {
      const dto = buildDto('http://localhost:11434/v1');
      dto.model_type = 'image';

      await expect(validate(dto)).resolves.toHaveLength(0);
    });

    it('rejects an invalid model_type like foobar', async () => {
      const dto = buildDto('http://localhost:11434/v1');
      // Force an invalid value through the API surface to exercise @IsIn.
      (dto as any).model_type = 'foobar';

      const errors = await validate(dto);

      const modelTypeError = errors.find((e) => e.property === 'model_type');
      expect(modelTypeError).toBeDefined();
      expect(modelTypeError?.constraints).toEqual(
        expect.objectContaining({ isIn: expect.any(String) }),
      );
    });

    it('treats model_type as optional — DTO with no model_type validates clean', async () => {
      const dto = buildDto('http://localhost:11434/v1');
      // model_type intentionally omitted.

      await expect(validate(dto)).resolves.toHaveLength(0);
    });
  });
});
