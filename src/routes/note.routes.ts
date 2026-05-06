import { saveNote,getNotes,getNoteById,deleteNote} from "../controllers/note.controller.js";
import { Router } from "express";
import { uploadNote } from "../middlewares/upload.js";
import { isAuthenticated } from "../middlewares/isAuthenticated.js";


const router = Router();
router.post("/upload", isAuthenticated, uploadNote, saveNote);
router.get("/get-notes/:userId", isAuthenticated, getNotes);
router.get("/get-note/:noteId", isAuthenticated, getNoteById);
router.delete("/delete-note/:noteId", isAuthenticated, deleteNote);

export default router;