import cors from 'cors';
import express, { type Express } from 'express';
import type { ChatConfig } from './api/chat/index.ts';
import { createApiRouter } from './api/index.ts';
import { healthRouter } from './api/health/index.ts';
import type { Config } from './config.ts';
import { errorHandler, notFound } from './middleware/errors.ts';

// Creates the Express application. Kept separate from `serve.ts` so tests can
// exercise the app without binding to a port.
export const createApp = (config: Pick<Config, 'corsOrigins'> & ChatConfig): Express => {
	const app = express();

	app.disable('x-powered-by');
	app.use(cors({ origin: config.corsOrigins }));
	app.use(express.json());

	// `/health` is exposed at the root for Docker and uptime checks.
	// Everything else lives under `/api`.
	app.use('/health', healthRouter);
	app.use('/api', createApiRouter(config));

	app.use(notFound);
	app.use(errorHandler);

	return app;
};
