import { GoogleGenAI } from "@google/genai";
import { getLanguageMeta, isInternationalLanguage } from "./languages";

export interface TranscribeResult {
  success: boolean;
  transcript: string;
  detectedLanguage?: string | null;
  provider: "gnani" | "gemini";
  model: string;
}

export interface SynthesizeResult {
  audioBuffer: Buffer;
  contentType: string;
  provider: "gnani" | "gemini";
  model: string;
}

/**
 * Routes speech recognition (STT) requests to the verified provider based on language.
 * - Indian languages (en-IN, hi-IN, te-IN, ta-IN, kn-IN, ml-IN, bn-IN, mr-IN, gu-IN, pa-IN) + auto -> Gnani Prisma
 * - International languages (es-ES, fr-FR, ja-JP) -> Gemini Transcribe (gemini-3.5-transcribe)
 */
export async function routeSpeechToText({
  audioBuffer,
  filename,
  mimeType,
  languageCode,
  gnaniApiKey,
  geminiApiKey,
}: {
  audioBuffer: Buffer;
  filename: string;
  mimeType: string;
  languageCode: string;
  gnaniApiKey?: string;
  geminiApiKey?: string;
}): Promise<TranscribeResult> {
  const meta = getLanguageMeta(languageCode);

  if (meta.sttProvider === "gemini" && geminiApiKey) {
    // International language -> Gemini Transcribe
    const ai = new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: { timeout: 35000 },
    });

    // Detect appropriate audio mime type
    const safeMime =
      mimeType.startsWith("audio/") ? mimeType : filename.endsWith(".wav") ? "audio/wav" : "audio/mp3";

    console.log(`[STT Router] Routing to Gemini Transcribe (${meta.code})...`);

    const interaction = await ai.interactions.create({
      model: "gemini-3.5-transcribe",
      input: [
        {
          type: "audio",
          data: audioBuffer.toString("base64"),
          mime_type: safeMime,
        },
      ],
      generation_config: {
        transcription_config: {
          language_codes: [meta.code],
        },
      },
    });

    let transcript = interaction.output_text?.trim() || "";

    if (!transcript && interaction.steps) {
      for (const step of interaction.steps) {
        if (step.type === "model_output" && Array.isArray(step.content)) {
          for (const item of step.content) {
            if (item.type === "text" && item.text) {
              transcript += item.text + " ";
            }
          }
        }
      }
    }

    transcript = transcript.trim();

    return {
      success: true,
      transcript: transcript || "No speech detected.",
      detectedLanguage: meta.code,
      provider: "gemini",
      model: "gemini-3.5-transcribe",
    };
  }

  // Indian language or Auto-detect -> Gnani Prisma
  if (!gnaniApiKey) {
    throw new Error("Gnani API key is missing on the server.");
  }

  const gnaniForm = new FormData();
  const fileBlob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
  gnaniForm.append("audio_file", fileBlob, filename);
  gnaniForm.append("model", "prisma-v3.0");
  gnaniForm.append("language_code", meta.gnaniCode || "indic-auto");
  gnaniForm.append("format", "transcribe");

  console.log(`[STT Router] Routing to Gnani Prisma (${meta.gnaniCode || "indic-auto"})...`);

  const response = await fetch("https://api.vachana.ai/stt/v3", {
    method: "POST",
    headers: {
      "X-API-Key-ID": gnaniApiKey,
    },
    body: gnaniForm,
    cache: "no-store",
  });

  const rawText = await response.text();
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(rawText);
  } catch {
    result = { message: rawText };
  }

  if (!response.ok) {
    console.error("Gnani STT error response:", result);
    throw new Error(
      (typeof result.error === "string" ? result.error : result.message as string) ||
        `Gnani STT failed with status ${response.status}`
    );
  }

  return {
    success: true,
    transcript: (result.transcript as string) || "No speech detected.",
    detectedLanguage: (result.detected_language_code as string) || null,
    provider: "gnani",
    model: (result.model as string) || "prisma-v3.0",
  };
}

/**
 * Routes speech synthesis (TTS) requests to the verified provider based on language.
 * - Indian languages (en-IN, hi-IN, te-IN, ta-IN, kn-IN, ml-IN, bn-IN, mr-IN, gu-IN, pa-IN) + auto -> Gnani Timbre
 * - International languages (es-ES, fr-FR, ja-JP) -> Gemini 3.8 Flash TTS (gemini-3.8-flash-tts)
 */
export async function routeTextToSpeech({
  text,
  languageCode,
  gnaniApiKey,
  geminiApiKey,
}: {
  text: string;
  languageCode: string;
  gnaniApiKey?: string;
  geminiApiKey?: string;
}): Promise<SynthesizeResult> {
  const meta = getLanguageMeta(languageCode);

  if (meta.ttsProvider === "gemini" && geminiApiKey) {
    // International language -> Gemini 3.8 Flash TTS
    console.log(`[TTS Router] Routing to Gemini 3.8 Flash TTS for ${meta.code}...`);

    const ai = new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: { timeout: 35000 },
    });

    const interaction = await ai.interactions.create({
      model: "gemini-3.8-flash-tts",
      input: [
        {
          type: "user_input",
          content: [
            {
              type: "text",
              text,
            },
          ],
        },
      ],
      response_format: { type: "audio" },
      generation_config: {
        speech_config: [
          {
            voice: meta.ttsVoice || "Kore",
          },
        ],
      },
    });

    let audioBase64 = interaction.output_audio?.data;

    if (!audioBase64 && interaction.steps) {
      for (const step of interaction.steps) {
        if (step.type === "model_output" && Array.isArray(step.content)) {
          for (const item of step.content) {
            if (item.type === "audio" && item.data) {
              audioBase64 = item.data;
              break;
            }
          }
        }
      }
    }

    if (!audioBase64) {
      throw new Error("Gemini TTS returned no audio data.");
    }

    const audioBuffer = Buffer.from(audioBase64, "base64");

    return {
      audioBuffer,
      contentType: "audio/wav",
      provider: "gemini",
      model: "gemini-3.8-flash-tts",
    };
  }

  // Indian language or Auto-detect -> Gnani Timbre
  if (!gnaniApiKey) {
    throw new Error("Gnani API key is missing on the server.");
  }

  const timbreLang = meta.gnaniCode || "en-IN";

  console.log(`[TTS Router] Routing to Gnani Timbre for ${timbreLang}...`);

  const payload = {
    text,
    model: "timbre-v2.5",
    voice: "Nalini",
    language: timbreLang,
    speed: 1.0,
    audio_config: {
      container: "mp3",
      sample_rate: 48000,
      bitrate: "128k",
    },
  };

  const response = await fetch("https://api.vachana.ai/api/v1/tts/inference", {
    method: "POST",
    headers: {
      "X-API-Key-ID": gnaniApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(18000),
  });

  if (!response.ok) {
    const details = await response.text();
    console.error("Gnani Timbre error:", { status: response.status, details });
    let msg = "Speech generation failed.";
    if (response.status === 429) {
      msg = "Speech generation is busy. Please try again shortly.";
    } else if (response.status >= 500) {
      msg = "The speech service is temporarily unavailable. Please try again.";
    }
    throw new Error(msg);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    throw new Error("Gnani returned an empty audio file.");
  }

  return {
    audioBuffer: Buffer.from(arrayBuffer),
    contentType: "audio/mpeg",
    provider: "gnani",
    model: "timbre-v2.5",
  };
}
