import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import SkillGapAnalysis, { categoryGaps } from './SkillGapAnalysis';
import { apiError, demoAnalysis, mockApi, renderWithProviders } from '@/test/utils';
import type { CareerAnalysis } from '@/types/api';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const history = (a: CareerAnalysis) => [
  { id: a.id, createdAt: a.createdAt, mode: a.mode, status: a.status, targetRoleName: a.targetRoleName, matchPercentage: 17, gapSkillCount: 7, estimatedHours: 100 },
];
const routes = (a: CareerAnalysis) => ({ 'GET /career/history': history(a), 'GET /career/analysis/*': a });

describe('SkillGapAnalysis', () => {
  it('renders match, graph facts and the AI explanation for the demo analysis', async () => {
    mockApi(routes(demoAnalysis));
    renderWithProviders(<SkillGapAnalysis />);
    expect(await screen.findByText(/Graph facts \(Neo4j\)/)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Demo mode');
    expect(screen.getByRole('img', { name: 'Skill match 17 percent' })).toBeInTheDocument();
    expect(screen.getByText('1 of 6 required skills')).toBeInTheDocument();

    const missingHeading = screen.getByRole('heading', { name: /Missing required skills \(5\)/ });
    expect(missingHeading).toBeInTheDocument();
    expect(screen.getAllByText('Python').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: /Prerequisite gaps/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /AI explanation \(Nosana\)/ })).toBeInTheDocument();
    expect(screen.getByText(demoAnalysis.insight!.insight.careerSummary)).toBeInTheDocument();
  });

  it('explains honestly when Nosana did not run', async () => {
    const a: CareerAnalysis = {
      ...demoAnalysis,
      mode: 'live',
      insight: undefined,
      steps: { ...demoAnalysis.steps, nosana: { ...demoAnalysis.steps.nosana, status: 'skipped', detail: 'NOSANA_API_KEY is not set' } },
    };
    mockApi(routes(a));
    renderWithProviders(<SkillGapAnalysis />);
    expect(await screen.findByText('NOSANA_API_KEY is not set')).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.getByText(/Graph facts/)).toBeInTheDocument();
  });

  it('reports a failed Nosana step without hiding graph facts', async () => {
    const a: CareerAnalysis = {
      ...demoAnalysis,
      insight: undefined,
      steps: { ...demoAnalysis.steps, nosana: { ...demoAnalysis.steps.nosana, status: 'failed', error: 'insufficient_credits' } },
    };
    mockApi(routes(a));
    renderWithProviders(<SkillGapAnalysis />);
    expect(await screen.findByText(/The Nosana step failed: insufficient_credits/)).toBeInTheDocument();
    expect(screen.getByText(/Missing required skills/)).toBeInTheDocument();
  });

  it('shows an empty state when no analysis exists', async () => {
    mockApi({ 'GET /career/history': [] });
    renderWithProviders(<SkillGapAnalysis />);
    expect(await screen.findByText('No analysis yet')).toBeInTheDocument();
  });

  it('shows an error state when the backend fails', async () => {
    mockApi({ 'GET /career/history': () => apiError(500, 'internal', 'Backend exploded') });
    renderWithProviders(<SkillGapAnalysis />);
    expect(await screen.findByText('Backend exploded')).toBeInTheDocument();
  });

  it('shows a loading state first', () => {
    mockApi({ 'GET /career/history': () => new Promise(() => undefined) as never });
    renderWithProviders(<SkillGapAnalysis />);
    expect(screen.getByText(/Loading your latest analysis/)).toBeInTheDocument();
  });
});

describe('categoryGaps', () => {
  it('counts required and prerequisite gaps per category', () => {
    const rows = categoryGaps(demoAnalysis);
    const required = rows.reduce((n, r) => n + r.required, 0);
    const prereq = rows.reduce((n, r) => n + r.prerequisite, 0);
    expect(required).toBe(demoAnalysis.graph!.missingSkills.length);
    expect(prereq).toBe(demoAnalysis.graph!.prerequisiteGapSkills.length);
    const first = rows[0];
    expect(rows.every((r) => r.required + r.prerequisite <= first.required + first.prerequisite)).toBe(true);
  });
});
