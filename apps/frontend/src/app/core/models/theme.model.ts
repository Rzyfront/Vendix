export interface StoreTheme {
  store_id: string;
  subdomain: string;
  custom_domain?: string;
  theme: {
    theme_name: string;
    colors: {
      background: string;
      primary: string;
      secondary: string;
      text_primary: string;
      border: string;
    };
    font: string;
    components: {
      button_radius: string;
    };
  };
  branding: {
    logo_url: string;
    favicon_url: string;
  };
  store_name: string;
}

export interface ThemeConfig {
  store_id: string;
  theme: StoreTheme;
  isLoaded: boolean;
}
