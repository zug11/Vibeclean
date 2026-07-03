import Reveal from "./Reveal";
import { PIPELINE } from "./copy";

const PipelineSection = () => (
  <section className="border-t border-white/[0.08] px-6 py-24 md:py-32">
    <div className="mx-auto max-w-6xl">
      <Reveal>
        <h2 className="text-balance text-3xl font-extrabold tracking-tight md:text-[44px] md:leading-tight">
          {PIPELINE.heading}
        </h2>
      </Reveal>

      <Reveal delay={0.05}>
        <p className="mt-8 max-w-3xl text-lg leading-relaxed text-white/60">{PIPELINE.intro1}</p>
        <p className="mt-3 max-w-3xl text-lg leading-relaxed text-white/60">{PIPELINE.intro2}</p>
      </Reveal>

      <div className="relative mt-14">
        <div className="pointer-events-none absolute left-[10%] right-[10%] top-5 hidden h-px bg-gradient-to-r from-vibe-green via-white/20 to-vibe-orange md:block" />
        <div className="grid grid-cols-1 gap-8 md:grid-cols-5 md:gap-6">
          {PIPELINE.steps.map((step, i) => (
            <Reveal key={step.title} delay={i * 0.09}>
              <div className="flex items-start gap-4 md:block">
                <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black font-mono text-sm text-vibe-orange md:mb-4">
                  0{i + 1}
                </div>
                <div>
                  <h3 className="text-base font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/55">{step.text}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>

      <Reveal>
        <p className="mt-14 max-w-3xl text-balance text-xl font-semibold leading-relaxed md:text-2xl">
          {PIPELINE.outro1}{" "}
          <span className="font-normal text-white/60">{PIPELINE.outro2}</span>
        </p>
      </Reveal>
    </div>
  </section>
);

export default PipelineSection;
