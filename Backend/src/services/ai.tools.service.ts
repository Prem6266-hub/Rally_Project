import { pool } from "../db/pool.js";
import { io } from "../socket.js";

interface CreateTaskArgs {
    title: string;
    description?: string | undefined;
    assignedTo?: string | undefined;
    dueDate?: string | undefined;
}

// export const createTaskFromAI = async (
//     args: CreateTaskArgs,
//     rallyId: string,
//     userId: string
// ) => {
//     const client = await pool.connect();

//     try {
//         await client.query("BEGIN");

//         // Verify that the requesting user belongs to the Rally
//         const memberResult = await client.query(
//             `SELECT 1
//              FROM rally_members
//              WHERE rally_id = $1
//              AND user_id = $2`,
//             [rallyId, userId]
//         );

//         if (memberResult.rows.length === 0) {
//             throw new Error("User is not a member of this Rally");
//         }

//         // Verify that the assigned user belongs to the Rally
//         if (args.assignedTo) {
//             const assigneeResult = await client.query(
//                 `SELECT 1
//                  FROM rally_members
//                  WHERE rally_id = $1
//                  AND user_id = $2`,
//                 [rallyId, args.assignedTo]
//             );

//             if (assigneeResult.rows.length === 0) {
//                 throw new Error("Assigned user is not a Rally member");
//             }
//         }

//         // Create task
//         const taskResult = await client.query(
//             `INSERT INTO tasks (
//                 rally_id,
//                 title,
//                 description,
//                 assigned_to,
//                 created_by,
//                 due_date
//             )
//             VALUES ($1, $2, $3, $4, $5, $6)
//             RETURNING *`,
//             [
//                 rallyId,
//                 args.title,
//                 args.description ?? null,
//                 args.assignedTo ?? null,
//                 userId,
//                 args.dueDate ?? null
//             ]
//         );

//         await client.query("COMMIT");

//         const newTask = taskResult.rows[0];

//          io.to(`rally:${rallyId}`).emit("new-task", newTask);

// // Notify only the assigned user.
// if (newTask.assigned_to) {
//     io.to(`user:${newTask.assigned_to}`).emit(
//         "task-assigned",
//         newTask
//     );
// }

//         return {
//             success: true,
//             task: taskResult.rows[0]
//         };

//     } catch (error) {
//         await client.query("ROLLBACK");
//         throw error;

//     } finally {
//         client.release();
//     }
// };



export const createPendingTaskAction = async (
  args: CreateTaskArgs,
  rallyId: string,
  userId: string
) => {
  if (!args.title || typeof args.title !== "string" || !args.title.trim()) {
    throw new Error("Task title is required");
  }

  const payload = {
    title: args.title.trim(),
    description: args.description ?? null,
    assignedTo: args.assignedTo ?? null,
    dueDate: args.dueDate ?? null,
  };

  const result = await pool.query(
    `INSERT INTO ai_pending_actions
      (rally_id, requested_by, action_type, payload)
     SELECT $1, $2, $3, $4
     WHERE EXISTS (
       SELECT 1
       FROM rally_members
       WHERE rally_id = $1 AND user_id = $2
     )
     RETURNING id, action_type, payload, status, expires_at`,
    [rallyId, userId, "CREATE_TASK", JSON.stringify(payload)]
  );

  if (result.rows.length === 0) {
    throw new Error("Rally not found or access denied");
  }

  return {
    success: true,
    message: "Task proposal created. Waiting for user confirmation.",
    pendingAction: result.rows[0],
  };
};

type PendingActionDecision = "CONFIRM" | "REJECT";

// export const resolvePendingTaskAction = async (
//   actionId: string,
//   rallyId: string,
//   userId: string,
//   decision: PendingActionDecision
// ) => {
//   const client = await pool.connect();

//   try {
//     await client.query("BEGIN");

//     // 1. Fetch and lock the pending action
//     const actionResult = await client.query(
//       `SELECT *
//        FROM ai_pending_actions
//        WHERE id = $1
//          AND rally_id = $2
//          AND requested_by = $3
//        FOR UPDATE`,
//       [actionId, rallyId, userId]
//     );

//     if (actionResult.rows.length === 0) {
//       throw new Error("Pending action not found");
//     }

//     const action = actionResult.rows[0];

//     // 2. Check its status
//     if (action.status !== "PENDING") {
//       throw new Error("This action has already been resolved");
//     }

//     // 3. Check expiration
//     if (new Date(action.expires_at) <= new Date()) {
//       await client.query(
//         `UPDATE ai_pending_actions
//          SET status = 'EXPIRED', resolved_at = NOW()
//          WHERE id = $1`,
//         [actionId]
//       );

//       await client.query("COMMIT");

//       return {
//         success: false,
//         message: "This task proposal has expired.",
//       };
//     }

//     // 4. Handle rejection
//     if (decision === "REJECT") {
//       await client.query(
//         `UPDATE ai_pending_actions
//          SET status = 'REJECTED', resolved_at = NOW()
//          WHERE id = $1`,
//         [actionId]
//       );

//       await client.query("COMMIT");

//       return {
//         success: true,
//         message: "Task proposal rejected.",
//       };
//     }

//     // 5. Handle confirmation
//     if (action.action_type !== "CREATE_TASK") {
//       throw new Error("Unsupported action type");
//     }

//     const payload = action.payload as CreateTaskArgs;

//     if (!payload.title?.trim()) {
//       throw new Error("Invalid task title");
//     }

//     // Validate assignee belongs to this Rally
//     if (payload.assignedTo) {
//       const assigneeResult = await client.query(
//         `SELECT 1
//          FROM rally_members
//          WHERE rally_id = $1 AND user_id = $2`,
//         [rallyId, payload.assignedTo]
//       );

//       if (assigneeResult.rows.length === 0) {
//         throw new Error("Invalid task assignee");
//       }
//     }

//     // Validate due date
//     if (
//       payload.dueDate &&
//       Number.isNaN(Date.parse(payload.dueDate))
//     ) {
//       throw new Error("Invalid due date");
//     }

//     // 6. Create the task
//     const taskResult = await client.query(
//       `INSERT INTO tasks
//         (rally_id, title, description, assigned_to, created_by, due_date)
//        VALUES ($1, $2, $3, $4, $5, $6)
//        RETURNING *`,
//       [
//         rallyId,
//         payload.title.trim(),
//         payload.description ?? null,
//         payload.assignedTo ?? null,
//         userId,
//         payload.dueDate ?? null,
//       ]
//     );

//     // 7. Mark action as executed
//     await client.query(
//       `UPDATE ai_pending_actions
//        SET status = 'EXECUTED', resolved_at = NOW()
//        WHERE id = $1`,
//       [actionId]
//     );

//     await client.query("COMMIT");

//     return {
//       success: true,
//       message: "Task created successfully.",
//       task: taskResult.rows[0],
//     };

//   } catch (error) {
//     await client.query("ROLLBACK");
//     throw error;
//   } finally {
//     client.release();
//   }
// };
export const resolvePendingTaskAction = async (
  actionId: string,
  rallyId: string,
  userId: string,
  decision: PendingActionDecision
) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Fetch and lock the pending action
    const actionResult = await client.query(
      `SELECT *
       FROM ai_pending_actions
       WHERE id = $1
         AND rally_id = $2
         AND requested_by = $3
       FOR UPDATE`,
      [actionId, rallyId, userId]
    );

    if (actionResult.rows.length === 0) {
      throw new Error("Pending action not found");
    }

    const action = actionResult.rows[0];

    // 2. Check action type
    if (action.action_type !== "CREATE_TASK") {
      throw new Error("Unsupported action type");
    }

    // 3. Check expiration
    if (new Date(action.expires_at) <= new Date()) {
      await client.query(
        `DELETE FROM ai_pending_actions WHERE id = $1`,
        [actionId]
      );

      await client.query("COMMIT");

      return {
        success: false,
        message: "This task proposal has expired.",
      };
    }

    // 4. Handle rejection
    if (decision === "REJECT") {
      await client.query(
        `DELETE FROM ai_pending_actions WHERE id = $1`,
        [actionId]
      );

      await client.query("COMMIT");

      return {
        success: true,
        message: "Task proposal rejected.",
      };
    }

    // 5. Validate task payload
    const payload = action.payload as CreateTaskArgs;

    if (
      !payload.title ||
      typeof payload.title !== "string" ||
      !payload.title.trim()
    ) {
      throw new Error("Invalid task title");
    }

    if (
      payload.dueDate &&
      Number.isNaN(Date.parse(payload.dueDate))
    ) {
      throw new Error("Invalid due date");
    }

    // 6. Validate assignee belongs to this Rally
    if (payload.assignedTo) {
      const assigneeResult = await client.query(
        `SELECT 1
         FROM rally_members
         WHERE rally_id = $1 AND user_id = $2`,
        [rallyId, payload.assignedTo]
      );

      if (assigneeResult.rows.length === 0) {
        throw new Error("Assigned user is not a Rally member");
      }
    }

    // 7. Create task
    const taskResult = await client.query(
      `INSERT INTO tasks
        (rally_id, title, description, assigned_to, created_by, due_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        rallyId,
        payload.title.trim(),
        payload.description ?? null,
        payload.assignedTo ?? null,
        userId,
        payload.dueDate ?? null,
      ]
    );

    // 8. Delete the temporary AI action
    await client.query(
      `DELETE FROM ai_pending_actions WHERE id = $1`,
      [actionId]
    );

    // 9. Commit transaction
    await client.query("COMMIT");

    const newTask = taskResult.rows[0];

                io.to(`rally:${rallyId}`).emit("new-task", newTask);

// Notify only the assigned user.
if (newTask.assigned_to) {
    io.to(`user:${newTask.assigned_to}`).emit(
        "task-assigned",
        newTask
    );
}

    return {
      success: true,
      message: "Task created successfully.",
      task: taskResult.rows[0],
    };

  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
