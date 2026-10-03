import { Router } from 'express';
import { healthRouter } from './health/index.ts';

// Root router for everything under `/api`.
// Each feature is a router in its own folder under `src/api/<feature>/`, mounted here.
export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);
