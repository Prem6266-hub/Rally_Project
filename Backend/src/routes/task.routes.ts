import { Router } from "express";
import {pool} from "../db/pool.js";
import { authenticateToken } from "../middleware/auth.middleware.js";
// import { ClientRequest } from "node:http";
import { io } from "../socket.js";

const taskRouter = Router();

//creating a task
taskRouter.post(
    "/:id/create",
    authenticateToken,
    async (req, res) => {
        const userId = res.locals.userId;
        const rallyId = req.params.id;
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

        if (
            description !== undefined &&
            description !== null &&
            typeof description !== "string"
        ) {
            return res.status(400).json({
                status: "error",
                message: "Description must be a string",
            });
        }

        if (assignedTo !== undefined && assignedTo !== null &&
            (typeof assignedTo !== "string" || !assignedTo.trim())) {
            return res.status(400).json({
                status: "error",
                message: "assignedTo must be a valid user ID or null",
            });
        }

        if (dueDate !== undefined && dueDate !== null &&
            (typeof dueDate !== "string" || Number.isNaN(Date.parse(dueDate)))) {
            return res.status(400).json({
                status: "error",
                message: "dueDate must be a valid date string or null",
            });
        }

        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            // 1. Ensure the creator is a member of this Rally.
            const membershipResult = await client.query(
                `SELECT 1
                 FROM rally_members
                 WHERE rally_id = $1 AND user_id = $2`,
                [rallyId, userId]
            );

            if (membershipResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return res.status(404).json({
                    status: "error",
                    message: "Rally not found or you are not a member",
                });
            }

            // 2. If assignedTo is provided, ensure the assignee is a member.
            if (assignedTo) {
                const assigneeResult = await client.query(
                    `SELECT 1
                     FROM rally_members
                     WHERE rally_id = $1 AND user_id = $2`,
                    [rallyId, assignedTo.trim()]
                );

                if (assigneeResult.rows.length === 0) {
                    await client.query("ROLLBACK");
                    return res.status(400).json({
                        status: "error",
                        message: "Assignee must be a member of this Rally",
                    });
                }
            }

            // 3. Create the task.
            const taskResult = await client.query(
                `INSERT INTO tasks
                    (rally_id, title, description, assigned_to, created_by, due_date)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING *`,
                [
                    rallyId,
                    title.trim(),
                    description?.trim() || null,
                    assignedTo?.trim() || null,
                    userId,
                    dueDate || null,
                ]
            );

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

            return res.status(201).json({
                status: "success",
                message: "Task created successfully",
                data: {
                    task: taskResult.rows[0],
                },
            });
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            console.error("Create task error:", error);

            return res.status(500).json({
                status: "error",
                message: "Failed to create task",
            });
        } finally {
            client.release();
        }
    }
);

//get rally tasks including assignee details and who created each task (filtering as well) - do filtering by apeending query paramenters to the url
taskRouter.get(
    "/rallies/:id/get",
    authenticateToken,
    async (req, res) => {
        const userId = res.locals.userId;
        const rallyId = req.params.id;

        const { status, assignedTo, sortBy } = req.query;

        const allowedStatuses = ["TODO", "IN_PROGRESS", "COMPLETED"];
        const allowedSortFields = ["due_date", "created_at", "title"];

        if (
            status !== undefined &&
            (typeof status !== "string" ||
                !allowedStatuses.includes(status))
        ) {
            return res.status(400).json({
                status: "error",
                message: "Invalid status filter",
            });
        }

        if (
            assignedTo !== undefined &&
            typeof assignedTo !== "string"
        ) {
            return res.status(400).json({
                status: "error",
                message: "assignedTo must be a user ID",
            });
        }

        if (
            sortBy !== undefined &&
            (typeof sortBy !== "string" ||
                !allowedSortFields.includes(sortBy))
        ) {
            return res.status(400).json({
                status: "error",
                message: "sortBy must be due_date, created_at, or title",
            });
        }

        try {
            // 1. Verify Rally membership.
            const membershipResult = await pool.query(
                `SELECT 1
                 FROM rally_members
                 WHERE rally_id = $1 AND user_id = $2`,
                [rallyId, userId]
            );

            if (membershipResult.rows.length === 0) {
                return res.status(404).json({
                    status: "error",
                    message: "Rally not found or you are not a member",
                });
            }

            // 2. Build safe, parameterized filters.
            const conditions = ["t.rally_id = $1"];
            const values: unknown[] = [rallyId];

            if (status) {
                values.push(status);
                conditions.push(`t.status = $${values.length}`);
            }

            if (assignedTo === "me") {
                values.push(userId);
                conditions.push(`t.assigned_to = $${values.length}`);
            } else if (assignedTo) {
                values.push(assignedTo);
                conditions.push(`t.assigned_to = $${values.length}`);
            }

            // 3. Allow only predefined sorting columns.
            const orderBy =
                sortBy === "title"
                    ? "t.title ASC"
                    : sortBy === "created_at"
                        ? "t.created_at DESC"
                        : "t.due_date ASC NULLS LAST";

            // 4. Fetch matching tasks.
            const result = await pool.query(
                `SELECT
                    t.id,
                    t.rally_id,
                    t.title,
                    t.description,
                    t.status,
                    t.due_date,
                    t.created_at,
                    t.updated_at,
                    t.assigned_to,
                    assignee.name AS assignee_name,
                    assignee.email AS assignee_email,
                    t.created_by,
                    creator.name AS creator_name
                 FROM tasks t
                 LEFT JOIN users assignee ON assignee.id = t.assigned_to
                 JOIN users creator ON creator.id = t.created_by
                 WHERE ${conditions.join(" AND ")}
                 ORDER BY
                    CASE WHEN t.status = 'COMPLETED' THEN 1 ELSE 0 END,
                    ${orderBy}`,
                values
            );

            return res.status(200).json({
                status: "success",
                count: result.rows.length,
                data: {
                    tasks: result.rows,
                },
            });
        } catch (error) {
            console.error("Fetch tasks error:", error);

            return res.status(500).json({
                status: "error",
                message: "Failed to fetch tasks",
            });
        }
    }
);

// update task
taskRouter.patch("/:id/update", authenticateToken, async (req, res) => {
    const userId = res.locals.userId;
    const taskId = req.params.id;

    const { title, description, assignedTo, dueDate, status } = req.body;

    const allowedStatuses = ["TODO", "IN_PROGRESS", "COMPLETED"];

    if (
        title === undefined &&
        description === undefined &&
        assignedTo === undefined &&
        dueDate === undefined &&
        status === undefined
    ) {
        return res.status(400).json({
            status: "error",
            message: "Provide at least one field to update",
        });
    }

    if (
        title !== undefined &&
        (typeof title !== "string" ||
            !title.trim() ||
            title.trim().length > 200)
    ) {
        return res.status(400).json({
            status: "error",
            message: "Title must be between 1 and 200 characters",
        });
    }

    if (
        description !== undefined &&
        description !== null &&
        typeof description !== "string"
    ) {
        return res.status(400).json({
            status: "error",
            message: "Description must be a string or null",
        });
    }

    if (
        assignedTo !== undefined &&
        assignedTo !== null &&
        (typeof assignedTo !== "string" || !assignedTo.trim())
    ) {
        return res.status(400).json({
            status: "error",
            message: "assignedTo must be a user ID or null",
        });
    }

    if (
        dueDate !== undefined &&
        dueDate !== null &&
        (typeof dueDate !== "string" || Number.isNaN(Date.parse(dueDate)))
    ) {
        return res.status(400).json({
            status: "error",
            message: "dueDate must be a valid date string or null",
        });
    }

    if (status !== undefined && !allowedStatuses.includes(status)) {
        return res.status(400).json({
            status: "error",
            message: "Status must be TODO, IN_PROGRESS, or COMPLETED",
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // 1. Lock the task while updating it.
        const taskResult = await client.query(
            `SELECT id, rally_id, created_by
             FROM tasks
             WHERE id = $1
             FOR UPDATE`,
            [taskId]
        );

        if (taskResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                status: "error",
                message: "Task not found",
            });
        }

        const task = taskResult.rows[0];

        // 2. Ensure the requester is a member of the Rally.
        const membershipResult = await client.query(
            `SELECT role
             FROM rally_members
             WHERE rally_id = $1 AND user_id = $2`,
            [task.rally_id, userId]
        );

        if (membershipResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(403).json({
                status: "error",
                message: "You are not a member of this Rally",
            });
        }

        const isOwner = membershipResult.rows[0].role === "OWNER";
        const isCreator = task.created_by === userId;

        // 3. Only the creator or owner can edit task details.
        const isEditingDetails =
            title !== undefined ||
            description !== undefined ||
            assignedTo !== undefined ||
            dueDate !== undefined;

        if (isEditingDetails && !isOwner && !isCreator) {
            await client.query("ROLLBACK");
            return res.status(403).json({
                status: "error",
                message: "Only the task creator or Rally owner can edit task details",
            });
        }

        // 4. If assigning a user, ensure they belong to this Rally.
        if (assignedTo) {
            const assigneeResult = await client.query(
                `SELECT 1
                 FROM rally_members
                 WHERE rally_id = $1 AND user_id = $2`,
                [task.rally_id, assignedTo.trim()]
            );

            if (assigneeResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return res.status(400).json({
                    status: "error",
                    message: "Assignee must be a member of this Rally",
                });
            }
        }

        // 5. Update only fields supplied by the client.
        const updateResult = await client.query(
            `UPDATE tasks
             SET
                title = CASE WHEN $1::boolean THEN $2 ELSE title END,
                description = CASE WHEN $3::boolean THEN $4 ELSE description END,
                assigned_to = CASE WHEN $5::boolean THEN $6::uuid ELSE assigned_to END,
                due_date = CASE WHEN $7::boolean THEN $8::timestamptz ELSE due_date END,
                status = CASE WHEN $9::boolean THEN $10 ELSE status END,
                updated_at = NOW()
             WHERE id = $11
             RETURNING *`,
            [
                title !== undefined,
                title === undefined ? null : title.trim(),
                description !== undefined,
                description === undefined
                    ? null
                    : description === null
                        ? null
                        : description.trim(),
                assignedTo !== undefined,
                assignedTo === undefined
                    ? null
                    : assignedTo === null
                        ? null
                        : assignedTo.trim(),
                dueDate !== undefined,
                dueDate === undefined ? null : dueDate,
                status !== undefined,
                status ?? null,
                taskId,
            ]
        );

        await client.query("COMMIT");

        const previousAssignedTo = taskResult.rows[0].assigned_to;
        const updateTask = updateResult.rows[0];
        if(updateTask.assigned_to &&
            updateTask.assigned_to !== previousAssignedTo
        ){
            io.to(`user:${updateTask.assigned_to}`).emit(
        "task-assigned",
        updateTask
    );
        }

        return res.status(200).json({
            status: "success",
            message: "Task updated successfully",
            data: {
                task: updateResult.rows[0],
            },
        });
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.error("Update task error:", error);

        return res.status(500).json({
            status: "error",
            message: "Failed to update task",
        });
    } finally {
        client.release();
    }
});

//delete a task - only creator or owner
taskRouter.delete("/:id/delete", authenticateToken, async (req, res) => {
    const userId = res.locals.userId;
    const taskId = req.params.id;

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // 1. Find and lock the task.
        const taskResult = await client.query(
            `SELECT id, rally_id, created_by
             FROM tasks
             WHERE id = $1
             FOR UPDATE`,
            [taskId]
        );

        if (taskResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                status: "error",
                message: "Task not found",
            });
        }

        const task = taskResult.rows[0];

        // 2. Check the user's Rally membership and role.
        const membershipResult = await client.query(
            `SELECT role
             FROM rally_members
             WHERE rally_id = $1 AND user_id = $2`,
            [task.rally_id, userId]
        );

        if (membershipResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(403).json({
                status: "error",
                message: "You are not a member of this Rally",
            });
        }

        const isOwner = membershipResult.rows[0].role === "OWNER";
        const isCreator = task.created_by === userId;

        // 3. Only the creator or owner can delete the task.
        if (!isOwner && !isCreator) {
            await client.query("ROLLBACK");
            return res.status(403).json({
                status: "error",
                message: "Only the task creator or Rally owner can delete this task",
            });
        }

        // 4. Delete the task.
        await client.query(
            `DELETE FROM tasks WHERE id = $1`,
            [taskId]
        );

        await client.query("COMMIT");

        return res.status(200).json({
            status: "success",
            message: "Task deleted successfully",
        });
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.error("Delete task error:", error);

        return res.status(500).json({
            status: "error",
            message: "Failed to delete task",
        });
    } finally {
        client.release();
    }
});

export default taskRouter;