import { Router } from 'express';
import { notImplemented } from '../../middleware/errors.ts';

// Placeholder until Chat API (Phase 2) is built. Every request responds with a 501.
export const chatRouter: Router = Router();

chatRouter.use(notImplemented);
