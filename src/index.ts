import "dotenv/config";
import express from "express";
import type { Express } from "express";


const app: Express = express();

app.use(express.json());


app.listen(3000, (): void => {
  console.log("Server is running on port 3000");
});
