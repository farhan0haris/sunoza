import {
  GoogleGenAI,
  type ContentListUnion,
  type GenerateContentConfig,
  type GenerateContentResponse,
} from "@google/genai";

// Verified Gemini Models
// Primary vision & document model: gemini-3.8-flash
// Verified fallback vision & document model: gemini-3.6-flash (multimodal, OCR-capable, high availability)
export const PRIMARY_GEMINI_MODEL = "gemini-3.8-flash";
export const FALLBACK_GEMINI_MODEL = "gemini-3.6-flash";

export interface ParsedGeminiError {
  statusCode: number;
  statusText: string;
  errorMessage: string;
  isAvailabilityError: boolean;
  isRateLimitError: boolean;
  isAuthError: boolean;
  isClientError: boolean;
  isSafetyError: boolean;
  isRetryable: boolean;
  userFacingMessage: string;
}

/**
 * Safely parses and classifies errors thrown by the Google Gen AI SDK.
 * Ensures internal JSON payloads, stack traces, and API keys are never leaked to clients.
 */
export function parseGeminiError(error: unknown): ParsedGeminiError {
  let statusCode = 500;
  let statusText = "UNKNOWN";
  let errorMessage = error instanceof Error ? error.message : String(error);

  // Check for SDK error status property
  if (typeof error === "object" && error !== null) {
    const errorObj = error as Record<string, unknown>;
    if (typeof errorObj.status === "number") {
      statusCode = errorObj.status;
    } else if (typeof errorObj.statusCode === "number") {
      statusCode = errorObj.statusCode;
    }
  }

  // Detect and unpack embedded JSON error messages from Google API (e.g. {"error":{"code":503,"message":"...","status":"UNAVAILABLE"}})
  if (typeof errorMessage === "string" && errorMessage.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(errorMessage);
      if (parsed && typeof parsed === "object" && parsed.error) {
        if (typeof parsed.error.code === "number") {
          statusCode = parsed.error.code;
        }
        if (typeof parsed.error.status === "string") {
          statusText = parsed.error.status;
        }
        if (typeof parsed.error.message === "string") {
          errorMessage = parsed.error.message;
        }
      }
    } catch {
      // Keep original errorMessage if not valid JSON
    }
  }

  const lowerMsg = errorMessage.toLowerCase();

  // Classify error type
  const isAvailabilityError =
    statusCode === 503 ||
    statusText === "UNAVAILABLE" ||
    lowerMsg.includes("high demand") ||
    lowerMsg.includes("overloaded") ||
    lowerMsg.includes("unavailable") ||
    lowerMsg.includes("temporarily unavailable") ||
    lowerMsg.includes("service unavailable");

  const isRateLimitError =
    statusCode === 429 ||
    statusText === "RESOURCE_EXHAUSTED" ||
    lowerMsg.includes("quota") ||
    lowerMsg.includes("rate limit") ||
    lowerMsg.includes("too many requests");

  const isAuthError =
    statusCode === 401 ||
    statusCode === 403 ||
    statusText === "PERMISSION_DENIED" ||
    statusText === "UNAUTHENTICATED" ||
    lowerMsg.includes("api key") ||
    lowerMsg.includes("permission_denied") ||
    lowerMsg.includes("api_key_invalid");

  const isClientError =
    (statusCode === 400 || statusCode === 404) && !isAuthError;

  const isSafetyError =
    lowerMsg.includes("safety") ||
    lowerMsg.includes("blocked") ||
    lowerMsg.includes("content filter");

  const isNetworkError =
    lowerMsg.includes("fetch failed") ||
    lowerMsg.includes("econnreset") ||
    lowerMsg.includes("etimedout") ||
    lowerMsg.includes("network error");

  const isServer5xx = statusCode >= 500 && statusCode < 600;

  // Retryable if transient service issue or network glitch, but NOT if auth/client/safety
  const isRetryable =
    (isAvailabilityError || isRateLimitError || isServer5xx || isNetworkError) &&
    !isAuthError &&
    !isClientError &&
    !isSafetyError;

  // Clean, empathetic user-facing message (no raw Google API JSON or stack traces)
  let userFacingMessage = "Sunoza could not complete this request right now. Please try again.";

  if (isAuthError) {
    userFacingMessage = "The AI service is temporarily unavailable due to a configuration issue. Please check the API setup.";
  } else if (isAvailabilityError || isRateLimitError) {
    userFacingMessage = "Sunoza's AI service is experiencing high demand. Please try again in a few moments.";
  } else if (isSafetyError) {
    userFacingMessage = "Sunoza could not process this content due to safety restrictions.";
  } else if (lowerMsg.includes("timeout") || lowerMsg.includes("deadline")) {
    userFacingMessage = "The analysis took too long to complete. Please try with a simpler image or document.";
  } else if (isClientError) {
    userFacingMessage = "The uploaded file or request could not be processed. Please check the file format.";
  }

  return {
    statusCode,
    statusText,
    errorMessage,
    isAvailabilityError,
    isRateLimitError,
    isAuthError,
    isClientError,
    isSafetyError,
    isRetryable,
    userFacingMessage,
  };
}

export class GeminiServiceError extends Error {
  public readonly statusCode: number;
  public readonly isAvailabilityError: boolean;
  public readonly modelUsed: string;

  constructor(
    message: string,
    statusCode = 500,
    modelUsed = PRIMARY_GEMINI_MODEL,
    isAvailabilityError = false
  ) {
    super(message);
    this.name = "GeminiServiceError";
    this.statusCode = statusCode;
    this.modelUsed = modelUsed;
    this.isAvailabilityError = isAvailabilityError;
  }
}

export interface GenerateWithFallbackParams {
  ai: GoogleGenAI;
  contents: ContentListUnion;
  config?: GenerateContentConfig;
  primaryModel?: string;
  fallbackModel?: string;
  maxAttempts?: number;
  taskLabel?: string;
}

export interface GenerateWithFallbackResult {
  response: GenerateContentResponse;
  text: string;
  modelUsed: string;
  wasFallbackUsed: boolean;
  attempts: number;
  finishReason: string;
}

/**
 * Executes a Gemini generateContent call with exponential backoff retry and verified model fallback.
 *
 * 1. Attempts the primary model first (gemini-3.8-flash).
 * 2. On 503 UNAVAILABLE ("high demand") or persistent 5xx, falls back to gemini-3.6-flash.
 * 3. Applies exponential backoff with jitter on temporary retryable failures.
 * 4. Fails fast on 400, 401, 403, 404, or safety errors without retrying.
 * 5. Returns clean user-facing error messages without exposing raw API JSON.
 */
export async function generateContentWithRetryAndFallback({
  ai,
  contents,
  config,
  primaryModel = PRIMARY_GEMINI_MODEL,
  fallbackModel = FALLBACK_GEMINI_MODEL,
  maxAttempts = 3,
  taskLabel = "Gemini Request",
}: GenerateWithFallbackParams): Promise<GenerateWithFallbackResult> {
  let currentModel = primaryModel;
  let wasFallbackUsed = false;
  let lastParsedError: ParsedGeminiError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStartTime = performance.now();

    try {
      console.log(`[${taskLabel}] Attempt ${attempt}/${maxAttempts} using model: ${currentModel}`);

      const response = await ai.models.generateContent({
        model: currentModel,
        contents,
        config,
      });

      const elapsedMs = Math.round(performance.now() - attemptStartTime);
      const finishReason = response.candidates?.[0]?.finishReason ?? "STOP";
      const text = response.text?.trim() ?? "";

      if (!text) {
        throw new Error("Gemini returned an empty explanation.");
      }

      console.log(`[${taskLabel}] Success with ${currentModel} in ${elapsedMs}ms (attempt ${attempt})`);

      return {
        response,
        text,
        modelUsed: currentModel,
        wasFallbackUsed,
        attempts: attempt,
        finishReason,
      };
    } catch (rawError) {
      const elapsedMs = Math.round(performance.now() - attemptStartTime);
      const parsed = parseGeminiError(rawError);
      lastParsedError = parsed;

      // Log technical details securely on the server (never exposed to client)
      console.warn(
        `[${taskLabel}] Attempt ${attempt}/${maxAttempts} with ${currentModel} failed in ${elapsedMs}ms:`,
        {
          statusCode: parsed.statusCode,
          statusText: parsed.statusText,
          isAvailabilityError: parsed.isAvailabilityError,
          isRetryable: parsed.isRetryable,
          technicalMessage: parsed.errorMessage,
        }
      );

      // Do NOT retry client errors, auth errors, or safety violations
      if (!parsed.isRetryable) {
        console.error(
          `[${taskLabel}] Non-retryable error encountered (${parsed.statusCode} - ${parsed.statusText}). Aborting retries.`
        );
        throw new GeminiServiceError(
          parsed.userFacingMessage,
          parsed.statusCode,
          currentModel,
          parsed.isAvailabilityError
        );
      }

      // Check for availability error (503 / high demand) on primary model -> Switch to fallback
      if (
        (parsed.isAvailabilityError || attempt >= 2) &&
        currentModel === primaryModel &&
        fallbackModel &&
        fallbackModel !== primaryModel
      ) {
        console.warn(
          `[${taskLabel}] Primary model ${primaryModel} is experiencing high demand (503/UNAVAILABLE). Switching to verified fallback model: ${fallbackModel}`
        );
        currentModel = fallbackModel;
        wasFallbackUsed = true;

        // Brief jitter delay before switching to fallback model
        const switchJitterMs = Math.round(150 + Math.random() * 200);
        await new Promise((resolve) => setTimeout(resolve, switchJitterMs));
        continue;
      }

      // If attempts remain, apply exponential backoff with jitter
      if (attempt < maxAttempts) {
        // Backoff: 500ms, ~900ms, ~1600ms + random jitter up to 300ms
        const baseDelay = 500 * Math.pow(1.8, attempt - 1);
        const jitter = Math.random() * 300;
        const delayMs = Math.round(Math.min(3000, baseDelay + jitter));

        console.log(`[${taskLabel}] Transient error on ${currentModel}. Retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // If all attempts exhausted
  const finalUserMessage =
    lastParsedError?.userFacingMessage ??
    "Sunoza's AI service is temporarily experiencing high demand. Please try again shortly.";

  console.error(
    `[${taskLabel}] All ${maxAttempts} attempts exhausted. Final model was ${currentModel}. Technical error:`,
    lastParsedError?.errorMessage
  );

  throw new GeminiServiceError(
    finalUserMessage,
    lastParsedError?.statusCode ?? 503,
    currentModel,
    true
  );
}

