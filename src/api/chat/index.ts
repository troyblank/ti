import { Router } from 'express';
import type { Config } from '../../config.ts';
import { sendError } from '../../middleware/errors.ts';
import { readNonBlankString } from '../../utils/readNonBlankString.ts';
import { askOllama, type OllamaConfig } from './ollama.ts';

export type ChatResponse = {
	message: string;
};

export type ChatConfig = OllamaConfig & Pick<Config, 'ollamaTimeoutMs'>;

// Roughly 1,000 tokens — well inside a 3B model's context window, so a prompt is
// never silently truncated and one request can't tie up the NAS's CPU for long.
export const MAX_MESSAGE_LENGTH = 4000;

// POST / — one message in, the local model's reply out.
// Mounted at /api/projects/:projectId/chat. The caller has already checked the project exists.
// Document text is not included yet; grounding the reply in the project's PDFs arrives with RAG.
export const createChatRouter = (config: ChatConfig): Router => {
	const router = Router();

	router.post('/', async (request, response) => {
		const message = readNonBlankString(request.body, 'message');

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
