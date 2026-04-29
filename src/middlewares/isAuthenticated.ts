import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

interface AuthRequest extends Request {
  userId?: string;
  user?: any;
}

export const isAuthenticated = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  try {
    const token = req.cookies.token;

    if (!token) {
      res
        .status(401)
        .json({ message: "No token provided, authentication failed" });
      return;
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your_secret_key",
    );
    req.userId = (decoded as any).userId;
    req.user = decoded;

    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

