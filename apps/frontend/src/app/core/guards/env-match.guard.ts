import { CanMatchFn, Route, UrlSegment } from '@angular/router';
import { inject } from '@angular/core';
import { TenantConfigService } from '../services/tenant-config.service';
import { AppEnvironment } from '../models/domain-config.interface';

/** Generic canMatch that checks current AppEnvironment against route.data.environments */
export const EnvMatchGuard: CanMatchFn = (
  route: Route,
  _segments: UrlSegment[]
) => {
  const tenantCfg = inject(TenantConfigService);
  const dc = tenantCfg.getCurrentDomainConfig();
  const currentEnv = dc?.environment;
  const allowed = (route.data?.['environments'] ?? []) as AppEnvironment[];
  if (!currentEnv || !Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.includes(currentEnv);
};
