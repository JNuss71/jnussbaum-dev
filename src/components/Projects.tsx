import React from 'react';
import { ArrowUpRightIcon, GithubIcon } from './Icons';

interface Project {
  title: string;
  role: string;
  period: string;
  description: string;
  tags: string[];
  liveUrl?: string;
  githubUrl?: string;
}

export const Projects: React.FC = () => {
  const projects: Project[] = [
    {
      title: 'Adaptive Space',
      role: 'Creator',
      period: '2026',
      description:
        'A 100% client-side, local-first progressive web application for runners. Born out of frustration with static book training plans that offer no dynamic guidance when training gets derailed, it combines deterministic exercise physiology guardrails with an agentic AI coach that reconciles schedules against actual activity and health telemetry.',
      tags: ['Agentic AI Coach', 'Local RAG', 'Deterministic Physiology', 'IndexedDB', 'Cloudflare Pages', 'PWA'],
      liveUrl: 'https://adaptivespace.ai'
    },
    {
      title: 'Adaptive Pace Calculator',
      role: 'Creator',
      period: '2026',
      description:
        'A continuous mathematical pacing and environmental altitude adjustment engine. Implements Daniels/Gilbert oxygen demand quadratic equations, beginner walking efficiency scaling, Bassett altitude polynomial models, and a numerical bisection sea-level solver with 23 automated tests.',
      tags: ['Mathematical Pacing Models', 'Numerical Algorithms', 'Automated Test Suite', 'Cloudflare Pages'],
      liveUrl: 'https://calc.adaptivespace.ai',
      githubUrl: 'https://github.com/JNuss71/adaptive-calculator'
    },
    {
      title: '12 Hours of Lawrence Woods',
      role: 'Creator',
      period: '2026',
      description:
        'Official event website for the 12 Hours of Lawrence Woods, a grassroots trail ultramarathon in the Middlesex Fells (Medford, MA). Features course elevation profiles, countdown timing, and UltraSignup registration links.',
      tags: ['Cloudflare Pages', 'Event Website'],
      liveUrl: 'https://12hlw.pages.dev'
    }
  ];

  return (
    <section id="projects" className="py-12 sm:py-16 border-b border-zinc-800/60">
      <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-4 md:gap-10">
        <div className="text-xs font-mono uppercase tracking-widest text-zinc-500 pt-1">
          Projects
        </div>

        <div className="space-y-10">
          {projects.map((project) => (
            <div key={project.title} className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-zinc-100">
                    {project.title}
                  </h3>
                  <span className="text-xs text-zinc-500 font-mono">
                    ({project.role})
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
                  {project.liveUrl && (
                    <a
                      href={project.liveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-300 hover:text-white hover:underline underline-offset-4 inline-flex items-center gap-1 transition-colors"
                    >
                      <span>visit site</span>
                      <ArrowUpRightIcon size={12} />
                    </a>
                  )}
                  {project.githubUrl && (
                    <a
                      href={project.githubUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-300 hover:text-white hover:underline underline-offset-4 inline-flex items-center gap-1 transition-colors"
                    >
                      <GithubIcon size={12} />
                      <span>source</span>
                    </a>
                  )}
                </div>
              </div>

              <p className="text-sm text-zinc-400 leading-relaxed max-w-2xl">
                {project.description}
              </p>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {project.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-900/90 border border-zinc-800/80 text-zinc-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};



