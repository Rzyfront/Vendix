import { WompiConfigValidator } from './wompi-config.validator';

export const CONFIG_VALIDATORS: Record<string, new () => any> = {
  wompi: WompiConfigValidator,
};
