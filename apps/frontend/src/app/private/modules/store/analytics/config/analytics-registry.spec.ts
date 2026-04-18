import {
  ANALYTICS_CATEGORIES,
  ANALYTICS_VIEWS,
  getViewsByCategory,
  getCategoryById,
  getViewByKey,
  getDefaultViewForCategory,
  getSidebarEntries,
  type AnalyticsCategoryId,
} from './analytics-registry';

describe('AnalyticsRegistry', () => {
  describe('ANALYTICS_CATEGORIES', () => {
    it('should have 8 categories', () => {
      expect(ANALYTICS_CATEGORIES).toHaveSize(8);
    });

    it('should have all required category ids', () => {
      const expectedIds: AnalyticsCategoryId[] = [
        'overview', 'sales', 'inventory', 'products',
        'purchases', 'customers', 'reviews', 'financial',
      ];
      const actualIds = ANALYTICS_CATEGORIES.map(c => c.id);
      expect(actualIds).toEqual(expectedIds);
    });

    it('should have valid panelUiKey for each category', () => {
      ANALYTICS_CATEGORIES.forEach(category => {
        expect(category.panelUiKey).toMatch(/^analytics_/);
        expect(category.icon).toBeTruthy();
        expect(category.color).toBeTruthy();
      });
    });
  });

  describe('ANALYTICS_VIEWS', () => {
    it('should have 26 views', () => {
      expect(ANALYTICS_VIEWS).toHaveSize(26);
    });

    it('should have unique keys', () => {
      const keys = ANALYTICS_VIEWS.map(v => v.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it('should have valid routes for all views', () => {
      ANALYTICS_VIEWS.forEach(view => {
        expect(view.route).toMatch(/^\/admin\/analytics\//);
        expect(view.category).toBeTruthy();
      });
    });

    it('should have overview with 1 view', () => {
      const overviewViews = getViewsByCategory('overview');
      expect(overviewViews).toHaveSize(1);
    });

    it('should have sales with 6 views', () => {
      const salesViews = getViewsByCategory('sales');
      expect(salesViews).toHaveSize(6);
    });

    it('should have inventory with 5 views', () => {
      const inventoryViews = getViewsByCategory('inventory');
      expect(inventoryViews).toHaveSize(5);
    });
  });

  describe('getViewsByCategory', () => {
    it('should return views for sales category', () => {
      const views = getViewsByCategory('sales');
      expect(views.length).toBeGreaterThan(0);
      views.forEach(v => expect(v.category).toBe('sales'));
    });

    it('should return empty array for non-existent category', () => {
      const views = getViewsByCategory('nonexistent' as AnalyticsCategoryId);
      expect(views).toEqual([]);
    });
  });

  describe('getCategoryById', () => {
    it('should return category for valid id', () => {
      const category = getCategoryById('sales');
      expect(category?.id).toBe('sales');
      expect(category?.label).toBe('Ventas');
    });

    it('should return undefined for invalid id', () => {
      const category = getCategoryById('invalid' as AnalyticsCategoryId);
      expect(category).toBeUndefined();
    });
  });

  describe('getViewByKey', () => {
    it('should return view for valid key', () => {
      const view = getViewByKey('sales_summary');
      expect(view?.key).toBe('sales_summary');
      expect(view?.category).toBe('sales');
    });

    it('should return undefined for invalid key', () => {
      const view = getViewByKey('invalid_key');
      expect(view).toBeUndefined();
    });
  });

  describe('getDefaultViewForCategory', () => {
    it('should return first view for category', () => {
      const defaultView = getDefaultViewForCategory('sales');
      expect(defaultView).toBeDefined();
      expect(defaultView?.category).toBe('sales');
    });

    it('should return undefined for invalid category', () => {
      const defaultView = getDefaultViewForCategory('invalid' as AnalyticsCategoryId);
      expect(defaultView).toBeUndefined();
    });
  });

  describe('getSidebarEntries', () => {
    it('should return entries for all categories', () => {
      const entries = getSidebarEntries();
      expect(entries).toHaveSize(8);
    });

    it('should have valid route, icon, and panelUiKey for each entry', () => {
      const entries = getSidebarEntries();
      entries.forEach(entry => {
        expect(entry.route).toMatch(/^\/admin\/analytics\//);
        expect(entry.icon).toBeTruthy();
        expect(entry.panelUiKey).toMatch(/^analytics_/);
        expect(entry.viewCount).toBeGreaterThan(0);
      });
    });

    it('should have correct view counts', () => {
      const entries = getSidebarEntries();
      const salesEntry = entries.find(e => e.label === 'Ventas');
      expect(salesEntry?.viewCount).toBe(6);
    });
  });
});
