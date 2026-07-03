import { Fragment } from "react";
import { CircleX, MoveRight } from "lucide-react";
import Reveal from "./Reveal";
import { PROBLEM } from "./copy";

const ProblemSection = () => (
  <section className="border-t border-white/[0.08] px-6 py-24 md:py-32">
    <div className="mx-auto max-w-3xl">
      <Reveal>
        <h2 className="text-balance text-3xl font-extrabold tracking-tight md:text-[44px] md:leading-tight">
          {PROBLEM.heading}
        </h2>
      </Reveal>

      <Reveal delay={0.05}>
        <p className="mt-8 text-lg leading-relaxed text-white/60">{PROBLEM.story}</p>
        <p className="mt-3 text-lg font-medium text-white">{PROBLEM.storyPunch}</p>
      </Reveal>

      <div className="mt-8 divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-white/[0.02]">
        {PROBLEM.pains.map((pain, i) => (
          <Reveal key={pain} delay={i * 0.06}>
            <div className="flex items-start gap-3 px-5 py-4">
              <CircleX size={16} className="mt-1 shrink-0 text-vibe-orange" />
              <p className="text-[15px] leading-relaxed text-white/70">{pain}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <p className="mt-12 text-lg text-white/60">{PROBLEM.beforeChain}</p>
      </Reveal>

      <Reveal delay={0.05}>
        <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-3">
          {PROBLEM.toolChain.map((tool, i) => (
            <Fragment key={tool}>
              {i > 0 && <MoveRight size={14} className="shrink-0 text-white/25" />}
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-sm text-white/70">
                {tool}
              </span>
            </Fragment>
          ))}
        </div>
      </Reveal>

      <Reveal>
        <p className="mt-12 text-lg leading-relaxed text-white/60">{PROBLEM.drift}</p>
      </Reveal>

      <Reveal>
        <p className="mt-12 text-balance text-xl font-semibold md:text-2xl">
          {PROBLEM.closer1} <span className="text-vibe-orange">{PROBLEM.closer2}</span>
        </p>
      </Reveal>
    </div>
  </section>
);

export default ProblemSection;
