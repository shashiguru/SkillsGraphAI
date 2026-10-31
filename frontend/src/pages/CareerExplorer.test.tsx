import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CareerExplorer from './CareerExplorer';
import { apiError, mockApi, profileFixture, renderWithProviders, rolesFixture } from '@/test/utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const routes = (profile: unknown = profileFixture) => ({
  'GET /roles': { roles: rolesFixture, families: ['AI', 'Engineering'] },
  'GET /profile': profile,
});

describe('CareerExplorer', () => {
  it('lists roles ranked by match with missing skills', async () => {
    mockApi(routes());
    renderWithProviders(<CareerExplorer />);
    const cards = await screen.findAllByTestId(/^role-/);
    expect(cards.map((c) => within(c).getByRole('heading').textContent)).toEqual(['Frontend Developer', 'AI Engineer']);
    const ai = screen.getByTestId('role-R009');
    expect(within(ai).getByText('17%')).toBeInTheDocument();
    expect(within(ai).getByText('Python')).toBeInTheDocument();
    expect(within(ai).getByText('1 of 6 required skills matched')).toBeInTheDocument();
    expect(within(screen.getByTestId('role-R001')).getByText('No missing skills')).toBeInTheDocument();
  });

  it('filters by family and by search text', async () => {
    mockApi(routes());
    renderWithProviders(<CareerExplorer />);
    const user = userEvent.setup();
    await screen.findByTestId('role-R009');
    await user.click(await screen.findByRole('button', { name: 'Engineering' }));
    expect(screen.queryByTestId('role-R009')).not.toBeInTheDocument();
    expect(screen.getByTestId('role-R001')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.type(screen.getByLabelText('Search roles'), 'generative');
    expect(screen.getByTestId('role-R009')).toBeInTheDocument();
    expect(screen.queryByTestId('role-R001')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search roles'));
    await user.type(screen.getByLabelText('Search roles'), 'zzz');
    expect(screen.getByText('No roles match')).toBeInTheDocument();
  });

  it('sets a role as the target by saving the profile', async () => {
    const { calls } = mockApi({ ...routes(), 'PUT /profile': { ...profileFixture, targetRoleId: 'R001' } });
    renderWithProviders(<CareerExplorer />);
    const user = userEvent.setup();
    const card = await screen.findByTestId('role-R001');
    expect(within(screen.getByTestId('role-R009')).getByText('Current target')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: /Set as target/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect((put.body as { targetRoleId: string }).targetRoleId).toBe('R001');
  });

  it('asks for a profile when none exists', async () => {
    mockApi({ ...routes(), 'GET /profile': () => apiError(404, 'not_found', 'none') });
    renderWithProviders(<CareerExplorer />);
    expect(await screen.findAllByRole('link', { name: /Create a profile/ })).toHaveLength(2);
  });

  it('shows an error state with retry when Neo4j is unavailable', async () => {
    mockApi({ ...routes(), 'GET /roles': () => apiError(503, 'not_configured', 'Neo4j is not configured') });
    renderWithProviders(<CareerExplorer />);
    expect(await screen.findByText('Neo4j is not configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows a loading state first', () => {
    mockApi({ ...routes(), 'GET /roles': () => new Promise(() => undefined) as never });
    renderWithProviders(<CareerExplorer />);
    expect(screen.getByText(/Querying roles/)).toBeInTheDocument();
  });
});
