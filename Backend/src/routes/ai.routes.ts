import {Router} from "express";
import { chatWithAi } from "../controllers/ai.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { resolveAIAction, getRallyInsights, analyzeConversation } from "../controllers/ai.controller.js";

const aiRouter = Router();

aiRouter.post("/chat", authenticateToken, chatWithAi);
aiRouter.post("/:rallyId/actions/:actionId", authenticateToken, resolveAIAction);
aiRouter.get("/:rallyId/insights", authenticateToken, getRallyInsights);
aiRouter.get("/:rallyId/conversation-analysis", authenticateToken, analyzeConversation);
aiRouter.post("/rallyId/conversation-analysis", authenticateToken, analyzeConversation);

export default aiRouter;