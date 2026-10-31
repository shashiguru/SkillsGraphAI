import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { isNeo4jConfigured } from '../src/config/env.js';
import { closeDriver } from '../src/services/neo4j/driver.js';

const app = createApp();

const base = { currentRole: 'Developer', yearsExperience: 3, industry: 'Software', softSkills: [], targetRoleId: 'R009', learningHoursPerWeek: 8 };
const skills = (...names: string[]) => names.map((name) => ({ name }));

describe.skipIf(!isNeo4jConfigured())('multiple profiles (live Neo4j)', () => {
  const created: string[] = [];
  afterAll(async () => {
    for (const id of created) await request(app).delete(`/api/profiles/${id}`);
    await closeDriver();
  });

  const gap = (id: string) => request(app).post('/api/career/skill-gap').set('X-Profile-Id', id).send({});

  it('keeps profiles isolated and changes the analysis when skills change', async () => {
    const a = await request(app).post('/api/profiles').send({ ...base, name: 'Test A', technicalSkills: skills('Docker') });
    const b = await request(app).post('/api/profiles').send({ ...base, name: 'Test B', technicalSkills: skills('Python', 'Machine Learning') });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const [idA, idB] = [a.body.data.userId as string, b.body.data.userId as string];
    created.push(idA, idB);
    expect(idA).not.toBe(idB);

    const listed = await request(app).get('/api/profiles');
    const ids = listed.body.data.map((p: { userId: string }) => p.userId);
    expect(ids).toEqual(expect.arrayContaining([idA, idB]));

    const gapA = await gap(idA);
    const gapB = await gap(idB);
    expect(gapA.status).toBe(200);
    expect(gapB.status).toBe(200);
    const missing = (r: request.Response) => r.body.data.analysis.missingSkills.map((s: { name: string }) => s.name);
    expect(missing(gapA)).toContain('Python');
    expect(missing(gapB)).not.toContain('Python');
    expect(gapB.body.data.analysis.matchedSkills.length).toBeGreaterThan(gapA.body.data.analysis.matchedSkills.length);

    // Editing A's skills changes A's result and leaves B untouched.
    const upd = await request(app)
      .put('/api/profile')
      .set('X-Profile-Id', idA)
      .send({ ...base, name: 'Test A', technicalSkills: skills('Docker', 'Python', 'Machine Learning') });
    expect(upd.status).toBe(200);
    const gapA2 = await gap(idA);
    expect(missing(gapA2)).not.toContain('Python');
    expect(gapA2.body.data.analysis.matchedSkills.length).toBeGreaterThan(gapA.body.data.analysis.matchedSkills.length);
    expect((await gap(idB)).body.data.analysis.matchedSkills.length).toBe(gapB.body.data.analysis.matchedSkills.length);
  });

  it('refuses to delete the default profile and 404s on an unknown profile', async () => {
    expect((await request(app).delete('/api/profiles/default-user')).status).toBe(400);
    expect((await request(app).delete('/api/profiles/p-doesnotexist')).status).toBe(404);
    expect((await request(app).get('/api/profile').set('X-Profile-Id', 'p-doesnotexist')).status).toBe(404);
  });
});
