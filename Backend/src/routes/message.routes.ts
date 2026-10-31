import { Router } from "express";
import { pool } from "../db/pool.js";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { io } from "../socket.js";

const messageRouter = Router();

//post  messages
messageRouter.post("/:id/post/message", authenticateToken, async (req, res) => {
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

    io.to(`rally:${rallyId}`).emit("new-message", result.rows[0]);

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

/////////////////////////// - task conversion and decision

//chat (message) -> task conversion api
messageRouter.post(
    "/:id/create-task",
    authenticateToken,
    async (req, res) => {
        const userId = res.locals.userId;
        const messageId = String(req.params.id);

        const { title, description, assignedTo, dueDate } = req.body;

        if (typeof title !== "string" || !title.trim()) {
            return res.status(400).json({
                status: "error",
                message: "Task title is required",
            });
        }

        if (title.trim().length > 200) {
            return res.status(400).json({
                status: "error",
                message: "Task title cannot exceed 200 characters",
            });
        }

        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            // 1. Find the message.
            const messageResult = await client.query(
                `SELECT id, rally_id
                 FROM messages
                 WHERE id = $1
                 FOR UPDATE`,
                [messageId]
            );

            if (messageResult.rows.length === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    status: "error",
                    message: "Message not found",
                });
            }

            const message = messageResult.rows[0];

            // 2. Verify Rally membership.
            const membershipResult = await client.query(
                `SELECT 1
                 FROM rally_members
                 WHERE rally_id = $1 AND user_id = $2`,
                [message.rally_id, userId]
            );

            if (membershipResult.rows.length === 0) {
                await client.query("ROLLBACK");

                return res.status(403).json({
                    status: "error",
                    message: "You are not a member of this Rally",
                });
            }

            // 3. If assigned, verify the assignee belongs to the Rally.
            if (assignedTo) {
                const assigneeResult = await client.query(
                    `SELECT 1
                     FROM rally_members
                     WHERE rally_id = $1 AND user_id = $2`,
                    [message.rally_id, assignedTo]
                );

                if (assigneeResult.rows.length === 0) {
                    await client.query("ROLLBACK");

                    return res.status(400).json({
                        status: "error",
                        message: "Assignee must be a member of this Rally",
                    });
                }
            }

            // 4. Create the linked task.
            const taskResult = await client.query(
                `INSERT INTO tasks (
                    rally_id,
                    title,
                    description,
                    assigned_to,
                    created_by,
                    due_date,
                    source_message_id
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *`,
                [
                    message.rally_id,
                    title.trim(),
                    description?.trim() || null,
                    assignedTo || null,
                    userId,
                    dueDate || null,
                    messageId,
                ]
            );

            await client.query("COMMIT");

            const task = taskResult.rows[0];

            // Notify Rally members about the new task.
            io.to(`rally:${message.rally_id}`).emit("new-task", task);

            // Notify only the assigned user.
            if (task.assigned_to) {
                io.to(`user:${task.assigned_to}`).emit(
                    "task-assigned",
                    task
                );
            }

            return res.status(201).json({
                status: "success",
                message: "Task created from message successfully",
                data: { task },
            });
        } catch (error: any) {
            await client.query("ROLLBACK").catch(() => {});

            // Same message already converted into a task.
            if (error.code === "23505") {
                return res.status(409).json({
                    status: "error",
                    message: "A task has already been created from this message",
                });
            }

            console.error("Create task from message error:", error);

            return res.status(500).json({
                status: "error",
                message: "Failed to create task from message",
            });
        } finally {
            client.release();
        }
    }
);

//chat (message) -> decision
messageRouter.post(
    "/:id/create-decision",
    authenticateToken,
    async (req, res) => {
        const userId = res.locals.userId;
        const messageId = String(req.params.id);

        const { title, description } = req.body;

        if (typeof title !== "string" || !title.trim()) {
            return res.status(400).json({
                status: "error",
                message: "Decision title is required",
            });
        }

        if (title.trim().length > 200) {
            return res.status(400).json({
                status: "error",
                message: "Decision title cannot exceed 200 characters",
            });
        }

        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            // 1. Find the original message.
            const messageResult = await client.query(
                `SELECT id, rally_id
                 FROM messages
                 WHERE id = $1
                 FOR UPDATE`,
                [messageId]
            );

            if (messageResult.rows.length === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    status: "error",
                    message: "Message not found",
                });
            }

            const message = messageResult.rows[0];

            // 2. Verify Rally membership.
            const membershipResult = await client.query(
                `SELECT 1
                 FROM rally_members
                 WHERE rally_id = $1 AND user_id = $2`,
                [message.rally_id, userId]
            );

            if (membershipResult.rows.length === 0) {
                await client.query("ROLLBACK");

                return res.status(403).json({
                    status: "error",
                    message: "You are not a member of this Rally",
                });
            }

            // 3. Create the Decision.
            const decisionResult = await client.query(
                `INSERT INTO decisions (
                    rally_id,
                    title,
                    description,
                    created_by,
                    source_message_id
                )
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *`,
                [
                    message.rally_id,
                    title.trim(),
                    typeof description === "string"
                        ? description.trim() || null
                        : null,
                    userId,
                    messageId,
                ]
            );

            await client.query("COMMIT");

            const decision = decisionResult.rows[0];

            // 4. Notify all Rally members.
            io.to(`rally:${message.rally_id}`).emit(
                "new-decision",
                decision
            );

            return res.status(201).json({
                status: "success",
                message: "Decision created from message successfully",
                data: { decision },
            });

        } catch (error: any) {
            await client.query("ROLLBACK").catch(() => {});

            if (error.code === "23505") {
                return res.status(409).json({
                    status: "error",
                    message: "A decision has already been created from this message",
                });
            }

            console.error("Create decision from message error:", error);

            return res.status(500).json({
                status: "error",
                message: "Failed to create decision from message",
            });
        } finally {
            client.release();
        }
    }
);

//conversion status - so frontend can know whether a message converted to task or decision already
messageRouter.get(
    "/:id/tsk_dczn_status",
    authenticateToken,
    async (req, res) => {
        const userId = res.locals.userId;
        const messageId = String(req.params.id);

        try {
            const result = await pool.query(
                `SELECT
                    m.id AS message_id,

                    t.id AS task_id,
                    t.title AS task_title,
                    t.status AS task_status,

                    d.id AS decision_id,
                    d.title AS decision_title,
                    d.status AS decision_status

                 FROM messages m

                 LEFT JOIN tasks t
                    ON t.source_message_id = m.id

                 LEFT JOIN decisions d
                    ON d.source_message_id = m.id

                 WHERE m.id = $1
                   AND EXISTS (
                       SELECT 1
                       FROM rally_members rm
                       WHERE rm.rally_id = m.rally_id
                         AND rm.user_id = $2
                   )`,
                [messageId, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    status: "error",
                    message: "Message not found or you are not a Rally member",
                });
            }

            const row = result.rows[0];

            return res.status(200).json({
                status: "success",
                data: {
                    task: row.task_id
                        ? {
                              id: row.task_id,
                              title: row.task_title,
                              status: row.task_status,
                          }
                        : null,

                    decision: row.decision_id
                        ? {
                              id: row.decision_id,
                              title: row.decision_title,
                              status: row.decision_status,
                          }
                        : null,
                },
            });
        } catch (error) {
            console.error("Get message actions error:", error);

            return res.status(500).json({
                status: "error",
                message: "Failed to fetch message actions",
            });
        }
    }
);

///////////////////////////

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
