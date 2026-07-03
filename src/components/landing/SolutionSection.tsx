import Reveal from "./Reveal";
import { SOLUTION } from "./copy";

const SolutionSection = () => (
  <section className="border-t border-white/[0.08] px-6 py-24 md:py-32">
    <div className="mx-auto max-w-5xl">
      <Reveal>
        <h2 className="max-w-3xl text-balance text-3xl font-extrabold tracking-tight md:text-[44px] md:leading-tight">
          {SOLUTION.heading}
        </h2>
      </Reveal>

      <div className="mt-12 grid gap-12 md:grid-cols-2 md:gap-16">
        <Reveal delay={0.05}>
          <div className="space-y-5 text-lg leading-relaxed text-white/60">
            <p className="text-white/80">{SOLUTION.p1}</p>
            <p>{SOLUTION.p2}</p>
            <p>{SOLUTION.p3}</p>
            <p>{SOLUTION.p4}</p>
          </div>
        </Reveal>

        <Reveal delay={0.15}>
          <div className="flex h-full flex-col justify-center">
            <blockquote className="border-l-2 border-vibe-green pl-6 text-2xl font-semibold leading-snug md:text-3xl">
              {SOLUTION.quote}
            </blockquote>
            <p className="mt-8 border-l-2 border-transparent pl-6 text-lg leading-relaxed text-white/60">
              {SOLUTION.result}
            </p>
          </div>
        </Reveal>
      </div>
    </div>
  </section>
);

export default SolutionSection;
