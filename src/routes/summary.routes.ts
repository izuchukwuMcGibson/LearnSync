import { Router } from "express";
import { generateSummary, getSummary } from "../controllers/summary.controller.js";
import { markAsRead } from "../controllers/quiz.controller.js";
import { isAuthenticated } from "../middlewares/isAuthenticated.js";

const router = Router();

router.post("/generate-summary/:noteId", isAuthenticated, generateSummary);
router.get("/:noteId", isAuthenticated, getSummary);
router.patch("/:noteId/read", isAuthenticated, markAsRead);

export default router;
