import dotenv from "dotenv";
dotenv.config();
import { GoogleGenAI } from "@google/genai";


const geminiApiKey = process.env.GEMINI_API_KEY;

if(!geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not defined");
}

export const ai = new GoogleGenAI({
    apiKey: geminiApiKey,
});