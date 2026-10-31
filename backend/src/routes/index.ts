import { Router } from 'express';
import { ok } from '../utils/response.js';
import { isDaytonaConfigured, isNeo4jConfigured, isNosanaConfigured } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as catalog from '../controllers/catalogController.js';
import * as profile from '../controllers/profileController.js';
import * as integrations from '../controllers/integrationsController.js';
import * as career from '../controllers/careerController.js';
import * as nosanaCtl from '../controllers/nosanaController.js';
import * as daytonaCtl from '../controllers/daytonaController.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  ok(res, {
    status: 'ok',
    service: 'skillgraph-backend',
    uptimeSeconds: Math.round(process.uptime()),
    // Configuration presence only. Real connectivity is reported by /api/integrations/status.
    configured: {
      neo4j: isNeo4jConfigured(),
      nosana: isNosanaConfigured(),
      daytona: isDaytonaConfigured(),
    },
  });
});

apiRouter.get('/integrations/neo4j/status', asyncHandler(integrations.neo4jStatus));
apiRouter.get('/integrations/nosana/status', asyncHandler(nosanaCtl.nosanaStatus));
apiRouter.get('/integrations/nosana/models', asyncHandler(nosanaCtl.nosanaModels));
apiRouter.put('/integrations/nosana/model', asyncHandler(nosanaCtl.selectNosanaModel));
apiRouter.get('/integrations/daytona/status', asyncHandler(daytonaCtl.daytonaStatus));

apiRouter.get('/skills', asyncHandler(catalog.listSkills));
apiRouter.get('/skills/:id', asyncHandler(catalog.getSkill));
apiRouter.get('/roles', asyncHandler(catalog.listRoles));
apiRouter.get('/roles/:id', asyncHandler(catalog.getRole));

apiRouter.get('/profile', asyncHandler(profile.readProfile));
apiRouter.post('/profile', asyncHandler(profile.createProfile));
apiRouter.put('/profile', asyncHandler(profile.updateProfile));
apiRouter.get('/profiles', asyncHandler(profile.listAllProfiles));
apiRouter.post('/profiles', asyncHandler(profile.createAdditionalProfile));
apiRouter.delete('/profiles/:id', asyncHandler(profile.removeProfile));

apiRouter.get('/integrations/status', asyncHandler(career.allIntegrationsStatus));

apiRouter.post('/career/skill-gap', asyncHandler(career.skillGap));
apiRouter.post('/career/analyze', asyncHandler(career.analyze));
apiRouter.get('/career/analysis/:id', asyncHandler(career.readAnalysis));
apiRouter.get('/career/history', asyncHandler(career.history));
apiRouter.get('/career/graph/:analysisId', asyncHandler(career.readGraph));
apiRouter.post('/career/roadmap', asyncHandler(career.recalculate));

apiRouter.get('/roadmap', asyncHandler(career.readRoadmap));
apiRouter.patch('/roadmap/items/:id/complete', asyncHandler(career.completeItem));

apiRouter.get('/dashboard/summary', asyncHandler(career.dashboardSummary));
