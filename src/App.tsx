import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { Projects } from './components/Projects';
import { Experience } from './components/Experience';
import { SkillsEducation } from './components/SkillsEducation';
import { Footer } from './components/Footer';

function App() {
  return (
    <div className="min-h-screen bg-[#09090b] text-[#f4f4f5] flex flex-col">
      <Header />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6">
        <Hero />
        <Projects />
        <Experience />
        <SkillsEducation />
      </main>

      <div className="max-w-4xl w-full mx-auto px-4 sm:px-6">
        <Footer />
      </div>
    </div>
  );
}

export default App;

