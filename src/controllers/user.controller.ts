import { PrismaClient } from "@prisma/client";
import type { User} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

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
    const token = jwt.sign({ email }, process.env.JWT_SECRET!, { expiresIn: "1h" });
    const newUser = await prisma.user.create({
      data: { name, email, password: hashedPassword },
    });
    return res
      .status(201)
      .json({ message: "User registered successfully", user: newUser });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Error occurred while registering user" });
  }
};
