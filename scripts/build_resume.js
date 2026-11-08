import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const inputArg = process.argv[2];
const outputArg = process.argv[3];

const mdPath = inputArg ? path.resolve(inputArg) : path.join(projectRoot, 'public', 'resume.md');
const pdfPath = outputArg 
  ? path.resolve(outputArg) 
  : (inputArg ? path.resolve(inputArg).replace(/\.md$/, '.pdf') : path.join(projectRoot, 'public', 'resume.pdf'));

const tempHtmlPath = path.join(os.tmpdir(), `resume_build_${Date.now()}.html`);

if (!fs.existsSync(mdPath)) {
  console.error(`Markdown resume not found at: ${mdPath}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(pdfPath), { recursive: true });

const mdContent = fs.readFileSync(mdPath, 'utf-8');

function parseMarkdownResume(md) {
  const lines = md.split('\n');
  let name = 'Jared Nussbaum';
  let title = 'Senior DevOps Engineer';
  let contact = '';
  let summary = '';
  
  const sections = {
    experience: [],
    projects: [],
    skills: [],
    education: []
  };

  let currentSection = null;
  let currentEntry = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line === '---') continue;

    // Header
    if (line.startsWith('# ')) {
      name = line.replace('# ', '').trim();
      continue;
    }
    if (line.startsWith('**') && line.endsWith('**') && !line.includes('|')) {
      title = line.replace(/\*\*/g, '').trim();
      continue;
    }
    if (line.includes('•') && line.includes('@') && !currentSection) {
      contact = line;
      continue;
    }

    // Section Headers
    if (line.startsWith('## Profile Summary')) {
      currentSection = 'summary';
      continue;
    }
    if (line.startsWith('## Experience')) {
      currentSection = 'experience';
      continue;
    }
    if (line.startsWith('## Projects') || line.startsWith('## Flagship Projects')) {
      currentSection = 'projects';
      continue;
    }
    if (line.startsWith('## Technical Skills')) {
      currentSection = 'skills';
      continue;
    }
    if (line.startsWith('## Education')) {
      currentSection = 'education';
      continue;
    }

    // Parse section contents
    if (currentSection === 'summary') {
      summary += (summary ? ' ' : '') + line;
      continue;
    }

    if (currentSection === 'experience') {
      if (line.startsWith('### ')) {
        const titlePart = line.replace('### ', '').trim();
        let role = titlePart;
        let company = '';
        if (titlePart.includes('|')) {
          const parts = titlePart.split('|');
          role = parts[0].replace(/\*\*/g, '').trim();
          company = parts[1].replace(/\*\*/g, '').trim();
        } else {
          role = titlePart.replace(/\*\*/g, '').trim();
        }
        currentEntry = { role, company, date: '', bullets: [] };
        sections.experience.push(currentEntry);
        continue;
      }
      if (line.startsWith('*') && line.endsWith('*') && !line.startsWith('* **')) {
        if (currentEntry) {
          currentEntry.date = line.replace(/\*/g, '').trim();
        }
        continue;
      }
      if (line.startsWith('* **') || line.startsWith('* ')) {
        const bulletText = line.replace(/^\*\s*/, '').trim();
        if (currentEntry) {
          currentEntry.bullets.push(bulletText);
        }
        continue;
      }
    }

    if (currentSection === 'projects') {
      if (line.startsWith('### ')) {
        const raw = line.replace('### ', '').trim();
        const titleMatch = raw.match(/\*\*(.*?)\*\*/);
        const pTitle = titleMatch ? titleMatch[1] : raw;
        const linkMatch = raw.match(/\((https?:\/\/[^\s)]+)\)/);
        const pLink = linkMatch ? linkMatch[1] : '';
        const displayLinkMatch = raw.match(/\[(.*?)\]/);
        const pDisplayLink = displayLinkMatch ? displayLinkMatch[1] : pLink;

        currentEntry = { title: pTitle, link: pLink, displayLink: pDisplayLink, date: '2026', bullets: [] };
        sections.projects.push(currentEntry);
        continue;
      }
      if (line.startsWith('*') && line.endsWith('*') && !line.startsWith('* **') && line.length < 15) {
        if (currentEntry) {
          currentEntry.date = line.replace(/\*/g, '').trim();
        }
        continue;
      }
      if (line.startsWith('* ')) {
        const bulletText = line.replace(/^\*\s*/, '').trim();
        if (currentEntry) {
          currentEntry.bullets.push(bulletText);
        }
        continue;
      }
    }

    if (currentSection === 'skills') {
      if (line.startsWith('* **')) {
        const parts = line.replace(/^\*\s*\*\*/, '').split(':**');
        const catName = parts[0].trim();
        const catSkills = parts[1] ? parts[1].trim() : '';
        sections.skills.push({ name: catName, skills: catSkills });
      }
      continue;
    }

    if (currentSection === 'education') {
      if (line.startsWith('### ')) {
        const school = line.replace('### ', '').replace(/\*\*/g, '').trim();
        currentEntry = { school, dateLoc: '', degree: '', honors: '' };
        sections.education.push(currentEntry);
        continue;
      }
      if (line.startsWith('*') && line.endsWith('*') && !line.startsWith('* **')) {
        if (currentEntry) {
          currentEntry.dateLoc = line.replace(/\*/g, '').trim();
        }
        continue;
      }
      if (line.startsWith('* **B.S.')) {
        if (currentEntry) {
          currentEntry.degree = line.replace(/^\*\s*\*\*B\.S\.\s*in\s*/, 'B.S. in ').replace(/\*\*/g, '').trim();
        }
        continue;
      }
      if (line.startsWith('* **GPA:')) {
        if (currentEntry) {
          currentEntry.honors = line.replace(/^\*\s*/, '').trim();
        }
        continue;
      }
    }
  }

  return { name, title, contact, summary, sections };
}

const parsed = parseMarkdownResume(mdContent);

let contactHtml = parsed.contact
  .replace(/\[(.*?)\]\((mailto:[^\s)]+)\)/g, '<a href="$2">$1</a>')
  .replace(/\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
  .replace(/•/g, '<span>•</span>');

function formatBullets(text) {
  if (text.startsWith('**') && text.includes(':**')) {
    return text.replace(/^\*\*(.*?):\*\*\s*/, '<span class="strong-label">$1:</span> ');
  }
  return text;
}

const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${parsed.name} - Resume</title>
  <style>
    @page {
      size: letter;
      margin: 0.45in 0.5in 0.45in 0.5in;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #18181b;
      background: #ffffff;
      font-size: 9.5pt;
      line-height: 1.35;
      -webkit-font-smoothing: antialiased;
    }
    a {
      color: #18181b;
      text-decoration: none;
    }
    .header {
      text-align: center;
      margin-bottom: 10px;
    }
    .name {
      font-size: 15.5pt;
      font-weight: 700;
      letter-spacing: -0.3px;
      color: #09090b;
      margin-bottom: 2px;
    }
    .title-sub {
      font-size: 10pt;
      font-weight: 600;
      color: #3f3f46;
      margin-bottom: 4px;
    }
    .contact-line {
      font-size: 8.5pt;
      color: #52525b;
      display: flex;
      justify-content: center;
      gap: 12px;
    }
    .contact-line a {
      color: #27272a;
    }
    .section-title {
      font-size: 9pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #09090b;
      border-bottom: 1px solid #d4d4d8;
      padding-bottom: 2.5px;
      margin-top: 10px;
      margin-bottom: 5px;
    }
    .summary-text {
      font-size: 8.8pt;
      color: #3f3f46;
      line-height: 1.38;
    }
    .entry {
      margin-bottom: 7px;
    }
    .entry-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 2px;
    }
    .role-title {
      font-size: 9.5pt;
      font-weight: 700;
      color: #09090b;
    }
    .company-name {
      font-size: 9pt;
      font-weight: 600;
      color: #3f3f46;
    }
    .entry-date {
      font-size: 8.5pt;
      color: #71717a;
      font-variant-numeric: tabular-nums;
    }
    ul {
      list-style-type: none;
      padding-left: 0;
    }
    li {
      position: relative;
      padding-left: 12px;
      font-size: 8.6pt;
      color: #3f3f46;
      margin-bottom: 2.5px;
      line-height: 1.35;
    }
    li::before {
      content: "•";
      position: absolute;
      left: 2px;
      color: #71717a;
      font-size: 9pt;
    }
    .strong-label {
      font-weight: 600;
      color: #18181b;
    }
    .project-links a {
      color: #52525b;
    }
    .skills-block {
      font-size: 8.6pt;
      color: #3f3f46;
      line-height: 1.40;
    }
    .skills-block strong {
      color: #18181b;
    }
  </style>
</head>
<body>

  <div class="header">
    <div class="name">${parsed.name}</div>
    <div class="title-sub">${parsed.title}</div>
    <div class="contact-line">
      ${contactHtml}
    </div>
  </div>

  <div class="section-title">Profile Summary</div>
  <p class="summary-text">
    ${parsed.summary}
  </p>

  <div class="section-title">Work Experience</div>

  ${parsed.sections.experience.map(e => `
  <div class="entry">
    <div class="entry-header">
      <div>
        <span class="role-title">${e.role}</span>${e.company ? ` | <span class="company-name">${e.company}</span>` : ''}
      </div>
      <div class="entry-date">${e.date}</div>
    </div>
    <ul>
      ${e.bullets.map(b => `<li>${formatBullets(b)}</li>`).join('\n      ')}
    </ul>
  </div>
  `).join('\n')}

  <div class="section-title">Projects</div>

  ${parsed.sections.projects.map(p => `
  <div class="entry">
    <div class="entry-header">
      <div>
        <span class="role-title">${p.title}</span> <span class="project-links">(<a href="${p.link}">${p.displayLink}</a>)</span>
      </div>
      <div class="entry-date">${p.date}</div>
    </div>
    <ul>
      ${p.bullets.map(b => `<li>${formatBullets(b)}</li>`).join('\n      ')}
    </ul>
  </div>
  `).join('\n')}

  <div class="section-title">Technical Skills</div>

  <div class="skills-block">
    ${parsed.sections.skills.map(s => `<div><strong>${s.name}:</strong> ${s.skills}</div>`).join('\n    ')}
  </div>

  <div class="section-title">Education</div>

  ${parsed.sections.education.map(ed => {
    const dateLocParts = ed.dateLoc.split('•').map(s => s.trim());
    const dateStr = dateLocParts[0] || '';
    const locStr = dateLocParts[1] || '';
    const honorsHtml = ed.honors
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color: #18181b;">$1</strong>');
    
    return `
  <div class="entry">
    <div class="entry-header">
      <div>
        <span class="role-title">${ed.school}</span>
      </div>
      <div class="entry-date">${locStr}</div>
    </div>
    <div class="entry-header" style="margin-top: 1px;">
      <div style="font-size: 9pt; font-weight: 600; color: #27272a;">
        ${ed.degree}
      </div>
      <div class="entry-date">${dateStr}</div>
    </div>
    <div style="font-size: 8.6pt; color: #52525b; margin-top: 2px;">
      ${honorsHtml}
    </div>
  </div>`;
  }).join('\n')}

</body>
</html>
`;

fs.writeFileSync(tempHtmlPath, htmlTemplate);

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const fileUrl = 'file://' + tempHtmlPath.replace(/\\/g, '/');
const cmd = `"${chromePath}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfPath}" "${fileUrl}"`;

try {
  execSync(cmd);
  console.log(`Successfully compiled PDF to ${pdfPath}`);
} finally {
  if (fs.existsSync(tempHtmlPath)) {
    fs.unlinkSync(tempHtmlPath);
  }
}
