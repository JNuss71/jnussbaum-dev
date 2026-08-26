import React from 'react';
import { ArrowUpIcon } from './Icons';

export const Footer: React.FC = () => {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="py-12 text-zinc-500 text-xs">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="space-y-1 text-center sm:text-left">
          <p className="text-zinc-400 font-medium">
            Jared Nussbaum &copy; {new Date().getFullYear()}
          </p>
          <p className="text-zinc-600 text-[11px]">
            Boston, MA • Senior DevOps Engineer
          </p>
        </div>

        <div className="flex items-center gap-4">
          <a
            href="https://github.com/JNuss71"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-zinc-200 transition-colors"
          >
            GitHub
          </a>
          <span className="text-zinc-800">•</span>
          <a
            href="mailto:hi@jnussbaum.dev"
            className="hover:text-zinc-200 transition-colors"
          >
            Email
          </a>
          <span className="text-zinc-800">•</span>
          <button
            onClick={scrollToTop}
            className="hover:text-white transition-colors inline-flex items-center gap-1 cursor-pointer"
            title="Scroll to top"
          >
            <span>Top</span>
            <ArrowUpIcon size={12} />
          </button>
        </div>
      </div>
    </footer>
  );
};

