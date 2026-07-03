import Reveal from "./Reveal";
import { HOW_IT_WORKS } from "./copy";

const HowItWorksSection = () => (
  <section className="border-t border-white/[0.08] px-6 py-24 md:py-32">
    <div className="mx-auto max-w-6xl">
      <Reveal>
        <h2 className="text-balance text-3xl font-extrabold tracking-tight md:text-[44px] md:leading-tight">
          {HOW_IT_WORKS.heading}
        </h2>
      </Reveal>

      <div className="mt-14 grid gap-12 md:grid-cols-3 md:gap-10">
        {HOW_IT_WORKS.steps.map((step, i) => (
          <Reveal key={step.title} delay={i * 0.1}>
            <div>
              <span className="block font-mono text-6xl font-extrabold leading-none text-white/[0.08]">
                0{i + 1}
              </span>
              <div className="mt-4 h-1 w-10 rounded-full bg-gradient-to-r from-vibe-green to-vibe-orange" />
              <h3 className="mt-6 text-xl font-semibold">{step.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-white/60">{step.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

export default HowItWorksSection;
