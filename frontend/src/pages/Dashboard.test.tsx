import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from './Dashboard';
import { apiError, demoAnalysis, mockApi, profileFixture, renderWithProviders, rolesFixture } from '@/test/utils';
import type { AnalysisListItem, CareerAnalysis } from '@/types/api';

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const profile = {
  ...profileFixture,
  technicalSkills: [
    { skillId: 'S004', name: 'Angular', category: 'Frontend', proficiencyLevel: 'Advanced', yearsExperience: null },
    { skillId: 'S002', name: 'Docker', category: 'DevOps', proficiencyLevel: 'Intermediate', yearsExperience: null },
  ],
};
const roles = { roles: rolesFixture, families: ['AI'] };
const recent: AnalysisListItem[] = [
  { id: demoAnalysis.id, createdAt: demoAnalysis.createdAt, mode: 'demo', status: 'completed', targetRoleName: 'AI Engineer', matchPercentage: 17, gapSkillCount: 7, estimatedHours: 100 },
];

describe('Dashboard', () => {
  it('starts with the saved profile skills and an Analyze button, not with old results', async () => {
    mockApi({ 'GET /profile': profile, 'GET /roles': roles, 'GET /career/history': recent });
    renderWithProviders(<Dashboard />);
    const skills = await screen.findByRole('list', { name: 'Your skills' });
    expect(within(skills).getByText('Angular')).toBeInTheDocument();
    expect(within(skills).getByText('Docker')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Analyze My Career/ })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Target role' })).toHaveValue('R009');
    // Nothing is analysed until the user asks for it.
    expect(screen.queryByRole('region', { name: 'Key numbers' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Analysis progress')).not.toBeInTheDocument();
  });

  it('asks the user to create a profile when none is saved', async () => {
    mockApi({
      'GET /profile': () => apiError(404, 'not_found', 'Profile not found'),
      'GET /roles': roles,
      'GET /career/history': [],
    });
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText('Create your profile first')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up my profile' })).toBeInTheDocument();
  });

  it('shows an error state when the profile cannot be loaded', async () => {
    mockApi({ 'GET /profile': () => apiError(503, 'not_configured', 'Neo4j is not configured'), 'GET /roles': roles, 'GET /career/history': [] });
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText('Neo4j is not configured')).toBeInTheDocument();
  });

  it('shows live progress, then the gaps and results once the analysis finishes', async () => {
    let polls = 0;
    const running: CareerAnalysis = {
      ...demoAnalysis,
      mode: 'live',
      status: 'running',
      steps: { ...demoAnalysis.steps, neo4j: { ...demoAnalysis.steps.neo4j, status: 'running' }, nosana: { ...demoAnalysis.steps.nosana, status: 'pending' } },
      events: [{ seq: 1, at: new Date().toISOString(), step: 'neo4j', status: 'started', message: 'Querying the skill graph' }],
    };
    const done: CareerAnalysis = {
      ...demoAnalysis,
      mode: 'live',
      status: 'completed',
      events: [...running.events, { seq: 2, at: new Date().toISOString(), step: 'neo4j', status: 'succeeded', message: 'Graph analysis finished', durationMs: 120 }],
    };
    const { calls } = mockApi({
      'GET /profile': profile,
      'GET /roles': roles,
      'POST /career/analyze': { analysisId: demoAnalysis.id, status: 'running', mode: 'live' },
      'GET /career/analysis/*': () => (++polls < 2 ? running : done),
      'GET /career/history': [],
    });
    renderWithProviders(<Dashboard />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Analyze My Career/ }));

    // While running: the real events are visible and results are not.
    expect(await screen.findByText('Querying the skill graph')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Key numbers' })).not.toBeInTheDocument();

    // After completion: results appear with gaps and the match number.
    await waitFor(() => expect(screen.getByText('Graph analysis finished')).toBeInTheDocument(), { timeout: 4000 });
    const stats = await screen.findByRole('region', { name: 'Key numbers' });
    expect(within(stats).getByText('17%')).toBeInTheDocument();
    const gaps = screen.getByLabelText('Skill gaps');
    for (const m of demoAnalysis.graph!.missingSkills) expect(within(gaps).getByText(m.name)).toBeInTheDocument();
    expect(screen.getByLabelText('Learning order')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ mode: 'live' });
  });

  it('sends the target role chosen on the dashboard', async () => {
    const { calls } = mockApi({
      'GET /profile': profile,
      'GET /roles': roles,
      'POST /career/analyze': { analysisId: demoAnalysis.id, status: 'running', mode: 'live' },
      'GET /career/analysis/*': { ...demoAnalysis, mode: 'live' },
      'GET /career/history': [],
    });
    renderWithProviders(<Dashboard />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Target role' }), 'R001');
    await user.click(screen.getByRole('button', { name: /Analyze My Career/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeTruthy());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ mode: 'live', targetRoleId: 'R001' });
  });

  it('opens a previous analysis from the recent list', async () => {
    mockApi({ 'GET /profile': profile, 'GET /roles': roles, 'GET /career/history': recent, 'GET /career/analysis/*': demoAnalysis });
    renderWithProviders(<Dashboard />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'View results' }));
    expect(await screen.findByRole('region', { name: 'Key numbers' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Demo mode');
    expect(await screen.findByTestId('cytoscape')).toBeInTheDocument();
  });
});
