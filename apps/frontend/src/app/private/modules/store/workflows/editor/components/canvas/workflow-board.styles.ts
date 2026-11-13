/**
 * Board look shared by the canvas and the route map: dotted grid, soft edges
 * and haloed edge labels. Theme tokens only, so it follows brand and dark mode.
 */
export const WORKFLOW_BOARD_STYLES = `
  .wf-board {
    background-color: color-mix(in srgb, var(--color-background) 60%, var(--color-surface));
    background-image: radial-gradient(
      color-mix(in srgb, var(--color-text-secondary) 28%, transparent) 1px,
      transparent 1px
    );
    background-size: 18px 18px;
  }
  .wf-edge {
    stroke: color-mix(in srgb, var(--color-text-secondary) 70%, transparent);
  }
  .wf-arrow {
    fill: color-mix(in srgb, var(--color-text-secondary) 85%, transparent);
  }
  .wf-edge-label {
    fill: var(--color-text-secondary);
    stroke: var(--color-surface);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .wf-edge-label.is-active {
    fill: var(--color-primary);
  }
`;
