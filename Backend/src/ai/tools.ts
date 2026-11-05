


// export const rallyTools = [
//     {
//         functionDeclarations: [
//             {
//                 name: "create_task",
//                 description:
//                     "Create a new task inside the current Rally.",
//                 parameters: {
//                     type: "OBJECT",
//                     properties: {
//                         title: {
//                             type: "STRING",
//                             description: "Title of the task",
//                         },
//                         description: {
//                             type: "STRING",
//                             description: "Description of the task",
//                         },
//                         assignedTo: {
//                             type: "STRING",
//                             description:
//                                 "UUID of the Rally member assigned to this task",
//                         },
//                         dueDate: {
//                             type: "STRING",
//                             description:
//                                 "Task due date in ISO 8601 format",
//                         },
//                     },
//                     required: ["title"],
//                 },
//             },
//         ],
//     },
// ];




















import { Type } from "@google/genai";
import type { Tool } from "@google/genai";

export const rallyTools: Tool[] = [
    {
        functionDeclarations: [
            {
                name: "create_task",
                description:
                    "Create a new task inside the current Rally.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        title: {
                            type: Type.STRING,
                            description: "Title of the task",
                        },
                        description: {
                            type: Type.STRING,
                            description: "Description of the task",
                        },
                        assignedTo: {
                            type: Type.STRING,
                            description:
                                "UUID of the Rally member assigned to this task",
                        },
                        dueDate: {
                            type: Type.STRING,
                            description:
                                "Task due date in ISO 8601 format",
                        },
                    },
                    required: ["title"],
                },
            },
        ],
    },
];