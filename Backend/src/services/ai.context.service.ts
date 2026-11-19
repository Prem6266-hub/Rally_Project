import { pool } from "../db/pool.js";

export const getRallyContext = async (rallyId: string, userId: string) => {
  const client = await pool.connect();

  try {
    const rallyResult = await client.query(
      `SELECT
        r.id,
        r.title,
        r.description,
        r.status,
        r.created_at,
        rm.role
     FROM rallies r
     INNER JOIN rally_members rm
        ON rm.rally_id = r.id
     WHERE r.id = $1
       AND rm.user_id = $2`,
      [rallyId, userId],
    );

    if (rallyResult.rows.length === 0) {
      throw new Error("Rally not found or access denied");
    }

    const rally = rallyResult.rows[0];

    const membersResult = await client.query(
      `SELECT
        u.id,
        u.name,
        rm.role,
        rm.joined_at
     FROM rally_members rm
     INNER JOIN users u
        ON u.id = rm.user_id
     WHERE rm.rally_id = $1
     ORDER BY rm.joined_at ASC`,
      [rallyId],
    );

    const members = membersResult.rows;

    const tasksResult = await client.query(
      `SELECT
        t.id,
        t.title,
        t.description,
        t.status,
        t.due_date,
        t.created_at,
        t.assigned_to,
        assignee.name AS assigned_to_name,
        creator.name AS created_by_name
     FROM tasks t
     LEFT JOIN users assignee
        ON assignee.id = t.assigned_to
     INNER JOIN users creator
        ON creator.id = t.created_by
     WHERE t.rally_id = $1
     ORDER BY t.created_at DESC`,
      [rallyId],
    );

    const tasks = tasksResult.rows;

    const decisionsResult = await client.query(
      `SELECT
        d.id,
        d.title,
        d.description,
        d.status,
        d.created_by,
        creator.name AS created_by_name,
        d.created_at,

        COUNT(dv.id)::int AS total_votes,

        COUNT(dv.id) FILTER (
            WHERE dv.vote = 'YES'
        )::int AS yes_votes,

        COUNT(dv.id) FILTER (
            WHERE dv.vote = 'NO'
        )::int AS no_votes,

        COUNT(dv.id) FILTER (
            WHERE dv.vote = 'ABSTAIN'
        )::int AS abstain_votes

     FROM decisions d

     INNER JOIN users creator
        ON creator.id = d.created_by

     LEFT JOIN decision_votes dv
        ON dv.decision_id = d.id

     WHERE d.rally_id = $1

     GROUP BY d.id, creator.name

     ORDER BY d.created_at DESC`,
      [rallyId],
    );

    const decisions = decisionsResult.rows;

    const messagesResult = await client.query(
      `SELECT
        m.id,
        m.content,
        m.created_at,
        u.name AS sender_name

     FROM messages m

     INNER JOIN users u
        ON u.id = m.sender_id

     WHERE m.rally_id = $1

     ORDER BY m.created_at DESC

     LIMIT 30`,
      [rallyId],
    );

    if (messagesResult.rows.length === 0) {
      throw new Error("No messages found");
    }

    const messages = messagesResult.rows.reverse();

    return {
      rally,
      members,
      tasks,
      decisions,
      messages,
    };
  } finally {
    client.release();
  }
};
