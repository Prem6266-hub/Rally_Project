import { ai } from "../config/gemini.js";
import { getRallyContext } from "./ai.context.service.js";
import { rallyTools } from "../ai/tools.js";
import { createPendingTaskAction } from "./ai.tools.service.js";

export const aiRes = async (prompt: string, rallyId: string, userId: string) => {
    // Fetch Rally context
    const rallyContext = await getRallyContext(rallyId, userId);
    //prepare instructions for gemini
    const systemInstruction = `
        You are Rally AI, an intelligent planning and
        coordination assistant.

        You are helping users within a specific Rally.

        Use the provided Rally context to answer questions.

        You can help users with:
        - Understanding Rally progress.
        - Summarizing tasks and responsibilities.
        - Analyzing decisions and voting results.
        - Identifying pending work.
        - Summarizing recent conversations.
        - Suggesting improvements to coordination.

        Important rules:
        - Use only the provided Rally context for Rally-specific facts.
        - Never invent tasks, members, decisions, or voting results.
        - If information is unavailable, clearly say so.
        - Do not claim to have performed an action.
        - Provide clear, practical and concise answers.
    `;

//     const response = await ai.models.generateContent({
//         model: "gemini-3.6-flash",
//         config: {
//             systemInstruction,
//             tools: rallyTools,
//         },
//         contents: `
//             RALLY CONTEXT:

//             ${JSON.stringify(rallyContext, null, 2)}

//             USER QUESTION:

//             ${prompt}
//         `,
//     });

    
//     const functionCalls = response.functionCalls ?? [];

// // If Gemini returns a normal text response
// if (functionCalls.length === 0) {
//     return {
//         text: response.text ?? null,
//         functionCalls: [],
//     };
// }

// const executionResults = [];

// for (const functionCall of functionCalls) {

//     if (functionCall.name === "create_task") {

//         const args = functionCall.args as {
//             title?: string;
//             description?: string;
//             assignedTo?: string;
//             dueDate?: string;
//         };

//         if (!args.title || typeof args.title !== "string") {
//             throw new Error("Invalid task title");
//         }

//         const result = await createTaskFromAI(
//             {
//                 title: args.title,
//                 description: args.description,
//                 assignedTo: args.assignedTo,
//                 dueDate: args.dueDate,
//             },
//             rallyId,
//             userId
//         );

//         executionResults.push({
//             functionName: functionCall.name,
//             result,
//         });

//     } else {
//         throw new Error(
//             `Unsupported function: ${functionCall.name}`
//         );
//     }
// }

// return {
//     text: response.text ?? null,
//     functionCalls,
//     executionResults,
// };
//     // const response = await ai.models.generateContent({
//     //     model: "gemini-3.8-flash",
//     //     contents: prompt,
//     // });
//     // return response.text;
//     return {
//         text: response.text ?? null,
//         // functionCalls: response.functionCalls ?? [],
//         functionCalls,
//         executionResults,
//     };



const initialPrompt = `
    RALLY CONTEXT:

    ${JSON.stringify(rallyContext, null, 2)}

    USER QUESTION:

    ${prompt}
`;

const response = await ai.models.generateContent({
    model: "gemini-3.6-flash",

    config: {
        systemInstruction,
        tools: rallyTools,
    },

    contents: initialPrompt,
});

// Check whether Gemini requested any function calls
const functionCalls = response.functionCalls ?? [];

// No function call: return normal AI response
if (functionCalls.length === 0) {
    return {
        text: response.text ?? null,
        executionResults: [],
    };
}

// Preserve Gemini's complete model response
const modelContent = response.candidates?.[0]?.content;

if (!modelContent) {
    throw new Error("Gemini did not return model content");
}

const functionResponseParts = [];
const executionResults = [];

// Execute requested functions
// for (const functionCall of functionCalls) {

//     const functionName = functionCall.name;

//     if (!functionName) {
//         throw new Error("Function name is missing");
//     }

//     let result;

//     if (functionName === "create_task") {

//         const args = functionCall.args as {
//             title?: string;
//             description?: string;
//             assignedTo?: string;
//             dueDate?: string;
//         };

//         if (!args.title || typeof args.title !== "string") {
//             throw new Error("Invalid task title");
//         }

//         result = await createTaskFromAI(
//             {
//                 title: args.title,
//                 description: args.description,
//                 assignedTo: args.assignedTo,
//                 dueDate: args.dueDate,
//             },
//             rallyId,
//             userId
//         );

//     } else {
//         throw new Error(`Unsupported function: ${functionName}`);
//     }

//     executionResults.push({
//         functionName,
//         result,
//     });

//     // Prepare execution result for Gemini
//     functionResponseParts.push({
//         functionResponse: {
//             name: functionName,
//             response: {
//                 result,
//             },
//         },
//     });
// }
for (const call of functionCalls) {
  if (call.name === "create_task") {
    const result = await createPendingTaskAction(
      call.args as {
        title: string;
        description?: string;
        assignedTo?: string;
        dueDate?: string;
      },
      rallyId,
      userId
    );

    executionResults.push(result);

    functionResponseParts.push({
      functionResponse: {
        name: call.name,
        response: {
          result,
        },
      },
    });
  }
}

// Send function results back to Gemini
const finalResponse = await ai.models.generateContent({
    model: "gemini-3.6-flash",

    config: {
        systemInstruction,
        tools: rallyTools,
    },

    contents: [
        {
            role: "user",
            parts: [{ text: initialPrompt }],
        },
        modelContent,
        {
            role: "user",
            parts: functionResponseParts,
        },
    ],
});

// Return Gemini's final natural-language response
return {
    text: finalResponse.text ?? null,
    executionResults,
};
}
