import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { isNeo4jConfigured } from '../src/config/env.js';

const app = createApp();

describe('API request validation', () => {
  it('rejects an invalid profile body with 400 and field details', async () => {
    const res = await request(app).post('/api/profile').send({ name: '', learningHoursPerWeek: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('rejects malformed JSON', async () => {
    const res = await request(app).post('/api/profile').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_json');
  });

  it('rejects an out-of-range skills limit', async () => {
    const res = await request(app).get('/api/skills?limit=9999');
    expect(res.status).toBe(400);
  });

  it.skipIf(isNeo4jConfigured())('reports Neo4j as not configured (503), never as success', async () => {
    const res = await request(app).get('/api/skills');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('not_configured');
  });

  it.skipIf(isNeo4jConfigured())('reports neo4j status as disconnected when not configured', async () => {
    const res = await request(app).get('/api/integrations/neo4j/status');
    expect(res.status).toBe(200);
    expect(res.body.data.connected).toBe(false);
    expect(res.body.data.configured).toBe(false);
  });
});

describe('Profile selection header', () => {
  it('rejects a malformed X-Profile-Id with 400', async () => {
    const res = await request(app).get('/api/profile').set('X-Profile-Id', 'bad id!');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });
});
