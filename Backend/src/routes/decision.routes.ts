import { Router } from "express";
import { pool } from "../db/pool.js";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { io } from "../socket.js";

const decisionRouter = Router();

//creating rally decision - let's member to propose a decision for group to solve
decisionRouter.post("/:id/decisions", authenticateToken, async (req, res) => {

  const userId = res.locals.userId;
  const rallyId = req.params.id;
  const { title, description} = req.body;
  
  if (
    typeof title != "string" ||
    !title.trim() ||
    title.trim().length > 200
  ) {
    return res.status(400).json({
      status: "error",
      message: "A valid title (max 200 characters) and userId are required",
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

  try {
    const membership = await pool.query(
      `SELECT 1 FROM rally_members
            WHERE rally_id = $1 AND user_id = $2`,
      [rallyId, userId],
    );

    if (membership.rows.length === 0) {
      return res.status(403).json({
        status: "error",
        message: "Only rally members can create decisions",
      });
    }

    const result = await pool.query(
      `INSERT INTO decisions
         (rally_id, title, description, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [rallyId, title.trim(), description?.trim() || null, userId],
    );

    io.to(`rally:${rallyId}`).emit(
    "new-decision",
    result.rows[0]
);

    return res.status(201).json({
      status: "success",
      message: "Decision created successfully",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Failed to crete decision: ", err);

    return res.status(500).json({
      status: "error",
      message: "Failed to create decision",
    });
  }
});

//retrieving all decisions of particular rally including vote count
decisionRouter.get("/:id/decisions",authenticateToken, async (req, res) => {
  const userId = res.locals.userId;
  const rallyId = req.params.id;

  if(typeof userId !== "string" || !userId.trim()){
    return res.status(400).json({
      status: "error",
      message: "userId query parameter is required",
    });
  }

  try {
    const membership = await pool.query(
  `SELECT 1
   FROM rally_members
   WHERE rally_id = $1 AND user_id = $2`,
  [rallyId, userId],
);

if (membership.rows.length === 0) {
  return res.status(404).json({
    status: "error",
    message: "Rally not found",
  });
}

    const result = await pool.query(
      `SELECT
         d.id,
         d.rally_id,
         d.title,
         d.description,
         d.status,
         d.created_by,
         d.created_at,
         d.updated_at,
         COUNT(dv.id)::int AS total_votes,
         COUNT(dv.id) FILTER (WHERE dv.vote = 'YES')::int AS yes_votes,
         COUNT(dv.id) FILTER (WHERE dv.vote = 'NO')::int AS no_votes,
         COUNT(dv.id) FILTER (WHERE dv.vote = 'ABSTAIN')::int AS abstain_votes,

         MAX(dv.vote) FILTER (WHERE dv.user_id = $2) AS my_vote

       FROM decisions d
       LEFT JOIN decision_votes dv ON dv.decision_id = d.id
       WHERE d.rally_id = $1
       GROUP BY d.id
       ORDER BY d.created_at DESC`,
      [rallyId, userId],
    );

    return res.status(200).json({
      status: "success",
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error("Failed to fetch decisions:", error);

    return res.status(500).json({
      status: "error",
      message: "Failed to fetch decisions",
    });
  }
});

//voting
decisionRouter.post("/:id/vote",authenticateToken, async (req, res) => {
  const userId = res.locals.userId;
  const decisionId = req.params.id;
  const {vote} = req.body;

  const allowedVotes = ["YES", "NO", "ABSTAIN"];

  if (
    typeof vote !== "string" ||
    !allowedVotes.includes(vote)
  ) {
    return res.status(400).json({
      status: "error",
      message: "valid vote (YES, NO, ABSTAIN) is required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock the decision row until the transaction finishes.
    const decisionResult = await client.query(
      `SELECT id, rally_id, status
       FROM decisions
       WHERE id = $1
       FOR UPDATE`,
      [decisionId],
    );

    if (decisionResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        status: "error",
        message: "Decision not found",
      });
    }

    const decision = decisionResult.rows[0];

    if (decision.status !== "OPEN") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        status: "error",
        message: "Voting is closed for this decision",
      });
    }

    const membershipResult = await client.query(
      `SELECT 1
       FROM rally_members
       WHERE rally_id = $1 AND user_id = $2`,
      [decision.rally_id, userId],
    );

    if (membershipResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        status: "error",
        message: "Only Rally members can vote",
      });
    }

    const result = await client.query(
      `INSERT INTO decision_votes (decision_id, user_id, vote)
       VALUES ($1, $2, $3)
       ON CONFLICT (decision_id, user_id)
       DO UPDATE SET
         vote = EXCLUDED.vote,
         created_at = NOW()
       RETURNING *`,
      [decisionId, userId, vote],
    );

    await client.query("COMMIT");

    return res.status(200).json({
      status: "success",
      message: "Vote recorded successfully",
      data: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Failed to record vote:", error);

    return res.status(500).json({
      status: "error",
      message: "Failed to record vote",
    });
  }finally{
    client.release();
  }
});

//closing a decision, even after closing members can see their result, but can't add or change vote
decisionRouter.patch("/:id/close", authenticateToken, async (req, res) => {
  const userId = res.locals.userId;
  const decisionId = req.params.id;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock the decision to prevent concurrent voting while it closes.
    const decisionResult = await client.query(
      `SELECT id, rally_id, status, created_by
       FROM decisions
       WHERE id = $1
       FOR UPDATE`,
      [decisionId],
    );

    if (decisionResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        status: "error",
        message: "Decision not found",
      });
    }

    const decision = decisionResult.rows[0];

    // Only the Rally owner or the decision creator may close it.
    const permissionResult = await client.query(
      `SELECT 1
       FROM rally_members
       WHERE rally_id = $1
         AND user_id = $2
         AND role = 'OWNER'
       UNION
       SELECT 1
       WHERE $3 = $2`,
      [decision.rally_id, userId, decision.created_by],
    );

    if (permissionResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        status: "error",
        message: "Only the Rally owner or decision creator can close it",
      });
    }

    if (decision.status === "CLOSED") {
      await client.query("ROLLBACK");

      return res.status(409).json({
        status: "error",
        message: "Decision is already closed",
      });
    }

    const result = await client.query(
      `UPDATE decisions
       SET status = 'CLOSED',
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [decisionId],
    );

    await client.query("COMMIT");

    return res.status(200).json({
      status: "success",
      message: "Decision closed successfully",
      data: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Failed to close decision:", error);

    return res.status(500).json({
      status: "error",
      message: "Failed to close decision",
    });
  } finally {
    client.release();
  }
});


export default decisionRouter;
