import { useEffect, useMemo, useRef } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import type cytoscape from 'cytoscape';
import type { CareerGraph, CytoNode } from '@/types/api';

export const STATUS_STYLE: Record<NonNullable<CytoNode['status']>, { color: string; label: string }> = {
  user: { color: '#2563eb', label: 'You' },
  existing: { color: '#16a34a', label: 'Existing skill' },
  missing: { color: '#dc2626', label: 'Missing skill' },
  prerequisite: { color: '#f59e0b', label: 'Prerequisite to learn' },
  implied: { color: '#94a3b8', label: 'Implied / not required' },
  target: { color: '#7c3aed', label: 'Target role' },
  course: { color: '#0891b2', label: 'Course' },
};

const stylesheet: cytoscape.StylesheetJson = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'background-color': 'data(color)',
      color: '#0f172a',
      'font-size': 11,
      'text-valign': 'bottom',
      'text-margin-y': 4,
      'text-wrap': 'wrap',
      'text-max-width': '90px',
      width: 26,
      height: 26,
      'border-width': 2,
      'border-color': '#ffffff',
    },
  },
  { selector: 'node[type = "Role"]', style: { shape: 'round-rectangle', width: 40, height: 32 } },
  { selector: 'node[type = "User"]', style: { shape: 'ellipse', width: 38, height: 38 } },
  { selector: 'node[type = "Course"]', style: { shape: 'diamond', width: 22, height: 22 } },
  {
    selector: 'edge',
    style: {
      width: 1.5,
      'line-color': '#cbd5e1',
      'target-arrow-color': '#cbd5e1',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      label: 'data(label)',
      'font-size': 8,
      color: '#64748b',
      'text-rotation': 'autorotate',
      'text-background-color': '#ffffff',
      'text-background-opacity': 0.85,
    },
  },
  { selector: 'edge[type = "PREREQUISITE_FOR"]', style: { 'line-color': '#f59e0b', 'target-arrow-color': '#f59e0b' } },
  { selector: 'edge[type = "REQUIRES_SKILL"]', style: { 'line-color': '#a78bfa', 'target-arrow-color': '#a78bfa' } },
  { selector: 'edge[type = "HAS_SKILL"]', style: { 'line-color': '#86efac', 'target-arrow-color': '#86efac' } },
  { selector: 'edge[type = "TEACHES"]', style: { 'line-color': '#67e8f9', 'target-arrow-color': '#67e8f9' } },
  { selector: '.dim', style: { opacity: 0.15 } },
  { selector: 'node:selected', style: { 'border-color': '#0f172a', 'border-width': 3 } },
];

export interface GraphViewProps {
  graph: CareerGraph;
  height?: number | string;
  /** Hide edge labels, disable interaction. Used for the dashboard preview. */
  compact?: boolean;
  visibleStatuses?: Set<string>;
  search?: string;
  selectedId?: string | null;
  onSelect?: (nodeId: string | null) => void;
  onReady?: (cy: cytoscape.Core) => void;
}

const EDGE_LABEL: Record<string, string> = {
  HAS_SKILL: 'HAS_SKILL',
  REQUIRES_SKILL: 'REQUIRES',
  PREREQUISITE_FOR: 'PREREQ_FOR',
  TEACHES: 'TEACHES',
};

/** Draws only what Neo4j returned (query K). Visibility filters never add elements. */
export function CareerGraphView({ graph, height = 480, compact = false, visibleStatuses, search = '', selectedId, onSelect, onReady }: GraphViewProps) {
  const cyRef = useRef<cytoscape.Core | null>(null);

  const visibleNodes = useMemo(
    () => graph.nodes.filter((n) => !visibleStatuses || visibleStatuses.has(n.status ?? 'implied')),
    [graph.nodes, visibleStatuses],
  );
  const elements = useMemo(() => {
    const ids = new Set(visibleNodes.map((n) => n.id));
    return [
      ...visibleNodes.map((n) => ({
        data: { id: n.id, label: n.label, type: n.type, status: n.status ?? 'implied', color: STATUS_STYLE[n.status ?? 'implied'].color },
      })),
      ...graph.edges
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e) => ({ data: { id: e.id, source: e.source, target: e.target, type: e.type, label: compact ? '' : (EDGE_LABEL[e.type] ?? e.type) } })),
    ];
  }, [visibleNodes, graph.edges, compact]);

  // Re-mount (and re-layout) whenever the visible element set changes.
  const layoutKey = useMemo(() => elements.map((e) => e.data.id).join('|'), [elements]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const q = search.trim().toLowerCase();
    cy.batch(() => {
      cy.elements().removeClass('dim');
      if (q) {
        const hit = cy.nodes().filter((n) => String(n.data('label')).toLowerCase().includes(q));
        cy.elements().not(hit.union(hit.connectedEdges())).addClass('dim');
      }
    });
  }, [search, layoutKey]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().unselect();
    if (selectedId) cy.getElementById(selectedId).select();
  }, [selectedId, layoutKey]);

  return (
    <CytoscapeComponent
      key={layoutKey}
      elements={elements}
      stylesheet={stylesheet}
      style={{ width: '100%', height }}
      layout={{ name: 'cose', animate: false, fit: true, padding: 24, nodeRepulsion: () => 9000, idealEdgeLength: () => 80 } as cytoscape.LayoutOptions}
      minZoom={0.2}
      maxZoom={3}
      userZoomingEnabled={!compact}
      userPanningEnabled={!compact}
      boxSelectionEnabled={false}
      autoungrabify={compact}
      cy={(cy: cytoscape.Core) => {
        cyRef.current = cy;
        cy.removeAllListeners();
        cy.on('tap', 'node', (evt) => onSelect?.(evt.target.id()));
        cy.on('tap', (evt) => {
          if (evt.target === cy) onSelect?.(null);
        });
        onReady?.(cy);
      }}
    />
  );
}
