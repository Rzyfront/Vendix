export interface ArticleStats {
  total: number;
  published: number;
  draft: number;
  archived: number;
  total_views: number;
}

export interface CreateArticleDto {
  title: string;
  summary: string;
  content: string;
  type: string;
  status?: string;
  category_id: number;
  module?: string;
  tags?: string[];
  cover_image_url?: string;
  is_featured?: boolean;
  sort_order?: number;
}

export interface UpdateArticleDto extends Partial<CreateArticleDto> {}

export interface CreateCategoryDto {
  name: string;
  description?: string;
  icon?: string;
  sort_order?: number;
  is_active?: boolean;
}

export interface UpdateCategoryDto extends Partial<CreateCategoryDto> {}
