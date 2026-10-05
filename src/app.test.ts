import { describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { createApp } from './app.ts';

const ORIGIN = 'http://localhost:5173';

describe('TI API', () => {
	const app = createApp({ corsOrigins: [ORIGIN] });

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


	describe('Planned API areas', () => {
		it.each(['/api/documents', '/api/chat', '/api/conversations'])('Responds to %s with a JSON 501 until it is built.', async (path) => {
			const response = await request(app).post(path).send({});

			expect(response.status).toBe(501);
			expect(response.body).toEqual({ error: 'Not Implemented' });
		});

		it('Responds with a 501 for nested paths under a planned area.', async () => {
			const response = await request(app).get('/api/documents/123');

			expect(response.status).toBe(501);
		});
	});

	describe('Request bodies', () => {
		it('Responds with a JSON 400 when the body is malformed JSON.', async () => {
			const response = await request(app).post('/api/chat').set('Content-Type', 'application/json').send('{ not json');

			expect(response.status).toBe(400);
			expect(response.body).toEqual({ error: 'Bad Request' });
		});
	});
});
