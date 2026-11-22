import React, { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { QUICK_EMOTES, type ChatMessage } from './types';

interface GameChatPanelProps {
  chatLog: ChatMessage[];
  chatOpen: boolean;
  isTouch: boolean;
  chatInputRef: React.RefObject<HTMLInputElement | null>;
  onToggleOpen: (open: boolean) => void;
  onSendChat: (text: string) => void;
  onSendEmote: (emoji: string) => void;
}

export const GameChatPanel: React.FC<GameChatPanelProps> = ({
  chatLog,
  chatOpen,
  isTouch,
  chatInputRef,
  onToggleOpen,
  onSendChat,
  onSendEmote,
}) => {
  const [chatText, setChatText] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatLog]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatText.trim();
    if (trimmed) {
      onSendChat(trimmed);
      setChatText('');
    }
    chatInputRef.current?.blur();
  };

  if (!chatOpen && isTouch) {
    return (
      <button
        type="button"
        onClick={() => onToggleOpen(true)}
        className="pointer-events-auto fixed z-30 flex items-center gap-1.5 px-3 py-2 rounded-full bg-slate-900/85 border border-slate-700/75 text-slate-200 text-xs font-semibold backdrop-blur"
        style={{
          left: 'calc(1rem + env(safe-area-inset-left))',
          bottom: 'calc(10.25rem + env(safe-area-inset-bottom))',
        }}
        aria-label="Buka obrolan"
      >
        💬 <span className="text-slate-400">{chatLog.length}</span>
      </button>
    );
  }

  if (!chatOpen) return null;

  return (
    <div className="pointer-events-auto fixed bottom-3.5 left-3.5 w-80 max-sm:w-[min(22rem,calc(100vw-1.5rem))] sm:w-96 bg-slate-900/85 backdrop-blur-md border border-slate-700/75 rounded-xl p-3 shadow-lg">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
          Obrolan
        </span>
        {isTouch && (
          <button
            type="button"
            onClick={() => onToggleOpen(false)}
            className="text-[10px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 cursor-pointer"
            aria-label="Tutup obrolan"
          >
            ✕
          </button>
        )}
      </div>

      <div className="h-32 overflow-y-auto chat-scroll space-y-1.5 text-xs pr-1">
        {chatLog.map((m) => (
          <div key={m.id} className="leading-snug break-words">
            {m.system ? (
              <span className="text-amber-300/90 italic">{m.text}</span>
            ) : (
              <>
                <span
                  className={`font-semibold mr-1.5 ${
                    m.role === 'guru'
                      ? 'text-amber-400'
                      : m.role === 'osis'
                      ? 'text-sky-400'
                      : 'text-slate-100'
                  }`}
                >
                  {m.sender}:
                </span>
                <span className="text-slate-300">{m.text}</span>
              </>
            )}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      <div className="mt-2 pt-2 border-t border-slate-800 flex items-center gap-1.5">
        {QUICK_EMOTES.map((em) => (
          <button
            key={em.key}
            type="button"
            onClick={() => onSendEmote(em.emoji)}
            title={`${em.label} [${em.key}]`}
            className="px-2 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 text-sm transition-colors cursor-pointer"
          >
            {em.emoji}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-2 flex gap-1.5">
        <input
          ref={chatInputRef}
          type="text"
          maxLength={90}
          value={chatText}
          onChange={(e) => setChatText(e.target.value)}
          placeholder="Ketik pesan lalu Enter..."
          className="flex-1 h-9 px-3 rounded-lg bg-slate-950/90 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
        />
        <button
          type="submit"
          aria-label="Kirim pesan"
          className="px-3 h-9 rounded-lg bg-sky-600 hover:bg-sky-500 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
