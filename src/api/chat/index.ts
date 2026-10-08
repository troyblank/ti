import { Router } from 'express';
import type { Config } from '../../config.ts';
import { sendError } from '../../middleware/errors.ts';
import { isRecord } from '../../utils/isRecord.ts';
import { askOllama, type OllamaConfig } from './ollama.ts';

export type ChatResponse = {
	message: string;
};

export type ChatConfig = OllamaConfig & Pick<Config, 'ollamaTimeoutMs'>;

// Roughly 1,000 tokens — well inside a 3B model's context window, so a prompt is
// never silently truncated and one request can't tie up the NAS's CPU for long.
export const MAX_MESSAGE_LENGTH = 4000;

const readUserMessage = (body: unknown): string | undefined => {
	if (!isRecord(body) || typeof body.message !== 'string') {
		return undefined;
	}

	const trimmed = body.message.trim();

	return trimmed === '' ? undefined : trimmed;
};

// POST /api/chat — one message in, the local model's reply out. No documents yet.
export const createChatRouter = (config: ChatConfig): Router => {
	const router = Router();

	router.post('/', async (request, response) => {
		const message = readUserMessage(request.body);

		if (message === undefined) {
			sendError(response, 400);

			return;
		}

		if (message.length > MAX_MESSAGE_LENGTH) {
			sendError(response, 413);

			return;
		}

		// Cancel the Ollama request if the client goes away or the model takes too long.
		const clientGone = new AbortController();
		const deadline = AbortSignal.timeout(config.ollamaTimeoutMs);

		response.on('close', () => clientGone.abort());

		let reply: string;

		try {
			reply = await askOllama(config, message, AbortSignal.any([clientGone.signal, deadline]));
		} catch (error) {
			if (clientGone.signal.aborted) {
				return;
			}

			if (deadline.aborted) {
				console.error(`Ollama did not answer within ${config.ollamaTimeoutMs}ms.`);
				sendError(response, 504);

				return;
			}

			throw error;
		}

		const body: ChatResponse = { message: reply };

		response.status(200).json(body);
	});

	return router;
};
