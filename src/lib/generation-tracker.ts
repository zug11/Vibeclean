// Feature 2: Real Generation Step Tracking

export interface GenerationStep {
  id: string;
  label: string;
  status: "pending" | "active" | "completed" | "error";
  startedAt?: number;
  completedAt?: number;
  detail?: string;
}

export interface GenerationProgress {
  steps: GenerationStep[];
  currentStepIndex: number;
  overallStatus: "idle" | "running" | "completed" | "error";
  startedAt?: number;
  completedAt?: number;
  totalDurationMs?: number;
}

type ProgressCallback = (progress: GenerationProgress) => void;

export function createGenerationTracker(onProgress: ProgressCallback) {
  let steps: GenerationStep[] = [];
  let currentStepIndex = -1;
  let overallStatus: GenerationProgress["overallStatus"] = "idle";
  let startedAt: number | undefined;
  let completedAt: number | undefined;

  const emit = () => {
    onProgress({
      steps: [...steps],
      currentStepIndex,
      overallStatus,
      startedAt,
      completedAt,
      totalDurationMs: startedAt ? (completedAt || Date.now()) - startedAt : undefined,
    });
  };

  return {
    start(stepLabels: string[]) {
      steps = stepLabels.map((label, i) => ({
        id: `step-${i}`,
        label,
        status: i === 0 ? "active" : "pending",
      }));
      currentStepIndex = 0;
      overallStatus = "running";
      startedAt = Date.now();
      completedAt = undefined;
      steps[0].startedAt = startedAt;
      emit();
    },

    // Update the ACTIVE step's label in place (e.g. live counters like
    // "Generating tables (12/20)") without advancing the step.
    updateCurrentStep(label: string) {
      if (currentStepIndex < 0 || currentStepIndex >= steps.length) return;
      steps[currentStepIndex].label = label;
      emit();
    },

    insertStep(label: string) {
      const newStep: GenerationStep = {
        id: `step-${steps.length}`,
        label,
        status: "pending",
      };
      steps.splice(currentStepIndex + 1, 0, newStep);
      emit();
    },

    advanceStep(detail?: string) {
      if (currentStepIndex < 0 || currentStepIndex >= steps.length) return;

      // Complete current step
      steps[currentStepIndex].status = "completed";
      steps[currentStepIndex].completedAt = Date.now();
      if (detail) steps[currentStepIndex].detail = detail;

      // Move to next
      currentStepIndex++;
      if (currentStepIndex < steps.length) {
        steps[currentStepIndex].status = "active";
        steps[currentStepIndex].startedAt = Date.now();
      }
      emit();
    },

    fail(error: string) {
      if (currentStepIndex >= 0 && currentStepIndex < steps.length) {
        steps[currentStepIndex].status = "error";
        steps[currentStepIndex].detail = error;
        steps[currentStepIndex].completedAt = Date.now();
      }
      overallStatus = "error";
      completedAt = Date.now();
      emit();
    },

    complete() {
      // Mark all remaining steps as completed
      for (const step of steps) {
        if (step.status === "pending" || step.status === "active") {
          step.status = "completed";
          step.completedAt = Date.now();
        }
      }
      overallStatus = "completed";
      completedAt = Date.now();
      emit();
    },

    getProgress(): GenerationProgress {
      return {
        steps: [...steps],
        currentStepIndex,
        overallStatus,
        startedAt,
        completedAt,
        totalDurationMs: startedAt ? (completedAt || Date.now()) - startedAt : undefined,
      };
    },
  };
}
