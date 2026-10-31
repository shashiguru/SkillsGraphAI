import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IntegrationMonitor, { healthOf } from './IntegrationMonitor';
import { apiError, mockApi, renderWithProviders } from '@/test/utils';
import type { IntegrationsStatus } from '@/types/api';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const connected: IntegrationsStatus = {
  checkedAt: new Date().toISOString(),
  neo4j: {
    configured: true,
    connected: true,
    latencyMs: 42,
    serverVersion: '5.26',
    counts: { nodes: { Skill: 40, Role: 12 }, relationships: { REQUIRES_SKILL: 60 } },
    lastSuccessfulQueryAt: new Date().toISOString(),
    lastError: null,
  },
  nosana: {
    configured: true,
    connected: true,
    baseUrl: 'https://inference.nosana.com/v1',
    models: [{ id: 'llama-a', available: true }, { id: 'llama-b', available: true }],
    selectedModel: 'llama-a',
    lastInference: { status: 'success', at: new Date().toISOString(), model: 'llama-a', durationMs: 900, attempts: 1, usage: { total_tokens: 321 } },
  },
  daytona: {
    configured: true,
    connected: true,
    apiUrl: 'https://app.daytona.io/api',
    lastExecution: {
      executionId: 'e1',
      status: 'completed',
      sandboxId: 'sbx-123',
      startedAt: new Date().toISOString(),
      durationMs: 3100,
      phases: {},
      exitCode: 0,
      pythonVersion: '3.12',
      networkIsolated: true,
      logs: [{ at: new Date().toISOString(), source: 'sandbox', message: 'analysis complete' }],
      cleanedUp: true,
    },
    recentExecutions: [],
  },
};

const unconfigured: IntegrationsStatus = {
  checkedAt: new Date().toISOString(),
  neo4j: { configured: false, connected: false, error: 'NEO4J_URI is not set', lastSuccessfulQueryAt: null, lastError: null },
  nosana: { configured: false, connected: false, baseUrl: 'https://inference.nosana.com/v1', models: [] },
  daytona: { configured: false, connected: false, apiUrl: 'https://app.daytona.io/api', lastExecution: null, recentExecutions: [] },
};

describe('healthOf', () => {
  it('distinguishes not configured, unreachable and connected', () => {
    expect(healthOf({ configured: false, connected: false }).label).toBe('Not configured');
    expect(healthOf({ configured: true, connected: false }).label).toBe('Unreachable');
    expect(healthOf({ configured: true, connected: true }).label).toBe('Connected');
  });
});

describe('IntegrationMonitor', () => {
  it('shows real metrics for connected services', async () => {
    mockApi({ 'GET /integrations/status': connected });
    renderWithProviders(<IntegrationMonitor />);
    const neo = await screen.findByLabelText('Neo4j status');
    expect(within(neo).getByText('Connected')).toBeInTheDocument();
    expect(within(neo).getByText('5.26')).toBeInTheDocument();
    expect(within(neo).getByText('Skill')).toBeInTheDocument();
    expect(within(neo).getByText('40')).toBeInTheDocument();

    const nosana = screen.getByLabelText('Nosana status');
    expect(within(nosana).getByText('321')).toBeInTheDocument();
    expect(within(nosana).getByRole('combobox')).toHaveValue('llama-a');

    const daytona = screen.getByLabelText('Daytona status');
    expect(within(daytona).getByText('sbx-123')).toBeInTheDocument();
    expect(within(daytona).getByLabelText('Sandbox logs')).toHaveTextContent('[sandbox] analysis complete');
  });

  it('reports unconfigured services honestly with no fabricated activity', async () => {
    mockApi({ 'GET /integrations/status': unconfigured });
    renderWithProviders(<IntegrationMonitor />);
    await screen.findByLabelText('Neo4j status');
    expect(screen.getAllByText('Not configured')).toHaveLength(3);
    expect(screen.getByText('NEO4J_URI is not set')).toBeInTheDocument();
    expect(screen.getByText(/No inference has run/)).toBeInTheDocument();
    expect(screen.getByText(/No sandbox has run/)).toBeInTheDocument();
    expect(within(screen.getByLabelText('Nosana status')).getByRole('combobox')).toBeDisabled();
  });

  it('selects a different Nosana model', async () => {
    const { calls } = mockApi({ 'GET /integrations/status': connected, 'PUT /integrations/nosana/model': connected.nosana });
    renderWithProviders(<IntegrationMonitor />);
    const user = userEvent.setup();
    const select = within(await screen.findByLabelText('Nosana status')).getByRole('combobox');
    await user.selectOptions(select, 'llama-b');
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ modelId: 'llama-b' });
  });

  it('shows an error state when the backend is unreachable', async () => {
    mockApi({ 'GET /integrations/status': () => apiError(500, 'internal', 'Backend down') });
    renderWithProviders(<IntegrationMonitor />);
    expect(await screen.findByText('Backend down')).toBeInTheDocument();
  });
});
