import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KnowledgeGraph, { NodeInspector } from './KnowledgeGraph';
import { apiError, demoAnalysis, mockApi, renderWithProviders } from '@/test/utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const routes = () => ({
  'GET /career/history': [{ id: demoAnalysis.id, createdAt: demoAnalysis.createdAt, mode: 'demo', status: 'completed', targetRoleName: 'AI Engineer', matchPercentage: 17, gapSkillCount: 7, estimatedHours: 100 }],
  'GET /career/analysis/*': demoAnalysis,
});

describe('KnowledgeGraph page', () => {
  it('draws exactly the nodes and edges that Neo4j returned', async () => {
    mockApi(routes());
    renderWithProviders(<KnowledgeGraph />);
    const cy = await screen.findByTestId('cytoscape');
    expect(Number(cy.dataset.nodes)).toBe(demoAnalysis.cytoscape!.nodes.length);
    expect(Number(cy.dataset.edges)).toBe(demoAnalysis.cytoscape!.edges.length);
    expect(screen.getByRole('note')).toHaveTextContent('Demo mode');
    expect(screen.getByText(/Select a node/)).toBeInTheDocument();
  });

  it('hides nodes of a type when its filter is turned off and restores them', async () => {
    mockApi(routes());
    renderWithProviders(<KnowledgeGraph />);
    const user = userEvent.setup();
    const cy = await screen.findByTestId('cytoscape');
    const total = Number(cy.dataset.nodes);
    const courses = demoAnalysis.cytoscape!.nodes.filter((n) => n.status === 'course').length;
    expect(courses).toBeGreaterThan(0);

    const chip = screen.getByRole('button', { name: new RegExp(`Course \\(${courses}\\)`) });
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(Number(screen.getByTestId('cytoscape').dataset.nodes)).toBe(total - courses);

    await user.click(chip);
    expect(Number(screen.getByTestId('cytoscape').dataset.nodes)).toBe(total);
  });

  it('offers zoom, fit and search controls', async () => {
    mockApi(routes());
    renderWithProviders(<KnowledgeGraph />);
    await screen.findByTestId('cytoscape');
    for (const name of ['Zoom in', 'Zoom out', 'Fit to screen']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.getByLabelText('Search graph')).toBeInTheDocument();
  });

  it('shows an empty state without an analysis', async () => {
    mockApi({ 'GET /career/history': [] });
    renderWithProviders(<KnowledgeGraph />);
    expect(await screen.findByText('No graph available')).toBeInTheDocument();
  });

  it('shows an error state', async () => {
    mockApi({ 'GET /career/history': () => apiError(503, 'not_configured', 'Neo4j is not configured') });
    renderWithProviders(<KnowledgeGraph />);
    expect(await screen.findByText('Neo4j is not configured')).toBeInTheDocument();
  });
});

describe('NodeInspector', () => {
  const graph = demoAnalysis.cytoscape!;

  it('prompts when nothing is selected', () => {
    render(<NodeInspector graph={graph} nodeId={null} />);
    expect(screen.getByText(/Select a node/)).toBeInTheDocument();
  });

  it('lists the relationships of the selected node', () => {
    const target = graph.nodes.find((n) => n.status === 'target')!;
    render(<NodeInspector graph={graph} nodeId={target.id} />);
    expect(screen.getByRole('heading', { name: target.label })).toBeInTheDocument();
    const connected = graph.edges.filter((e) => e.source === target.id || e.target === target.id).length;
    expect(screen.getByText(`Connections (${connected})`)).toBeInTheDocument();
    expect(screen.getByText('Target role')).toBeInTheDocument();
  });
});
