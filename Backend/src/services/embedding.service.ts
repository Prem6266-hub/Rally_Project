
import { ai } from "../config/gemini.js";

type EmbeddingTaskType =
  | "RETRIEVAL_DOCUMENT"
  | "RETRIEVAL_QUERY";

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;

export const generateEmbedding = async (
  text: string,
  taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT"
): Promise<number[]> => {
  if (!text.trim()) {
    throw new Error("Text cannot be empty");
  }

  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: {
      taskType,
      outputDimensionality: EMBEDDING_DIMENSIONS,
    },
  });

  const values = response.embeddings?.[0]?.values;

  if (!values || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error("Failed to generate a valid embedding");
  }

  // Normalize the vector for consistent similarity calculations.
  const magnitude = Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0)
  );

  if (magnitude === 0) {
    throw new Error("Generated embedding has zero magnitude");
  }

  return values.map((value) => value / magnitude);
};
