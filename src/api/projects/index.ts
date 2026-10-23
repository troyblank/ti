import { Router, type NextFunction, type Request, type Response } from 'express';
import { sendError } from '../../middleware/errors.ts';
import { readNonBlankString } from '../../utils/readNonBlankString.ts';
import { createChatRouter, type ChatConfig } from '../chat/index.ts';
import { createDocumentsRouter, type DocumentsConfig } from '../documents/index.ts';
import { setRequestProject } from './requestProject.ts';
import { createProject, listProjects, readProject, type WriteProject } from './storage.ts';

export type ProjectsConfig = ChatConfig & DocumentsConfig;

// A display name, not a path. Long enough for a game title and its edition.
export const MAX_PROJECT_NAME_LENGTH = 255;

// Upload and chat both refuse a project that is not there before they do any work.
// The project found here is handed on, so the routes below never re-read the id from the URL.
const requireProject = (dataDir: string) => async (request: Request, response: Response, next: NextFunction) => {
	const project = await readProject(dataDir, request.params.projectId);

	if (project === undefined) {
		sendError(response, 404);

		return;
	}

	setRequestProject(response, project);
	next();
};

// /api/projects — create and list projects, and reach a project's documents and chat.
export const createProjectsRouter = (config: ProjectsConfig, writeProject?: WriteProject): Router => {
	const router = Router();
	const { dataDir } = config;

	router.post('/', async (request, response) => {
		const name = readNonBlankString(request.body, 'name');

		if (name === undefined) {
			sendError(response, 400);

			return;
		}

		if (name.length > MAX_PROJECT_NAME_LENGTH) {
			sendError(response, 413);

			return;
		}

		const project = await createProject(dataDir, name, writeProject);

		response.status(201).json(project);
	});

	router.get('/', async (_request, response) => {
		response.status(200).json(await listProjects(dataDir));
	});

	router.use('/:projectId/documents', requireProject(dataDir), createDocumentsRouter(config));
	router.use('/:projectId/chat', requireProject(dataDir), createChatRouter(config));

	return router;
};
