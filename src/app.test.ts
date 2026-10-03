import { afterEach, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createApp, errorHandler } from './app.ts';

const ORIGIN = 'http://localhost:5173';

describe('TI API', () => {
	const app = createApp({ corsOrigins: [ORIGIN] });

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('GET /health', () => {
		it('Reports the service is healthy with an ok status.', async () => {
			const response = await request(app).get('/health');

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toMatch(/application\/json/);
			expect(response.body).toEqual({ status: 'ok' });
		});

		it('Is also reachable under the /api prefix.', async () => {
			const response = await request(app).get('/api/health');

			expect(response.status).toBe(200);
			expect(response.body).toEqual({ status: 'ok' });
		});
	});

	describe('CORS', () => {
		it('Allows a configured browser origin to call the API.', async () => {
			const response = await request(app).get('/health').set('Origin', ORIGIN);

			expect(response.headers['access-control-allow-origin']).toBe(ORIGIN);
		});

		it('Does not allow an origin that is not configured.', async () => {
			const response = await request(app).get('/health').set('Origin', 'https://evil.example.com');

			expect(response.headers['access-control-allow-origin']).toBeUndefined();
		});
	});

	describe('Unknown routes', () => {
		it('Responds with a JSON 404 for paths that do not exist.', async () => {
			const response = await request(app).get('/does-not-exist');

			expect(response.status).toBe(404);
			expect(response.body).toEqual({ error: 'Not Found' });
		});
	});

	describe('Security headers', () => {
		it('Does not advertise the framework in use.', async () => {
			const response = await request(app).get('/health');

			expect(response.headers['x-powered-by']).toBeUndefined();
		});
	});

	describe('Unhandled errors', () => {
		it('Logs the error and responds with a generic JSON 500.', async () => {
			const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
			const failure = new Error('boom');
			const brokenApp = express();

			brokenApp.get('/explode', () => {
				throw failure;
			});
			brokenApp.use(errorHandler);

			const response = await request(brokenApp).get('/explode');

			expect(response.status).toBe(500);
			expect(response.body).toEqual({ error: 'Internal Server Error' });
			expect(consoleError).toHaveBeenCalledWith(failure);
		});
	});
});
