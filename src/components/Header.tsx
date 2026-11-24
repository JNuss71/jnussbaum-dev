import React, { useState } from 'react';
import { trips } from '../data/trips';
import { MenuIcon, XIcon } from './Icons';

export const Header: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-b border-zinc-800/60 w-full">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 md:py-6 flex items-center justify-between gap-4">
        <a
          href="/"
          className="flex items-center gap-2.5 text-xs font-mono font-bold tracking-tight text-zinc-300 hover:text-white transition-colors"
        >
          <span className="w-6 h-6 rounded bg-zinc-800 border border-zinc-700/80 flex items-center justify-center text-xs text-white">
            JN
          </span>
          <span className="text-zinc-400 font-normal">jaredn.dev</span>
        </a>

        {/* Desktop navigation */}
        <nav className="hidden md:flex items-center gap-x-5 text-sm text-zinc-400">
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

        {/* Mobile menu toggle */}
        <button
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          className="md:hidden p-1.5 -mr-1.5 text-zinc-400 hover:text-white transition-colors cursor-pointer"
        >
          {menuOpen ? <XIcon size={20} /> : <MenuIcon size={20} />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <nav
          aria-label="Mobile navigation"
          className="md:hidden border-t border-zinc-800/60 px-4 py-4 space-y-4 bg-[#09090b]"
        >
          <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm text-zinc-300">
            <a
              href="/#projects"
              onClick={() => setMenuOpen(false)}
              className="py-1.5 hover:text-white transition-colors"
            >
              Projects
            </a>
            <a
              href="/#experience"
              onClick={() => setMenuOpen(false)}
              className="py-1.5 hover:text-white transition-colors"
            >
              Experience
            </a>
            <a
              href="/#skills"
              onClick={() => setMenuOpen(false)}
              className="py-1.5 hover:text-white transition-colors"
            >
              Skills
            </a>
            <a
              href="/#endurance"
              onClick={() => setMenuOpen(false)}
              className="py-1.5 hover:text-white transition-colors"
            >
              Endurance
            </a>
            {trips.length > 0 && (
              <a
                href="/photos"
                onClick={() => setMenuOpen(false)}
                className="py-1.5 hover:text-white transition-colors"
              >
                Photos
              </a>
            )}
          </div>

          <div className="pt-3 border-t border-zinc-800/60 flex items-center gap-5 text-xs font-mono text-zinc-400">
            <a
              href="/resume.pdf"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className="py-1 hover:text-white transition-colors"
            >
              Resume
            </a>
            <a
              href="https://github.com/JNuss71"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className="py-1 hover:text-white transition-colors"
            >
              GitHub
            </a>
            <a
              href="mailto:hi@jaredn.dev"
              onClick={() => setMenuOpen(false)}
              className="py-1 hover:text-white transition-colors"
            >
              Contact
            </a>
          </div>
        </nav>
      )}
    </header>
  );
};
