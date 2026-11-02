import { NextResponse } from "next/server";
import { routeTextToSpeech } from "@/lib/speech-providers";

export const maxDuration = 60;

export async function POST(request: Request) {
  const startTime = performance.now();

  try {
    const gnaniApiKey = process.env.GNANI_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!gnaniApiKey && !geminiApiKey) {
      return NextResponse.json(
        { error: "Speech generation credentials are not configured on the server." },
        { status: 500 }
      );
    }

    const body = await request.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const requestedLanguage = typeof body.language === "string" ? body.language : "en-IN";

    if (!text) {
      return NextResponse.json(
        { error: "Please provide text to convert to speech." },
        { status: 400 }
      );
    }

    if (text.length > 5000) {
      return NextResponse.json(
        { error: "Text exceeds the 5000 character limit for speech synthesis." },
        { status: 400 }
      );
    }

    const result = await routeTextToSpeech({
      text,
      languageCode: requestedLanguage,
      gnaniApiKey,
      geminiApiKey,
    });

    const elapsedMs = Math.round(performance.now() - startTime);
    console.log(
      `[TTS Success] Generated ${result.audioBuffer.byteLength} bytes using ${result.provider} (${result.model}) in ${elapsedMs}ms`
    );

    return new Response(new Uint8Array(result.audioBuffer), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Length": String(result.audioBuffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startTime);
    console.error("TTS processing error:", {
      error: error instanceof Error ? error.message : String(error),
      elapsedMs,
    });

    const message =
      error instanceof Error ? error.message : "Speech synthesis failed.";

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
