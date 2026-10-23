import { Router } from 'express';
import { conversationsRouter } from './conversations/index.ts';
import { healthRouter } from './health/index.ts';
import { createProjectsRouter, type ProjectsConfig } from './projects/index.ts';

// Root router for everything under `/api`.
// Each feature is a router in its own folder under `src/api/<feature>/`, mounted here.
export const createApiRouter = (config: ProjectsConfig): Router => {
	const router = Router();

	router.use('/health', healthRouter);
	router.use('/projects', createProjectsRouter(config));
	router.use('/conversations', conversationsRouter);

	return router;
};
