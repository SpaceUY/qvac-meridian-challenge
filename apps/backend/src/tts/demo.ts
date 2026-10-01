/**
 * End-to-end local TTS proof, no cloud involved: synthesize -> play ->
 * synthesize a longer passage -> cancel mid-flight -> unload/close.
 *
 * Run with: npm run tts-demo --workspace=apps/backend
 */
import { unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { ModelManagementService } from "../models/service/models.service.js";
import { QvacRuntimeAdapter } from "../models/infra/qvacRuntimeAdapter.js";
import { QvacTtsAdapter } from "./infra/qvacTtsAdapter.js";
import { TtsService } from "./service/tts.service.js";
import {
  CANCEL_AFTER_MS,
  DEMO_CANCEL_TEXT,
  DEMO_OUTPUT_WAV,
  DEMO_TEXT,
  POLL_INTERVAL_MS,
} from "./demo.const.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitWhilePending(service: TtsService): Promise<void> {
  while (service.getStatus() === "pending") {
    await delay(POLL_INTERVAL_MS);
  }
}

/** Plays a WAV file, waits for it to finish. */
function playWav(path: string): Promise<void> {
  const currentPlatform = platform();
  let command: string;
  let args: string[];

  if (currentPlatform === "darwin") {
    command = "afplay";
    args = [path];
  } else if (currentPlatform === "win32") {
    command = "powershell";
    args = [
      "-Command",
      `Add-Type -AssemblyName presentationCore; (New-Object Media.SoundPlayer '${path}').PlaySync()`,
    ];
  } else {
    command = "aplay";
    args = [path];
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function main(): Promise<void> {
  const modelsAdapter = new QvacRuntimeAdapter();
  const models = new ModelManagementService(modelsAdapter, modelsAdapter);
  const ttsService = new TtsService(models, new QvacTtsAdapter());

  try {
    console.log("\n▸ [synthesize] loading Supertonic2 + synthesizing a short sentence...");
    await ttsService.synthesize(DEMO_TEXT);
    await waitWhilePending(ttsService);
    if (ttsService.getStatus() !== "succeeded") {
      throw new Error(`synthesis did not succeed, status: ${ttsService.getStatus()}`);
    }
    const audio = ttsService.getAudio();
    if (!audio) throw new Error("status is 'succeeded' but no audio is available");
    writeFileSync(DEMO_OUTPUT_WAV, audio);
    console.log(`▸ [synthesize] wrote ${audio.length} bytes to ${DEMO_OUTPUT_WAV}`);

    console.log("▸ [synthesize] playing audio locally (no cloud service involved)...");
    await playWav(DEMO_OUTPUT_WAV);
    console.log("▸ [synthesize] playback complete");

    console.log("\n▸ [cancel] starting a longer synthesis and cancelling it mid-flight...");
    await ttsService.synthesize(DEMO_CANCEL_TEXT);
    await delay(CANCEL_AFTER_MS);
    await ttsService.cancel();
    await waitWhilePending(ttsService);
    console.log(`▸ [cancel] status after cancel: ${ttsService.getStatus()}`);
    if (ttsService.getStatus() !== "cancelled") {
      throw new Error(
        `expected status "cancelled" after cancel(), got "${ttsService.getStatus()}" - ` +
          `if this is flaky, DEMO_CANCEL_TEXT may need to be longer or CANCEL_AFTER_MS shorter`
      );
    }

    console.log(
      "\n▸ Done: local synthesis, local playback, and mid-flight cancellation all verified without any cloud dependency."
    );
  } finally {
    try {
      unlinkSync(DEMO_OUTPUT_WAV);
    } catch {
      // best effort
    }
    await models.unloadAll();
    await models.close();
  }
}

main().catch((err) => {
  console.error("\n✖ TTS demo failed:", err);
  process.exit(1);
});
