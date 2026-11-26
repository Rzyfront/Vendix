import { validate } from 'class-validator';
import { CreateAIConfigDto } from './create-ai-config.dto';
import { UpdateAIConfigDto } from './update-ai-config.dto';

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

  it('accepts an https base URL on an allowed provider host', async () => {
    await expect(
      validate(buildDto('https://openrouter.ai/api/v1')),
    ).resolves.toHaveLength(0);
  });

  describe('base_url SSRF guard (B2, PR #1428)', () => {
    const saved = process.env.AI_ENGINE_ALLOWED_HOSTS;
    afterEach(() => {
      if (saved === undefined) delete process.env.AI_ENGINE_ALLOWED_HOSTS;
      else process.env.AI_ENGINE_ALLOWED_HOSTS = saved;
    });

    it.each([
      ['cloud metadata over http', 'http://169.254.169.254/latest'],
      ['cloud metadata over https', 'https://169.254.169.254/latest'],
      ['localhost over https', 'https://localhost/v1'],
      ['local Ollama (previously accepted)', 'http://localhost:11434/v1'],
      ['an .internal name', 'https://metadata.google.internal/'],
      ['a private IP', 'https://192.168.1.10/v1'],
      ['an unknown external host', 'https://attacker.example.com/v1'],
      ['an allowed host over http', 'http://api.openai.com/v1'],
      ['an allowed host with credentials', 'https://user:pass@openrouter.ai/api/v1'],
    ])('rejects %s (%s)', async (_label, url) => {
      const errors = await validate(buildDto(url));
      expect(errors.map((e) => e.property)).toContain('base_url');
    });

    it('rejects private names even when the deployment lists them', async () => {
      process.env.AI_ENGINE_ALLOWED_HOSTS = 'localhost,gw.example.com';
      const errors = await validate(buildDto('https://localhost/v1'));
      expect(errors.map((e) => e.property)).toContain('base_url');
    });

    it('accepts a host the deployment adds with AI_ENGINE_ALLOWED_HOSTS', async () => {
      process.env.AI_ENGINE_ALLOWED_HOSTS = 'gw.example.com';
      await expect(
        validate(buildDto('https://gw.example.com/v1')),
      ).resolves.toHaveLength(0);
    });

    it('applies to updates too (PartialType keeps the validator)', async () => {
      const dto = new UpdateAIConfigDto();
      dto.base_url = 'https://169.254.169.254/latest';
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('base_url');
    });
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
      const dto = buildDto('https://openrouter.ai/api/v1');
      dto.model_type = 'image';

      await expect(validate(dto)).resolves.toHaveLength(0);
    });

    it('rejects an invalid model_type like foobar', async () => {
      const dto = buildDto('https://openrouter.ai/api/v1');
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
      const dto = buildDto('https://openrouter.ai/api/v1');
      // model_type intentionally omitted.

      await expect(validate(dto)).resolves.toHaveLength(0);
    });
  });

  describe('settings', () => {
    it('accepts a multimodal config with image transport and capabilities', async () => {
      const dto = buildDto('https://openrouter.ai/api/v1');
      dto.model_type = 'image';
      dto.settings = {
        image_generation_mode: 'images_api',
        capabilities: ['text'],
      };

      await expect(validate(dto)).resolves.toHaveLength(0);
    });

    it('rejects an unknown image_generation_mode', async () => {
      const dto = buildDto('https://openrouter.ai/api/v1');
      dto.settings = { image_generation_mode: 'telepathy' } as any;

      const errors = await validate(dto);

      expect(errors.find((e) => e.property === 'settings')).toBeDefined();
    });

    it('rejects capabilities that are not unique model types', async () => {
      const dto = buildDto('https://openrouter.ai/api/v1');
      dto.settings = { capabilities: ['text', 'text'] } as any;

      const errors = await validate(dto);

      expect(errors.find((e) => e.property === 'settings')).toBeDefined();
    });

    it('rejects an empty capabilities array — single-type configs omit the key', async () => {
      const dto = buildDto('https://openrouter.ai/api/v1');
      dto.settings = { capabilities: [] } as any;

      const errors = await validate(dto);

      expect(errors.find((e) => e.property === 'settings')).toBeDefined();
    });
  });
});
