import { Injectable } from '@nestjs/common';

/**
 * Domain Config Standardizer Helper
 * 
 * Ensures all domain configurations follow the same structure,
 * preventing visual tokens from leaking into the root of the config object.
 */
@Injectable()
export class DomainConfigStandardizerHelper {
  /**
   * Standardizes a domain configuration object.
   * Moves orphan visual tokens from root to the branding object.
   * 
   * @param config The raw configuration object from database or DTO
   * @param appType The application type (e.g., 'STORE_ECOMMERCE', 'ORG_LANDING')
   */
  standardize(config: any, appType: string): any {
    if (!config) return { app: appType };

    // Separate branding from the rest of the config
    const { branding, ...rest } = config;

    // 1. Identify visual tokens that might be at the root
    const rootVisualTokens: any = {};
    const visualKeys = [
      'primary_color', 'secondary_color', 'accent_color', 
      'background_color', 'surface_color', 'text_color', 
      'border_color', 'text_secondary_color', 'text_muted_color',
      'logo_url', 'favicon_url', 'theme', 'name'
    ];

    visualKeys.forEach(key => {
      if (rest[key] !== undefined) {
        rootVisualTokens[key] = rest[key];
        delete rest[key]; // Clean the root
      }
    });

    // 2. Merge existing branding with root tokens
    // Root tokens take priority if they were explicitly sent in the DTO
    const finalBranding = {
      ...(branding || {}),
      ...rootVisualTokens
    };

    // 3. Build the standardized config
    const standardized: any = {
      ...rest,
      app: appType
    };

    // Only add branding if it's not empty
    if (Object.keys(finalBranding).length > 0) {
      standardized.branding = finalBranding;
    }

    return standardized;
  }
}
