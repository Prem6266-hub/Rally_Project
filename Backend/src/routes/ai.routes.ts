import {Router} from "express";
import { chatWithAi } from "../controllers/ai.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { resolveAIAction } from "../controllers/ai.controller.js";

const aiRouter = Router();

aiRouter.post("/chat", authenticateToken, chatWithAi);
aiRouter.post("/:rallyId/actions/:actionId", authenticateToken, resolveAIAction);

export default aiRouter;