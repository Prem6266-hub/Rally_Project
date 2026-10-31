import "dotenv/config";
import { createServer } from "http";
import app from "./app.js";
import { initializeSocket } from "./socket.js";

const PORT = Number(process.env.PORT) || 3000;

const httpServer = createServer(app);

// Initialize Socket.IO.
initializeSocket(httpServer);

httpServer.listen(PORT, () => {
    console.log(`Rally backend running on port ${PORT}`);
});