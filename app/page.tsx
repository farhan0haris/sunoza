"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  LANGUAGES,
  INDIAN_LANGUAGES,
  INTERNATIONAL_LANGUAGES,
  type LanguageCode,
  getLanguageMeta,
} from "@/lib/languages";
import { getTranslations, type TranslationStrings } from "@/lib/translations";

// Client-side image resizing utility to reduce upload latency and memory while preserving readability
async function resizeImageIfNeeded(file: File, maxDimension = 1600): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return file;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      if (width <= maxDimension && height <= maxDimension) {
        return resolve(file);
      }

      if (width > height) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        return resolve(file);
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, width, height);

      const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) {
            return resolve(file);
          }
          const resizedFile = new File([blob], file.name, {
            type: mimeType,
            lastModified: Date.now(),
          });
          resolve(resizedFile);
        },
        mimeType,
        0.88
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}

function audioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const targetRate = 16000;
  const ratio = audioBuffer.sampleRate / targetRate;
  const outputLength = Math.floor(audioBuffer.length / ratio);

  const channels = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, index) => audioBuffer.getChannelData(index)
  );

  const samples = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(
      Math.max(start + 1, Math.floor((i + 1) * ratio)),
      audioBuffer.length
    );

    let sum = 0;
    let count = 0;

    for (let frame = start; frame < end; frame++) {
      let sample = 0;
      for (const channel of channels) {
        sample += channel[frame] / channels.length;
      }
      sum += sample;
      count++;
    }

    samples[i] = count > 0 ? sum / count : 0;
  }

  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeText(offset: number, value: string) {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      offset,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true
    );
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

// Subtle soundwave-inspired branding motif
function SoundwaveMotif({
  bars = 4,
  height = "h-4",
  color = "text-[#D99B37]",
  animated = false,
}: {
  bars?: number;
  height?: string;
  color?: string;
  animated?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${color}`} aria-hidden="true">
      <span className={`w-0.5 rounded-full bg-current ${animated ? "wave-bar-1" : "h-1.5"}`}></span>
      <span className={`w-0.5 rounded-full bg-current ${animated ? "wave-bar-2" : "h-3"}`}></span>
      <span className={`w-0.5 rounded-full bg-current ${animated ? "wave-bar-3" : "h-4"}`}></span>
      <span className={`w-0.5 rounded-full bg-current ${animated ? "wave-bar-4" : "h-2.5"}`}></span>
      {bars >= 5 && (
        <span className={`w-0.5 rounded-full bg-current ${animated ? "wave-bar-5" : "h-1.5"}`}></span>
      )}
    </span>
  );
}

// Functional example phrases & prompt chips for quick exploration
const VOICE_EXAMPLE_PHRASES = [
  "Explain this message to me.",
  "Help me understand something.",
  "Read this information aloud.",
  "Translate this sentence.",
];

const IMAGE_PROMPT_CHIPS = [
  "What is in this picture?",
  "Where is this place?",
  "Read the text in this image.",
  "Describe this image.",
];

const DOC_PROMPT_CHIPS = [
  "Summarise this document.",
  "Find important dates.",
  "Explain the fees and amounts.",
  "Identify important warnings.",
];

export default function Home() {
  // Global Language Preference (13 Languages + Auto-detect)
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode>("auto");
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const langMenuRef = useRef<HTMLDivElement>(null);

  // Active Feature Tab: "voice" | "image" | "document"
  const [activeTab, setActiveTab] = useState<"voice" | "image" | "document">("voice");
  // Desktop Multimodal Tool Switcher: "image" | "document"
  const [desktopToolTab, setDesktopToolTab] = useState<"image" | "document">("image");

  // Voice Assistant states
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const understandAudioRef = useRef<HTMLAudioElement | null>(null);
  const docAudioRef = useRef<HTMLAudioElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [detectedLanguage, setDetectedLanguage] = useState("");
  const [error, setError] = useState("");
  const [assistantResponse, setAssistantResponse] = useState("");
  const [voiceThinking, setVoiceThinking] = useState(false);
  const [voiceAudioLoading, setVoiceAudioLoading] = useState(false);
  const [voiceAudioUrl, setVoiceAudioUrl] = useState("");
  const [voiceAudioError, setVoiceAudioError] = useState("");
  const voiceAudioAbortRef = useRef<AbortController | null>(null);
  const activeVoiceRequestIdRef = useRef<number>(0);

  // Image understanding states
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>("");
  const [imageQuestion, setImageQuestion] = useState("");
  const [imageAnswer, setImageAnswer] = useState("");
  const [understandStatus, setUnderstandStatus] = useState<
    "idle" | "understanding" | "preparing"
  >("idle");
  const [understandError, setUnderstandError] = useState("");
  const [understandAudioLoading, setUnderstandAudioLoading] = useState(false);
  const [understandAudioUrl, setUnderstandAudioUrl] = useState("");
  const [understandAudioError, setUnderstandAudioError] = useState("");
  const [isImageDragging, setIsImageDragging] = useState(false);
  const understandAudioAbortRef = useRef<AbortController | null>(null);
  const understandRequestAbortRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<number>(0);

  // Document understanding states
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docQuestion, setDocQuestion] = useState("");
  const [docAnswer, setDocAnswer] = useState("");
  const [docStatus, setDocStatus] = useState<"idle" | "reading" | "analyzing">("idle");
  const [docError, setDocError] = useState("");
  const [docAudioLoading, setDocAudioLoading] = useState(false);
  const [docAudioUrl, setDocAudioUrl] = useState("");
  const [docAudioError, setDocAudioError] = useState("");
  const [docMeta, setDocMeta] = useState<{
    numPages?: number;
    fileType?: string;
    isScanned?: boolean;
    model?: string;
  } | null>(null);
  const [isDocDragging, setIsDocDragging] = useState(false);
  const docAudioAbortRef = useRef<AbortController | null>(null);
  const docRequestAbortRef = useRef<AbortController | null>(null);
  const activeDocRequestIdRef = useRef<number>(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Translations for current selected language
  const t: TranslationStrings = getTranslations(selectedLanguage);
  const currentLangMeta = getLanguageMeta(selectedLanguage);

  // Close language menu on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setIsLangMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Determine effective language parameter for API calls
  function getEffectiveLanguage(): string {
    if (selectedLanguage !== "auto") {
      return selectedLanguage;
    }
    return detectedLanguage || "en-IN";
  }

  // Helper to replay audio from start
  function replayAudio(audioRef: React.RefObject<HTMLAudioElement | null>) {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((err) => {
        console.warn("Audio replay was prevented:", err);
      });
    }
  }

  // Release generated audio URLs, previews, and active timers when replaced or unmounted
  useEffect(() => {
    return () => {
      if (voiceAudioUrl) URL.revokeObjectURL(voiceAudioUrl);
      if (understandAudioUrl) URL.revokeObjectURL(understandAudioUrl);
      if (docAudioUrl) URL.revokeObjectURL(docAudioUrl);
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, [voiceAudioUrl, understandAudioUrl, docAudioUrl, imagePreviewUrl]);

  // Send audio to backend for transcription (routes to Gnani Prisma or Gemini Transcribe)
  async function sendToSpeechToText(audio: Blob, filename: string) {
    const formData = new FormData();
    formData.append("audio", audio, filename);
    formData.append("language", selectedLanguage);

    const response = await fetch("/api/speech-to-text", {
      method: "POST",
      body: formData,
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        typeof result.error === "string"
          ? result.error
          : JSON.stringify(result.error ?? result);

      throw new Error(message || `Speech recognition failed (${response.status}).`);
    }

    const heardTranscript =
      typeof result.transcript === "string" && result.transcript.trim()
        ? result.transcript
        : "No speech detected.";

    const detected =
      typeof result.detectedLanguage === "string"
        ? result.detectedLanguage
        : "Language not identified.";

    setTranscript(heardTranscript);
    setDetectedLanguage(detected);

    if (voiceAudioUrl) {
      URL.revokeObjectURL(voiceAudioUrl);
      setVoiceAudioUrl("");
    }
    setVoiceAudioError("");
    setAssistantResponse("");
  }

  // Ask Sunoza and speak response
  async function speakTranscript() {
    if (!transcript.trim() || transcript === "No speech detected.") return;

    if (voiceAudioAbortRef.current) {
      voiceAudioAbortRef.current.abort();
      voiceAudioAbortRef.current = null;
    }

    activeVoiceRequestIdRef.current += 1;
    const currentRequestId = activeVoiceRequestIdRef.current;

    setVoiceThinking(true);
    setVoiceAudioError("");
    setAssistantResponse("");

    if (voiceAudioUrl) {
      URL.revokeObjectURL(voiceAudioUrl);
      setVoiceAudioUrl("");
    }

    try {
      const chatResponse = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: transcript,
          language: getEffectiveLanguage(),
        }),
      });

      const chatResult = await chatResponse.json().catch(() => ({}));

      if (!chatResponse.ok) {
        throw new Error(
          chatResult.details ||
          chatResult.error ||
          "Could not generate an answer."
        );
      }

      const answer = chatResult.answer;

      if (typeof answer !== "string" || !answer.trim()) {
        throw new Error("Gemini returned an empty answer.");
      }

      if (currentRequestId !== activeVoiceRequestIdRef.current) return;

      setAssistantResponse(answer);
      setVoiceThinking(false);

      generateVoiceAudio(answer, currentRequestId);
    } catch (err) {
      if (currentRequestId !== activeVoiceRequestIdRef.current) return;

      console.error("Sunoza response error:", err);
      setVoiceAudioError(
        err instanceof Error ? err.message : "Something went wrong."
      );
      setVoiceThinking(false);
    }
  }

  async function generateVoiceAudio(textToSpeak: string, requestId?: number) {
    if (!textToSpeak.trim()) return;

    const targetRequestId = requestId ?? activeVoiceRequestIdRef.current;

    if (voiceAudioAbortRef.current) {
      voiceAudioAbortRef.current.abort();
    }

    const controller = new AbortController();
    voiceAudioAbortRef.current = controller;

    setVoiceAudioLoading(true);
    setVoiceAudioError("");

    try {
      const ttsResponse = await fetch("/api/text-to-speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          text: textToSpeak,
          language: getEffectiveLanguage(),
        }),
      });

      if (!ttsResponse.ok) {
        const ttsResult = await ttsResponse.json().catch(() => ({}));
        throw new Error(
          ttsResult.details ||
          ttsResult.error ||
          "Could not generate spoken audio."
        );
      }

      const audioBlob = await ttsResponse.blob();
      if (!audioBlob.size) {
        throw new Error("Generated audio is empty.");
      }

      if (controller.signal.aborted || targetRequestId !== activeVoiceRequestIdRef.current) {
        return;
      }

      setVoiceAudioUrl(URL.createObjectURL(audioBlob));
    } catch (err) {
      if (controller.signal.aborted || targetRequestId !== activeVoiceRequestIdRef.current) {
        return;
      }

      console.error("Voice audio generation error:", err);
      setVoiceAudioError(
        err instanceof Error ? err.message : "Could not generate spoken audio."
      );
    } finally {
      if (!controller.signal.aborted && targetRequestId === activeVoiceRequestIdRef.current) {
        setVoiceAudioLoading(false);
        voiceAudioAbortRef.current = null;
      }
    }
  }

  // Clear selected image
  function clearSelectedImage() {
    if (understandRequestAbortRef.current) {
      understandRequestAbortRef.current.abort();
      understandRequestAbortRef.current = null;
    }
    if (understandAudioAbortRef.current) {
      understandAudioAbortRef.current.abort();
      understandAudioAbortRef.current = null;
    }
    activeRequestIdRef.current += 1;

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl("");
    }
    setImageFile(null);
    setImageAnswer("");
    setUnderstandStatus("idle");
    setUnderstandError("");
    setUnderstandAudioError("");
    if (understandAudioUrl) {
      URL.revokeObjectURL(understandAudioUrl);
      setUnderstandAudioUrl("");
    }
  }

  // Clear selected document
  function clearSelectedDocument() {
    if (docRequestAbortRef.current) {
      docRequestAbortRef.current.abort();
      docRequestAbortRef.current = null;
    }
    if (docAudioAbortRef.current) {
      docAudioAbortRef.current.abort();
      docAudioAbortRef.current = null;
    }
    activeDocRequestIdRef.current += 1;

    setDocFile(null);
    setDocAnswer("");
    setDocStatus("idle");
    setDocError("");
    setDocAudioError("");
    setDocMeta(null);
    if (docAudioUrl) {
      URL.revokeObjectURL(docAudioUrl);
      setDocAudioUrl("");
    }
  }

  // Image understanding function
  async function understandImage() {
    if (!imageFile) {
      setUnderstandError("Please upload an image first.");
      return;
    }

    if (understandRequestAbortRef.current) {
      understandRequestAbortRef.current.abort();
      understandRequestAbortRef.current = null;
    }
    if (understandAudioAbortRef.current) {
      understandAudioAbortRef.current.abort();
      understandAudioAbortRef.current = null;
    }

    activeRequestIdRef.current += 1;
    const currentRequestId = activeRequestIdRef.current;

    const requestController = new AbortController();
    understandRequestAbortRef.current = requestController;

    setUnderstandStatus("understanding");
    setUnderstandError("");
    setUnderstandAudioError("");
    setImageAnswer("");

    if (understandAudioUrl) {
      URL.revokeObjectURL(understandAudioUrl);
      setUnderstandAudioUrl("");
    }

    try {
      const processedImage = await resizeImageIfNeeded(imageFile, 1600);

      if (requestController.signal.aborted || currentRequestId !== activeRequestIdRef.current) {
        return;
      }

      setUnderstandStatus("preparing");

      const formData = new FormData();
      formData.append("image", processedImage);
      formData.append(
        "question",
        imageQuestion || "Explain what is shown in this image clearly."
      );
      formData.append("language", getEffectiveLanguage());

      const response = await fetch("/api/understand", {
        method: "POST",
        body: formData,
        signal: requestController.signal,
      });

      const result = await response.json().catch(() => ({}));

      if (requestController.signal.aborted || currentRequestId !== activeRequestIdRef.current) {
        return;
      }

      if (!response.ok) {
        throw new Error(
          result.error ||
          result.details ||
          "Could not understand the image."
        );
      }

      const answer = result.answer;

      if (!answer) {
        throw new Error("No explanation was generated.");
      }

      setImageAnswer(answer);
      setUnderstandStatus("idle");

      generateUnderstandAudio(answer, currentRequestId);
    } catch (err) {
      if (requestController.signal.aborted || currentRequestId !== activeRequestIdRef.current) {
        return;
      }

      console.error("Image understanding error:", err);
      setUnderstandError(
        err instanceof Error ? err.message : "Something went wrong."
      );
      setUnderstandStatus("idle");
    } finally {
      if (understandRequestAbortRef.current === requestController) {
        understandRequestAbortRef.current = null;
      }
    }
  }

  async function generateUnderstandAudio(textToSpeak: string, requestId?: number) {
    if (!textToSpeak.trim()) return;

    const targetRequestId = requestId ?? activeRequestIdRef.current;

    if (understandAudioAbortRef.current) {
      understandAudioAbortRef.current.abort();
    }

    const controller = new AbortController();
    understandAudioAbortRef.current = controller;

    setUnderstandAudioLoading(true);
    setUnderstandAudioError("");

    try {
      const ttsResponse = await fetch("/api/text-to-speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          text: textToSpeak,
          language: getEffectiveLanguage(),
        }),
      });

      if (!ttsResponse.ok) {
        const ttsResult = await ttsResponse.json().catch(() => ({}));
        throw new Error(
          ttsResult.error ||
          ttsResult.details ||
          "Could not generate spoken explanation."
        );
      }

      const audioBlob = await ttsResponse.blob();
      if (!audioBlob.size) {
        throw new Error("Generated audio is empty.");
      }

      if (controller.signal.aborted || targetRequestId !== activeRequestIdRef.current) {
        return;
      }

      setUnderstandAudioUrl(URL.createObjectURL(audioBlob));
    } catch (err) {
      if (controller.signal.aborted || targetRequestId !== activeRequestIdRef.current) {
        return;
      }

      console.error("Understand audio generation error:", err);
      setUnderstandAudioError(
        err instanceof Error ? err.message : "Could not generate audio."
      );
    } finally {
      if (!controller.signal.aborted && targetRequestId === activeRequestIdRef.current) {
        setUnderstandAudioLoading(false);
        understandAudioAbortRef.current = null;
      }
    }
  }

  // Document understanding function
  async function understandDocument() {
    if (!docFile) {
      setDocError("Please select a document (PDF, TXT, MD, CSV, or Image) first.");
      return;
    }

    if (docRequestAbortRef.current) {
      docRequestAbortRef.current.abort();
      docRequestAbortRef.current = null;
    }
    if (docAudioAbortRef.current) {
      docAudioAbortRef.current.abort();
      docAudioAbortRef.current = null;
    }

    activeDocRequestIdRef.current += 1;
    const currentRequestId = activeDocRequestIdRef.current;

    const requestController = new AbortController();
    docRequestAbortRef.current = requestController;

    setDocStatus("reading");
    setDocError("");
    setDocAudioError("");
    setDocAnswer("");
    setDocMeta(null);

    if (docAudioUrl) {
      URL.revokeObjectURL(docAudioUrl);
      setDocAudioUrl("");
    }

    try {
      let uploadFile = docFile;

      if (["image/jpeg", "image/png", "image/webp"].includes(docFile.type)) {
        uploadFile = await resizeImageIfNeeded(docFile, 1600);
      }

      if (requestController.signal.aborted || currentRequestId !== activeDocRequestIdRef.current) {
        return;
      }

      setDocStatus("analyzing");

      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append(
        "question",
        docQuestion || "Summarise this document and explain the key dates, amounts and warnings."
      );
      formData.append("language", getEffectiveLanguage());

      const response = await fetch("/api/document", {
        method: "POST",
        body: formData,
        signal: requestController.signal,
      });

      const result = await response.json().catch(() => ({}));

      if (requestController.signal.aborted || currentRequestId !== activeDocRequestIdRef.current) {
        return;
      }

      if (!response.ok) {
        throw new Error(
          result.error ||
          result.details ||
          "Could not understand the document."
        );
      }

      const answer = result.answer;
      if (!answer) {
        throw new Error("No explanation was generated.");
      }

      setDocAnswer(answer);
      setDocMeta({
        numPages: result.numPages,
        fileType: result.fileType,
        isScanned: result.isScanned,
        model: result.model,
      });
      setDocStatus("idle");

      generateDocAudio(answer, currentRequestId);
    } catch (err) {
      if (requestController.signal.aborted || currentRequestId !== activeDocRequestIdRef.current) {
        return;
      }

      console.error("Document understanding error:", err);
      setDocError(
        err instanceof Error ? err.message : "Something went wrong."
      );
      setDocStatus("idle");
    } finally {
      if (docRequestAbortRef.current === requestController) {
        docRequestAbortRef.current = null;
      }
    }
  }

  async function generateDocAudio(textToSpeak: string, requestId?: number) {
    if (!textToSpeak.trim()) return;

    const targetRequestId = requestId ?? activeDocRequestIdRef.current;

    if (docAudioAbortRef.current) {
      docAudioAbortRef.current.abort();
    }

    const controller = new AbortController();
    docAudioAbortRef.current = controller;

    setDocAudioLoading(true);
    setDocAudioError("");

    try {
      const ttsResponse = await fetch("/api/text-to-speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          text: textToSpeak,
          language: getEffectiveLanguage(),
        }),
      });

      if (!ttsResponse.ok) {
        const ttsResult = await ttsResponse.json().catch(() => ({}));
        throw new Error(
          ttsResult.error ||
          ttsResult.details ||
          "Could not generate spoken explanation."
        );
      }

      const audioBlob = await ttsResponse.blob();
      if (!audioBlob.size) {
        throw new Error("Generated audio is empty.");
      }

      if (controller.signal.aborted || targetRequestId !== activeDocRequestIdRef.current) {
        return;
      }

      setDocAudioUrl(URL.createObjectURL(audioBlob));
    } catch (err) {
      if (controller.signal.aborted || targetRequestId !== activeDocRequestIdRef.current) {
        return;
      }

      console.error("Doc audio generation error:", err);
      setDocAudioError(
        err instanceof Error ? err.message : "Could not generate audio."
      );
    } finally {
      if (!controller.signal.aborted && targetRequestId === activeDocRequestIdRef.current) {
        setDocAudioLoading(false);
        docAudioAbortRef.current = null;
      }
    }
  }

  // Start microphone recording
  async function startRecording() {
    try {
      setError("");
      setVoiceAudioError("");
      setTranscript("");
      setDetectedLanguage("");
      if (voiceAudioUrl) {
        URL.revokeObjectURL(voiceAudioUrl);
        setVoiceAudioUrl("");
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Microphone access is not available in this browser. Please check permissions."
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      const formats = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];

      const supportedFormat = formats.find((format) =>
        MediaRecorder.isTypeSupported(format)
      );

      const recorder = supportedFormat
        ? new MediaRecorder(stream, { mimeType: supportedFormat })
        : new MediaRecorder(stream);

      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorderRef.current = recorder;
      streamRef.current = stream;

      // Start live 30-second duration counter
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      setRecordingSeconds(0);
      const timer = setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev >= 29) {
            clearInterval(timer);
            stopRecording();
            return 30;
          }
          return prev + 1;
        });
      }, 1000);
      recordingTimerRef.current = timer;

      recorder.start();
      setRecording(true);
    } catch (err) {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setRecordingSeconds(0);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;

      setError(
        err instanceof Error ? err.message : "Could not start recording."
      );
    }
  }

  // Stop recording, convert to WAV and route to speech provider
  async function stopRecording() {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    const recorder = recorderRef.current;
    if (!recorder) return;

    setRecording(false);
    setLoading(true);
    setError("");

    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.stop();
    });

    try {
      await stopped;

      streamRef.current?.getTracks().forEach((track) => track.stop());

      const rawAudio = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });

      if (rawAudio.size === 0) {
        throw new Error("No audio was recorded.");
      }

      const context = new AudioContext();

      try {
        const audioBuffer = await context.decodeAudioData(
          await rawAudio.arrayBuffer()
        );

        if (audioBuffer.duration > 30) {
          throw new Error(
            "Recording is longer than 30 seconds. Please try a shorter message."
          );
        }

        const wavAudio = audioBufferToWav(audioBuffer);
        await sendToSpeechToText(wavAudio, "sunoza-voice.wav");
      } finally {
        await context.close();
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while processing your voice."
      );
    } finally {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      streamRef.current = null;
      chunksRef.current = [];
      setLoading(false);
      setRecordingSeconds(0);
    }
  }

  // Upload an existing supported audio recording
  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError("");
    setVoiceAudioError("");
    setTranscript("");
    setDetectedLanguage("");
    if (voiceAudioUrl) {
      URL.revokeObjectURL(voiceAudioUrl);
      setVoiceAudioUrl("");
    }

    try {
      await sendToSpeechToText(file, file.name);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Audio upload failed."
      );
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  }

  // Determine current mic status
  const micState = loading
    ? "processing"
    : recording
    ? "recording"
    : voiceThinking
    ? "thinking"
    : voiceAudioLoading
    ? "speaking"
    : "idle";

  return (
    <main className="min-h-screen bg-[#F3EFE6] px-4 py-6 text-[#252A31] sm:px-6 sm:py-8 lg:px-8 lg:py-12">
      <div className="mx-auto max-w-[1240px] w-full">

        {/* ─── HEADER ─── */}
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-[#DDD6C9] pb-6 sm:mb-10">
          <div className="flex items-center gap-3.5">
            {/* Logo Mark: Indigo tile with "S", accent dot & soundwave motif */}
            <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-[#33446A] shadow-xs">
              <span className="font-bold text-lg text-[#FFFCF7]">S</span>
              <span className="h-1.5 w-1.5 rounded-full bg-[#D99B37] -ml-0.5 mt-2"></span>
              {/* Subtle soundwave brand accent inside badge */}
              <span className="absolute right-1.5 flex items-center gap-0.5" aria-hidden="true">
                <span className="h-1.5 w-0.5 rounded-full bg-[#D99B37]/70"></span>
                <span className="h-3.5 w-0.5 rounded-full bg-[#FFFCF7]/90"></span>
                <span className="h-2 w-0.5 rounded-full bg-[#D99B37]/70"></span>
              </span>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold tracking-tight text-[#33446A]">
                  {t.appName}
                </h1>
                <SoundwaveMotif bars={4} height="h-3" color="text-[#D99B37]" />
              </div>
              <p className="text-xs font-medium text-[#485E4B]">
                {t.tagline}
              </p>
            </div>
          </div>

          {/* ─── MULTILINGUAL LANGUAGE SELECTOR (13 Languages + Auto) ─── */}
          <div className="relative" ref={langMenuRef}>
            <button
              type="button"
              onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
              aria-expanded={isLangMenuOpen}
              aria-haspopup="listbox"
              aria-label="Select language"
              className="inline-flex items-center gap-2 rounded-full border border-[#DDD6C9] bg-[#FFFCF7] px-4 py-2 text-xs font-semibold text-[#33446A] shadow-xs transition hover:border-[#33446A] focus-visible:outline-2 focus-visible:outline-[#33446A]"
            >
              <SoundwaveMotif bars={3} height="h-3" color="text-[#D99B37]" />
              <span className="font-bold tracking-tight text-xs">{currentLangMeta.nativeName}</span>
              {currentLangMeta.code !== "auto" && (
                <span className="text-xs text-[#485E4B] hidden sm:inline">({currentLangMeta.englishName})</span>
              )}
              <svg
                width="10"
                height="6"
                viewBox="0 0 10 6"
                fill="none"
                className={`text-[#485E4B] transition-transform duration-150 ${isLangMenuOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              >
                <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {isLangMenuOpen && (
              <div
                role="listbox"
                className="absolute right-0 z-50 mt-2 w-72 sm:w-80 max-w-[calc(100vw-2rem)] max-h-[75vh] sm:max-h-96 overflow-y-auto rounded-2xl border border-[#DDD6C9] bg-[#FFFCF7] p-2 shadow-xl"
              >
                {/* Auto-detect option */}
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedLanguage === "auto"}
                  onClick={() => {
                    setSelectedLanguage("auto");
                    setIsLangMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs transition ${
                    selectedLanguage === "auto"
                      ? "bg-[#33446A] font-semibold text-[#FFFCF7]"
                      : "text-[#252A31] hover:bg-[#F3EFE6]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <SoundwaveMotif bars={3} color={selectedLanguage === "auto" ? "text-[#D99B37]" : "text-[#485E4B]"} />
                    <div>
                      <span className="font-bold text-sm">Auto-detect</span>
                      <p className="text-xs opacity-80">Automatic Indian speech detection</p>
                    </div>
                  </div>
                  {selectedLanguage === "auto" && <span className="font-bold">✓</span>}
                </button>

                {/* Indian Languages Section (Gnani AI) */}
                <div className="my-2 border-t border-[#ECE7DC] pt-2 px-3 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#485E4B]">
                    Indian Languages (Gnani AI)
                  </span>
                  <span className="text-xs font-semibold text-[#D99B37] bg-[#FBF4E7] px-2 py-0.5 rounded-full">10 Languages</span>
                </div>

                {INDIAN_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    role="option"
                    aria-selected={selectedLanguage === lang.code}
                    onClick={() => {
                      setSelectedLanguage(lang.code);
                      setIsLangMenuOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition ${
                      selectedLanguage === lang.code
                        ? "bg-[#33446A] font-semibold text-[#FFFCF7]"
                        : "text-[#252A31] hover:bg-[#F3EFE6]"
                    }`}
                  >
                    <div>
                      <span className="font-bold text-sm tracking-wide">{lang.nativeName}</span>
                      <span className="ml-2 text-xs opacity-75">({lang.englishName})</span>
                    </div>
                    {selectedLanguage === lang.code && <span className="font-bold">✓</span>}
                  </button>
                ))}

                {/* International Languages Section (Gemini) */}
                <div className="my-2 border-t border-[#ECE7DC] pt-2 px-3 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#485E4B]">
                    International Languages (Gemini)
                  </span>
                  <span className="text-xs font-semibold text-[#33446A] bg-[#ECE7DC] px-2 py-0.5 rounded-full">3 Languages</span>
                </div>

                {INTERNATIONAL_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    role="option"
                    aria-selected={selectedLanguage === lang.code}
                    onClick={() => {
                      setSelectedLanguage(lang.code);
                      setIsLangMenuOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition ${
                      selectedLanguage === lang.code
                        ? "bg-[#33446A] font-semibold text-[#FFFCF7]"
                        : "text-[#252A31] hover:bg-[#F3EFE6]"
                    }`}
                  >
                    <div>
                      <span className="font-bold text-sm tracking-wide">{lang.nativeName}</span>
                      <span className="ml-2 text-xs opacity-75">({lang.englishName})</span>
                    </div>
                    {selectedLanguage === lang.code && <span className="font-bold">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        {/* ─── EDITORIAL HERO SECTION (Consistent Left Alignment) ─── */}
        <section className="mb-8 sm:mb-10 border-b border-[#DDD6C9] pb-8 sm:pb-10 text-left">
          {/* Editorial Eyebrow */}
          <div className="flex items-center justify-start gap-2.5 mb-3 text-2xs font-extrabold uppercase tracking-widest text-[#B86F58]">
            <SoundwaveMotif bars={3} height="h-2.5" color="text-[#D99B37]" />
            <span>Your Everyday Accessibility Companion</span>
          </div>

          <h1 className="font-editorial text-4xl sm:text-5xl lg:text-6xl font-normal tracking-tight text-[#33446A] leading-[1.12]">
            {t.welcomeTitle || "How can I help you today?"}
          </h1>

          <p className="mt-3 text-base sm:text-lg leading-relaxed text-[#485E4B] max-w-2xl font-normal">
            Speak naturally, share a picture or upload a document. I&apos;ll help make things easier to understand.
          </p>

          {/* Typographic Capability Line */}
          <div className="mt-5 flex flex-wrap items-center justify-start gap-x-3 gap-y-1.5 text-xs font-semibold text-[#485E4B]">
            <span className="inline-flex items-center gap-1.5 text-[#33446A]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#D99B37]"></span>
              <span>13 languages</span>
            </span>
            <span className="text-[#DDD6C9]">/</span>
            <span className="inline-flex items-center gap-1.5 text-[#33446A]">
              <SoundwaveMotif bars={3} height="h-2" color="text-[#D99B37]" />
              <span>Voice assistance</span>
            </span>
            <span className="text-[#DDD6C9]">/</span>
            <span className="inline-flex items-center gap-1.5 text-[#33446A]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              <span>Image understanding</span>
            </span>
            <span className="text-[#DDD6C9]">/</span>
            <span className="inline-flex items-center gap-1.5 text-[#33446A]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                <path d="M14 2v6h6" />
              </svg>
              <span>Document reading</span>
            </span>
          </div>
        </section>

        {/* ─── MOBILE FEATURE TABS (Hidden on Desktop lg:) ─── */}
        <nav
          aria-label="Feature sections"
          className="mb-6 flex lg:hidden rounded-2xl border border-[#DDD6C9] bg-[#FFFCF7] p-1.5 shadow-xs"
        >
          <button
            type="button"
            onClick={() => setActiveTab("voice")}
            aria-selected={activeTab === "voice"}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition ${
              activeTab === "voice"
                ? "bg-[#33446A] text-[#FFFCF7] shadow-xs"
                : "text-[#485E4B] hover:text-[#252A31]"
            }`}
          >
            <SoundwaveMotif bars={3} height="h-3" color={activeTab === "voice" ? "text-[#D99B37]" : "text-current"} />
            <span>{t.tabVoice}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("image");
              setDesktopToolTab("image");
            }}
            aria-selected={activeTab === "image"}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition ${
              activeTab === "image"
                ? "bg-[#33446A] text-[#FFFCF7] shadow-xs"
                : "text-[#485E4B] hover:text-[#252A31]"
            }`}
          >
            <span>{t.tabImage}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("document");
              setDesktopToolTab("document");
            }}
            aria-selected={activeTab === "document"}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition ${
              activeTab === "document"
                ? "bg-[#33446A] text-[#FFFCF7] shadow-xs"
                : "text-[#485E4B] hover:text-[#252A31]"
            }`}
          >
            <span>{t.tabDocument}</span>
          </button>
        </nav>

        {/* ─── MAIN ASYMMETRIC GRID (Desktop: 7-col Voice + 5-col Multimodal) ─── */}
        <div className="lg:grid lg:grid-cols-12 lg:gap-10 items-start">

          {/* ═════════════════════════════════════════════════════════ */}
          {/* PRIMARY COLUMN (lg:col-span-7): TALK TO SUNOZA            */}
          {/* ═════════════════════════════════════════════════════════ */}
          <div className={`lg:col-span-7 ${activeTab === "voice" ? "block" : "hidden lg:block"}`}>
            <section aria-labelledby="voice-section-heading">
              {/* 1. Editorial Section Header (Standard min-h-[58px] baseline alignment with right column) */}
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[#DDD6C9] pb-3 mb-6 min-h-[58px]">
                <div>
                  <h2 id="voice-section-heading" className="font-editorial text-2xl sm:text-3xl font-medium tracking-tight text-[#33446A]">
                    {t.tabVoice}
                  </h2>
                  <p className="mt-1 text-xs text-[#485E4B]">
                    {t.micSupportHint}
                  </p>
                </div>

                <div className="flex items-center gap-2 text-xs font-semibold text-[#33446A]">
                  <SoundwaveMotif bars={4} height="h-3" color="text-[#D99B37]" animated={micState === "recording" || micState === "speaking"} />
                  <span className="uppercase tracking-wider text-2xs font-bold text-[#485E4B]">Voice First</span>
                </div>
              </div>

              {/* 2 & 3. Centered Microphone Area & Waveform — Open, Breathing, Unboxed */}
              <div className="my-6 sm:my-8 flex flex-col items-center">
                {/* Live Recording Indicator */}
                {micState === "recording" && (
                  <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#B86F58]/15 border border-[#B86F58]/35 px-4 py-1.5 text-xs font-bold text-[#B86F58] animate-pulse shadow-2xs">
                    <span className="h-2 w-2 rounded-full bg-[#B86F58]"></span>
                    <span>Listening… Tap microphone when finished (0:{recordingSeconds.toString().padStart(2, "0")} / 0:30)</span>
                  </div>
                )}

                <div className="relative flex items-center justify-center">
                  {/* Listening Waveform Animation */}
                  {micState === "recording" && (
                    <div className="absolute flex items-center justify-center gap-1.5 -top-10" aria-hidden="true">
                      <span className="w-1.5 h-6 rounded-full bg-[#B86F58] wave-bar-1"></span>
                      <span className="w-1.5 h-10 rounded-full bg-[#B86F58] wave-bar-2"></span>
                      <span className="w-1.5 h-14 rounded-full bg-[#D99B37] wave-bar-3"></span>
                      <span className="w-1.5 h-10 rounded-full bg-[#B86F58] wave-bar-4"></span>
                      <span className="w-1.5 h-6 rounded-full bg-[#B86F58] wave-bar-5"></span>
                    </div>
                  )}

                  {/* Speaking Waveform Animation */}
                  {micState === "speaking" && (
                    <div className="absolute flex items-center justify-center gap-1.5 -top-9" aria-hidden="true">
                      <span className="w-1 h-5 rounded-full bg-[#D99B37] speak-bar-1"></span>
                      <span className="w-1 h-8 rounded-full bg-[#33446A] speak-bar-2"></span>
                      <span className="w-1 h-10 rounded-full bg-[#D99B37] speak-bar-3"></span>
                      <span className="w-1 h-6 rounded-full bg-[#33446A] speak-bar-4"></span>
                    </div>
                  )}

                  {/* 96px Interactive Mic Button */}
                  <button
                    type="button"
                    onClick={recording ? stopRecording : startRecording}
                    disabled={loading || voiceThinking}
                    aria-label={recording ? "Stop recording voice" : "Start recording voice"}
                    className={`relative flex h-24 w-24 items-center justify-center rounded-full transition-all duration-200 ${
                      micState === "recording"
                        ? "bg-[#B86F58] mic-recording-btn text-[#FFFCF7]"
                        : micState === "processing" || micState === "thinking"
                        ? "bg-[#33446A] opacity-75 cursor-wait text-[#FFFCF7]"
                        : "bg-[#33446A] mic-idle-btn text-[#FFFCF7]"
                    } disabled:cursor-not-allowed`}
                  >
                    {micState === "recording" ? (
                      <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <rect x="7" y="7" width="10" height="10" rx="2" />
                      </svg>
                    ) : micState === "processing" || micState === "thinking" ? (
                      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeDasharray="50" strokeDashoffset="15" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" />
                        <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M9 21h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    )}
                  </button>
                </div>

                {/* 4. Recording Instruction & Status */}
                <p className="mt-5 text-xl font-bold text-[#252A31] text-center" aria-live="polite">
                  {micState === "processing"
                    ? "Understanding your request…"
                    : micState === "recording"
                    ? "Listening…"
                    : micState === "thinking"
                    ? "Understanding your request…"
                    : micState === "speaking"
                    ? t.micSpeaking
                    : "Ready when you are."}
                </p>

                <p className="mt-1 text-sm text-[#485E4B] text-center">
                  {micState === "recording"
                    ? `0:${recordingSeconds.toString().padStart(2, "0")} of 30 seconds max`
                    : micState === "processing" || micState === "thinking"
                    ? "Analyzing speech and generating response…"
                    : micState === "speaking"
                    ? "Playing spoken explanation aloud"
                    : "Tap the microphone and speak naturally."}
                </p>

                <div className="mt-3 flex items-center gap-2 text-xs font-medium text-[#485E4B]">
                  <SoundwaveMotif bars={3} height="h-2.5" color="text-[#D99B37]" />
                  <span>Listening in:</span>
                  <span className="font-bold text-[#33446A]">{currentLangMeta.nativeName}</span>
                </div>
              </div>

              {/* Error Banner */}
              {error && (
                <div
                  role="alert"
                  className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
                >
                  {error}
                </div>
              )}

              {/* Gentle "No Speech Detected" Banner */}
              {transcript === "No speech detected." && (
                <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/70 p-5 text-sm text-amber-900">
                  <div className="flex items-center gap-2 font-bold mb-1">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>No speech was detected</span>
                  </div>
                  <p className="text-xs text-amber-800 leading-relaxed mb-3">
                    We couldn&apos;t detect any clear speech in your recording. Please ensure your microphone is unmuted, speak clearly, and try again.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setTranscript("");
                      setDetectedLanguage("");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-950 transition"
                  >
                    Try again
                  </button>
                </div>
              )}

              {/* 5. Transcript or Conversation Reading Surface (when present) */}
              {transcript && transcript !== "No speech detected." && (
                <div className="rounded-2xl border border-[#DDD6C9] bg-[#FFFCF7] p-5 sm:p-6 mb-6 shadow-xs">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <SoundwaveMotif bars={3} height="h-3" color="text-[#33446A]" />
                      <span className="text-xs font-bold uppercase tracking-wider text-[#33446A]">
                        {t.whatIHerd}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[#485E4B]">
                        {currentLangMeta.code !== "auto" ? currentLangMeta.nativeName : detectedLanguage || "Auto"}
                      </span>
                      <span className="text-[#DDD6C9]">·</span>
                      <button
                        type="button"
                        onClick={() => {
                          setTranscript("");
                          setAssistantResponse("");
                          if (voiceAudioUrl) {
                            URL.revokeObjectURL(voiceAudioUrl);
                            setVoiceAudioUrl("");
                          }
                        }}
                        className="text-xs text-[#B86F58] hover:underline font-semibold"
                        aria-label="Clear transcript"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <p className="text-base leading-relaxed text-[#252A31] break-words">{transcript}</p>

                  {/* Assistant Response Inside Surface */}
                  {assistantResponse && (
                    <div
                      className="mt-5 border-t border-[#ECE7DC] pt-4"
                      aria-live="polite"
                      role="region"
                      aria-label="Assistant answer"
                    >
                      <div className="flex items-center gap-1.5 mb-2">
                        <SoundwaveMotif bars={3} height="h-3" color="text-[#D99B37]" />
                        <p className="text-xs font-bold uppercase tracking-wider text-[#D99B37]">
                          {t.sunozaSays}
                        </p>
                      </div>
                      <p className="text-base leading-relaxed text-[#252A31] break-words">
                        {assistantResponse}
                      </p>
                    </div>
                  )}

                  {/* Action Controls */}
                  <div className="mt-5 border-t border-[#DDD6C9] pt-4">
                    <button
                      type="button"
                      onClick={speakTranscript}
                      disabled={voiceThinking || loading}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#33446A] px-5 py-3 text-sm font-semibold text-[#FFFCF7] shadow-xs transition hover:bg-[#263350] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {voiceThinking ? (
                        <>
                          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                          <span>Understanding your request…</span>
                        </>
                      ) : (
                        <>
                          <SoundwaveMotif bars={3} height="h-3" color="text-[#D99B37]" />
                          {t.askSunoza}
                        </>
                      )}
                    </button>

                    {voiceAudioLoading && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-[#485E4B]" aria-live="polite">
                        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#D99B37]"></span>
                        {t.audioGenerating}
                      </div>
                    )}

                    {voiceAudioError && (
                      <div className="mt-3 flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900 border border-amber-200" role="alert">
                        <span>{voiceAudioError}</span>
                        <button
                          type="button"
                          onClick={() => generateVoiceAudio(assistantResponse)}
                          disabled={voiceAudioLoading}
                          aria-label="Retry audio generation"
                          className="ml-3 font-semibold underline hover:text-amber-950 focus:outline-none"
                        >
                          {t.retry}
                        </button>
                      </div>
                    )}

                    {voiceAudioUrl && (
                      <div className="mt-4 pt-3 border-t border-[#DDD6C9]/60">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 text-xs font-semibold text-[#33446A]">
                            <SoundwaveMotif bars={4} height="h-3" color="text-[#D99B37]" animated={true} />
                            <span>Spoken Audio Response</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => replayAudio(voiceAudioRef)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[#DDD6C9] bg-[#FFFCF7] px-2.5 py-1 text-xs font-semibold text-[#33446A] hover:bg-[#FAF7F0] transition"
                            aria-label="Replay audio from beginning"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                              <path d="M3 3v5h5" />
                            </svg>
                            <span>Replay Audio</span>
                          </button>
                        </div>
                        <audio
                          ref={voiceAudioRef}
                          controls
                          preload="metadata"
                          src={voiceAudioUrl}
                          className="w-full"
                        >
                          Your browser does not support audio playback.
                        </audio>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 6. Example Questions (Shown in Sequence 6) */}
              {micState === "idle" && !transcript && !assistantResponse && (
                <div className="mt-6 border-t border-[#DDD6C9] pt-5">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#485E4B] mb-2.5">
                    Or try one of these questions:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {VOICE_EXAMPLE_PHRASES.map((phrase) => (
                      <button
                        key={phrase}
                        type="button"
                        onClick={() => {
                          setTranscript(phrase);
                          setDetectedLanguage(currentLangMeta.nativeName || "English");
                          if (voiceAudioUrl) {
                            URL.revokeObjectURL(voiceAudioUrl);
                            setVoiceAudioUrl("");
                          }
                          setAssistantResponse("");
                          setVoiceAudioError("");
                        }}
                        className="rounded-xl border border-[#DDD6C9] bg-[#FAF7F0] px-3.5 py-2.5 text-left text-xs font-medium text-[#33446A] hover:border-[#33446A] hover:bg-[#FFFCF7] transition focus-visible:outline-2 focus-visible:outline-[#33446A]"
                      >
                        &ldquo;{phrase}&rdquo;
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 7. Audio Upload Hairline Row */}
              <div className="mt-6 border-t border-[#DDD6C9] pt-4">
                <label
                  htmlFor="audio-upload"
                  className={`flex cursor-pointer items-center justify-between rounded-xl border border-[#DDD6C9] bg-[#FAF7F0] px-4 py-2.5 text-xs transition hover:border-[#33446A] hover:bg-[#FFFCF7] ${
                    loading || recording || voiceThinking ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <SoundwaveMotif bars={3} height="h-3.5" color="text-[#485E4B]" />
                    <div>
                      <span className="font-semibold text-[#33446A]">{t.orUploadAudio}</span>
                      <span className="text-xs text-[#485E4B] ml-2 hidden sm:inline">({t.audioFormats})</span>
                    </div>
                  </div>

                  <span className="font-semibold text-[#33446A] underline underline-offset-2">
                    Browse file
                  </span>

                  <input
                    id="audio-upload"
                    type="file"
                    accept=".wav,.mp3,.ogg,.flac,.aac,.m4a"
                    onChange={handleFileUpload}
                    disabled={loading || recording || voiceThinking}
                    className="sr-only"
                  />
                </label>
              </div>
            </section>
          </div>

          {/* ═════════════════════════════════════════════════════════ */}
          {/* SECONDARY COLUMN (lg:col-span-5): MULTIMODAL SUITE       */}
          {/* ═════════════════════════════════════════════════════════ */}
          <div className={`lg:col-span-5 ${activeTab !== "voice" ? "block" : "hidden lg:block"}`}>

            {/* Desktop Unified Header & Tool Switcher (Exact min-h-[58px] baseline alignment with left column) */}
            <div className="hidden lg:flex items-baseline justify-between gap-3 border-b border-[#DDD6C9] pb-3 mb-6 min-h-[58px]">
              <div>
                <h2 className="font-editorial text-2xl sm:text-3xl font-medium tracking-tight text-[#33446A]">
                  {desktopToolTab === "image" ? t.imageSectionTitle : t.docSectionTitle}
                </h2>
                <p className="mt-1 text-xs text-[#485E4B]">
                  {desktopToolTab === "image" ? t.imageSectionDesc : "Upload an invoice, agreement, letter, policy or other document."}
                </p>
              </div>

              {/* Integrated Switcher Tabs in Desktop Header */}
              <div className="flex items-center rounded-xl border border-[#DDD6C9] bg-[#FFFCF7] p-1 shadow-2xs shrink-0">
                <button
                  type="button"
                  onClick={() => setDesktopToolTab("image")}
                  aria-selected={desktopToolTab === "image"}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    desktopToolTab === "image"
                      ? "bg-[#33446A] text-[#FFFCF7] shadow-2xs"
                      : "text-[#485E4B] hover:text-[#252A31]"
                  }`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                    <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{t.tabImage}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDesktopToolTab("document")}
                  aria-selected={desktopToolTab === "document"}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    desktopToolTab === "document"
                      ? "bg-[#33446A] text-[#FFFCF7] shadow-2xs"
                      : "text-[#485E4B] hover:text-[#252A31]"
                  }`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                  <span>{t.tabDocument}</span>
                </button>
              </div>
            </div>

            {/* ─── TOOL A: IMAGE UNDERSTANDING ─── */}
            <div className={`${activeTab === "document" ? "hidden lg:hidden" : (desktopToolTab === "image" || activeTab === "image" ? "block" : "hidden lg:hidden")}`}>
              <section aria-labelledby="image-section-heading">
                {/* Mobile-Only Section Header */}
                <div className="flex lg:hidden flex-wrap items-baseline justify-between gap-2 border-b border-[#DDD6C9] pb-3 mb-6">
                  <div>
                    <h2 id="image-section-heading" className="font-editorial text-2xl sm:text-3xl font-medium tracking-tight text-[#33446A]">
                      {t.imageSectionTitle}
                    </h2>
                    <p className="mt-1 text-xs text-[#485E4B]">
                      {t.imageSectionDesc}
                    </p>
                  </div>
                  <span className="uppercase tracking-wider text-2xs font-bold text-[#485E4B]">
                    Visual AI
                  </span>
                </div>

                {/* Subtle Editorial Upload Surface */}
                <div
                  tabIndex={0}
                  role="button"
                  aria-label="Upload an image"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      document.getElementById("image-upload")?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsImageDragging(true);
                  }}
                  onDragLeave={() => setIsImageDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsImageDragging(false);
                    const droppedFile = e.dataTransfer.files?.[0];
                    if (droppedFile) {
                      if (["image/jpeg", "image/png", "image/webp"].includes(droppedFile.type)) {
                        if (understandRequestAbortRef.current) understandRequestAbortRef.current.abort();
                        if (understandAudioAbortRef.current) understandAudioAbortRef.current.abort();
                        activeRequestIdRef.current += 1;
                        setUnderstandStatus("idle");
                        if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
                        setImageFile(droppedFile);
                        setImagePreviewUrl(URL.createObjectURL(droppedFile));
                        setImageAnswer("");
                        setUnderstandError("");
                        setUnderstandAudioError("");
                        if (understandAudioUrl) {
                          URL.revokeObjectURL(understandAudioUrl);
                          setUnderstandAudioUrl("");
                        }
                      } else {
                        setUnderstandError("Unsupported image format. Please upload JPEG, PNG, or WEBP.");
                      }
                    }
                  }}
                  onClick={() => document.getElementById("image-upload")?.click()}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-[#DDD6C9] px-4 py-6 text-center transition focus-visible:outline-2 focus-visible:outline-[#33446A] ${
                    isImageDragging
                      ? "border-[#33446A] bg-[#ECE7DC] scale-[0.99]"
                      : "bg-[#FAF7F0] hover:border-[#33446A] hover:bg-[#FFFCF7]"
                  }`}
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#ECE7DC] text-[#33446A]">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
                      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                      <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>

                  <span className="mt-3 text-xs font-bold text-[#33446A]">
                    {isImageDragging ? "Drop your image here" : t.chooseImage}
                  </span>
                  <span className="mt-0.5 text-xs text-[#485E4B]">JPEG, PNG, WEBP · Up to 8 MB</span>

                  <input
                    id="image-upload"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      if (understandRequestAbortRef.current) understandRequestAbortRef.current.abort();
                      if (understandAudioAbortRef.current) understandAudioAbortRef.current.abort();
                      activeRequestIdRef.current += 1;
                      setUnderstandStatus("idle");

                      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
                      setImageFile(file);
                      setImagePreviewUrl(file ? URL.createObjectURL(file) : "");
                      setImageAnswer("");
                      setUnderstandError("");
                      setUnderstandAudioError("");
                      if (understandAudioUrl) {
                        URL.revokeObjectURL(understandAudioUrl);
                        setUnderstandAudioUrl("");
                      }
                    }}
                  />
                </div>

                {/* Selected Image Row */}
                {imageFile && (
                  <div className="mt-3 flex items-center justify-between rounded-xl border border-[#DDD6C9] bg-[#FFFCF7] px-3.5 py-2.5 text-xs shadow-2xs">
                    <div className="flex items-center gap-2.5 truncate text-[#33446A]">
                      {imagePreviewUrl && (
                        <img
                          src={imagePreviewUrl}
                          alt="Thumbnail preview"
                          className="h-10 w-10 rounded-lg object-cover border border-[#DDD6C9] shadow-2xs shrink-0"
                        />
                      )}
                      <div className="truncate">
                        <span className="truncate font-semibold block text-sm">{imageFile.name}</span>
                        <span className="text-xs text-[#485E4B]">
                          {(imageFile.size / 1024).toFixed(0)} KB · {imageFile.type.replace("image/", "").toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={clearSelectedImage}
                      aria-label="Remove selected image"
                      className="ml-2 shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#B86F58] hover:bg-red-50 focus:outline-none transition"
                    >
                      {t.remove}
                    </button>
                  </div>
                )}

                {/* Suggested Question Chips */}
                <div className="mt-4">
                  <p className="text-2xs font-bold uppercase tracking-wider text-[#485E4B] mb-2">
                    Suggested questions:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {IMAGE_PROMPT_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setImageQuestion(chip)}
                        className="rounded-lg border border-[#DDD6C9] bg-[#FAF7F0] px-3 py-1.5 text-2xs font-medium text-[#33446A] hover:border-[#33446A] hover:bg-[#FFFCF7] transition"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Question Input */}
                <label
                  htmlFor="image-question"
                  className="mt-4 mb-1.5 block text-xs font-bold text-[#252A31]"
                >
                  {t.imagePromptLabel}
                </label>

                <textarea
                  id="image-question"
                  value={imageQuestion}
                  onChange={(e) => setImageQuestion(e.target.value)}
                  placeholder={t.imagePromptPlaceholder}
                  rows={2}
                  className="w-full rounded-xl border border-[#DDD6C9] bg-[#FAF7F0] p-3 text-base outline-none transition focus:border-[#33446A] focus:bg-[#FFFCF7] sm:text-xs"
                />

                <button
                  type="button"
                  onClick={understandImage}
                  disabled={!imageFile || understandStatus !== "idle"}
                  className="mt-3.5 w-full rounded-xl bg-[#33446A] px-4 py-3 text-xs font-bold text-[#FFFCF7] shadow-xs transition hover:bg-[#263350] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {understandStatus === "understanding" || understandStatus === "preparing" ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                      {t.imageExplaining}
                    </span>
                  ) : (
                    t.imageExplainBtn
                  )}
                </button>

                {understandError && (
                  <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                    {understandError}
                  </div>
                )}

                {/* Image Explanation Result Reading Surface */}
                {imageAnswer && (
                  <div
                    className="mt-5 rounded-2xl border border-[#DDD6C9] bg-[#FFFCF7] p-5 text-xs shadow-xs"
                    aria-live="polite"
                    role="region"
                    aria-label="Image explanation"
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      <SoundwaveMotif bars={3} height="h-3" color="text-[#D99B37]" />
                      <p className="font-bold uppercase tracking-wider text-[#D99B37] text-xs">
                        {t.sunozaSays}
                      </p>
                    </div>

                    <p className="leading-relaxed text-[#252A31] text-sm break-words">{imageAnswer}</p>

                    {/* Audio Playback Controls */}
                    <div className="mt-4 border-t border-[#ECE7DC] pt-3">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[#33446A]">
                          {t.listenExplanation}
                        </span>
                        {understandAudioLoading && (
                          <span className="flex items-center gap-1.5 text-xs text-[#485E4B]" aria-live="polite">
                            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#D99B37]"></span>
                            {t.audioGenerating}
                          </span>
                        )}
                        {understandAudioUrl && !understandAudioLoading && (
                          <button
                            type="button"
                            onClick={() => replayAudio(understandAudioRef)}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#DDD6C9] bg-[#FFFCF7] px-2.5 py-1 text-xs font-semibold text-[#33446A] hover:bg-[#FAF7F0] transition"
                            aria-label="Replay audio"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                              <path d="M3 3v5h5" />
                            </svg>
                            <span>Replay Audio</span>
                          </button>
                        )}
                      </div>

                      {understandAudioError && (
                        <div className="mt-2 flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 border border-amber-200" role="alert">
                          <span>{understandAudioError}</span>
                          <button
                            type="button"
                            onClick={() => generateUnderstandAudio(imageAnswer)}
                            disabled={understandAudioLoading}
                            aria-label="Retry audio generation"
                            className="ml-2 font-semibold underline hover:text-amber-950 focus:outline-none"
                          >
                            {t.retry}
                          </button>
                        </div>
                      )}

                      {understandAudioUrl && (
                        <audio
                          ref={understandAudioRef}
                          controls
                          src={understandAudioUrl}
                          className="mt-2 w-full"
                        >
                          Your browser does not support audio playback.
                        </audio>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* ─── TOOL B: DOCUMENT UNDERSTANDING ─── */}
            <div className={`${activeTab === "image" ? "hidden lg:hidden" : (desktopToolTab === "document" || activeTab === "document" ? "block" : "hidden lg:hidden")}`}>
              <section aria-labelledby="doc-section-heading">
                {/* Mobile-Only Section Header */}
                <div className="flex lg:hidden flex-wrap items-baseline justify-between gap-2 border-b border-[#DDD6C9] pb-3 mb-6">
                  <div>
                    <h2 id="doc-section-heading" className="font-editorial text-2xl sm:text-3xl font-medium tracking-tight text-[#33446A]">
                      {t.docSectionTitle}
                    </h2>
                    <p className="mt-1 text-xs text-[#485E4B]">
                      Upload an invoice, agreement, letter, policy or other document.
                    </p>
                  </div>
                  <span className="uppercase tracking-wider text-2xs font-bold text-[#485E4B]">
                    Document AI
                  </span>
                </div>

                {/* Subtle Editorial Upload Surface */}
                <div
                  tabIndex={0}
                  role="button"
                  aria-label="Upload a document"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      document.getElementById("doc-upload")?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDocDragging(true);
                  }}
                  onDragLeave={() => setIsDocDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDocDragging(false);
                    const droppedFile = e.dataTransfer.files?.[0];
                    if (droppedFile) {
                      if (docRequestAbortRef.current) docRequestAbortRef.current.abort();
                      if (docAudioAbortRef.current) docAudioAbortRef.current.abort();
                      activeDocRequestIdRef.current += 1;
                      setDocStatus("idle");
                      setDocFile(droppedFile);
                      setDocAnswer("");
                      setDocError("");
                      setDocAudioError("");
                      setDocMeta(null);
                      if (docAudioUrl) {
                        URL.revokeObjectURL(docAudioUrl);
                        setDocAudioUrl("");
                      }
                    }
                  }}
                  onClick={() => document.getElementById("doc-upload")?.click()}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-[#DDD6C9] px-4 py-6 text-center transition focus-visible:outline-2 focus-visible:outline-[#33446A] ${
                    isDocDragging
                      ? "border-[#33446A] bg-[#ECE7DC] scale-[0.99]"
                      : "bg-[#FAF7F0] hover:border-[#33446A] hover:bg-[#FFFCF7]"
                  }`}
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#ECE7DC] text-[#33446A]">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                      <path d="M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </div>

                  <span className="mt-3 text-xs font-bold text-[#33446A]">
                    {isDocDragging ? "Drop your file here" : t.chooseDoc}
                  </span>
                  <span className="mt-0.5 text-xs text-[#485E4B]">PDF, TXT, MD, CSV · Up to 10 MB (Max 30 pages for PDF)</span>

                  <input
                    id="doc-upload"
                    type="file"
                    accept=".pdf,.txt,.md,.csv,image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      if (docRequestAbortRef.current) docRequestAbortRef.current.abort();
                      if (docAudioAbortRef.current) docAudioAbortRef.current.abort();
                      activeDocRequestIdRef.current += 1;
                      setDocStatus("idle");
                      setDocFile(file);
                      setDocAnswer("");
                      setDocError("");
                      setDocAudioError("");
                      setDocMeta(null);
                      if (docAudioUrl) {
                        URL.revokeObjectURL(docAudioUrl);
                        setDocAudioUrl("");
                      }
                    }}
                  />
                </div>

                {/* Selected Document Row */}
                {docFile && (
                  <div className="mt-3 flex items-center justify-between rounded-xl border border-[#DDD6C9] bg-[#FFFCF7] px-3.5 py-2.5 text-xs shadow-2xs">
                    <div className="flex items-center gap-2.5 truncate text-[#33446A]">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0 text-[#33446A]" aria-hidden="true">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                        <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                      </svg>
                      <div className="truncate">
                        <span className="truncate font-semibold block text-sm">{docFile.name}</span>
                        <span className="shrink-0 text-xs text-[#485E4B]">
                          {(docFile.size / 1024).toFixed(0)} KB
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={clearSelectedDocument}
                      aria-label="Remove selected document"
                      className="ml-2 shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#B86F58] hover:bg-red-50 focus:outline-none transition"
                    >
                      {t.remove}
                    </button>
                  </div>
                )}

                {/* Suggested Task Chips */}
                <div className="mt-4">
                  <p className="text-2xs font-bold uppercase tracking-wider text-[#485E4B] mb-2">
                    Suggested tasks:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {DOC_PROMPT_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setDocQuestion(chip)}
                        className="rounded-lg border border-[#DDD6C9] bg-[#FAF7F0] px-3 py-1.5 text-2xs font-medium text-[#33446A] hover:border-[#33446A] hover:bg-[#FFFCF7] transition"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Question Input */}
                <label
                  htmlFor="doc-question"
                  className="mt-4 mb-1.5 block text-xs font-bold text-[#252A31]"
                >
                  {t.docPromptLabel}
                </label>

                <textarea
                  id="doc-question"
                  value={docQuestion}
                  onChange={(e) => setDocQuestion(e.target.value)}
                  placeholder={t.docPromptPlaceholder}
                  rows={2}
                  className="w-full rounded-xl border border-[#DDD6C9] bg-[#FAF7F0] p-3 text-base outline-none transition focus:border-[#33446A] focus:bg-[#FFFCF7] sm:text-xs"
                />

                <button
                  type="button"
                  onClick={understandDocument}
                  disabled={!docFile || docStatus !== "idle"}
                  className="mt-3.5 w-full rounded-xl bg-[#33446A] px-4 py-3 text-xs font-bold text-[#FFFCF7] shadow-xs transition hover:bg-[#263350] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {docStatus === "reading" ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                      {t.docReading}
                    </span>
                  ) : docStatus === "analyzing" ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                      {t.docAnalyzing}
                    </span>
                  ) : (
                    t.docExplainBtn
                  )}
                </button>

                {docError && (
                  <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                    {docError}
                  </div>
                )}

                {/* Document Explanation Result Reading Surface */}
                {docAnswer && (
                  <div
                    className="mt-5 rounded-2xl border border-[#DDD6C9] bg-[#FFFCF7] p-5 text-xs shadow-xs"
                    aria-live="polite"
                    role="region"
                    aria-label="Document explanation"
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <SoundwaveMotif bars={3} height="h-3" color="text-[#D99B37]" />
                        <p className="font-bold uppercase tracking-wider text-[#D99B37] text-xs">
                          {t.sunozaSays}
                        </p>
                      </div>
                      {docMeta && (
                        <span className="text-xs font-bold text-[#33446A]">
                          {docMeta.fileType?.toUpperCase()} · {docMeta.numPages} {docMeta.numPages === 1 ? "page" : "pages"}
                          {docMeta.isScanned ? " · OCR" : ""}
                        </span>
                      )}
                    </div>

                    <div className="space-y-3 leading-relaxed text-[#252A31] text-sm break-words">
                      {docAnswer.split("\n\n").map((para, idx) => (
                        <p key={idx}>{para}</p>
                      ))}
                    </div>

                    {/* Audio Playback Controls */}
                    <div className="mt-4 border-t border-[#ECE7DC] pt-3">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[#33446A]">
                          {t.listenExplanation}
                        </span>
                        {docAudioLoading && (
                          <span className="flex items-center gap-1.5 text-xs text-[#485E4B]" aria-live="polite">
                            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#D99B37]"></span>
                            {t.audioGenerating}
                          </span>
                        )}
                        {docAudioUrl && !docAudioLoading && (
                          <button
                            type="button"
                            onClick={() => replayAudio(docAudioRef)}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#DDD6C9] bg-[#FFFCF7] px-2.5 py-1 text-xs font-semibold text-[#33446A] hover:bg-[#FAF7F0] transition"
                            aria-label="Replay audio"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                              <path d="M3 3v5h5" />
                            </svg>
                            <span>Replay Audio</span>
                          </button>
                        )}
                      </div>

                      {docAudioError && (
                        <div className="mt-2 flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 border border-amber-200" role="alert">
                          <span>{docAudioError}</span>
                          <button
                            type="button"
                            onClick={() => generateDocAudio(docAnswer)}
                            disabled={docAudioLoading}
                            aria-label="Retry audio generation"
                            className="ml-2 font-semibold underline hover:text-amber-950 focus:outline-none"
                          >
                            {t.retry}
                          </button>
                        </div>
                      )}

                      {docAudioUrl && (
                        <audio
                          ref={docAudioRef}
                          controls
                          src={docAudioUrl}
                          className="mt-2 w-full"
                        >
                          Your browser does not support audio playback.
                        </audio>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>

        {/* ─── HOW SUNOZA HELPS (EDITORIAL 3-COLUMN MAGAZINE LAYOUT) ─── */}
        <section className="mt-16 sm:mt-20 border-t border-[#DDD6C9] pt-10 sm:pt-14">
          <div className="mb-8 sm:mb-10 text-left">
            <span className="text-2xs font-extrabold uppercase tracking-widest text-[#B86F58] block mb-2">
              Everyday Accessibility
            </span>
            <h2 className="font-editorial text-3xl sm:text-4xl lg:text-5xl font-normal tracking-tight text-[#33446A]">
              Designed to make everyday technology easier.
            </h2>
            <p className="mt-3 text-sm sm:text-base text-[#485E4B] max-w-2xl leading-relaxed">
              Simple ways to communicate, understand what you see and make sense of important information.
            </p>
          </div>

          {/* Three Open Columns with Consistent Gutters & Shared Baselines */}
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#DDD6C9] border-y border-[#DDD6C9]">
            {/* Column 01 */}
            <div className="flex flex-col justify-between py-6 md:py-8 px-0 md:px-8 first:md:pl-0 last:md:pr-0">
              <div>
                <span className="font-editorial text-4xl sm:text-5xl italic text-[#D99B37] block mb-3 font-normal leading-none">
                  01
                </span>
                <span className="text-2xs font-bold uppercase tracking-wider text-[#485E4B] block mb-1">
                  Voice First
                </span>
                <h3 className="font-editorial text-2xl font-medium text-[#33446A] mb-2.5">
                  Talk naturally
                </h3>
                <p className="text-sm leading-relaxed text-[#485E4B]">
                  Speak in your preferred language and receive a natural spoken response.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-[#ECE7DC] flex items-center gap-1.5 text-xs font-semibold text-[#33446A]">
                <SoundwaveMotif bars={3} height="h-2.5" color="text-[#D99B37]" />
                <span>13 Languages Supported</span>
              </div>
            </div>

            {/* Column 02 */}
            <div className="flex flex-col justify-between py-6 md:py-8 px-0 md:px-8 first:md:pl-0 last:md:pr-0">
              <div>
                <span className="font-editorial text-4xl sm:text-5xl italic text-[#B86F58] block mb-3 font-normal leading-none">
                  02
                </span>
                <span className="text-2xs font-bold uppercase tracking-wider text-[#485E4B] block mb-1">
                  Visual AI
                </span>
                <h3 className="font-editorial text-2xl font-medium text-[#33446A] mb-2.5">
                  Understand what you see
                </h3>
                <p className="text-sm leading-relaxed text-[#485E4B]">
                  Share a photograph, screenshot or sign and ask questions about it.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-[#ECE7DC] flex items-center gap-1.5 text-xs font-semibold text-[#33446A]">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#B86F58]" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="m10 15 5-3-5-3v6Z" fill="currentColor" />
                </svg>
                <span>Instant Spoken Answers</span>
              </div>
            </div>

            {/* Column 03 */}
            <div className="flex flex-col justify-between py-6 md:py-8 px-0 md:px-8 first:md:pl-0 last:md:pr-0">
              <div>
                <span className="font-editorial text-4xl sm:text-5xl italic text-[#485E4B] block mb-3 font-normal leading-none">
                  03
                </span>
                <span className="text-2xs font-bold uppercase tracking-wider text-[#485E4B] block mb-1">
                  Document AI
                </span>
                <h3 className="font-editorial text-2xl font-medium text-[#33446A] mb-2.5">
                  Make documents simpler
                </h3>
                <p className="text-sm leading-relaxed text-[#485E4B]">
                  Understand letters, invoices, forms, agreements and important information.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-[#ECE7DC] flex items-center gap-1.5 text-xs font-semibold text-[#33446A]">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#485E4B]" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                  <path d="M14 2v6h6" />
                </svg>
                <span>PDF, TXT, MD, CSV & OCR</span>
              </div>
            </div>
          </div>
        </section>

        {/* ─── EDITORIAL TRUST & PRIVACY STRIP (UNBOXED, MATCHING 3-COLUMN GRID) ─── */}
        <section className="mt-10 sm:mt-12 border-b border-[#DDD6C9] pb-8 sm:pb-10" aria-label="Trust and security information">
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#DDD6C9] text-xs">
            <div className="py-4 md:py-0 px-0 md:px-8 first:md:pl-0 last:md:pr-0 flex items-start gap-3.5">
              <span className="font-editorial text-2xl italic text-[#33446A] font-normal leading-none shrink-0">
                01
              </span>
              <div>
                <h4 className="font-bold text-[#33446A] text-sm">Server-side security</h4>
                <p className="mt-1 text-[#485E4B] leading-relaxed">
                  API credentials remain server-side and are not exposed in the browser.
                </p>
              </div>
            </div>

            <div className="py-4 md:py-0 px-0 md:px-8 first:md:pl-0 last:md:pr-0 flex items-start gap-3.5">
              <span className="font-editorial text-2xl italic text-[#33446A] font-normal leading-none shrink-0">
                02
              </span>
              <div>
                <h4 className="font-bold text-[#33446A] text-sm">Transparent limits</h4>
                <p className="mt-1 text-[#485E4B] leading-relaxed">
                  Clearly explain upload sizes (8 MB image, 10 MB doc, 30 PDF pages) and 30-second recording limits.
                </p>
              </div>
            </div>

            <div className="py-4 md:py-0 px-0 md:px-8 first:md:pl-0 last:md:pr-0 flex items-start gap-3.5">
              <span className="font-editorial text-2xl italic text-[#33446A] font-normal leading-none shrink-0">
                03
              </span>
              <div>
                <h4 className="font-bold text-[#33446A] text-sm">AI verification</h4>
                <p className="mt-1 text-[#485E4B] leading-relaxed">
                  Remind users that important legal, medical and financial information should be verified.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ─── REFINED EDITORIAL FOOTER ─── */}
        <footer className="mt-12 sm:mt-16 pt-6 pb-8 text-center text-xs text-[#485E4B]">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#33446A] text-[#FFFCF7] font-bold text-xs shadow-2xs">
                S
              </div>
              <span className="font-bold text-[#33446A] text-sm tracking-tight">{t.appName}</span>
              <span className="text-[#DDD6C9]">/</span>
              <span className="font-medium text-[#485E4B]">{t.tagline}</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#33446A]">
                <SoundwaveMotif bars={3} height="h-2.5" color="text-[#D99B37]" />
                <span>Accessibility Assistant</span>
              </span>
              <span className="text-[#DDD6C9]">·</span>
              <span className="text-xs text-[#485E4B]">Powered by Gnani AI & Gemini</span>
            </div>
          </div>

          <p className="text-xs text-[#485E4B]/80 max-w-xl mx-auto">
            Crafted with high contrast, keyboard accessibility, and multilingual voice-first interaction to empower every user.
          </p>
        </footer>
      </div>
    </main>
  );
}
