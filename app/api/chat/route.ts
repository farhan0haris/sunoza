import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { parseGeminiError } from "@/lib/gemini";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "The AI service is temporarily misconfigured. Please check the server setup." },
        { status: 500 }
      );
    }

    const body = await request.json();

    const message =
      typeof body.message === "string"
        ? body.message.trim()
        : "";

    const language =
      typeof body.language === "string"
        ? body.language
        : "en-IN";

    if (!message) {
      return NextResponse.json(
        { error: "Please provide a message." },
        { status: 400 }
      );
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: 30000 },
    });

    const startTime = Date.now();

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",

      contents: message,

      config: {
        systemInstruction: `
You are Sunoza, a helpful voice-first accessibility assistant.

The user's detected language is ${language}.

YOUR MAIN RESPONSIBILITY:
Answer the actual question asked by the user.

IMPORTANT RULES:

1. Never reply with only a greeting when the user asks a question.
2. Answer the user's question directly.
3. Use simple language that everyone can understand.
4. Respond in the same language as the user.
5. If the user mixes Hindi and English, you may naturally mix them too.
6. Explain technical concepts using everyday examples.
7. Keep normal answers around 2 to 4 sentences.
8. Avoid unnecessary introductions and long explanations.
9. Be patient and respectful.
10. Never invent information.
11. Never ask users for OTPs, PINs, passwords or banking credentials.

Your answers will be converted into speech.
Write naturally, clearly and conversationally.
        `,

        temperature: 0.3,
        maxOutputTokens: 180,
      },
    });

    const answer = response.text?.trim();

    if (!answer) {
      throw new Error("Gemini returned an empty response.");
    }

    console.log(
      `Gemini response generated in ${Date.now() - startTime} ms`
    );

    return NextResponse.json({
      success: true,
      answer,
      model: "gemini-3.5-flash-lite",
    });

  } catch (error) {
    console.error("Gemini chat error:", error);

    const parsed = parseGeminiError(error);

    return NextResponse.json(
      {
        error: parsed.userFacingMessage,
      },
      { status: parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500 }
    );
  }
}
