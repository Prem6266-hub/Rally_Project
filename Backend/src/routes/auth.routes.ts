import dotenv from "dotenv";
dotenv.config();
import {Router} from "express";
import bcrypt from "bcrypt";
import {pool} from "../db/pool.js";
import  jwt  from "jsonwebtoken";
import type { Response } from "express";
import { authenticateToken } from "../middleware/auth.middleware.js";


const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const authRouter = Router();

function setAuthCookie(res: Response, userId: string){
  const secret = process.env.JWT_SECRET;

  if(!secret){
    throw new Error("JWT_SECRET is missing");
  }

  const token = jwt.sign(
    {sub: userId},
    secret,
    {expiresIn: "7d"},
  )

  res.cookie("rally_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

//register route
authRouter.post("/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof email !== "string" ||
    !email.trim() ||
    typeof password !== "string" ||
    password.length < 6
  ) {
    return res.status(400).json({
      status: "error",
      message:
        "Name, valid email, and password of at least 6 characters are required",
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at`,
      [name.trim(), email.trim().toLowerCase(), passwordHash],
    );

    const user = result.rows[0];

    setAuthCookie(res, user.id);

    return res.status(201).json({
      status: "success",
      message: "Account created and logged in successfully",
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          created_at: user.created_at,
        }
      },
    });
  } catch (error: any) {
    if (error.code === "23505") {
      return res.status(409).json({
        status: "error",
        message: "An account with this email already exists",
      });
    }

    console.error("Registration failed:", error);

    return res.status(500).json({
      status: "error",
      message: "Failed to register user",
    });
  }
});

//login route
authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (
    typeof email !== "string" ||
    !email.trim() ||
    typeof password !== "string" ||
    !password
  ) {
    return res.status(400).json({
      status: "error",
      message: "Email and password are required",
    });
  }

  // const jwtSecret = process.env.JWT_SECRET;

  // if (!jwtSecret) {
  //   console.error("JWT_SECRET is missing from environment variables");

  //   return res.status(500).json({
  //     status: "error",
  //     message: "Authentication is not configured",
  //   });
  // }

  try {
    const result = await pool.query(
      `SELECT id, name, email, password_hash
       FROM users
       WHERE email = $1`,
      [email.trim().toLowerCase()],
    );

    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        status: "error",
        message: "Invalid email or password",
      });
    }

    setAuthCookie(res, user.id);

    return res.status(200).json({
      status: "success",
      message: "Login successful",
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      },
    });
  } catch (error) {
    console.error("Login failed:", error);

    return res.status(500).json({
      status: "error",
      message: "Failed to log in",
    });
  }
});

////me
authRouter.get("/me", authenticateToken, async(_req,res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, created_at
      FROM users
      WHERE id = $1`,
      [res.locals.userId],
    );

    if(result.rows.length === 0){
      res.clearCookie("rally_token", {path: "/"});

      return res.status(401).json({
        status: "error",
        message: "User account no longer exists",
      });
    }

    return res.status(200).json({
      status: "success",
      data: {user: result.rows[0]},
    });
  } catch (err) {
    console.error("Session lookup failed:", err);

    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve session",
    });
  }
})

//logout
authRouter.post("/logout", async (_req,res) => {
    res.clearCookie('rally_token', {    //clearCookie option should match those options which used while setting cookie specially path, samesite, secure
      httpOnly:true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    return res.status(200).json({
      status: "success",
      message: "Logged out successfully",
    });
})




export default authRouter;