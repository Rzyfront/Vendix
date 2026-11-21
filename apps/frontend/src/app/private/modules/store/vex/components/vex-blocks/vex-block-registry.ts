import type { Type } from '@angular/core';
import { VexBlockChartComponent } from './vex-block-chart.component';
import { VexBlockFileComponent } from './vex-block-file.component';
import { VexBlockHelpArticleComponent } from './vex-block-help-article.component';
import { VexBlockImageComponent } from './vex-block-image.component';
import { VexBlockKpiComponent } from './vex-block-kpi.component';
import { VexBlockLearningPathComponent } from './vex-block-learning-path.component';
import { VexBlockListComponent } from './vex-block-list.component';
import { VexBlockMarkdownComponent } from './vex-block-markdown.component';
import { VexBlockTableComponent } from './vex-block-table.component';
import { VexBlockTimelineComponent } from './vex-block-timeline.component';
import { VexBlockUnknownComponent } from './vex-block-unknown.component';
import { VexBlockVideoComponent } from './vex-block-video.component';

/**
 * `kind → component`. Every entry takes a `block` input; interactive ones
 * (table, chart) also expose an `interaction` output the host forwards.
 * Adding a block kind = one new component + one line here.
 */
export const VEX_BLOCK_REGISTRY: Readonly<Record<string, Type<unknown>>> = {
  table: VexBlockTableComponent,
  chart: VexBlockChartComponent,
  kpi: VexBlockKpiComponent,
  image: VexBlockImageComponent,
  file: VexBlockFileComponent,
  markdown: VexBlockMarkdownComponent,
  timeline: VexBlockTimelineComponent,
  list: VexBlockListComponent,
  help_article: VexBlockHelpArticleComponent,
  video: VexBlockVideoComponent,
  learning_path: VexBlockLearningPathComponent,
};

/** Never returns `undefined`: unknown kinds get the notice component. */
export function resolveVexBlockComponent(kind: string): Type<unknown> {
  return Object.prototype.hasOwnProperty.call(VEX_BLOCK_REGISTRY, kind)
    ? VEX_BLOCK_REGISTRY[kind]
    : VexBlockUnknownComponent;
}
