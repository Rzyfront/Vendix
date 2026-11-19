import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HomePanelSettingsDto } from './home-panel-settings.dto';
import { UpdateSettingsDto } from './update-settings.dto';

const check = async (payload: unknown) =>
  validate(plainToInstance(HomePanelSettingsDto, payload));

describe('HomePanelSettingsDto (QUI-967)', () => {
  it('acepta un panel de inicio incluido en los habilitados', async () => {
    expect(
      await check({
        default_panel: 'occupancy',
        enabled_panels: ['occupancy', 'summary', 'crm_pipeline'],
      }),
    ).toHaveLength(0);
  });

  it('rechaza un default_panel fuera del catálogo', async () => {
    const errors = await check({
      default_panel: 'widgets',
      enabled_panels: ['summary'],
    });
    expect(errors.map((e) => e.property)).toContain('default_panel');
  });

  it('rechaza ids de enabled_panels fuera del catálogo', async () => {
    const errors = await check({
      default_panel: 'summary',
      enabled_panels: ['summary', 'kanban_libre'],
    });
    expect(errors.map((e) => e.property)).toContain('enabled_panels');
  });

  it('rechaza un default_panel no incluido en enabled_panels', async () => {
    const errors = await check({
      default_panel: 'crm_pipeline',
      enabled_panels: ['summary'],
    });
    const error = errors.find((e) => e.property === 'default_panel');
    expect(error?.constraints).toEqual(
      expect.objectContaining({
        homePanelDefaultEnabled:
          'El panel de inicio debe estar entre los paneles habilitados',
      }),
    );
  });

  it('rechaza enabled_panels vacío o con repetidos', async () => {
    expect(
      (await check({ default_panel: 'summary', enabled_panels: [] })).map(
        (e) => e.property,
      ),
    ).toContain('enabled_panels');
    expect(
      (
        await check({
          default_panel: 'summary',
          enabled_panels: ['summary', 'summary'],
        })
      ).map((e) => e.property),
    ).toContain('enabled_panels');
  });

  it('UpdateSettingsDto valida la sección anidada home_panel', async () => {
    const errors = await validate(
      plainToInstance(UpdateSettingsDto, {
        home_panel: { default_panel: 'production', enabled_panels: ['summary'] },
      }),
    );
    expect(errors.map((e) => e.property)).toContain('home_panel');
    expect(
      await validate(
        plainToInstance(UpdateSettingsDto, {
          home_panel: {
            default_panel: 'production',
            enabled_panels: ['production', 'summary'],
          },
        }),
      ),
    ).toHaveLength(0);
  });
});
