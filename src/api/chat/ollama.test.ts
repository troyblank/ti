import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { askOllama } from './ollama.ts';

const ollama = { ollamaUrl: 'http://ollama.test:11434', ollamaModel: 'llama3.2:3b' };

const mockFetch = (body: unknown, status = 200) =>
	jest.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response(JSON.stringify(body), {
			status,
			headers: { 'Content-Type': 'application/json' },
		}),
	);

describe('askOllama', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('Returns the assistant reply from Ollama.', async () => {
		const fetchMock = mockFetch({ message: { role: 'assistant', content: 'Hi there.' } });
		const { signal } = new AbortController();

		await expect(askOllama(ollama, 'Hello', signal)).resolves.toBe('Hi there.');

		expect(fetchMock).toHaveBeenCalledWith('http://ollama.test:11434/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: 'llama3.2:3b',
				messages: [{ role: 'user', content: 'Hello' }],
				stream: false,
			}),
			signal,
		});
	});

	it('Rejects with the reason Ollama gives when it returns an error status.', async () => {
		mockFetch({ error: "model 'llama3.2:3b' not found" }, 404);

		await expect(askOllama(ollama, 'Hello', new AbortController().signal)).rejects.toThrow(
			/status 404: .*model 'llama3\.2:3b' not found/,
		);
	});

	it.each([
		['a non-object payload', 'nope'],
		['a null payload', null],
		['a list payload', []],
		['a payload without a message', {}],
		['a message that is not an object', { message: 'Hi' }],
		['a message without text', { message: { content: 1 } }],
	])('Rejects when Ollama returns %s.', async (_label, body) => {
		mockFetch(body);

		await expect(askOllama(ollama, 'Hello', new AbortController().signal)).rejects.toThrow(/assistant message/);
	});

	it('Passes cancellation through to the request.', async () => {
		const controller = new AbortController();
		const reason = new Error('client went away');
		jest.spyOn(globalThis, 'fetch').mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
				}),
		);

		const pending = askOllama(ollama, 'Hello', controller.signal);
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
	});
});
