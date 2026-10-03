import { Router } from 'express';

export type HealthResponse = {
	status: 'ok';
};

export const healthRouter: Router = Router();

healthRouter.get('/', (_request, response) => {
	const body: HealthResponse = { status: 'ok' };

	response.status(200).json(body);
});
