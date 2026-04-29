import { Router } from "express";
import { generateQuiz } from "../controllers/quiz.controller.js";
import { isAuthenticated } from "../middlewares/isAuthenticated.js";

const router = Router();

router.post("/generate-quiz/:noteId", isAuthenticated, generateQuiz);

export default router;
