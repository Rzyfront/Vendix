import { VexBlockListComponent } from './vex-block-list.component';
import { VexBlockTableComponent } from './vex-block-table.component';
import { VexBlockTimelineComponent } from './vex-block-timeline.component';
import { VexBlockUnknownComponent } from './vex-block-unknown.component';
import { resolveVexBlockComponent } from './vex-block-registry';

describe('resolveVexBlockComponent', () => {
  it('maps known kinds to their component', () => {
    expect(resolveVexBlockComponent('table')).toBe(VexBlockTableComponent);
    expect(resolveVexBlockComponent('timeline')).toBe(VexBlockTimelineComponent);
    expect(resolveVexBlockComponent('list')).toBe(VexBlockListComponent);
  });

  it('falls back to the notice component for an unknown kind, never undefined', () => {
    expect(resolveVexBlockComponent('hologram')).toBe(VexBlockUnknownComponent);
    expect(resolveVexBlockComponent('')).toBe(VexBlockUnknownComponent);
    expect(resolveVexBlockComponent('constructor')).toBe(VexBlockUnknownComponent);
  });
});
