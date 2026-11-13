import React from 'react';
import { BookOpen, X } from 'lucide-react';
import type { QuizQuestion } from './schoolMap';

interface QuizModalProps {
  question: QuizQuestion;
  onAnswer: (selectedIndex: number) => void;
  onClose: () => void;
}

export const QuizModal: React.FC<QuizModalProps> = ({
  question,
  onAnswer,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-6">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2 text-sm font-semibold text-sky-400">
            <BookOpen className="w-4 h-4" />
            <span>Ujian Kilat · {question.subject}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="mt-4 text-base font-medium text-slate-100 leading-relaxed">
          {question.question}
        </p>

        <div className="mt-4 space-y-2">
          {question.options.map((opt, idx) => (
            <button
              key={opt}
              type="button"
              onClick={() => onAnswer(idx)}
              className="w-full text-left px-4 py-3 min-h-[44px] rounded-lg bg-slate-950/70 hover:bg-sky-500/15 border border-slate-800 hover:border-sky-500 text-sm text-slate-200 transition-colors cursor-pointer flex items-center gap-3"
            >
              <span className="font-mono-num text-xs font-bold text-slate-400">
                {String.fromCharCode(65 + idx)}.
              </span>
              <span>{opt}</span>
            </button>
          ))}
        </div>

        <p className="mt-4 text-xs text-slate-400">
          Jawab benar untuk mendapatkan +30 XP dan Rp 1.000 uang saku.
        </p>
      </div>
    </div>
  );
};
