import { SetMetadata } from '@nestjs/common';

export const INDUSTRY_MODULE_KEY = 'industry_module_key';

/**
 * Declares which panel module key (see `MODULE_INDUSTRIES`) a controller or
 * handler belongs to. Read by `IndustryModuleGuard`.
 */
export const IndustryModule = (key: string) =>
  SetMetadata(INDUSTRY_MODULE_KEY, key);
