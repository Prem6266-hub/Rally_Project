import {Router} from "express";
import {pool} from "../db/pool.js";
import {authenticateToken} from "../middleware/auth.middleware.js";

const inviteRouter = Router();

//invite a already registered user
inviteRouter.post(
    "/:id/invitations",
    authenticateToken,
    async (req, res) => {
        const userId = res.locals.userId;
        const rallyId = req.params.id;
        const { email } = req.body;

        if (typeof email !== "string" || !email.trim()) {
            return res.status(400).json({
                status: "error",
                message: "Email is required",
            });
        }

        let client;

        try {
            client = await pool.connect();
            await client.query("BEGIN");

            // 1. Only the Rally owner can send invitations.
            const ownerResult = await client.query(
                `SELECT 1
                 FROM rally_members
                 WHERE rally_id = $1
                   AND user_id = $2
                   AND role = 'OWNER'
                 FOR UPDATE`,
                [rallyId, userId]
            );

            if (ownerResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return res.status(404).json({
                    status: "error",
                    message: "Rally not found or you are not the owner",
                });
            }

            // 2. Find the registered user by email.
            const userResult = await client.query(
                `SELECT id, name, email
                 FROM users
                 WHERE LOWER(email) = LOWER($1)`,
                [email.trim()]
            );

            if (userResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return res.status(404).json({
                    status: "error",
                    message: "No registered user found with this email",
                });
            }

            const invitee = userResult.rows[0];

            // 3. Prevent inviting an existing member.
            const memberResult = await client.query(
                `SELECT 1
                 FROM rally_members
                 WHERE rally_id = $1 AND user_id = $2`,
                [rallyId, invitee.id]
            );

            if (memberResult.rows.length > 0) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    status: "error",
                    message: "This user is already a Rally member",
                });
            }

            // 4. Prevent duplicate pending invitations.
            const pendingResult = await client.query(
                `SELECT 1
                 FROM invitations
                 WHERE rally_id = $1
                   AND invitee_user_id = $2
                   AND status = 'PENDING'`,
                [rallyId, invitee.id]
            );

            if (pendingResult.rows.length > 0) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    status: "error",
                    message: "A pending invitation already exists",
                });
            }

            // 5. Create the invitation.
            const invitationResult = await client.query(
                `INSERT INTO invitations
                    (rally_id, invitee_user_id, invited_by_user_id, status)
                 VALUES ($1, $2, $3, 'PENDING')
                 RETURNING id, rally_id, invitee_user_id,
                           invited_by_user_id, status, created_at`,
                [rallyId, invitee.id, userId]
            );

            await client.query("COMMIT");

            return res.status(201).json({
                status: "success",
                message: "Invitation sent successfully",
                data: {
                    invitation: invitationResult.rows[0],
                    invitee: {
                        id: invitee.id,
                        name: invitee.name,
                        email: invitee.email,
                    },
                },
            });
        } catch (error) {
            if (client) {
                await client.query("ROLLBACK").catch(() => {});
            }

            console.error("Create invitation error:", error);

            return res.status(500).json({
                status: "error",
                message: "Failed to send invitation",
            });
        } finally {
            client?.release();
        }
    }
);

//get the invitation - logged in user can get/see rally/invitations they've received
inviteRouter.get("/", authenticateToken, async (req, res) => {
    const userId = res.locals.userId;

    try {
        const result = await pool.query(
            `SELECT
                i.id,
                i.rally_id,
                i.status,
                i.created_at,
                r.title AS rally_title,
                r.description AS rally_description,
                u.name AS invited_by_name,
                u.email AS invited_by_email
             FROM invitations i
             JOIN rallies r ON r.id = i.rally_id
             JOIN users u ON u.id = i.invited_by_user_id
             WHERE i.invitee_user_id = $1
               AND i.status = 'PENDING'
             ORDER BY i.created_at DESC`,
            [userId]
        );

        return res.status(200).json({
            status: "success",
            count: result.rows.length,
            data: {
                invitations: result.rows,
            },
        });
    } catch (error) {
        console.error("Fetch invitations error:", error);

        return res.status(500).json({
            status: "error",
            message: "Failed to fetch invitations",
        });
    }
});

//accepting or rejecting invitations
inviteRouter.patch(
    "/invitations/:id/respond",
    authenticateToken,
    async (req, res) => {
        const userId = res.locals.userId;
        const invitationId = req.params.id;
        const { action } = req.body;

        if (action !== "ACCEPT" && action !== "REJECT") {
            return res.status(400).json({
                status: "error",
                message: "Action must be ACCEPT or REJECT",
            });
        }

        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            // 1. Find and lock the invitation.
            const invitationResult = await client.query(
                `SELECT id, rally_id, status
                 FROM invitations
                 WHERE id = $1 AND invitee_user_id = $2
                 FOR UPDATE`,
                [invitationId, userId]
            );

            if (invitationResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return res.status(404).json({
                    status: "error",
                    message: "Invitation not found",
                });
            }

            const invitation = invitationResult.rows[0];

            // 2. Only pending invitations can be answered.
            if (invitation.status !== "PENDING") {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    status: "error",
                    message: "This invitation has already been answered",
                });
            }

            if (action === "ACCEPT") {
                // 3. Add the user to the Rally.
                await client.query(
                    `INSERT INTO rally_members (rally_id, user_id, role)
                     VALUES ($1, $2, 'MEMBER')
                     ON CONFLICT (rally_id, user_id) DO NOTHING`,
                    [invitation.rally_id, userId]
                );
            }

            // 4. Update the invitation status.
            const newStatus = action === "ACCEPT" ? "ACCEPTED" : "REJECTED";

            await client.query(
                `UPDATE invitations
                 SET status = $1, responded_at = NOW()
                 WHERE id = $2`,
                [newStatus, invitationId]
            );

            await client.query("COMMIT");

            return res.status(200).json({
                status: "success",
                message: `Invitation ${action.toLowerCase()}ed successfully`,
                data: {
                    invitationId,
                    rallyId: invitation.rally_id,
                    invitationStatus: newStatus,
                },
            });
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {});
            console.error("Respond to invitation error:", error);

            return res.status(500).json({
                status: "error",
                message: "Failed to respond to invitation",
            });
        } finally {
            client.release();
        }
    }
);

//rally owner to view all invitation send for particular rally
inviteRouter.get(
    "rallies/:id/invitations",
    authenticateToken,
    async (req, res) => {
        const userId = res.locals.userId;
        const rallyId = req.params.id;

        try {
            // Only the Rally owner can view sent invitations.
            const ownerResult = await pool.query(
                `SELECT 1
                 FROM rally_members
                 WHERE rally_id = $1
                   AND user_id = $2
                   AND role = 'OWNER'`,
                [rallyId, userId]
            );

            if (ownerResult.rows.length === 0) {
                return res.status(404).json({
                    status: "error",
                    message: "Rally not found or you are not the owner",
                });
            }

            const result = await pool.query(
                `SELECT
                    i.id,
                    i.invitee_user_id,
                    u.name AS invitee_name,
                    u.email AS invitee_email,
                    i.status,
                    i.created_at,
                    i.responded_at
                 FROM invitations i
                 JOIN users u ON u.id = i.invitee_user_id
                 WHERE i.rally_id = $1
                 ORDER BY i.created_at DESC`,
                [rallyId]
            );

            return res.status(200).json({
                status: "success",
                count: result.rows.length,
                data: {
                    invitations: result.rows,
                },
            });
        } catch (error) {
            console.error("Fetch Rally invitations error:", error);

            return res.status(500).json({
                status: "error",
                message: "Failed to fetch Rally invitations",
            });
        }
    }
);

export default inviteRouter;