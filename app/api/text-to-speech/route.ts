
import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(request: Request) {
  const startTime = performance.now();

  try {
    const apiKey = process.env.GNANI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Gnani API key is missing." },
        { status: 500 }
      );
    }

    const body = await request.json();

    const text =
      typeof body.text === "string" ? body.text.trim() : "";

    const requestedLanguage =
      typeof body.language === "string"
        ? body.language
        : "en-IN";

    if (!text) {
      return NextResponse.json(
        { error: "Please provide text to convert." },
        { status: 400 }
      );
    }

    if (text.length > 5000) {
      return NextResponse.json(
        { error: "Text is too long. Please shorten it to under 5000 characters." },
        { status: 400 }
      );
    }

    const supportedLanguages = [
      "auto",
      "en-IN",
      "hi-IN",
      "ta-IN",
      "te-IN",
      "kn-IN",
      "ml-IN",
      "mr-IN",
      "bn-IN",
      "gu-IN",
      "pa-IN",
    ];

    const language = supportedLanguages.includes(requestedLanguage)
      ? requestedLanguage
      : "en-IN";

    // Gnani Timbre v2.5 request
    const payload = {
      text,
      model: "timbre-v2.5",
      voice: "Nalini",
      language,
      speed: 1.0,
      audio_config: {
        container: "mp3",
        sample_rate: 48000,
        bitrate: "128k",
      },
    };

    console.log("Sending text to Gnani Timbre:", {
      model: payload.model,
      voice: payload.voice,
      language: payload.language,
      textLength: text.length,
    });

    const ttsStart = performance.now();

    const response = await fetch(
      "https://api.vachana.ai/api/v1/tts/inference",
      {
        method: "POST",
        headers: {
          "X-API-Key-ID": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }
    );

    const ttsMs = Math.round(
      performance.now() - ttsStart
    );

    if (!response.ok) {
      const details = await response.text();

      console.error("Gnani TTS error:", {
        status: response.status,
        details,
        ttsMs,
      });

      let userMessage = "Gnani speech generation failed.";

      if (response.status === 429) {
        userMessage =
          "Speech generation is temporarily busy. Please try again shortly.";
      } else if (response.status >= 500) {
        userMessage =
          "The speech service is temporarily unavailable. Please try again.";
      }

      return NextResponse.json(
        {
          error: userMessage,
          details,
        },
        { status: response.status }
      );
    }

    // Receive MP3 directly. No WAV parsing or DataView needed.
    const audio = await response.arrayBuffer();

    if (audio.byteLength === 0) {
      return NextResponse.json(
        { error: "Gnani returned an empty audio file." },
        { status: 502 }
      );
    }

    const totalMs = Math.round(
      performance.now() - startTime
    );

    console.log("Timbre TTS complete:", {
      audioBytes: audio.byteLength,
      ttsMs,
      totalMs,
      textLength: text.length,
    });

    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-store",
      },
    });

  } catch (error) {
    const totalMs = Math.round(
      performance.now() - startTime
    );

    const message =
      error instanceof Error ? error.message : String(error);

    console.error("TTS processing error:", {
      error: message,
      totalMs,
    });

    return NextResponse.json(
      {
        error: "TTS processing failed.",
        details: message,
      },
      { status: 500 }
    );
  }
}
