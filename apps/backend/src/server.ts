import express from "express";
import cors from "cors";
import { createModelsRouter } from "./models/router/models.router.js";
import { ModelManagementService } from "./models/service/models.service.js";
import { QvacRuntimeAdapter } from "./models/infra/qvacRuntimeAdapter.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/ping", (_req, res) => {
  res.json({ message: "pong from express" });
});

const qvacRuntimeAdapter = new QvacRuntimeAdapter();
const modelManagementService = new ModelManagementService(qvacRuntimeAdapter, qvacRuntimeAdapter);
app.use("/api/models", createModelsRouter(modelManagementService));

const server = app.listen(3001, () => {
  console.log("Server listening on port 3001");
});

async function shutdown(): Promise<void> {
  await modelManagementService.unloadAll();
  await modelManagementService.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
