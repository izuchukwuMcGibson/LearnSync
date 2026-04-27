import "dotenv/config";
import express from "express";
import type { Express } from "express";
import userRoute from "./routes/user.routes.js";
import morgan from "morgan";
import cookieParser from "cookie-parser";




const app: Express = express();

app.use(morgan("combined"));
app.use(express.json());
app.use(cookieParser());
app.use('/api/users', userRoute);



app.listen(3000, (): void => {
  console.log("Server is running on port 3000");
});
