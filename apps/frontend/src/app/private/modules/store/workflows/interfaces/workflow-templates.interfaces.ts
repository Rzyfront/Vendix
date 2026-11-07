/** One stage of a template as the gallery previews it. */
export interface WorkflowTemplateStage {
  key: string;
  name: string;
  type: string;
}

/** Gallery card: a template without its full definition. */
export interface WorkflowTemplateSummary {
  key: string;
  name: string;
  category: string;
  description: string;
  /** Registered Lucide icon name. */
  icon: string;
  stage_count: number;
  stages: WorkflowTemplateStage[];
}

/** Result of activating a template: the flow created and published in the store. */
export interface WorkflowTemplateActivation {
  id: number;
  key: string;
  name: string;
  version: number;
  source_template_key: string;
}
