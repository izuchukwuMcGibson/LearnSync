import { register,login,me} from "../controllers/user.controller.js";
import { Router } from "express";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", me);

export default router;
