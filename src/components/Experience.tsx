import React from 'react';
import { ArrowUpRightIcon } from './Icons';

export const Experience: React.FC = () => {
  return (
    <section id="experience" className="py-12 sm:py-16 border-b border-zinc-800/60">
      <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-4 md:gap-10">
        <div className="text-xs font-mono uppercase tracking-widest text-zinc-500 pt-1">
          Experience
        </div>

        <div className="space-y-8">
          {/* Current Role */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
              <div>
                <h3 className="text-base font-semibold text-zinc-100">
                  Senior DevOps Engineer
                </h3>
                <div className="text-sm font-medium text-zinc-300">
                  Federal Reserve Bank of Boston
                </div>
              </div>
              <div className="text-xs font-mono text-zinc-500">
                June 2021 - Present • Boston, MA
              </div>
            </div>

            <p className="text-sm text-zinc-400 leading-relaxed pt-0.5">
              Leading cloud platform architecture, systems automation, and research computing infrastructure across the Federal Reserve System:
            </p>

            <ul className="space-y-2.5 text-sm text-zinc-400 leading-relaxed pt-1">
              <li className="flex items-start gap-2.5">
                <span className="text-zinc-600 select-none mt-1 text-xs">▸</span>
                <span>
                  <strong className="text-zinc-200 font-medium">AWS Data Platform:</strong> Architect and deploy Terraform and Ansible pipelines managing Apache Airflow data pipelines, DataHub cataloging, automated CI/CD releases, and dynamic Okta-governed IAM access controls across all 12 Federal Reserve research districts.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="text-zinc-600 select-none mt-1 text-xs">▸</span>
                <span>
                  <strong className="text-zinc-200 font-medium">AI FinOps & Cloud Observability:</strong> Engineer enterprise cloud observability platforms, including an AWS Bedrock telemetry dashboard utilizing CUR 2.0 and Streamlit on Amazon ECS to deliver daily per-user, per-model, and per-token-type spend analytics.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="text-zinc-600 select-none mt-1 text-xs">▸</span>
                <span>
                  <strong className="text-zinc-200 font-medium">Authentication & Data Tooling:</strong> Engineer high-leverage systems tooling, including an enterprise Okta authentication client for seamless AWS role assumption and a cross-language Athena data retrieval CLI with Python, R, Julia, Stata, and MATLAB FFI wrappers.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="text-zinc-600 select-none mt-1 text-xs">▸</span>
                <span>
                  <strong className="text-zinc-200 font-medium">Linux HPC & Infrastructure Automation:</strong> Maintain, modernize, and stabilize the research Linux HPC system, leading the scheduler migration from Sun Grid Engine (SGE) to Slurm. Automate VMware vSphere and bare-metal server provisioning with Packer and Terraform, and build CI/CD pipelines with Ansible and Docker for reliable service deployments.
                </span>
              </li>
            </ul>
          </div>

          {/* Prior Work & Resume Link */}
          <div className="pt-2 border-t border-zinc-800/40 space-y-4">
            <div className="text-xs text-zinc-500 leading-relaxed">
              <span className="text-zinc-400 font-medium font-mono uppercase tracking-wider text-[11px] block sm:inline sm:mr-2">
                Prior Experience:
              </span>
              <span>CPX Security (Engineering Intern) • Raytheon IDS (IT DevOps & Solutions Development Intern)</span>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-mono">
              <a
                href="/resume.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-zinc-200 font-medium hover:text-white hover:underline underline-offset-4 transition-colors"
              >
                <span>View Full Resume (PDF)</span>
                <ArrowUpRightIcon size={12} />
              </a>
              <span className="text-zinc-600 select-none">•</span>
              <a
                href="/resume.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-400 hover:text-zinc-200 hover:underline underline-offset-4 transition-colors"
              >
                Raw Markdown
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};



