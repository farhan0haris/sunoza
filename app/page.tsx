"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

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

  // Downmix to mono and resample to 16 kHz.
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

  // Encode samples as 16-bit PCM WAV.
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

export default function Home() {
  // Global Language Preference
  const [selectedLanguage, setSelectedLanguage] = useState<string>("auto");

  // Voice Assistant states
  const [recording, setRecording] = useState(false);
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
  const [imageQuestion, setImageQuestion] = useState(
    "What does this image mean?"
  );
  const [imageAnswer, setImageAnswer] = useState("");
  const [understandStatus, setUnderstandStatus] = useState<
    "idle" | "understanding" | "preparing"
  >("idle");
  const [understandError, setUnderstandError] = useState("");
  const [understandAudioLoading, setUnderstandAudioLoading] = useState(false);
  const [understandAudioUrl, setUnderstandAudioUrl] = useState("");
  const [understandAudioError, setUnderstandAudioError] = useState("");
  const understandAudioAbortRef = useRef<AbortController | null>(null);
  const understandRequestAbortRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<number>(0);

  // Document understanding states
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docQuestion, setDocQuestion] = useState(
    "Summarise this document and explain the key dates, amounts and warnings."
  );
  const [docAnswer, setDocAnswer] = useState("");
  const [docStatus, setDocStatus] = useState<
    "idle" | "reading" | "analyzing"
  >("idle");
  const [docError, setDocError] = useState("");
  const [docAudioLoading, setDocAudioLoading] = useState(false);
  const [docAudioUrl, setDocAudioUrl] = useState("");
  const [docAudioError, setDocAudioError] = useState("");
  const [docMeta, setDocMeta] = useState<{
    numPages?: number;
    fileType?: string;
    isScanned?: boolean;
  } | null>(null);
  const [isDocDragging, setIsDocDragging] = useState(false);
  const docAudioAbortRef = useRef<AbortController | null>(null);
  const docRequestAbortRef = useRef<AbortController | null>(null);
  const activeDocRequestIdRef = useRef<number>(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Determine effective language parameter for API calls
  function getEffectiveLanguage(): string {
    if (selectedLanguage !== "auto") {
      return selectedLanguage;
    }
    return detectedLanguage || "en-IN";
  }

  // Release generated audio URLs when they are replaced or the page unmounts.
  useEffect(() => {
    return () => {
      if (voiceAudioUrl) URL.revokeObjectURL(voiceAudioUrl);
      if (understandAudioUrl) URL.revokeObjectURL(understandAudioUrl);
      if (docAudioUrl) URL.revokeObjectURL(docAudioUrl);
    };
  }, [voiceAudioUrl, understandAudioUrl, docAudioUrl]);

  // Send audio to our backend for Prisma transcription.
  async function sendToGnani(audio: Blob, filename: string) {
    const formData = new FormData();
    formData.append("audio", audio, filename);

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

  // Convert the current transcript to an AI explanation and speak with Gnani Timbre independently.
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
      // 1. Ask Gemini to answer the user's message
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

      // 2. Immediately display Gemini's answer to the user
      setAssistantResponse(answer);
      setVoiceThinking(false);

      // 3. Generate Timbre voice asynchronously without blocking the user
      generateVoiceAudio(answer, currentRequestId);

    } catch (err) {
      if (currentRequestId !== activeVoiceRequestIdRef.current) return;

      console.error("Sunoza response error:", err);
      setVoiceAudioError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
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
      formData.append("question", imageQuestion);
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
          result.details ||
          result.error ||
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
        err instanceof Error
          ? err.message
          : "Something went wrong."
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
          ttsResult.details ||
          ttsResult.error ||
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
        err instanceof Error
          ? err.message
          : "Could not generate audio."
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
      setDocError("Please select a document (PDF, TXT, or Image) first.");
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
      formData.append("question", docQuestion);
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
          result.details ||
          result.error ||
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
          ttsResult.details ||
          ttsResult.error ||
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

  // Start microphone recording.
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
        throw new Error("Microphone access is not available in this browser. Please check your browser permissions.");
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

      recorder.start();
      setRecording(true);
    } catch (err) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;

      setError(
        err instanceof Error ? err.message : "Could not start recording."
      );
    }
  }

  // Stop recording, convert it to WAV and send it to Prisma.
  async function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return;

    setRecording(false);
    setLoading(true);
    setError("");

    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener(
        "stop",
        () => resolve(),
        { once: true }
      );
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
            "Recording is longer than 30 seconds. Please try again."
          );
        }

        const wavAudio = audioBufferToWav(audioBuffer);
        await sendToGnani(wavAudio, "sunoza-recording.wav");
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
    }
  }

  // Upload an existing supported audio recording.
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
      await sendToGnani(file, file.name);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Audio upload failed."
      );
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  }

  // Derive mic visual state
  const micState = loading
    ? ("processing" as const)
    : recording
      ? ("recording" as const)
      : voiceThinking
        ? ("thinking" as const)
        : voiceAudioLoading
          ? ("speaking" as const)
          : ("idle" as const);

  return (
    <main className="min-h-screen bg-[#F7F5EF] px-4 py-8 text-[#252B28] sm:px-6 md:py-12">
      <div className="mx-auto max-w-2xl">

        {/* ─── Header ─── */}
        <header className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            {/* Logo mark */}
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#315B49] shadow-sm">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Z" fill="none" stroke="white" strokeWidth="1.5"/>
                <path d="M12 6a4 4 0 0 1 4 4c0 2.21-1.79 4-4 4" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M12 14v4" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="12" cy="21" r="1" fill="white"/>
              </svg>
            </div>

            <div>
              <h1 className="text-xl font-semibold tracking-tight text-[#315B49]">Sunoza</h1>
              <p className="text-[13px] text-[#64806E]">
                Technology that understands you.
              </p>
            </div>
          </div>

          {/* Language Selector */}
          <div className="flex items-center gap-2 rounded-full border border-[#E5E6DE] bg-white px-3.5 py-2 shadow-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 text-[#64806E]" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2Z" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
            <select
              id="language-select"
              aria-label="Language"
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="select-clean bg-transparent text-sm font-medium text-[#315B49] outline-none cursor-pointer"
            >
              <option value="auto">Auto-detect</option>
              <option value="en-IN">English</option>
              <option value="hi-IN">हिन्दी</option>
              <option value="te-IN">తెలుగు</option>
            </select>
          </div>
        </header>

        {/* ─── Section 1: Voice Assistant ─── */}
        <section className="rounded-3xl border border-[#E5E6DE] bg-white p-6 shadow-sm sm:p-10">
          <div className="text-center">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#64806E]">
              Voice assistant
            </p>

            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How can I help you?</h2>

            <p className="mt-2 text-[15px] text-[#64806E]">
              Speak naturally in any language. Sunoza listens, understands and responds.
            </p>
          </div>

          {/* Mic Button Area */}
          <div className="my-10 flex flex-col items-center">
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={loading || voiceThinking}
              aria-label={recording ? "Stop recording" : "Start recording"}
              className={`relative flex h-[88px] w-[88px] items-center justify-center rounded-full transition-all duration-200 ${
                micState === "recording"
                  ? "bg-red-600 mic-recording"
                  : micState === "processing" || micState === "thinking"
                    ? "bg-[#315B49] opacity-70 cursor-wait"
                    : "bg-[#315B49] mic-idle"
              } disabled:cursor-not-allowed`}
            >
              {/* Mic / Stop Icon */}
              {micState === "recording" ? (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2"/>
                </svg>
              ) : micState === "processing" || micState === "thinking" ? (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2" strokeDasharray="50" strokeDashoffset="15" strokeLinecap="round"/>
                </svg>
              ) : (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="9" y="2" width="6" height="12" rx="3" fill="white"/>
                  <path d="M5 11a7 7 0 0 0 14 0" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
                  <path d="M12 18v3" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
                  <path d="M9 21h6" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              )}
            </button>

            <p className="mt-5 text-base font-medium text-[#252B28]" aria-live="polite">
              {micState === "processing"
                ? "Processing your voice…"
                : micState === "recording"
                  ? "Listening — tap to stop"
                  : micState === "thinking"
                    ? "Thinking…"
                    : micState === "speaking"
                      ? "Generating audio…"
                      : "Tap the mic to speak"}
            </p>

            <p className="mt-1.5 text-[13px] text-[#64806E]">
              {micState === "recording"
                ? "Speak clearly, up to 30 seconds"
                : "Supports Hindi, English, Telugu and more"}
            </p>
          </div>

          {/* Processing indicator */}
          {loading && (
            <div role="status" aria-live="polite" className="mb-5 flex items-center justify-center gap-2 text-sm text-[#315B49]">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#315B49]"></span>
              Transcribing with Gnani Prisma…
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              role="alert"
              className="mb-5 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          {/* Transcript result */}
          {transcript && (
            <div className="rounded-2xl bg-[#E8EFE8] p-5 sm:p-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-[#315B49]">
                What I heard
              </p>

              <p className="text-[17px] leading-relaxed">{transcript}</p>

              <p className="mt-3 text-xs text-[#64806E]">
                Language: {detectedLanguage || (selectedLanguage !== "auto" ? selectedLanguage : "Auto-detect")}
              </p>

              {/* Sunoza response */}
              {assistantResponse && (
                <div
                  className="mt-4 rounded-xl bg-white px-5 py-4 shadow-sm"
                  aria-live="polite"
                  role="region"
                  aria-label="Assistant answer"
                >
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#315B49]">
                    Sunoza says
                  </p>

                  <p className="text-[15px] leading-relaxed text-[#252B28]">
                    {assistantResponse}
                  </p>
                </div>
              )}

              {/* Ask / Audio pipeline */}
              <div className="mt-4 border-t border-[#D5E1D6] pt-4">
                <button
                  type="button"
                  onClick={speakTranscript}
                  disabled={voiceThinking || loading}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#315B49] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#254638] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {voiceThinking ? (
                    <>
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                      Thinking…
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M11 5L6 9H2v6h4l5 4V5Z" fill="white"/>
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                      Ask Sunoza
                    </>
                  )}
                </button>

                {voiceAudioLoading && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-[#64806E]" aria-live="polite">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#315B49]"></span>
                    Generating voice…
                  </div>
                )}

                {voiceAudioError && (
                  <div className="mt-3 flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-800" role="alert">
                    <span>{voiceAudioError}</span>
                    <button
                      type="button"
                      onClick={() => generateVoiceAudio(assistantResponse)}
                      disabled={voiceAudioLoading}
                      aria-label="Retry voice audio generation"
                      className="ml-3 font-semibold underline hover:text-amber-900 focus:outline-none"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {voiceAudioUrl && (
                  <audio
                    controls
                    preload="metadata"
                    src={voiceAudioUrl}
                    className="mt-4 w-full"
                  >
                    Your browser does not support audio playback.
                  </audio>
                )}
              </div>
            </div>
          )}

          {/* Audio upload */}
          <div className="mt-7 border-t border-[#E5E6DE] pt-5">
            <label
              htmlFor="audio-upload"
              className={`upload-area flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed border-[#D5E1D6] bg-[#FAFAF6] px-5 py-5 text-center hover:border-[#315B49] hover:bg-[#F0F4F1] ${
                loading || recording || voiceThinking ? "pointer-events-none opacity-50" : ""
              }`}
            >
              <div className="flex items-center gap-2.5">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#64806E]" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M17 8l-5-5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 3v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <span className="text-sm font-medium text-[#315B49]">Upload an audio recording</span>
              </div>

              <span className="mt-1.5 text-xs text-[#64806E]">
                WAV, MP3, OGG, FLAC, AAC, M4A
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

        {/* ─── Section 2: Image Understanding ─── */}
        <section className="mt-6 rounded-3xl border border-[#E5E6DE] bg-white p-6 shadow-sm sm:p-10">
          <div className="mb-6">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#64806E]">
              Image understanding
            </p>

            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Explain a screenshot or photo
            </h2>

            <p className="mt-1.5 text-sm text-[#64806E]">
              Upload any image and Sunoza will describe what it sees.
            </p>
          </div>

          <label
            htmlFor="image-upload"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                document.getElementById("image-upload")?.click();
              }
            }}
            className="upload-area flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#D5E1D6] bg-[#FAFAF6] px-6 py-8 text-center hover:border-[#315B49] hover:bg-[#F0F4F1] focus-visible:outline-2 focus-visible:outline-[#315B49]"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#E8EFE8]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-[#315B49]" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5"/>
                <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
                <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>

            <span className="mt-3 text-sm font-semibold text-[#315B49]">
              Choose an image
            </span>

            <span className="mt-1 text-xs text-[#64806E]">
              JPEG, PNG or WEBP · Max 8 MB
            </span>

            <input
              id="image-upload"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => {
                if (understandRequestAbortRef.current) {
                  understandRequestAbortRef.current.abort();
                  understandRequestAbortRef.current = null;
                }
                if (understandAudioAbortRef.current) {
                  understandAudioAbortRef.current.abort();
                  understandAudioAbortRef.current = null;
                }
                activeRequestIdRef.current += 1;
                setUnderstandStatus("idle");

                setImageFile(event.target.files?.[0] ?? null);
                setImageAnswer("");
                setUnderstandError("");
                setUnderstandAudioError("");
                if (understandAudioUrl) {
                  URL.revokeObjectURL(understandAudioUrl);
                  setUnderstandAudioUrl("");
                }
              }}
            />
          </label>

          {/* Selected file badge */}
          {imageFile && (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-[#F0F4F1] px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2 truncate text-[#315B49]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5"/>
                  <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
                  <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="truncate font-medium">{imageFile.name}</span>
                <span className="shrink-0 text-xs text-[#64806E]">({(imageFile.size / 1024).toFixed(0)} KB)</span>
              </div>
              <button
                type="button"
                onClick={clearSelectedImage}
                aria-label="Remove selected image"
                className="ml-2 shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 hover:text-red-800 focus:outline-none transition"
              >
                Remove
              </button>
            </div>
          )}

          <label
            htmlFor="image-question"
            className="mt-5 mb-2 block text-sm font-medium text-[#252B28]"
          >
            What do you want to know?
          </label>

          <textarea
            id="image-question"
            value={imageQuestion}
            onChange={(event) => setImageQuestion(event.target.value)}
            placeholder="Ask a question about your image…"
            rows={2}
            className="w-full rounded-xl border border-[#E5E6DE] bg-[#FAFAF6] p-4 text-base outline-none transition focus:border-[#315B49] focus:bg-white sm:text-sm"
          />

          <button
            type="button"
            onClick={understandImage}
            disabled={!imageFile || understandStatus !== "idle"}
            className="mt-4 w-full rounded-xl bg-[#315B49] px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#254638] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {understandStatus === "understanding"
              ? "Understanding image…"
              : understandStatus === "preparing"
              ? "Preparing explanation…"
              : "Explain this image"}
          </button>

          {understandError && (
            <div role="alert" className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {understandError}
            </div>
          )}

          {/* Image explanation result */}
          {imageAnswer && (
            <div
              className="mt-6 rounded-2xl bg-[#E8EFE8] p-5 sm:p-6"
              aria-live="polite"
              role="region"
              aria-label="Image explanation"
            >
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#315B49]">
                Sunoza explains
              </p>

              <p className="text-[15px] leading-relaxed text-[#252B28]">
                {imageAnswer}
              </p>

              {/* Audio player */}
              <div className="mt-4 border-t border-[#D5E1D6] pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-[#315B49]">
                    Listen to explanation
                  </p>
                  {understandAudioLoading && (
                    <span className="flex items-center gap-1.5 text-xs text-[#64806E]" aria-live="polite">
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#315B49]"></span>
                      Generating…
                    </span>
                  )}
                  {understandAudioUrl && !understandAudioLoading && (
                    <span className="text-xs font-medium text-[#315B49]">
                      ✓ Ready
                    </span>
                  )}
                </div>

                {understandAudioError && (
                  <div className="mt-3 flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-800" role="alert">
                    <span>{understandAudioError}</span>
                    <button
                      type="button"
                      onClick={() => generateUnderstandAudio(imageAnswer)}
                      disabled={understandAudioLoading}
                      aria-label="Retry audio generation"
                      className="ml-3 font-semibold underline hover:text-amber-900 focus:outline-none"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {understandAudioUrl && (
                  <audio
                    controls
                    src={understandAudioUrl}
                    className="mt-3 w-full"
                  >
                    Your browser does not support audio playback.
                  </audio>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ─── Section 3: Document Understanding ─── */}
        <section className="mt-6 rounded-3xl border border-[#E5E6DE] bg-white p-6 shadow-sm sm:p-10">
          <div className="mb-6">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#64806E]">
              Document understanding
            </p>

            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Understand any document
            </h2>

            <p className="mt-1.5 text-sm text-[#64806E]">
              Upload invoices, agreements, policies or notes. Sunoza extracts text, detects scanned pages and highlights key information.
            </p>
          </div>

          {/* Drag & drop file area */}
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
            className={`upload-area flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition focus-visible:outline-2 focus-visible:outline-[#315B49] ${
              isDocDragging
                ? "border-[#315B49] bg-[#E8EFE8]"
                : "border-[#D5E1D6] bg-[#FAFAF6] hover:border-[#315B49] hover:bg-[#F0F4F1]"
            }`}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#E8EFE8]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-[#315B49]" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>

            <span className="mt-3 text-sm font-semibold text-[#315B49]">
              {isDocDragging ? "Drop your file here" : "Choose or drop a document"}
            </span>

            <span className="mt-1 text-xs text-[#64806E]">
              PDF, TXT, MD, CSV or Image · Max 10 MB
            </span>

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

          {/* Selected document badge */}
          {docFile && (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-[#F0F4F1] px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2 truncate text-[#315B49]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                </svg>
                <span className="truncate font-medium">{docFile.name}</span>
                <span className="shrink-0 text-xs text-[#64806E]">({(docFile.size / 1024).toFixed(0)} KB)</span>
              </div>
              <button
                type="button"
                onClick={clearSelectedDocument}
                aria-label="Remove selected document"
                className="ml-2 shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 hover:text-red-800 focus:outline-none transition"
              >
                Remove
              </button>
            </div>
          )}

          <label
            htmlFor="doc-question"
            className="mt-5 mb-2 block text-sm font-medium text-[#252B28]"
          >
            What would you like explained?
          </label>

          <textarea
            id="doc-question"
            value={docQuestion}
            onChange={(event) => setDocQuestion(event.target.value)}
            placeholder="Ask about dates, fees, penalties, summaries…"
            rows={2}
            className="w-full rounded-xl border border-[#E5E6DE] bg-[#FAFAF6] p-4 text-base outline-none transition focus:border-[#315B49] focus:bg-white sm:text-sm"
          />

          <button
            type="button"
            onClick={understandDocument}
            disabled={!docFile || docStatus !== "idle"}
            className="mt-4 w-full rounded-xl bg-[#315B49] px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#254638] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {docStatus === "reading"
              ? "Extracting text…"
              : docStatus === "analyzing"
              ? "Analyzing content…"
              : "Explain this document"}
          </button>

          {docError && (
            <div role="alert" className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {docError}
            </div>
          )}

          {/* Document explanation result */}
          {docAnswer && (
            <div
              className="mt-6 rounded-2xl bg-[#E8EFE8] p-5 sm:p-6"
              aria-live="polite"
              role="region"
              aria-label="Document explanation"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#315B49]">
                  Document explanation
                </p>
                {docMeta && (
                  <span className="rounded-full bg-[#D5E1D6] px-2.5 py-1 text-[11px] font-medium text-[#254638]">
                    {docMeta.fileType?.toUpperCase()} · {docMeta.numPages} {docMeta.numPages === 1 ? "page" : "pages"}
                    {docMeta.isScanned ? " · OCR" : ""}
                  </span>
                )}
              </div>

              <div className="text-[15px] leading-relaxed whitespace-pre-line text-[#252B28]">
                {docAnswer}
              </div>

              {/* Audio player */}
              <div className="mt-4 border-t border-[#D5E1D6] pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-[#315B49]">
                    Listen to explanation
                  </p>
                  {docAudioLoading && (
                    <span className="flex items-center gap-1.5 text-xs text-[#64806E]" aria-live="polite">
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#315B49]"></span>
                      Generating…
                    </span>
                  )}
                  {docAudioUrl && !docAudioLoading && (
                    <span className="text-xs font-medium text-[#315B49]">
                      ✓ Ready
                    </span>
                  )}
                </div>

                {docAudioError && (
                  <div className="mt-3 flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-800" role="alert">
                    <span>{docAudioError}</span>
                    <button
                      type="button"
                      onClick={() => generateDocAudio(docAnswer)}
                      disabled={docAudioLoading}
                      aria-label="Retry document audio generation"
                      className="ml-3 font-semibold underline hover:text-amber-900 focus:outline-none"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {docAudioUrl && (
                  <audio
                    controls
                    src={docAudioUrl}
                    className="mt-3 w-full"
                  >
                    Your browser does not support audio playback.
                  </audio>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ─── Footer ─── */}
        <footer className="mt-10 pb-4 text-center text-xs text-[#64806E]">
          Sunoza · Powered by Gnani AI
        </footer>
      </div>
    </main>
  );
}
