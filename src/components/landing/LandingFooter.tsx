const LandingFooter = () => (
  <footer className="border-t border-white/[0.08] px-6 py-12">
    <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 text-center">
      <img src="/vibedb-logo.svg" alt="VibeDB" className="h-20 w-auto" />
      <p className="text-xs text-white/40">© {new Date().getFullYear()} VibeDB. All rights reserved.</p>
    </div>
  </footer>
);

export default LandingFooter;
