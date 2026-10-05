import { STATUS_CODES } from 'node:http';
import type { NextFunction, Request, Response } from 'express';

export type ErrorResponse = {
	error: string;
};

const sendError = (response: Response, status: number) => {
	const body: ErrorResponse = { error: STATUS_CODES[status] ?? 'Error' };

	response.status(status).json(body);
};

// Reads the HTTP status attached to an error by Express middleware (e.g. `express.json()`
// sets 400 for malformed JSON and 413 for oversized bodies).
const getStatus = (error: unknown): number | undefined => {
	if (typeof error !== 'object' || error === null) {
		return undefined;
	}

	const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
	const value = status ?? statusCode;

	return typeof value === 'number' ? value : undefined;
};

export const notFound = (_request: Request, response: Response) => {
	sendError(response, 404);
};

// Placeholder handler for API areas that are on the roadmap but not built yet.
export const notImplemented = (_request: Request, response: Response) => {
	sendError(response, 501);
};

// Client errors (4xx) are passed through with a generic message; anything else is
// logged and reported as a 500 so internal details never reach the client.
// Express identifies error handlers by arity, so `next` must stay in the signature.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
	const status = getStatus(error);

	if (status !== undefined && status >= 400 && status < 500) {
		sendError(response, status);

		return;
	}

	console.error(error);
	sendError(response, 500);
};
