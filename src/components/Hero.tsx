import React from 'react';
import { ArrowUpRightIcon, GithubIcon, MailIcon, MapPinIcon } from './Icons';

export const Hero: React.FC = () => {
  return (
    <section className="py-12 sm:py-16 border-b border-zinc-800/60">
      <div className="space-y-5">
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100">
            Jared Nussbaum
          </h1>
          <p className="text-base sm:text-lg text-zinc-300 font-medium">
            Senior DevOps Engineer
          </p>
          <div className="flex items-center gap-2 text-xs font-mono text-zinc-500 pt-0.5">
            <span className="flex items-center gap-1 text-zinc-400">
              <MapPinIcon size={12} className="text-zinc-400" />
              Boston, MA
            </span>
            <span>•</span>
            <span>Federal Reserve Bank of Boston</span>
          </div>
        </div>

        <div className="space-y-3 text-sm sm:text-base text-zinc-400 leading-relaxed max-w-2xl">
          <p>
            An outspoken voice for sound technical direction, focused on communicating architectural trade-offs, asking critical questions, and aligning systems with business goals.
          </p>
          <p>
            Hands-on, high-throughput engineer focused on selecting the right technology to build and ship robust tools, platforms, and software systems.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 pt-2 text-xs font-mono">
          <a
            href="/resume.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-zinc-200 font-medium hover:text-white transition-colors"
          >
            <ArrowUpRightIcon size={14} />
            <span>Resume (PDF)</span>
          </a>
          <span className="text-zinc-700">/</span>
          <a
            href="https://github.com/JNuss71"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-white transition-colors"
          >
            <GithubIcon size={14} />
            <span>github.com/JNuss71</span>
          </a>
          <span className="text-zinc-700">/</span>
          <a
            href="mailto:hi@jnussbaum.dev"
            className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-white transition-colors"
          >
            <MailIcon size={14} />
            <span>hi@jnussbaum.dev</span>
          </a>
        </div>
      </div>
    </section>
  );
};




