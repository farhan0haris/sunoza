import { NextResponse } from "next/server";
import { routeSpeechToText } from "@/lib/speech-providers";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const gnaniApiKey = process.env.GNANI_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!gnaniApiKey && !geminiApiKey) {
      return NextResponse.json(
        { error: "Speech service credentials are not configured on the server." },
        { status: 500 }
      );
    }

    const incomingForm = await request.formData();
    const audio = incomingForm.get("audio");
    const requestedLanguage = String(incomingForm.get("language") || "auto");

    if (!(audio instanceof File)) {
      return NextResponse.json(
        { error: "Please provide a valid audio recording." },
        { status: 400 }
      );
    }

    const allowedFormats = /\.(wav|mp3|ogg|flac|aac|m4a|webm)$/i;
    if (!allowedFormats.test(audio.name) && !audio.type.startsWith("audio/")) {
      return NextResponse.json(
        { error: "Unsupported audio format. Please upload WAV, MP3, OGG, FLAC, AAC, or M4A." },
        { status: 400 }
      );
    }

    if (audio.size === 0 || audio.size > 15 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Audio file is empty or exceeds the 15 MB limit." },
        { status: 400 }
      );
    }

    const audioBuffer = Buffer.from(await audio.arrayBuffer());

    const result = await routeSpeechToText({
      audioBuffer,
      filename: audio.name,
      mimeType: audio.type || "audio/wav",
      languageCode: requestedLanguage,
      gnaniApiKey,
      geminiApiKey,
    });

    return NextResponse.json({
      success: true,
      transcript: result.transcript,
      detectedLanguage: result.detectedLanguage,
      provider: result.provider,
      model: result.model,
    });
  } catch (error) {
    console.error("Speech recognition error:", error);

    const message =
      error instanceof Error ? error.message : "Failed to process audio recording.";

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
