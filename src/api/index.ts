import { Router } from 'express';
import { chatRouter } from './chat/index.ts';
import { conversationsRouter } from './conversations/index.ts';
import { documentsRouter } from './documents/index.ts';
import { healthRouter } from './health/index.ts';

// Root router for everything under `/api`.
// Each feature is a router in its own folder under `src/api/<feature>/`, mounted here.
export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/documents', documentsRouter);
apiRouter.use('/chat', chatRouter);
apiRouter.use('/conversations', conversationsRouter);
