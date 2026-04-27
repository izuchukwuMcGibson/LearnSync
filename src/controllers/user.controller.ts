import { PrismaClient } from "@prisma/client";
import type { User } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import "dotenv/config";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

type RegisterBody = {
  name: string;
  email: string;
  password: string;
};

type ErrorMessage = {
  error: string;
};

type SuccessMessage = {
  message: string;
  user?: User;
};

export const register = async (
  req: Request<{}, {}, RegisterBody>,
  res: Response<SuccessMessage | ErrorMessage>,
) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ message: "Name, email, and password are required" });
  }
  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: "Email already in use" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const token = jwt.sign({ email }, process.env.JWT_SECRET!, {
      expiresIn: "1h",
    });
    const newUser = await prisma.user.create({
      data: { name, email, password: hashedPassword },
    });
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 3600000, // 1 hour
    });
    return res
      .status(201)
      .json({ message: "User registered successfully", user: newUser });
  } catch (error) {
    return res.status(500).json({
      message: "Error occurred while registering user",
      error: (error as Error).message,
    });
  }
};

export const login = async (
  req: Request<{}, {}, { email: string; password: string }>,
  res: Response<SuccessMessage | ErrorMessage>,
) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }
    const token = jwt.sign({ email }, process.env.JWT_SECRET!, {
      expiresIn: "1h",
    });
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 3600000, // 1 hour
    });
    return res.status(200).json({ message: "Login successful", user });
  } catch (error) {
    return res.status(500).json({
      message: "Error occurred while logging in",
      error: (error as Error).message,
    });
  }
};

export const me = async (
  req: Request<{}, {}, {}>,
  res: Response<SuccessMessage | ErrorMessage>,
) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      email: string;
    };
    const user = await prisma.user.findUnique({
      where: { email: decoded.email },
    });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    return res
      .status(200)
      .json({ message: "User retrieved successfully", user });
  } catch (error) {
    return res.status(500).json({
      message: "Error occurred while retrieving user",
      error: (error as Error).message,
    });
  }
};

