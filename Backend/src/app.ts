import express from "express";
import cors from "cors";
import { pool } from "./db/pool.js";
import rallyRoutes from "./routes/rally.routes.js";
import decisionRoutes from "./routes/decision.routes.js";
import authRoutes from "./routes/auth.routes.js";
import cookieParser from "cookie-parser";
import inviteRoutes from "./routes/invitation.routes.js";

const app = express();

app.use(cookieParser());

app.use(
  cors({
    origin: "http://localhost:5173", //have to replace with real frontend route
    credentials: true,
  })
)

app.use(express.json());



//routes
app.use("/api/rallies", rallyRoutes);
app.use("/api/rallies", decisionRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/rallies", inviteRoutes);


app.get("/test", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Rally Backend is running",
  });
});

app.get("/db-check", async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT NOW() AS current_time, current_database() AS database_name",
    );
    res.status(200).json({
      status: "connected",
      database: result.rows[0].database_name,
      time: result.rows[0].current_time,
    });
  } catch (err) {
    console.error("Database connection failed:", err);

    res.status(500).json({
      status: "error",
      message: "Could not connect to the database",
    });
  }
});



export default app;
