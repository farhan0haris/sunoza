import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import {
  generateContentWithRetryAndFallback,
  parseGeminiError,
  GeminiServiceError,
  PRIMARY_GEMINI_MODEL,
} from "@/lib/gemini";

export const maxDuration = 60;

// Maximum limits
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_PAGES = 30; // Limit processing to 30 pages for performance and responsiveness

interface ExtractedDoc {
  text: string;
  numPages: number;
  isScannedOrEmpty: boolean;
  fileType: "pdf" | "txt" | "md" | "csv" | "image";
  mimeType?: string;
}

async function parsePdfWithPdfjs(buffer: Buffer): Promise<{
  text: string;
  numPages: number;
  isScannedOrEmpty: boolean;
}> {
  // Dynamically import pdfjs-dist legacy build for Node.js server environments
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  });

  const doc = await loadingTask.promise;
  const numPages = doc.numPages;

  if (numPages > MAX_PAGES) {
    throw new Error(
      `PDF has ${numPages} pages, exceeding the maximum supported limit of ${MAX_PAGES} pages.`
    );
  }

  let fullText = "";
  let totalChars = 0;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items
      .filter((item: any) => typeof item.str === "string")
      .map((item: any) => item.str.trim())
      .filter((str: string) => str.length > 0);

    const pageText = items.join(" ").trim();
    totalChars += pageText.length;

    if (pageText) {
      fullText += `[Page ${pageNum}]\n${pageText}\n\n`;
    }
  }

  // If average extracted characters per page is below 25, it's virtually empty or a scanned image
  const isScannedOrEmpty = totalChars < 25;

  return {
    text: fullText.trim(),
    numPages,
    isScannedOrEmpty,
  };
}

export async function POST(request: Request) {
  const startTime = performance.now();

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "The AI service is temporarily misconfigured. Please check the server setup." },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const question = String(formData.get("question") || "").trim();
    const language = String(formData.get("language") || "en-IN");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Please upload a document (PDF, TXT, MD, CSV, or Image)." },
        { status: 400 }
      );
    }

    const fileType = file.type;
    const fileName = file.name.toLowerCase();

    // Check size limit
    if (file.size === 0) {
      return NextResponse.json(
        { error: "The uploaded file is empty (0 bytes)." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File exceeds the 10 MB maximum size limit." },
        { status: 400 }
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    let docInfo: ExtractedDoc;

    if (fileType === "application/pdf" || fileName.endsWith(".pdf")) {
      const pdfParse = await parsePdfWithPdfjs(fileBuffer);
      docInfo = {
        text: pdfParse.text,
        numPages: pdfParse.numPages,
        isScannedOrEmpty: pdfParse.isScannedOrEmpty,
        fileType: "pdf",
      };
    } else if (
      fileType === "text/markdown" ||
      fileName.endsWith(".md") ||
      fileName.endsWith(".markdown")
    ) {
      const text = fileBuffer.toString("utf-8").trim();
      if (!text) {
        return NextResponse.json(
          { error: "The markdown document contains no readable content." },
          { status: 400 }
        );
      }
      docInfo = {
        text,
        numPages: 1,
        isScannedOrEmpty: false,
        fileType: "md",
      };
    } else if (
      fileType === "text/csv" ||
      fileType === "application/csv" ||
      fileType === "application/vnd.ms-excel" ||
      fileName.endsWith(".csv")
    ) {
      const text = fileBuffer.toString("utf-8").trim();
      if (!text) {
        return NextResponse.json(
          { error: "The CSV document contains no readable content." },
          { status: 400 }
        );
      }
      docInfo = {
        text,
        numPages: 1,
        isScannedOrEmpty: false,
        fileType: "csv",
      };
    } else if (
      fileType === "text/plain" ||
      fileName.endsWith(".txt")
    ) {
      const text = fileBuffer.toString("utf-8").trim();
      if (!text) {
        return NextResponse.json(
          { error: "The text document contains no readable content." },
          { status: 400 }
        );
      }
      docInfo = {
        text,
        numPages: 1,
        isScannedOrEmpty: false,
        fileType: "txt",
      };
    } else if (
      fileType === "image/jpeg" ||
      fileType === "image/jpg" ||
      fileType === "image/png" ||
      fileType === "image/webp" ||
      fileName.match(/\.(jpe?g|png|webp)$/i)
    ) {
      let imageMime = fileType;
      if (!imageMime || !imageMime.startsWith("image/")) {
        if (fileName.endsWith(".png")) imageMime = "image/png";
        else if (fileName.endsWith(".webp")) imageMime = "image/webp";
        else imageMime = "image/jpeg";
      }

      docInfo = {
        text: "",
        numPages: 1,
        isScannedOrEmpty: true, // Processed via vision model directly
        fileType: "image",
        mimeType: imageMime,
      };
    } else {
      return NextResponse.json(
        {
          error:
            "Unsupported file type. Please upload a PDF, TXT, MD, CSV document, or Image (JPEG, PNG, WEBP).",
        },
        { status: 400 }
      );
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: 40000 },
    });

    // Document understanding system prompt
    const systemPrompt = `
You are Sunoza, an accessibility and document assistant.
The user has uploaded a document for explanation.

User's Question:
${question || "Summarise this document and explain the key points."}

Respond in this language: ${language}.

Instructions:
1. Use simple, everyday, accessible language.
2. Summarise what this document is and its main purpose.
3. Identify all critical dates, deadlines, and amounts (money, fees, penalties, etc.).
4. Explain any unfamiliar, legal, or technical terms in plain words.
5. Highlight important warnings, conditions, or risks.
6. Answer the user's specific question directly based on the document's actual contents.
7. If certain information is not found in the document, clearly state that it is not present.
8. Do not invent or assume information that is not in the document.
9. Keep the explanation well-structured, concise, and easy to follow when spoken aloud.
10. Write naturally because this will be spoken aloud to the user.
`;

    let result;

    if (docInfo.fileType === "pdf" && docInfo.isScannedOrEmpty) {
      // Scanned PDF OCR Fallback:
      // Send the PDF binary directly to Gemini which has native multimodal PDF/document OCR capabilities
      console.log(
        "PDF has little to no text stream. Utilizing native Gemini vision/document OCR fallback."
      );

      const base64Pdf = fileBuffer.toString("base64");
      result = await generateContentWithRetryAndFallback({
        ai,
        contents: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: base64Pdf,
            },
          },
          {
            text: `Note: This PDF appears to be a scanned document or image-based document without a standard digital text layer. Perform high-accuracy OCR on all visible pages.\n\n${systemPrompt}`,
          },
        ],
        config: {
          maxOutputTokens: 1000,
        },
        taskLabel: "Document OCR (Scanned PDF)",
      });
    } else if (docInfo.fileType === "image") {
      // Image document
      const base64Image = fileBuffer.toString("base64");
      result = await generateContentWithRetryAndFallback({
        ai,
        contents: [
          {
            inlineData: {
              mimeType: docInfo.mimeType || "image/jpeg",
              data: base64Image,
            },
          },
          {
            text: systemPrompt,
          },
        ],
        config: {
          maxOutputTokens: 1000,
        },
        taskLabel: "Document Image",
      });
    } else {
      // Digital PDF or Text file with extracted structure
      const promptContent = `
Document Details:
- Format: ${docInfo.fileType.toUpperCase()}
- Total Pages: ${docInfo.numPages}

Extracted Document Content:
${docInfo.text}

${systemPrompt}
`;

      result = await generateContentWithRetryAndFallback({
        ai,
        contents: [
          {
            text: promptContent,
          },
        ],
        config: {
          maxOutputTokens: 1000,
        },
        taskLabel: `Document Text (${docInfo.fileType.toUpperCase()})`,
      });
    }

    const answer = result.text;

    if (!answer) {
      throw new Error("Gemini returned an empty explanation for this document.");
    }

    const totalMs = Math.round(performance.now() - startTime);

    console.log("Document processing complete:", {
      file: file.name,
      fileType: docInfo.fileType,
      numPages: docInfo.numPages,
      wasOcrFallback: docInfo.isScannedOrEmpty,
      modelUsed: result.modelUsed,
      wasFallbackUsed: result.wasFallbackUsed,
      attempts: result.attempts,
      totalMs,
      finishReason: result.finishReason,
    });

    return NextResponse.json({
      success: true,
      answer,
      numPages: docInfo.numPages,
      fileType: docInfo.fileType,
      isScanned: docInfo.isScannedOrEmpty,
      finishReason: result.finishReason,
      model: result.modelUsed,
    });
  } catch (error) {
    const totalMs = Math.round(performance.now() - startTime);

    // Secure server-side technical error logging
    console.error("Document understanding error:", {
      error: error instanceof Error ? error.message : String(error),
      totalMs,
    });

    let statusCode = 500;
    let userMessage = "Sunoza could not understand this document. Please try again.";

    if (error instanceof Error) {
      if (
        error.name === "InvalidPDFException" ||
        error.message.includes("Invalid PDF") ||
        error.message.includes("FormatError")
      ) {
        statusCode = 400;
        userMessage = "The uploaded PDF appears to be corrupted or invalid.";
      } else if (error.message.includes("exceeding the maximum supported limit")) {
        statusCode = 400;
        userMessage = error.message;
      } else if (error instanceof GeminiServiceError) {
        statusCode = error.statusCode;
        userMessage = error.message;
      } else {
        const parsed = parseGeminiError(error);
        statusCode = parsed.statusCode;
        userMessage = parsed.userFacingMessage;
      }
    }

    // Never return raw Google API JSON or stack traces to the client
    return NextResponse.json(
      {
        error: userMessage,
      },
      { status: statusCode >= 400 && statusCode < 600 ? statusCode : 500 }
    );
  }
}
