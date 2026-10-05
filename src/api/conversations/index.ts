import { Router } from 'express';
import { notImplemented } from '../../middleware/errors.ts';

// Placeholder until Conversation history (Phase 8) is built. Every request responds with a 501.
export const conversationsRouter: Router = Router();

conversationsRouter.use(notImplemented);
