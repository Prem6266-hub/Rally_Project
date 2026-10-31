import { Server } from "socket.io";
import type { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { parse } from "cookie";
import { pool } from "./db/pool.js";
import {validate as isValidUUID} from "uuid";

export let io: Server;

export function initializeSocket(httpServer: HttpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: process.env.CLIENT_URL || "http://localhost:5173",
            credentials: true,
        },
    });

    // Authenticate socket connections using the existing JWT cookie.
    io.use((socket, next) => {
        try {
            const cookieHeader = socket.handshake.headers.cookie;

            if (!cookieHeader) {
                return next(new Error("Authentication required"));
            }

            const cookies = parse(cookieHeader);
            const token = cookies.rally_token;

            if (!token) {
                return next(new Error("Authentication required"));
            }

            const secret = process.env.JWT_SECRET;

            if (!secret) {
                return next(new Error("Server configuration error"));
            }

            const payload = jwt.verify(token, secret);

            if (
                typeof payload === "string" ||
                typeof payload.sub !== "string"
            ) {
                return next(new Error("Invalid token"));
            }

            socket.data.userId = payload.sub;

            next();
        } catch {
            next(new Error("Invalid or expired token"));
        }
    });

    // Handle authenticated socket connections.
    io.on("connection", (socket) => {
        console.log(`User connected: ${socket.data.userId}`);

        socket.join(`user:${socket.data.userId}`);

        // Join a Rally-specific room.
        // socket.on("join-rally", async (rallyId: string, callback) => {
        //     try {
        //         if (typeof rallyId !== "string" || !rallyId.trim()) {
        //             return callback?.({
        //                 error: "Invalid Rally ID",
        //             });
        //         }

        //         if(!isValidUUID(rallyId)){
        //             return callback?.({error: "Invalid Rally ID"});
        //         }

        //         const result = await pool.query(
        //             `SELECT 1
        //              FROM rally_members
        //              WHERE rally_id = $1 AND user_id = $2`,
        //             [rallyId, socket.data.userId]
        //         );

        //         if (result.rows.length === 0) {
        //             return callback?.({
        //                 error: "Not a Rally member",
        //             });
        //         }

        //         socket.join(`rally:${rallyId}`);

        //         callback?.({
        //             success: true,
        //         });
        //     } catch (error) {
        //         console.error("Error joining Rally room:", error);

        //         callback?.({
        //             error: "Could not join Rally room",
        //         });
        //     }
        // });
        socket.on("join-rally", async (rallyId: string, callback) => {
    const respond = typeof callback === "function" ? callback : () => {};

    try {
        if (typeof rallyId !== "string" || !isValidUUID(rallyId)) {
            return respond({ error: "Invalid Rally ID" });
        }

        const result = await pool.query(
            `SELECT 1
             FROM rally_members
             WHERE rally_id = $1 AND user_id = $2`,
            [rallyId, socket.data.userId]
        );

        if (result.rows.length === 0) {
            return respond({ error: "Not a Rally member" });
        }

        socket.join(`rally:${rallyId}`);

        respond({ success: true });
    } catch (error) {
        console.error("Error joining Rally room:", error);
        respond({ error: "Could not join Rally room" });
    }
});

        socket.on("disconnect", () => {
            console.log(`User disconnected: ${socket.data.userId}`);
        });
    });

    return io;
}

export function removeUserFromRally(
    rallyId: string,
    userId: string
){
    io.in(`user:${userId}`).socketsLeave(`rally:${rallyId}`);
}

export function removeRallyRoom(rallyId: string){
    io.in(`rally:${rallyId}`).socketsLeave(`rally:${rallyId}`);
}