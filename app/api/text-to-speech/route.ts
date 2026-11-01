
import { NextResponse } from "next/server";

export async function POST(request: Request) {
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

    if (text.length > 2000) {
      return NextResponse.json(
        { error: "Text is too long." },
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
    });

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
      }
    );

    if (!response.ok) {
      const details = await response.text();

      console.error("Gnani TTS error:", {
        status: response.status,
        details,
      });

      return NextResponse.json(
        {
          error: "Gnani speech generation failed.",
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

    console.log(
      `Timbre generated ${audio.byteLength} bytes of audio.`
    );

    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-store",
      },
    });

  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    console.error("TTS processing error:", message);

    return NextResponse.json(
      {
        error: "TTS processing failed.",
        details: message,
      },
      { status: 500 }
    );
  }
}
