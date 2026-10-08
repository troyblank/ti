import { afterEach, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';
import { MAX_MESSAGE_LENGTH } from './api/chat/index.ts';
import { createApp } from './app.ts';

const ORIGIN = 'http://localhost:5173';
const OLLAMA_URL = 'http://ollama.test:11434';
const OLLAMA_MODEL = 'llama3.2:3b';
const config = { corsOrigins: [ORIGIN], ollamaUrl: OLLAMA_URL, ollamaModel: OLLAMA_MODEL, ollamaTimeoutMs: 60_000 };

const mockOllamaReply = (body: unknown, status = 200) =>
	jest.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response(JSON.stringify(body), {
			status,
			headers: { 'Content-Type': 'application/json' },
		}),
	);

// A fetch that never answers, and resolves `aborted` once its request is cancelled.
const mockHangingOllama = () => {
	let markAborted: () => void = () => {};
	const aborted = new Promise<void>((resolve) => {
		markAborted = resolve;
	});

	jest.spyOn(globalThis, 'fetch').mockImplementation(
		(_url, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => {
					markAborted();
					reject(init.signal?.reason);
				});
			}),
	);

	return { aborted };
};

describe('TI API', () => {
	const app = createApp(config);

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


	describe('Planned API areas', () => {
		it.each(['/api/documents', '/api/conversations'])('Responds to %s with a JSON 501 until it is built.', async (path) => {
			const response = await request(app).post(path).send({});

			expect(response.status).toBe(501);
			expect(response.body).toEqual({ error: 'Not Implemented' });
		});

		it('Responds with a 501 for nested paths under a planned area.', async () => {
			const response = await request(app).get('/api/documents/123');

			expect(response.status).toBe(501);
		});
	});

	describe('POST /api/chat', () => {
		it('Returns the local model reply for a message.', async () => {
			mockOllamaReply({ message: { role: 'assistant', content: 'Hi there.' } });

			const response = await request(app).post('/api/chat').send({ message: '  Hello  ' });

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toMatch(/application\/json/);
			expect(response.body).toEqual({ message: 'Hi there.' });
			expect(globalThis.fetch).toHaveBeenCalledWith(`${OLLAMA_URL}/api/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: OLLAMA_MODEL,
					messages: [{ role: 'user', content: 'Hello' }],
					stream: false,
				}),
				signal: expect.any(AbortSignal),
			});
		});

		it.each([
			['the message is missing', {}],
			['the message is blank', { message: '   ' }],
			['the message is not text', { message: 42 }],
			['the body is a list', []],
			// JSON `null` and bare numbers are rejected by `express.json()` before the route runs;
			// kept here to pin the HTTP contract. The route's own guard is covered by `isRecord`'s tests.
			['the body is JSON null', null],
			['the body is a bare number', 42],
		])('Responds with a JSON 400 when %s.', async (_label, body) => {
			const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('should not be called'));

			const response = await request(app)
				.post('/api/chat')
				.set('Content-Type', 'application/json')
				.send(JSON.stringify(body));

			expect(response.status).toBe(400);
			expect(response.body).toEqual({ error: 'Bad Request' });
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('Responds with a JSON 404 when chat is called with a method other than POST.', async () => {
			const response = await request(app).get('/api/chat');

			expect(response.status).toBe(404);
			expect(response.body).toEqual({ error: 'Not Found' });
		});

		it('Responds with a generic JSON 500 when the local model cannot be reached.', async () => {
			const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
			const failure = new Error('connect ECONNREFUSED');
			jest.spyOn(globalThis, 'fetch').mockRejectedValue(failure);

			const response = await request(app).post('/api/chat').send({ message: 'Hello' });

			expect(response.status).toBe(500);
			expect(response.body).toEqual({ error: 'Internal Server Error' });
			expect(consoleError).toHaveBeenCalledWith(failure);
		});

		it.each([
			['returns an error status', () => mockOllamaReply({ error: 'model not found' }, 404)],
			['returns an unexpected payload', () => mockOllamaReply({ done: true })],
		])('Responds with a generic JSON 500 when the local model %s.', async (_label, mockOllama) => {
			const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
			mockOllama();

			const response = await request(app).post('/api/chat').send({ message: 'Hello' });

			expect(response.status).toBe(500);
			expect(response.body).toEqual({ error: 'Internal Server Error' });
			expect(consoleError).toHaveBeenCalledTimes(1);
		});

		it('Responds with a JSON 413 when the message is too long for the model.', async () => {
			const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('should not be called'));

			const response = await request(app)
				.post('/api/chat')
				.send({ message: 'a'.repeat(MAX_MESSAGE_LENGTH + 1) });

			expect(response.status).toBe(413);
			expect(response.body).toEqual({ error: 'Payload Too Large' });
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('Accepts a message exactly at the length limit.', async () => {
			mockOllamaReply({ message: { role: 'assistant', content: 'Ok.' } });

			const response = await request(app)
				.post('/api/chat')
				.send({ message: 'a'.repeat(MAX_MESSAGE_LENGTH) });

			expect(response.status).toBe(200);
		});

		it('Responds with a JSON 504 and cancels the request when the local model takes too long.', async () => {
			const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
			const { aborted } = mockHangingOllama();
			const impatientApp = createApp({ ...config, ollamaTimeoutMs: 20 });

			const response = await request(impatientApp).post('/api/chat').send({ message: 'Hello' });

			expect(response.status).toBe(504);
			expect(response.body).toEqual({ error: 'Gateway Timeout' });
			expect(consoleError).toHaveBeenCalledWith('Ollama did not answer within 20ms.');
			await aborted;
		});

		it('Cancels the local model request when the client disconnects.', async () => {
			const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
			const { aborted } = mockHangingOllama();

			await expect(request(app).post('/api/chat').send({ message: 'Hello' }).timeout(20)).rejects.toThrow(/Timeout/);
			await aborted;

			expect(consoleError).not.toHaveBeenCalled();
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
