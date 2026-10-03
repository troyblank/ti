import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { apiRouter } from './api/index.ts';
import { healthRouter } from './api/health/index.ts';
import type { Config } from './config.ts';

export type ErrorResponse = {
	error: string;
};

export const notFound = (_request: Request, response: Response) => {
	const body: ErrorResponse = { error: 'Not Found' };

	response.status(404).json(body);
};

// Express identifies error handlers by arity, so `next` must stay in the signature.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
	console.error(error);

	const body: ErrorResponse = { error: 'Internal Server Error' };

	response.status(500).json(body);
};

// Creates the Express application. Kept separate from `serve.ts` so tests can
// exercise the app without binding to a port.
export const createApp = (config: Pick<Config, 'corsOrigins'>): Express => {
	const app = express();

	app.disable('x-powered-by');
	app.use(cors({ origin: config.corsOrigins }));
	app.use(express.json());

	// `/health` is exposed at the root for Docker and uptime checks.
	// Everything else lives under `/api`.
	app.use('/health', healthRouter);
	app.use('/api', apiRouter);

	app.use(notFound);
	app.use(errorHandler);

	return app;
};
