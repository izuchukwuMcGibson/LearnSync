import { Router } from "express";
import {
  generateQuiz,
  submitQuizScore,
} from "../controllers/quiz.controller.js";
import { isAuthenticated } from "../middlewares/isAuthenticated.js";

const router = Router();

router.post("/generate-quiz/:noteId", isAuthenticated, generateQuiz);
router.post("/:quizId/submit-score", isAuthenticated, submitQuizScore);

export default router;
