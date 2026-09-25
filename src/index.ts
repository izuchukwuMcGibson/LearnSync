import "dotenv/config";
import express from "express";
import type { Express } from "express";
import cors from "cors";
import userRoute from "./routes/user.routes.js";
import noteRoute from "./routes/note.routes.js";
import summaryRoute from "./routes/summary.routes.js";
import quizRoute from "./routes/quiz.routes.js";
import morgan from "morgan";
import cookieParser from "cookie-parser";

const app: Express = express();

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "https://learn-sync-frontend-coral.vercel.app", // Example local frontend (Vite)
  process.env.FRONTEND_URL || "", // Add your production URL to your .env
].filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);
app.use(morgan("dev"));
app.use(express.json());
app.use(cookieParser());
app.use("/api/users", userRoute);
app.use("/api/notes", noteRoute);
app.use("/api/summary", summaryRoute);
app.use("/api/quiz", quizRoute);

const PORT = process.env.PORT || 3000;

app.listen(PORT, (): void => {
  console.log("Server is running on port 3000");
});
