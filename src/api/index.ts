import { Router } from 'express';
import { createChatRouter, type ChatConfig } from './chat/index.ts';
import { conversationsRouter } from './conversations/index.ts';
import { createDocumentsRouter, type DocumentsConfig } from './documents/index.ts';
import { healthRouter } from './health/index.ts';

// Root router for everything under `/api`.
// Each feature is a router in its own folder under `src/api/<feature>/`, mounted here.
export const createApiRouter = (config: ChatConfig & DocumentsConfig): Router => {
	const router = Router();

	router.use('/health', healthRouter);
	router.use('/documents', createDocumentsRouter(config));
	router.use('/chat', createChatRouter(config));
	router.use('/conversations', conversationsRouter);

	return router;
};
