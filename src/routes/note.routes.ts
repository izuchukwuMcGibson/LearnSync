import { saveNote,getNotes,getNoteById} from "../controllers/note.controller.js";
import { Router } from "express";
import { uploadNote } from "../middlewares/upload.js";
import { isAuthenticated } from "../middlewares/isAuthenticated.js";

const router = Router();    
router.post("/upload", isAuthenticated, uploadNote, saveNote);
router.get("/notes/:userId", isAuthenticated, getNotes);
router.get("/note/:noteId", isAuthenticated, getNoteById);

export default router;