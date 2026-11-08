import React from 'react';
import { trips } from '../data/trips';

export const Header: React.FC = () => {
  return (
    <header className="border-b border-zinc-800/60 w-full">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <a
          href="/"
          className="flex items-center gap-2.5 text-xs font-mono font-bold tracking-tight text-zinc-300 hover:text-white transition-colors"
        >
          <span className="w-6 h-6 rounded bg-zinc-800 border border-zinc-700/80 flex items-center justify-center text-xs text-white">
            JN
          </span>
          <span className="text-zinc-400 font-normal">jaredn.dev</span>
        </a>

        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-5 text-sm text-zinc-400">
          <a href="/#projects" className="hover:text-zinc-200 transition-colors">
            Projects
          </a>
          <a href="/#experience" className="hover:text-zinc-200 transition-colors">
            Experience
          </a>
          <a href="/#skills" className="hover:text-zinc-200 transition-colors">
            Skills
          </a>
          <a href="/#endurance" className="hover:text-zinc-200 transition-colors">
            Endurance
          </a>
          {trips.length > 0 && (
            <a href="/photos" className="hover:text-zinc-200 transition-colors">
              Photos
            </a>
          )}
          <span className="text-zinc-700 select-none">/</span>
          <a 
            href="/resume.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-zinc-200 transition-colors"
          >
            Resume
          </a>
          <a 
            href="https://github.com/JNuss71" 
            target="_blank" 
            rel="noopener noreferrer"
            className="hover:text-zinc-200 transition-colors"
          >
            GitHub
          </a>
          <a 
            href="mailto:hi@jaredn.dev"
            className="hover:text-zinc-200 transition-colors"
          >
            Contact
          </a>
        </nav>
      </div>
    </header>
  );
};



