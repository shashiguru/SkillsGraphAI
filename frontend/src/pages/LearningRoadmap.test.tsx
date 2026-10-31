import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';
import LearningRoadmap from './LearningRoadmap';
import { apiError, demoAnalysis, mockApi, renderWithProviders, roadmapFromAnalysis } from '@/test/utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const view = roadmapFromAnalysis(demoAnalysis);

describe('LearningRoadmap', () => {
  it('renders phases, totals, schedule and the demo label', async () => {
    mockApi({ 'GET /roadmap': view });
    renderWithProviders(<LearningRoadmap />);
    expect(await screen.findByText('Demo calculation (local Python)')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Demo mode');
    for (const p of view.phases) expect(screen.getByText(new RegExp(`Phase ${p.phase}: ${p.name}`))).toBeInTheDocument();
    expect(screen.getByText(`${view.totals!.hours} h`)).toBeInTheDocument();
    const schedule = screen.getByRole('list', { name: 'Weekly schedule' });
    expect(within(schedule).getAllByText(/^Week \d+$/)).toHaveLength(view.weeklySchedule.length);
    for (const item of view.items) expect(screen.getByLabelText(`Mark ${item.skill} complete`)).toBeInTheDocument();
  });

  it('puts prerequisites before the skills that depend on them', async () => {
    mockApi({ 'GET /roadmap': view });
    renderWithProviders(<LearningRoadmap />);
    await screen.findByText(/Weekly schedule/);
    const order = (name: string) => view.items.find((i) => i.skill === name)!.order;
    const withPrereqs = view.items.filter((i) => i.prerequisites.length > 0);
    expect(withPrereqs.length).toBeGreaterThan(0);
    for (const item of withPrereqs) {
      for (const p of item.prerequisites) {
        const known = view.items.some((i) => i.skill === p);
        // prerequisites the user already has are not part of the roadmap
        if (known) expect(order(p)).toBeLessThan(item.order);
      }
    }
    expect(order('Statistics')).toBeLessThan(order('Machine Learning'));
  });

  it('marks a skill complete through the API and updates progress', async () => {
    const first = view.items[0];
    const updated = { ...view, items: view.items.map((i) => (i.skillId === first.skillId ? { ...i, completed: true } : i)), totals: { ...view.totals!, completedSkills: 1, progressPercent: 14 } };
    const { calls } = mockApi({ 'GET /roadmap': view, 'PATCH /roadmap/items/*': updated });
    renderWithProviders(<LearningRoadmap />);
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText(`Mark ${first.skill} complete`));
    await waitFor(() => expect(screen.getByLabelText(`Mark ${first.skill} complete`)).toBeChecked());
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.path).toBe(`/roadmap/items/${first.skillId}/complete`);
    expect(patch.body).toEqual({ completed: true, analysisId: view.analysisId });
    expect(screen.getByText('14%')).toBeInTheDocument();
  });

  it('recalculates the schedule when the hours slider changes', async () => {
    const recalculated = { ...view, learningHoursPerWeek: 20, totals: { ...view.totals!, weeks: 5 } };
    const { calls } = mockApi({ 'GET /roadmap': view, 'POST /career/roadmap': recalculated });
    renderWithProviders(<LearningRoadmap />);
    const user = userEvent.setup();
    const slider = await screen.findByLabelText('Hours per week');
    const button = screen.getByRole('button', { name: /Recalculate schedule/ });
    expect(button).toBeDisabled();
    fireEvent.change(slider, { target: { value: '20' } });
    expect(screen.getByTestId('hours-value')).toHaveTextContent('20 h');
    await user.click(button);
    await waitFor(() => expect(screen.getByText('5 wk')).toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ learningHoursPerWeek: 20, analysisId: view.analysisId });
  });

  it('shows the backend error when recalculation fails', async () => {
    mockApi({ 'GET /roadmap': view, 'POST /career/roadmap': () => apiError(503, 'not_configured', 'Daytona is not configured') });
    renderWithProviders(<LearningRoadmap />);
    const user = userEvent.setup();
    fireEvent.change(await screen.findByLabelText('Hours per week'), { target: { value: '12' } });
    await user.click(screen.getByRole('button', { name: /Recalculate schedule/ }));
    expect(await screen.findByText('Daytona is not configured')).toBeInTheDocument();
  });

  it('falls back to graph order when the sandbox computation is unavailable', async () => {
    const unavailable = roadmapFromAnalysis(demoAnalysis, {
      computation: 'unavailable',
      computationNote: 'Daytona is not configured',
      mode: 'live',
      items: [],
      phases: [],
      weeklySchedule: [],
      totals: null,
    });
    mockApi({ 'GET /roadmap': unavailable });
    renderWithProviders(<LearningRoadmap />);
    expect(await screen.findByText('Sandbox computation unavailable')).toBeInTheDocument();
    expect(screen.getByText('Graph order')).toBeInTheDocument();
    expect(screen.getByLabelText(`Mark ${unavailable.graphOrder[0].skill} complete`)).toBeInTheDocument();
    expect(screen.queryByText('Weekly schedule')).not.toBeInTheDocument();
  });

  it('shows an empty state when there is no roadmap', async () => {
    mockApi({ 'GET /roadmap': () => apiError(404, 'not_found', 'No analysis') });
    renderWithProviders(<LearningRoadmap />);
    expect(await screen.findByText('No roadmap yet')).toBeInTheDocument();
  });

  it('shows an error state', async () => {
    mockApi({ 'GET /roadmap': () => apiError(500, 'internal', 'Store unavailable') });
    renderWithProviders(<LearningRoadmap />);
    expect(await screen.findByText('Store unavailable')).toBeInTheDocument();
  });
});
