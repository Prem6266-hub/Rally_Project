import type { Request,Response} from "express";
import { aiRes } from "../services/ai.service.js";
import { resolvePendingTaskAction } from "../services/ai.tools.service.js";

export const chatWithAi = async(req: Request, res: Response) => {
    try {
        const {prompt, rallyId} = req.body;
        const userId = res.locals.userId;

        if(!prompt || typeof prompt !== "string" || !prompt.trim()){
            return res.status(400).json({
                status: "error",
                message: "Prompt is required",
            });
        }

        if (!rallyId || typeof rallyId !== "string") {
            return res.status(400).json({
                status: "error",
                message: "Rally ID is required",
            });
        }

        const response = await aiRes(prompt, rallyId,userId);

        return res.status(200).json({
            status: "success",
            data: {
                response,
            },
        });
    } catch (err) {
        console.error("AI controller Error: ", err);

        return res.status(500).json({
            status: "error",
            message: "Failed to generate AI response",
        });
    }
}

export const resolveAIAction = async (
  req: Request,
  res: Response
) => {
  try {
    const rallyId = req.params.rallyId;
    const actionId = req.params.actionId;
    const { decision } = req.body;
    const userId = res.locals.userId;

    if (
  typeof rallyId !== "string" ||
  typeof actionId !== "string"
) {
  return res.status(400).json({
    status: "error",
    message: "Invalid Rally ID or Action ID",
  });
}

    // Validate decision
    if (!["CONFIRM", "REJECT"].includes(decision)) {
      return res.status(400).json({
        status: "error",
        message: "Decision must be CONFIRM or REJECT",
      });
    }

    const result = await resolvePendingTaskAction(
      actionId,
      rallyId,
      userId,
      decision
    );

    return res.status(200).json({
      status: "success",
      data: result,
    });

  } catch (error) {
    console.error("AI Action Error:", error);

    const message =
      error instanceof Error ? error.message : "Something went wrong";

    const statusCode =
      message === "Pending action not found" ? 404 :
      message === "Unsupported action type" ? 400 :
      500;

    return res.status(statusCode).json({
      status: "error",
      message,
    });
  }
};