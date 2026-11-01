"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

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
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [language, setLanguage] = useState("");
  const [error, setError] = useState("");
  const [ttsLoading, setTtsLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [ttsError, setTtsError] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Release generated audio URLs when they are replaced or the page unmounts.
  useEffect(() => {
    if (!audioUrl) return;

    return () => {
      URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

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

    setTranscript(
      typeof result.transcript === "string" && result.transcript.trim()
        ? result.transcript
        : "No speech detected."
    );
    setLanguage(
      typeof result.detectedLanguage === "string"
        ? result.detectedLanguage
        : "Language not identified."
    );

    // A new transcript should not keep audio generated for the previous one.
    setAudioUrl("");
    setTtsError("");
  }

  // Convert the current transcript to speech with Gnani Timbre.
  async function speakTranscript() {
    if (!transcript.trim()) return;

    setTtsLoading(true);
    setTtsError("");
    setAudioUrl("");

    try {
      const response = await fetch("/api/text-to-speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: transcript,
          language: language || "en-IN",
        }),
      });

      // Only read JSON when the backend reports an error.
      // A successful response contains audio, not JSON.
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        console.error("Timbre API response:", result);

        const details =
          typeof result.details === "string"
            ? result.details
            : typeof result.error === "string"
              ? result.error
              : `TTS failed (${response.status}).`;

        throw new Error(details);
      }

      // Read a successful response body exactly once, as a Blob.
      const audioBlob = await response.blob();

      if (audioBlob.size === 0) {
        throw new Error("Timbre returned an empty audio file.");
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType && !contentType.toLowerCase().startsWith("audio/")) {
        throw new Error(`Unexpected audio response type: ${contentType}`);
      }

      const url = URL.createObjectURL(audioBlob);
      setAudioUrl(url);
    } catch (err) {
      console.error("Speech generation error:", err);
      setTtsError(
        err instanceof Error
          ? err.message
          : "Could not generate spoken audio."
      );
    } finally {
      setTtsLoading(false);
    }
  }

  // Start microphone recording.
  async function startRecording() {
    try {
      setError("");
      setTtsError("");
      setTranscript("");
      setLanguage("");
      setAudioUrl("");

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access is not available in this browser.");
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
    setTtsError("");
    setTranscript("");
    setLanguage("");
    setAudioUrl("");

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

  return (
    <main className="min-h-screen bg-[#F7F5EF] px-5 py-10 text-[#252B28]">
      <div className="mx-auto max-w-2xl">
        <header className="mb-12 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#315B49] text-2xl font-bold text-white">
            S
          </div>

          <div>
            <h1 className="text-2xl font-semibold text-[#315B49]">Sunoza</h1>
            <p className="text-sm text-gray-500">
              Technology that understands you.
            </p>
          </div>
        </header>

        <section className="rounded-3xl border border-[#E5E6DE] bg-white p-7 shadow-sm sm:p-10">
          <div className="text-center">
            <p className="mb-3 text-sm font-medium uppercase tracking-widest text-[#64806E]">
              Your voice assistant
            </p>

            <h2 className="text-3xl font-semibold">How can I help you?</h2>

            <p className="mt-3 text-gray-500">
              Speak naturally. You can mix languages too.
            </p>
          </div>

          <div className="my-10 flex flex-col items-center">
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={loading || ttsLoading}
              aria-label={recording ? "Stop recording" : "Start recording"}
              className={`flex h-28 w-28 items-center justify-center rounded-full text-4xl text-white shadow-lg transition ${
                recording
                  ? "bg-red-600"
                  : "bg-[#315B49] hover:bg-[#254638]"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {recording ? "■" : "🎙"}
            </button>

            <p className="mt-5 text-lg font-medium">
              {loading
                ? "Processing your voice..."
                : recording
                  ? "Tap to stop"
                  : "Tap to speak"}
            </p>

            <p className="mt-1 text-sm text-gray-400">
              Keep your recording under 30 seconds.
            </p>
          </div>

          {loading && (
            <p role="status" className="mb-5 text-center text-[#315B49]">
              Sending audio to Gnani Prisma...
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          {transcript && (
            <div className="rounded-2xl bg-[#E8EFE8] p-6">
              <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#315B49]">
                What I heard
              </p>

              <p className="text-lg leading-relaxed">{transcript}</p>

              <p className="mt-4 text-sm text-gray-600">
                Detected language: {language}
              </p>

              <div className="mt-5 border-t border-[#D5E1D6] pt-4">
                <button
                  type="button"
                  onClick={speakTranscript}
                  disabled={ttsLoading || loading}
                  className="rounded-xl bg-[#315B49] px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {ttsLoading ? "Generating voice..." : "🔊 Read this aloud"}
                </button>

                {ttsError && (
                  <p role="alert" className="mt-3 text-sm text-red-600">
                    {ttsError}
                  </p>
                )}

                {audioUrl && (
                  <audio
                    controls
                    preload="metadata"
                    src={audioUrl}
                    className="mt-4 w-full"
                  >
                    Your browser does not support audio playback.
                  </audio>
                )}
              </div>
            </div>
          )}

          <div className="mt-8 border-t border-gray-100 pt-6">
            <label
              htmlFor="audio-upload"
              className="mb-2 block text-sm font-medium"
            >
              Or upload an audio recording
            </label>

            <input
              id="audio-upload"
              type="file"
              accept=".wav,.mp3,.ogg,.flac,.aac,.m4a"
              onChange={handleFileUpload}
              disabled={loading || recording || ttsLoading}
              className="block w-full rounded-xl border border-gray-200 p-3 text-sm"
            />

            <p className="mt-2 text-xs text-gray-400">
              Supported: WAV, MP3, OGG, FLAC, AAC and M4A.
            </p>
          </div>
        </section>

        <footer className="mt-8 text-center text-sm text-gray-400">
          Sunoza · Powered by Gnani Prisma
        </footer>
      </div>
    </main>
  );
}
