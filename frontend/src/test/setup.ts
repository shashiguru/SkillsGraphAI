import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { vi } from 'vitest';

// Cytoscape needs a real canvas. The stub renders the element list it was given so tests can assert on
// exactly which graph nodes and edges reach the renderer.
vi.mock('react-cytoscapejs', () => ({
  default: ({ elements }: { elements: { data: { id: string; label?: string; source?: string } }[] }) => {
    const nodes = elements.filter((e) => !e.data.source);
    const edges = elements.filter((e) => e.data.source);
    return createElement(
      'div',
      { 'data-testid': 'cytoscape', 'data-nodes': nodes.length, 'data-edges': edges.length },
      nodes.map((n) => createElement('span', { key: n.data.id, 'data-testid': 'cy-node' }, n.data.label)),
    );
  },
}));

// Recharts' ResponsiveContainer measures its parent, which has no layout in a test DOM.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
