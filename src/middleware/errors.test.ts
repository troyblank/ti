import { afterEach, describe, expect, it, jest } from '@jest/globals';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { errorHandler } from './errors.ts';

const appThatThrows = (error: unknown) => {
	const app = express();

	app.get('/explode', () => {
		throw error;
	});
	app.use(errorHandler);

	return app;
};

describe('errorHandler', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('Logs the error and responds with a generic JSON 500.', async () => {
		const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
		const failure = new Error('boom');

		const response = await request(appThatThrows(failure)).get('/explode');

		expect(response.status).toBe(500);
		expect(response.body).toEqual({ error: 'Internal Server Error' });
		expect(consoleError).toHaveBeenCalledWith(failure);
	});

	it('Passes client errors through with a generic message and does not log them.', async () => {
		const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

		const response = await request(appThatThrows(Object.assign(new Error('too big'), { status: 413 }))).get('/explode');

		expect(response.status).toBe(413);
		expect(response.body).toEqual({ error: 'Payload Too Large' });
		expect(consoleError).not.toHaveBeenCalled();
	});

	it('Reads the status from statusCode when status is not set.', async () => {
		const response = await request(appThatThrows({ statusCode: 404 })).get('/explode');

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: 'Not Found' });
	});

	it('Falls back to a generic message for client statuses without a standard name.', async () => {
		const response = await request(appThatThrows({ status: 499 })).get('/explode');

		expect(response.status).toBe(499);
		expect(response.body).toEqual({ error: 'Error' });
	});

	it.each([
		['a server error status', { status: 503 }],
		['a non-numeric status', { status: 'bad' }],
		['a non-object value', 'boom'],
	])('Treats %s as an internal error.', async (_label, error) => {
		jest.spyOn(console, 'error').mockImplementation(() => {});

		const response = await request(appThatThrows(error)).get('/explode');

		expect(response.status).toBe(500);
		expect(response.body).toEqual({ error: 'Internal Server Error' });
	});

	// Express treats a thrown `null` as "no error", so this calls the handler directly.
	it('Treats null as an internal error.', () => {
		jest.spyOn(console, 'error').mockImplementation(() => {});
		const json = jest.fn();
		const response = { status: jest.fn<(status: number) => { json: typeof json }>(() => ({ json })) };

		errorHandler(null, {} as Request, response as unknown as Response, jest.fn());

		expect(response.status).toHaveBeenCalledWith(500);
		expect(json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
	});
});
