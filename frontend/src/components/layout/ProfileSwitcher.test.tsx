import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileSwitcher } from './ProfileSwitcher';
import { getActiveProfileId, setActiveProfileId } from '@/lib/activeProfile';
import { mockApi, renderWithProviders } from '@/test/utils';

const list = [
  { userId: 'default-user', name: 'Alex', currentRole: 'Full Stack Developer', targetRoleId: 'R009', skillCount: 7, updatedAt: null },
  { userId: 'p-1234abcd', name: 'Sam', currentRole: 'Data Analyst', targetRoleId: 'R009', skillCount: 3, updatedAt: null },
];

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProfileSwitcher', () => {
  it('lists saved profiles and sends the chosen one with every API request', async () => {
    const { fn } = mockApi({ 'GET /profiles': list, 'GET /profile': null });
    renderWithProviders(<ProfileSwitcher />);
    const user = userEvent.setup();
    const select = await screen.findByRole('combobox', { name: 'Active profile' });
    await waitFor(() => expect(select).toHaveValue('default-user'));
    await user.selectOptions(select, 'p-1234abcd');
    expect(getActiveProfileId()).toBe('p-1234abcd');
    await waitFor(() => {
      const headers = fn.mock.calls.at(-1)![1]!.headers as Record<string, string>;
      expect(headers['X-Profile-Id']).toBe('p-1234abcd');
    });
  });

  it('falls back to the default profile when nothing was chosen', () => {
    expect(getActiveProfileId()).toBe('default-user');
    setActiveProfileId('p-1');
    expect(getActiveProfileId()).toBe('p-1');
  });
});
