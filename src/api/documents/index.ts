import { Router } from 'express';
import { notImplemented } from '../../middleware/errors.ts';

// Placeholder until PDF upload (Phase 3) is built. Every request responds with a 501.
export const documentsRouter: Router = Router();

documentsRouter.use(notImplemented);
