# Sunoza (सुनोज़ा) – Multilingual Accessibility Assistant

> **Technology that understands you.**<br />
> A speech-first, multimodal accessibility companion empowering users across 13 languages through natural voice interaction, visual understanding, and document explanation.

---

## Overview

**Sunoza** is an accessibility-first web application designed for users who face language, visual, literacy, or digital barriers when interacting with technology. By integrating high-accuracy Indic speech recognition and synthesis with multimodal reasoning, Sunoza allows users to converse, interpret physical environments through images, and decipher complex documents in their native language.

### Problem Being Solved
Hundreds of millions of people across India and globally face steep accessibility barriers:
1. **Linguistic Exclusion**: Most digital assistants prioritize standardized English, poorly serving speakers of regional Indian languages and non-English speakers.
2. **Visual & Literacy Impairments**: Labels on medicine bottles, utility bills, street signage, and government notices are often inaccessible to illiterate, elderly, or visually impaired individuals.
3. **Complex Document Formats**: Critical information is often trapped in scanned PDFs, tables, and dense paperwork that cannot be easily read aloud by traditional screen readers.

### Intended Users
- **Elderly individuals** who prefer speaking naturally over typing on small virtual keyboards.
- **Low-literacy and non-English speakers** seeking information in their mother tongue.
- **Visually impaired users** needing spoken descriptions of photos, receipts, signs, and physical surroundings.
- **Everyday citizens** needing quick explanations of government forms, utility statements, and contracts.

---

## Key Features

### 1. Talk to Sunoza (Voice Assistant)
- **Large 96px Tactile Mic**: Designed with high-contrast states, animated soundwaves, and pulsating halos for intuitive one-tap speech.
- **Live Soundwave Motion**: Visual feedback across `idle`, `listening`, `processing`, and `speaking` states.
- **Elderly-Friendly Feedback**: Clear text labels, high contrast, and automatic spoken audio playback for responses.
- **Audio File Upload**: Upload existing voice memos and recordings (`.wav`, `.mp3`, `.m4a`, `.ogg`, `.flac`).

### 2. Understand Images (Visual AI)
- **One-Tap Photo & Screenshot Analysis**: Drop or select any photo (`JPEG`, `PNG`, `WEBP` up to 10MB).
- **Client-Side Image Optimization**: High-resolution camera captures are resized client-side to preserve network bandwidth and minimize latency.
- **Instant Spoken Readout**: Spoken explanations describing visual contents, packaging labels, and signage.

### 3. Understand Documents (Document AI)
- **Multi-Format Support**: Reads `.pdf`, `.txt`, `.md`, and `.csv` files up to 10MB.
- **Hybrid Extraction & OCR**: Extracts selectable text client-side via PDF.js; automatically falls back to vision OCR for scanned documents.
- **Metadata Badges & Audio Playback**: Displays page count, format, and OCR status alongside spoken audio explanations.

---

## Architecture & Speech Provider Routing

Sunoza implements a provider-aware speech routing architecture:

```
                      ┌────────────────────────┐
                      │   User Input / Audio   │
                      └───────────┬────────────┘
                                  │
                 ┌────────────────┴────────────────┐
                 ▼                                 ▼
      [ Indian Languages ]              [ International Languages ]
    (10 Languages + Auto-detect)            (3 Languages)
                 │                                 │
     ┌───────────┴───────────┐         ┌───────────┴───────────┐
     │  STT: Gnani Prisma    │         │  STT: Gemini 3.5      │
     │  TTS: Gnani Timbre    │         │       Transcribe      │
     └───────────────────────┘         │  TTS: Gemini 3.8      │
                                       │       Flash TTS       │
                                       └───────────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │  Reasoning & Multimodal Vision  │
                 │   Gemini (with Exponential      │
                 │     Backoff & Auto-Fallback)    │
                 └─────────────────────────────────┘
```

---

## 13 Configured Languages

| Code | Language | Native Script | Category | STT Provider | TTS Provider | Status |
|---|---|---|---|---|---|---|
| `auto` | Auto-detect | Auto | Indic | Gnani Prisma v3.0 | Gnani Timbre v2.5 | Fully Tested |
| `en-IN` | English (India) | English | Indian | Gnani Prisma v3.0 | Gnani Timbre v2.5 | Fully Tested |
| `hi-IN` | Hindi | हिन्दी | Indian | Gnani Prisma v3.0 | Gnani Timbre v2.5 | Fully Tested |
| `te-IN` | Telugu | తెలుగు | Indian | Gnani Prisma v3.0 | Gnani Timbre v2.5 | Fully Tested |
| `ta-IN` | Tamil | தமிழ் | Indian | Gnani Prisma v3.0 | Gnani Timbre v2.5 | Fully Tested |
| `kn-IN` | Kannada | ಕನ್ನಡ | Indian | Gnani Prisma v3.0 | Gnani Timbre v2.5 | Fully Tested |
| `ml-IN` | Malayalam | മലയാളം | Indian | Gnani Prisma v3.0 | Gnani Timbre v2.5 | Fully Tested |
| `bn-IN` | Bengali | বাংলা | Indian | Gnani Prisma v3.0 | Gnani Timbre v2.5 | Fully Tested |
| `mr-IN` | Marathi | मराठी | Indian | Gnani Prisma v3.0 | Gnani Timbre v2.5 | Fully Tested |
| `gu-IN` | Gujarati | ગુજરાતી | Indian | Gnani Prisma v3.0 | Gnani Timbre v2.5 | Fully Tested |
| `pa-IN` | Punjabi | ਪੰਜਾਬੀ | Indian | Gnani Prisma v3.0 | Gnani Timbre v2.5 | Fully Tested |
| `es-ES` | Spanish | Español | International | Gemini 3.5 Transcribe | Gemini 3.8 Flash TTS | Fully Tested |
| `fr-FR` | French | Français | International | Gemini 3.5 Transcribe | Gemini 3.8 Flash TTS | Fully Tested |
| `ja-JP` | Japanese | 日本語 | International | Gemini 3.5 Transcribe | Gemini 3.8 Flash TTS | Fully Tested |

---

## Technology Stack

- **Framework**: [Next.js 16 (App Router)](https://nextjs.org/) with Turbopack & React 19.
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) with custom editorial tokens and accessible keyframes.
- **Typography**: Google Fonts — [Manrope](https://fonts.google.com/specimen/Manrope) (Latin), [Noto Sans](https://fonts.google.com/noto) (Devanagari, Telugu, Tamil, Kannada, Malayalam, Bengali, Gujarati, Gurmukhi), and [Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP) (Japanese).
- **Speech Providers**:
  - [Gnani.ai](https://www.gnani.ai/): Prisma STT v3.0 & Timbre TTS v2.5.
  - [Google Gemini API](https://ai.google.dev/): `gemini-3.5-transcribe` & `gemini-3.8-flash-tts` via `@google/genai`.
- **Multimodal AI**: Google Gemini with automatic retry and exponential backoff.
- **Document Processing**: `pdfjs-dist` for client-side text extraction with automatic vision OCR fallback.
- **Package Manager**: `pnpm`.

---

## Getting Started

### Prerequisites
- Node.js `v20.x` or later (tested on Node v24).
- `pnpm` installed globally: `npm install -g pnpm`.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/farhanharis/sunoza.git
   cd sunoza/sunoza
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Set up environment variables:
   Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
   Add your API credentials (kept strictly server-side):
   ```env
   # Google Gemini API Key
   GEMINI_API_KEY=your_gemini_api_key_here

   # Gnani.ai API Key
   GNANI_API_KEY=your_gnani_api_key_here
   ```

### Development & Validation Commands

- Run the local development server:
  ```bash
  pnpm dev
  ```
  Open [http://localhost:3000](http://localhost:3000) to view the application.

- Type-check the codebase:
  ```bash
  npx tsc --noEmit
  ```

- Build for production:
  ```bash
  pnpm build
  ```

- Start production server:
  ```bash
  pnpm start
  ```

---

## Accessibility Considerations

Sunoza is built from the ground up according to WCAG 2.1 AA accessibility guidelines:
- **High-Contrast Palette**:
  - Background: Warm ivory (`#F3EFE6`)
  - Primary text / actions: Deep indigo (`#33446A`)
  - Accent / status: Marigold (`#D99B37`) & Terracotta (`#B86F58`)
  - Muted text: Deep sage (`#485E4B`) with a **6.7:1 contrast ratio**, well exceeding the 4.5:1 WCAG AA standard.
- **Large Touch Targets**: All interactive elements, buttons, and switches maintain touch targets >= 44x44px.
- **iOS Safari Input Zoom Prevention**: Form inputs and textareas use 16px font on mobile viewports to prevent unwanted viewport shifts.
- **ARIA Live Regions**: Screen readers receive immediate polite announcements for transcript updates, thinking states, and audio readiness.
- **Reduced Motion**: Respects `prefers-reduced-motion` media queries by disabling animations and replacing pulses with clean high-contrast outlines.

---

## Deployment on Vercel

Sunoza is pre-configured for zero-configuration deployment on [Vercel](https://vercel.com):

1. Import the Git repository in your Vercel Dashboard.
2. Set the **Root Directory** to `sunoza` (if nested in a monorepo).
3. Add the two environment variables in **Project Settings > Environment Variables**:
   - `GEMINI_API_KEY`
   - `GNANI_API_KEY`
4. Click **Deploy**. Next.js App Router API routes will automatically deploy as serverless functions.

---

## Known Limitations

- **Browser Microphone Permissions**: The voice recording feature requires microphone permission over `https://` (or `localhost` during development).
- **Audio Duration**: Voice recordings are limited to 30 seconds per turn to optimize response latency and bandwidth.
- **File Upload Limits**: Image and document uploads have a maximum size limit of 10MB to maintain low memory usage on mobile devices.

---

## License

This project is open-source under the MIT License.
