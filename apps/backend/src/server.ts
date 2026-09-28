import express from "express";
import cors from "cors";

const app = express();

app.use(cors());

app.get("/api/ping", (_req, res) => {
  res.json({ message: "pong from express" });
});

app.listen(3001, () => {
  console.log("Server listening on port 3001");
});
