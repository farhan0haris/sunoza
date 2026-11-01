
import { NextResponse } from "next/server";

export const maxDuration = 60;



export async function POST(request: Request) {
  try {
    // 1. Read the API key from the server environment
    const apiKey = process.env.GNANI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Gnani API key is missing." },
        { status: 500 }
      );
    }

    // 2. Receive audio from the frontend
    const incomingForm = await request.formData();
    const audio = incomingForm.get("audio");

    if (!audio || typeof audio === "string") {
      return NextResponse.json(
        { error: "Please provide an audio file." },
        { status: 400 }
      );
    }

    // 3. Validate the uploaded file
    const allowedFormats =
      /\.(wav|mp3|ogg|flac|aac|m4a)$/i;

    if (!allowedFormats.test(audio.name)) {
      return NextResponse.json(
        { error: "Unsupported audio format." },
        { status: 400 }
      );
    }

    if (audio.size === 0 || audio.size > 15 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Audio is empty or exceeds 15 MB." },
        { status: 400 }
      );
    }

    // 4. Prepare the request for Gnani Prisma
    const gnaniForm = new FormData();

    gnaniForm.append("audio_file", audio, audio.name);
    gnaniForm.append("model", "prisma-v3.0");
    gnaniForm.append("language_code", "indic-auto");
    gnaniForm.append("format", "transcribe");

    // 5. Send audio to Gnani
    const response = await fetch(
      "https://api.vachana.ai/stt/v3",
      {
        method: "POST",
        headers: {
          "X-API-Key-ID": apiKey,
        },
        body: gnaniForm,
        cache: "no-store",
      }
    );

    const rawResponse = await response.text();

    let result: Record<string, unknown>;

    try {
      result = JSON.parse(rawResponse);
    } catch {
      result = { message: rawResponse };
    }

    // 6. Handle Gnani errors
    if (!response.ok) {
      console.error("Gnani API error:", result);

      return NextResponse.json(
        { error: result },
        { status: response.status }
      );
    }

    // 7. Send the transcript back to the frontend
    return NextResponse.json({
      success: true,
      transcript: result.transcript ?? "",
      detectedLanguage:
        result.detected_language_code ?? null,
      model: result.model ?? "prisma-v3.0",
    });

  } catch (error) {
    console.error("Speech recognition error:", error);

    return NextResponse.json(
      { error: "Failed to process the audio." },
      { status: 500 }
    );
  }
}
