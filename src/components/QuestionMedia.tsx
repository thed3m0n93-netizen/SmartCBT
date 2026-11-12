import { useState } from "react";

/**
 * SmartCBT — QuestionMedia
 *
 * Renders a question's attached media (`media_type` + `media_url` columns of
 * the `questions` table): inline image, audio player, or video player. Shared
 * by the teacher detail preview and the student exam view so both sides show
 * the exact same markup.
 */
export interface QuestionMediaProps {
  mediaType?: string | null;
  mediaUrl?: string | null;
  /** Max display height in px for images / video (default 320). */
  maxHeight?: number;
}

export default function QuestionMedia({ mediaType, mediaUrl, maxHeight = 320 }: QuestionMediaProps) {
  const [broken, setBroken] = useState(false);

  if (!mediaType || mediaType === "none" || !mediaUrl) return null;
  if (broken) {
    return (
      <div
        className="text-xs px-3 py-2 rounded-lg inline-flex items-center gap-2"
        style={{ background: "#FEF2F2", color: "#B91C1C", border: "1px solid #FECACA" }}
      >
        ⚠ Media tidak dapat dimuat: {mediaUrl}
      </div>
    );
  }

  if (mediaType === "image") {
    return (
      <img
        src={mediaUrl}
        alt="Gambar soal"
        loading="lazy"
        onError={() => setBroken(true)}
        className="rounded-xl"
        style={{ maxHeight, maxWidth: "100%", objectFit: "contain" }}
      />
    );
  }

  if (mediaType === "audio") {
    return (
      <div className="flex items-center gap-3 w-full">
        <span className="text-xl shrink-0" aria-hidden>🎧</span>
        <audio
          controls
          src={mediaUrl}
          onError={() => setBroken(true)}
          className="w-full"
          style={{ maxHeight: 54 }}
        />
      </div>
    );
  }

  if (mediaType === "video") {
    return (
      <video
        controls
        src={mediaUrl}
        onError={() => setBroken(true)}
        className="rounded-xl w-full"
        style={{ maxHeight, maxWidth: "100%" }}
      />
    );
  }

  return null;
}
