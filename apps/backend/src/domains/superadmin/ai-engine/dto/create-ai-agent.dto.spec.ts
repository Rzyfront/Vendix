import { validate } from 'class-validator';
import { CreateAIAgentDto } from './create-ai-agent.dto';
import { UpdateAIAgentDto } from './update-ai-agent.dto';

describe('CreateAIAgentDto (F4)', () => {
  const buildDto = (): CreateAIAgentDto => {
    const dto = new CreateAIAgentDto();
    dto.key = 'soporte-menu';
    dto.name = 'Soporte de carta';
    return dto;
  };

  it('accepts the plan verification key soporte-menu', async () => {
    await expect(validate(buildDto())).resolves.toHaveLength(0);
  });

  it('accepts vexi and a fully-populated agent', async () => {
    const dto = buildDto();
    dto.key = 'vexi';
    dto.description = 'Default assistant';
    dto.app_key = 'chat_assistant';
    dto.system_prompt = 'Sé breve.';
    dto.allowed_tools = ['search_products'];
    dto.max_iterations = 10;
    dto.requires_confirmation_default = false;
    dto.is_active = true;

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects snake_case and uppercase keys (kebab-case only)', async () => {
    for (const key of ['soporte_menu', 'Soporte-Menu', 'soporte menu']) {
      const dto = buildDto();
      dto.key = key;

      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'key')).toBeDefined();
    }
  });

  it('rejects max_iterations outside 1..50', async () => {
    for (const max_iterations of [0, 51]) {
      const dto = buildDto();
      dto.max_iterations = max_iterations;

      const errors = await validate(dto);
      expect(
        errors.find((e) => e.property === 'max_iterations'),
      ).toBeDefined();
    }
  });

  it('accepts explicit nulls for clearable references (unlink flow)', async () => {
    const dto = new UpdateAIAgentDto();
    dto.app_key = null;
    dto.system_prompt = null;
    dto.max_iterations = null;

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
