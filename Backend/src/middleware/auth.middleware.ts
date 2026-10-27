import type {Request, Response, NextFunction} from "express";
import jwt from "jsonwebtoken";

export function authenticateToken(
    req: Request,
    res: Response,
    next: NextFunction,
){
    const token = req.cookies?.rally_token;
    const secret = process.env.JWT_SECRET;

    if(!secret){
        console.error("JWT_SECRET is missing");
        return res.status(500).json({
            status: "error",
            message: "Authentication is not configured",
        });
    }

    if(!token){
        return res.status(401).json({
            status: "error",
            message: "Authentication required",
        });
    }

    try {
        //checks token's signature and expiration time
        const payload = jwt.verify(token, secret);
        if(
            typeof payload === "string" || 
        typeof payload.sub !== "string"
        ){
            return res.status(401).json({
                status: "error",
                message: "Invalid authentication token",
            });
        }

        res.locals.userId = payload.sub;
        next();
        
    } catch (err) {
        return res.status(401).json({
      status: "error",
      message: "Invalid or expired session",
    });
    }
}