export interface HelpCategory {
  id: number;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  sort_order: number;
  is_active: boolean;
  _count?: {
    articles: number;
  };
}

export interface HelpArticle {
  id: number;
  title: string;
  slug: string;
  summary: string;
  content: string;
  type: 'TUTORIAL' | 'FAQ' | 'GUIDE' | 'ANNOUNCEMENT' | 'RELEASE_NOTE';
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  category_id: number;
  category: Pick<HelpCategory, 'id' | 'name' | 'slug' | 'icon'>;
  module?: string;
  tags: string[];
  cover_image_url?: string;
  view_count: number;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface HelpArticlesResponse {
  data: HelpArticle[];
  meta: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}
