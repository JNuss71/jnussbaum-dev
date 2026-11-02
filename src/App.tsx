import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { Projects } from './components/Projects';
import { Experience } from './components/Experience';
import { SkillsEducation } from './components/SkillsEducation';
import { PhotosPage } from './components/Photos';
import { Footer } from './components/Footer';

/** Tiny pathname router: /photos and /photos/<trip> are the only extra routes. */
function photosRoute(): { slug?: string } | null {
  const [root, slug] = window.location.pathname.split('/').filter(Boolean);
  return root === 'photos' ? { slug } : null;
}

function App() {
  const photos = photosRoute();

  return (
    <div className="min-h-screen bg-[#09090b] text-[#f4f4f5] flex flex-col">
      <Header />

      {photos ? (
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <PhotosPage slug={photos.slug} />
        </main>
      ) : (
        <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6">
          <Hero />
          <Projects />
          <Experience />
          <SkillsEducation />
        </main>
      )}

      <div className="max-w-4xl w-full mx-auto px-4 sm:px-6">
        <Footer />
      </div>
    </div>
  );
}

export default App;
