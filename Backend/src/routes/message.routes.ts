import { Router } from "express";
import { pool } from "../db/pool.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const messageRouter = Router();

//post  messages
messageRouter.post("/:id/post", authenticateToken, async (req, res) => {
  const userId = res.locals.userId;
  const rallyId = req.params.id;
  const { content } = req.body;

  if (typeof content !== "string" || !content.trim()) {
    return res.status(400).json({
      status: "error",
      message: "Message content is required",
    });
  }

  if (content.trim().length > 5000) {
    return res.status(400).json({
      status: "error",
      message: "Message cannot exceed 5000 characters",
    });
  }

  try {
    // 1. Verify that the sender belongs to this Rally.
    const membershipResult = await pool.query(
      `SELECT 1
                 FROM rally_members
                 WHERE rally_id = $1 AND user_id = $2`,
      [rallyId, userId],
    );

    if (membershipResult.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Rally not found or you are not a member",
      });
    }

    // 2. Save the message.
    const result = await pool.query(
      `INSERT INTO messages (rally_id, sender_id, content)
                 VALUES ($1, $2, $3)
                 RETURNING id, rally_id, sender_id, content,
                           created_at, updated_at`,
      [rallyId, userId, content.trim()],
    );

    return res.status(201).json({
      status: "success",
      message: "Message sent successfully",
      data: {
        message: result.rows[0],
      },
    });
  } catch (error) {
    console.error("Send message error:", error);

    return res.status(500).json({
      status: "error",
      message: "Failed to send message",
    });
  }
});

//load conversations (chat) - append the query as well to get limited messages
messageRouter.get(
  "/:id/messages/get",
  authenticateToken,
  async (req, res) => {
    const userId = res.locals.userId;
    const rallyId = req.params.id;

    const limitParam = req.query.limit;
    const before = req.query.before;

    const limit = limitParam === undefined ? 50 : Number(limitParam);

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({
        status: "error",
        message: "Limit must be between 1 and 100",
      });
    }

    if (before !== undefined && typeof before !== "string") {
      return res.status(400).json({
        status: "error",
        message: "before must be a message timestamp",
      });
    }

    try {
      // 1. Verify Rally membership.
      const membershipResult = await pool.query(
        `SELECT 1
                 FROM rally_members
                 WHERE rally_id = $1 AND user_id = $2`,
        [rallyId, userId],
      );

      if (membershipResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Rally not found or you are not a member",
        });
      }

      // 2. Fetch messages with sender details.
      const values: unknown[] = [rallyId];
      let beforeCondition = "";

      if (before) {
        const beforeDate = new Date(before);

        if (Number.isNaN(beforeDate.getTime())) {
          return res.status(400).json({
            status: "error",
            message: "before must be a valid timestamp",
          });
        }

        values.push(beforeDate.toISOString());
        beforeCondition = `AND m.created_at < $${values.length}`;
      }

      values.push(limit);

      const result = await pool.query(
        `SELECT
                    m.id,
                    m.rally_id,
                    m.sender_id,
                    u.name AS sender_name,
                    m.content,
                    m.created_at,
                    m.updated_at
                 FROM messages m
                 JOIN users u ON u.id = m.sender_id
                 WHERE m.rally_id = $1
                   ${beforeCondition}
                 ORDER BY m.created_at DESC, m.id DESC
                 LIMIT $${values.length}`,
        values,
      );

      // Return oldest-to-newest for convenient chat rendering.
      const messages = result.rows.reverse();

      return res.status(200).json({
        status: "success",
        count: messages.length,
        data: { messages },
      });
    } catch (error) {
      console.error("Fetch messages error:", error);

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch messages",
      });
    }
  },
);

//message editing
messageRouter.patch("/:id/edit", authenticateToken, async(req,res) => {
    const userId = res.locals.userId;
    const messageId = req.params.id;
    const {content} = req.body;

    if (typeof content !== "string" || !content.trim()) {
            return res.status(400).json({
                status: "error",
                message: "Message content is required",
            });
        }

        if (content.trim().length > 5000) {
            return res.status(400).json({
                status: "error",
                message: "Message cannot exceed 5000 characters",
            });
        }

        try {
            const result = await pool.query(
                `UPDATE messages m
                 SET content = $1,
                     updated_at = NOW()
                 WHERE m.id = $2
                   AND m.sender_id = $3
                   AND EXISTS (
                       SELECT 1
                       FROM rally_members rm
                       WHERE rm.rally_id = m.rally_id
                         AND rm.user_id = $3
                   )
                 RETURNING
                     m.id,
                     m.rally_id,
                     m.sender_id,
                     m.content,
                     m.created_at,
                     m.updated_at`,
                [content.trim(), messageId, userId]
            );

            if(result.rows.length === 0){
                return res.status(404).json({
                    status: "error",
                    message: "Message not found or you cannot edit it",
                });
            }

            return res.status(200).json({
                status: "success",
                message: "Message updated successfully",
                data: {
                    message: result.rows[0],
                },
            });
        } catch (err) {
            console.error("Edit message error:", err);

            return res.status(500).json({
                status: "error",
                message: "Failed to edit message",
            });
        }
})

//deleting messages
messageRouter.delete(
    "/:id/delete",
    authenticateToken,
    async (req, res) => {
        const userId = res.locals.userId;
        const messageId = req.params.id;

        try {
            const result = await pool.query(
                `DELETE FROM messages m
                 USING rally_members rm
                 WHERE m.id = $1
                   AND rm.rally_id = m.rally_id
                   AND (
                       m.sender_id = $2
                       OR (
                           rm.user_id = $2
                           AND rm.role = 'OWNER'
                       )
                   )
                 RETURNING m.id, m.rally_id`,
                [messageId, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    status: "error",
                    message: "Message not found or you cannot delete it",
                });
            }

            return res.status(200).json({
                status: "success",
                message: "Message deleted successfully",
                data: {
                    messageId: result.rows[0].id,
                    rallyId: result.rows[0].rally_id,
                },
            });
        } catch (error) {
            console.error("Delete message error:", error);

            return res.status(500).json({
                status: "error",
                message: "Failed to delete message",
            });
        }
    }
);



export default messageRouter;
