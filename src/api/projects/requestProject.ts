import type { Response } from 'express';
import type { Project } from './storage.ts';

// The project a request was routed to, as checked by the projects router before
// any upload or chat work starts. Kept in response.locals for the rest of the request.
export const setRequestProject = (response: Response, project: Project): void => {
	response.locals.project = project;
};

// Only reachable through the projects router. A missing project here is a programming mistake, not a 404.
export const requestProject = (response: Response): Project => {
	const project: unknown = response.locals.project;

	if (project === undefined) {
		throw new Error('Project id is missing.');
	}

	return project as Project;
};
