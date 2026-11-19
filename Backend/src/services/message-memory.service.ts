import {pool} from "../db/pool.js"
import { generateEmbedding } from "./embedding.service.js"

export const storeMessageEmbedding = async (
  messageId: string,
  rallyId: string,
  content: string
) => {
  const embedding = await generateEmbedding(
    content,
    "RETRIEVAL_DOCUMENT"
  );

  const vectorString = `[${embedding.join(",")}]`;

  await pool.query(
    `INSERT INTO message_embeddings
      (message_id, rally_id, embedding)
     VALUES ($1, $2, $3::vector)
     ON CONFLICT (message_id)
     DO UPDATE SET embedding = EXCLUDED.embedding`,
    [messageId, rallyId, vectorString]
  );
};

export const searchRelevantMessages = async(rallyId: string, query: string, limit: number = 5) => {
    const queryEmbedding = await generateEmbedding(query, "RETRIEVAL_QUERY");

    const vectorString = `[${queryEmbedding.join(",")}]`;

     const result = await pool.query(
    `SELECT
        m.id,
        m.sender_id,
        u.name AS sender_name,
        m.content,
        m.created_at,
        1 - (me.embedding <=> $2::vector) AS similarity
     FROM message_embeddings me
     INNER JOIN messages m ON m.id = me.message_id
     INNER JOIN users u ON u.id = m.sender_id
     WHERE me.rally_id = $1
     ORDER BY me.embedding <=> $2::vector
     LIMIT $3`,
    [rallyId, vectorString, limit]
  );

  return result.rows;
}