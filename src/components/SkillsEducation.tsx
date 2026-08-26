import React from 'react';

export const SkillsEducation: React.FC = () => {
  const skillCategories = [
    {
      title: 'Cloud & Infrastructure',
      skills: [
        'AWS',
        'Amazon ECS',
        'AWS Bedrock',
        'Terraform',
        'Ansible',
        'Packer',
        'Docker',
        'Linux HPC',
        'Slurm',
        'VMware vSphere',
        'Prometheus & Alertmanager',
        'PXE Boot & Kickstart',
        'NVIDIA CUDA & GPUs',
        'Apache Airflow',
        'DataHub',
        'IAM',
        'Okta'
      ]
    },
    {
      title: 'Languages & Automation',
      skills: [
        'Python',
        'Streamlit',
        'Linux Bash / Shell',
        'PowerShell',
        'SQL',
        'Athena',
        'C / C++',
        'GitLab CI',
        'GitHub Actions',
        'Conda & Pixi'
      ]
    }
  ];

  return (
    <>
      {/* Skills Section */}
      <section id="skills" className="py-12 sm:py-16 border-b border-zinc-800/60">
        <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-4 md:gap-10">
          <div className="text-xs font-mono uppercase tracking-widest text-zinc-500 pt-1">
            Skills
          </div>

          <div className="space-y-8">
            {skillCategories.map((category) => (
              <div key={category.title} className="space-y-2.5">
                <h3 className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                  {category.title}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {category.skills.map((skill) => (
                    <span
                      key={skill}
                      className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-900/90 border border-zinc-800 text-zinc-300"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* Endurance Section */}
      <section id="endurance" className="py-12 sm:py-16 border-b border-zinc-800/60">
        <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-4 md:gap-10">
          <div className="text-xs font-mono uppercase tracking-widest text-zinc-500 pt-1">
            Endurance
          </div>

          <div className="space-y-3">
            <p className="text-sm text-zinc-400 leading-relaxed">
              Competitive marathoner and ultrarunner based in Boston, MA.
            </p>

            <div className="flex flex-wrap gap-2 pt-1">
              <span className="text-xs font-mono px-2.5 py-1 rounded bg-zinc-900/90 border border-zinc-800 text-zinc-300">
                Boston Marathon (2025): <strong className="text-zinc-100">2:41:43</strong>
              </span>
              <span className="text-xs font-mono px-2.5 py-1 rounded bg-zinc-900/90 border border-zinc-800 text-zinc-300">
                12 Hours of Lawrence Woods (2025): <strong className="text-zinc-100">58.5 Miles (1st Place)</strong>
              </span>
              <span className="text-xs font-mono px-2.5 py-1 rounded bg-zinc-900/90 border border-zinc-800 text-zinc-300">
                Tucson Half Marathon (2025): <strong className="text-zinc-100">1:15:00</strong>
              </span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};



