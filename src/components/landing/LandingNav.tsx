import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import VibeDBMark from "./VibeDBMark";

const LandingNav = () => (
  <nav className="sticky top-0 z-50 border-b border-white/[0.08] bg-black/70 backdrop-blur-xl">
    <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
      <div className="flex items-center gap-2.5">
        <VibeDBMark className="h-7 w-auto" />
        <span className="text-[17px] font-semibold tracking-tight">
          vibe<span className="text-vibe-orange">DB</span>
          <span className="bg-gradient-to-r from-vibe-orange to-vibe-green bg-clip-text text-transparent">.me</span>
        </span>
      </div>
      <Button
        asChild
        size="sm"
        className="border border-white/15 bg-transparent text-white hover:bg-white/10 focus-visible:ring-vibe-green/60 focus-visible:ring-offset-black"
      >
        <Link to="/app">Go to App</Link>
      </Button>
    </div>
  </nav>
);

export default LandingNav;
