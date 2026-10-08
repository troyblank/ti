import type { Config } from '../../config.ts';
import { isRecord } from '../../utils/isRecord.ts';

export type OllamaConfig = Pick<Config, 'ollamaUrl' | 'ollamaModel'>;

// Ollama's chat response is `{ message: { role, content } }` when streaming is off.
const readAssistantMessage = (body: unknown): string => {
	if (!isRecord(body) || !isRecord(body.message) || typeof body.message.content !== 'string') {
		throw new Error('Ollama response did not include an assistant message.');
	}

	return body.message.content;
};

// Asks the configured model one question and returns the assistant's reply.
// `signal` cancels the request, so Ollama stops generating when nobody is waiting.
export const askOllama = async (
	{ ollamaUrl, ollamaModel }: OllamaConfig,
	message: string,
	signal: AbortSignal,
): Promise<string> => {
	const response = await fetch(`${ollamaUrl}/api/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: ollamaModel,
			messages: [{ role: 'user', content: message }],
			stream: false,
		}),
		signal,
	});

	if (!response.ok) {
		// Reading the body releases the connection and keeps Ollama's reason
		// (e.g. a model that was never pulled) in the log.
		const detail = await response.text();

		throw new Error(`Ollama request failed with status ${response.status}: ${detail}`);
	}

	return readAssistantMessage(await response.json());
};
