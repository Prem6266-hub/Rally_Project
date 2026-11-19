import { generateEmbedding } from "./services/embedding.service.js";
const test = async () => {
  try {
    const embedding = await generateEmbedding(
      "We decided to use PostgreSQL for Rally."
    );

    console.log("Dimensions:", embedding.length);
    console.log("First five values:", embedding.slice(0, 5));
  } catch (error) {
    console.error("Embedding test failed:", error);
  }
};

test();