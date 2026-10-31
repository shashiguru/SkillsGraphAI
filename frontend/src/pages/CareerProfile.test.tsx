import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import CareerProfile, { ALEX_DEFAULTS, ProfileFormSchema, toProfileInput } from './CareerProfile';
import { apiError, mockApi, profileFixture, renderWithProviders, rolesFixture, skillsFixture } from '@/test/utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const baseRoutes = () => ({
  'GET /profile': () => apiError(404, 'not_found', 'No profile'),
  'GET /roles': { roles: rolesFixture, families: ['AI', 'Engineering'] },
  'GET /skills': { skills: skillsFixture, categories: [] },
});

describe('ProfileFormSchema', () => {
  it('accepts the Alex defaults', () => {
    expect(ProfileFormSchema.safeParse(ALEX_DEFAULTS).success).toBe(true);
  });
  it('rejects empty names, negative experience and no skills', () => {
    const r = ProfileFormSchema.safeParse({ ...ALEX_DEFAULTS, name: ' ', yearsExperience: -1, technicalSkills: [] });
    expect(r.success).toBe(false);
  });
  it('splits soft skills into a clean array', () => {
    const out = toProfileInput({ ...ALEX_DEFAULTS, softSkillsText: ' a, ,b ' });
    expect(out.softSkills).toEqual(['a', 'b']);
    expect(out.targetRoleId).toBeUndefined();
  });
});

describe('CareerProfile page', () => {
  it('prefills the Alex persona when nothing is saved', async () => {
    mockApi(baseRoutes());
    renderWithProviders(<CareerProfile />);
    expect(await screen.findByDisplayValue('Alex')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Full Stack Developer')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Selected skills' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(ALEX_DEFAULTS.technicalSkills.length);
    expect(within(list).getByText('Angular')).toBeInTheDocument();
  });

  it('shows the saved profile instead of the defaults', async () => {
    mockApi({ ...baseRoutes(), 'GET /profile': profileFixture });
    renderWithProviders(<CareerProfile />);
    await waitFor(() => expect(screen.getByLabelText('Years of experience')).toHaveValue(9));
    const list = screen.getByRole('list', { name: 'Selected skills' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(await screen.findByRole('option', { name: 'AI Engineer' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Target role')).toHaveValue('R009'));
  });

  it('shows validation errors and does not submit invalid data', async () => {
    const { calls } = mockApi(baseRoutes());
    renderWithProviders(<CareerProfile />);
    const user = userEvent.setup();
    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    const hours = screen.getByLabelText('Learning hours per week');
    await user.clear(hours);
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Enter a number')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('adds a graph skill through the autocomplete and removes a skill', async () => {
    mockApi(baseRoutes());
    renderWithProviders(<CareerProfile />);
    const user = userEvent.setup();
    await screen.findByDisplayValue('Alex');
    await user.click(screen.getByRole('combobox', { name: 'Search skills' }));
    await user.click(await screen.findByRole('button', { name: /Python/ }));
    const list = screen.getByRole('list', { name: 'Selected skills' });
    expect(within(list).getByText('Python')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Python' }));
    expect(within(list).queryByText('Python')).not.toBeInTheDocument();
  });

  it('posts the profile with skill ids and shows ignored skills', async () => {
    const { calls } = mockApi({
      ...baseRoutes(),
      'POST /profile': { ...profileFixture, unmappedSkills: ['C#'] },
    });
    renderWithProviders(<CareerProfile />);
    const user = userEvent.setup();
    await screen.findByDisplayValue('Alex');
    await user.click(screen.getByRole('combobox', { name: 'Search skills' }));
    await user.click(await screen.findByRole('button', { name: /Machine Learning/ }));
    await user.selectOptions(await screen.findByRole('option', { name: 'AI Engineer' }).then((o) => o.parentElement as HTMLSelectElement), 'R009');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByText('Profile saved')).toBeInTheDocument();
    expect(screen.getByText(/Not in the graph and ignored: C#/)).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST')!;
    const body = post.body as { targetRoleId: string; technicalSkills: { skillId?: string; name: string }[]; softSkills: string[] };
    expect(body.targetRoleId).toBe('R009');
    expect(body.technicalSkills.find((s) => s.name === 'Machine Learning')?.skillId).toBe('S003');
    expect(body.softSkills).toEqual(['Communication', 'Mentoring']);
  });

  it('shows an error when saving fails', async () => {
    mockApi({ ...baseRoutes(), 'POST /profile': () => apiError(503, 'not_configured', 'Neo4j is not configured') });
    renderWithProviders(<CareerProfile />);
    const user = userEvent.setup();
    await screen.findByDisplayValue('Alex');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('Neo4j is not configured')).toBeInTheDocument();
  });

  it('shows an error state when the profile cannot be loaded', async () => {
    mockApi({ ...baseRoutes(), 'GET /profile': () => apiError(500, 'internal', 'Database offline') });
    renderWithProviders(<CareerProfile />);
    expect(await screen.findByText('Database offline')).toBeInTheDocument();
    expect(screen.getByText('Could not load your saved profile')).toBeInTheDocument();
  });
});
