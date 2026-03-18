// ─── Healthcare Domain Module ─────────────────────────────
import type { TableNode, DomainModule, DomainDetectionResult, TypeUpgrade, DomainTrigger, CompanionTableSuggestion, DomainRLSPolicy } from "@/lib/types";
import type { CheckRule, CrossColumnCheckRule } from "@/lib/compiler-pass";

// ─── Detection Signals ───────────────────────────────────

const TABLE_SIGNALS = new Set([
  "patients", "patient_profiles", "clinical_trials", "trial_arms",
  "treatment_arms", "cohorts", "patient_cohorts", "consents",
  "informed_consent", "consent_records", "procedures", "medications",
  "prescriptions", "medication_orders", "diagnoses", "lab_results",
  "vitals", "biometrics", "adverse_events", "encounters", "visits",
  "providers", "practitioners", "claims", "insurance", "ehr",
  "medical_records", "appointments", "allergies", "care_plans",
]);

const COLUMN_SIGNALS = new Set([
  "patient_id", "mrn", "dob", "diagnosis_code", "icd_code", "ndc_code",
  "cpt_code", "snomed_code", "dose_mg", "dose_amount", "body_weight",
  "bmi", "blood_pressure", "blood_pressure_systolic", "blood_pressure_diastolic",
  "heart_rate", "spo2", "body_temp", "temperature", "consent_date",
  "procedure_date", "admission_date", "discharge_date", "blinded",
  "arm_assignment", "placebo", "adverse_event", "hipaa_consent",
  "consent_given", "consent_status", "blood_type", "npi", "dosage",
  "severity", "trial_phase", "encounter_status", "claim_status",
]);

function detect(tables: TableNode[]): DomainDetectionResult {
  const signals: string[] = [];
  for (const t of tables) {
    const tName = t.name.toLowerCase();
    if (TABLE_SIGNALS.has(tName)) signals.push(`table:${tName}`);
    for (const c of t.columns) {
      const cName = c.name.toLowerCase();
      if (COLUMN_SIGNALS.has(cName)) signals.push(`column:${tName}.${cName}`);
    }
  }
  const maxSignals = tables.length * 3;
  const confidence = maxSignals > 0 ? Math.min(signals.length / maxSignals, 1) : 0;
  return { domain: "healthcare", confidence, matchedSignals: signals };
}

// ─── CHECK Rules ─────────────────────────────────────────

const checkRules: CheckRule[] = [
  { pattern: (n) => n === "dose_mg" || n === "dose_amount" || n === "dosage", expression: (c) => `${c} > 0`, label: "positive dosage", category: "range" },
  { pattern: (n) => n === "body_weight", expression: (c) => `${c} > 0 AND ${c} <= 700`, label: "body weight range (kg)", category: "range" },
  { pattern: (n) => n === "bmi", expression: (c) => `${c} > 5 AND ${c} <= 100`, label: "BMI clinical range", category: "range" },
  { pattern: (n) => n === "heart_rate", expression: (c) => `${c} > 0 AND ${c} <= 300`, label: "heart rate range (bpm)", category: "range" },
  { pattern: (n) => n === "blood_pressure_systolic", expression: (c) => `${c} > 0 AND ${c} <= 400`, label: "systolic BP range (mmHg)", category: "range" },
  { pattern: (n) => n === "blood_pressure_diastolic", expression: (c) => `${c} > 0 AND ${c} <= 300`, label: "diastolic BP range (mmHg)", category: "range" },
  { pattern: (n) => n === "spo2", expression: (c) => `${c} >= 0 AND ${c} <= 100`, label: "SpO2 percentage", category: "range" },
  { pattern: (n) => n === "body_temp" || n === "temperature", expression: (c) => `${c} > 25 AND ${c} <= 45`, label: "body temp clinical range (C)", category: "range" },
  { pattern: (n) => n === "severity", expression: (c) => `${c} IN ('mild', 'moderate', 'severe', 'life_threatening', 'fatal')`, label: "clinical severity enum", category: "enum" },
  { pattern: (n) => n === "trial_phase", expression: (c) => `${c} IN ('preclinical', 'phase_1', 'phase_2', 'phase_3', 'phase_4', 'post_market')`, label: "trial phase enum", category: "enum" },
  { pattern: (n) => n === "consent_status", expression: (c) => `${c} IN ('pending', 'obtained', 'withdrawn', 'expired')`, label: "consent status enum", category: "enum" },
  { pattern: (n) => n === "blood_type", expression: (c) => `${c} IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')`, label: "blood type enum", category: "enum" },
  { pattern: (n) => n === "encounter_status", expression: (c) => `${c} IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show')`, label: "encounter status enum", category: "enum" },
  { pattern: (n) => n === "claim_status", expression: (c) => `${c} IN ('submitted', 'pending', 'approved', 'denied', 'appealed', 'paid')`, label: "claim status enum", category: "enum" },
];

const crossColumnCheckRules: CrossColumnCheckRule[] = [
  {
    detect: (cols) => {
      const admit = cols.find(c => c.name === "admission_date");
      const discharge = cols.find(c => c.name === "discharge_date");
      return admit && discharge ? { col1: admit.name, col2: discharge.name } : null;
    },
    expression: (c1, c2) => `${c2} >= ${c1}`,
    constraintName: (t) => `chk_${t}_discharge_gte_admission`,
    label: "discharge date >= admission date",
  },
  {
    detect: (cols) => {
      const consent = cols.find(c => c.name === "consent_date");
      const procedure = cols.find(c => c.name === "procedure_date");
      return consent && procedure ? { col1: consent.name, col2: procedure.name } : null;
    },
    expression: (c1, c2) => `${c2} >= ${c1}`,
    constraintName: (t) => `chk_${t}_procedure_gte_consent`,
    label: "procedure date >= consent date",
  },
  {
    detect: (cols) => {
      const dia = cols.find(c => c.name === "blood_pressure_diastolic");
      const sys = cols.find(c => c.name === "blood_pressure_systolic");
      return dia && sys ? { col1: dia.name, col2: sys.name } : null;
    },
    expression: (c1, c2) => `${c2} >= ${c1}`,
    constraintName: (t) => `chk_${t}_systolic_gte_diastolic`,
    label: "systolic >= diastolic BP",
  },
];

// ─── Type Upgrades ───────────────────────────────────────

function typeUpgrades(tables: TableNode[]): TypeUpgrade[] {
  const upgrades: TypeUpgrade[] = [];
  for (const t of tables) {
    for (const col of t.columns) {
      const lower = col.type.toLowerCase();
      const cName = col.name.toLowerCase();
      // dob should be date, not timestamp
      if (cName === "dob" && (lower === "timestamp" || lower === "timestamptz")) {
        upgrades.push({ tableName: t.name, columnName: col.name, fromType: col.type, toType: "date", reason: "date of birth should be date, not timestamp" });
      }
      // encounter/appointment timestamps → timestamptz for multi-timezone clinics
      if (lower === "timestamp" && (cName.includes("admission") || cName.includes("discharge") || cName.includes("encounter") || cName.includes("appointment"))) {
        upgrades.push({ tableName: t.name, columnName: col.name, fromType: col.type, toType: "timestamptz", reason: "cross-timezone clinical scheduling" });
      }
    }
  }
  return upgrades;
}

// ─── Triggers ────────────────────────────────────────────

function triggers(tables: TableNode[]): DomainTrigger[] {
  const result: DomainTrigger[] = [];
  const names = new Set(tables.map(t => t.name.toLowerCase()));
  // Consent-before-procedure validation
  const consentTable = names.has("consents") ? "consents" : names.has("consent_records") ? "consent_records" : names.has("informed_consent") ? "informed_consent" : null;
  if (consentTable) {
    for (const t of tables) {
      const tName = t.name.toLowerCase();
      if ((tName === "procedures" || tName === "medication_orders" || tName === "prescriptions") && t.columns.some(c => c.name.toLowerCase() === "patient_id")) {
        const fnName = `fn_check_consent_${t.name}`;
        const trgName = `trg_check_consent_${t.name}`;
        result.push({
          functionName: fnName, triggerName: trgName, tableName: t.name,
          description: `Validates patient consent exists before ${t.name} insertion`,
          body: `CREATE OR REPLACE FUNCTION ${fnName}() RETURNS TRIGGER AS $$\nDECLARE\n  consent_found boolean;\nBEGIN\n  SELECT EXISTS(\n    SELECT 1 FROM ${consentTable}\n    WHERE patient_id = NEW.patient_id\n      AND consent_status = 'obtained'\n  ) INTO consent_found;\n  IF NOT consent_found THEN\n    RAISE EXCEPTION 'No valid consent found for patient %', NEW.patient_id;\n  END IF;\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;\n\nDO $$ BEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${trgName}') THEN\n    CREATE TRIGGER ${trgName} BEFORE INSERT ON ${t.name} FOR EACH ROW EXECUTE FUNCTION ${fnName}();\n  END IF;\nEND $$;`,
        });
      }
    }
  }
  return result;
}

// ─── Companion Tables ────────────────────────────────────

function companionTables(tables: TableNode[]): CompanionTableSuggestion[] {
  const result: CompanionTableSuggestion[] = [];
  const names = new Set(tables.map(t => t.name.toLowerCase()));
  // Suggest consent_records if encounters exist without consent table
  if (names.has("encounters") && !names.has("consents") && !names.has("consent_records") && !names.has("informed_consent")) {
    result.push({
      name: "consent_records",
      columns: [
        { name: "id", type: "uuid", constraints: [{ type: "primary" }, { type: "default", value: "gen_random_uuid()" }] },
        { name: "patient_id", type: "uuid", constraints: [{ type: "notNull" }] },
        { name: "consent_type", type: "varchar", constraints: [{ type: "notNull" }] },
        { name: "consent_status", type: "varchar", constraints: [{ type: "notNull" }] },
        { name: "consent_date", type: "date", constraints: [{ type: "notNull" }] },
        { name: "expiry_date", type: "date" },
        { name: "document_url", type: "text" },
        { name: "created_at", type: "timestamptz", constraints: [{ type: "notNull" }, { type: "default", value: "now()" }] },
        { name: "updated_at", type: "timestamptz", constraints: [{ type: "notNull" }, { type: "default", value: "now()" }] },
      ],
      reason: "Patient consent tracking (required for clinical procedures and PHI access)",
    });
  }
  // Suggest audit_log for PHI compliance
  if (names.has("patients") && !names.has("audit_logs") && !names.has("audit_log")) {
    result.push({
      name: "audit_log",
      columns: [
        { name: "id", type: "uuid", constraints: [{ type: "primary" }, { type: "default", value: "gen_random_uuid()" }] },
        { name: "user_id", type: "uuid", constraints: [{ type: "notNull" }] },
        { name: "action", type: "varchar", constraints: [{ type: "notNull" }] },
        { name: "resource_type", type: "varchar", constraints: [{ type: "notNull" }] },
        { name: "resource_id", type: "uuid", constraints: [{ type: "notNull" }] },
        { name: "ip_address", type: "varchar" },
        { name: "created_at", type: "timestamptz", constraints: [{ type: "notNull" }, { type: "default", value: "now()" }] },
      ],
      reason: "HIPAA-compliant PHI access audit logging",
    });
  }
  return result;
}

// ─── RLS Policies ────────────────────────────────────────

function rlsPolicies(tables: TableNode[]): DomainRLSPolicy[] {
  const result: DomainRLSPolicy[] = [];
  for (const t of tables) {
    const tName = t.name.toLowerCase();
    const hasProvider = t.columns.some(c => c.name.toLowerCase() === "provider_id");
    const hasPatient = t.columns.some(c => c.name.toLowerCase() === "patient_id");
    // Provider-scoped patient records
    if (tName === "patients" || (hasPatient && hasProvider)) {
      result.push({
        tableName: t.name, policyName: `provider_scope_${t.name}`,
        description: `Providers see only their own patients' ${t.name}`,
        sql: `ALTER TABLE ${t.name} ENABLE ROW LEVEL SECURITY;\nCREATE POLICY "provider_scope_${t.name}" ON ${t.name}\n  FOR SELECT\n  USING (\n    ${hasProvider ? "provider_id = auth.uid()" : "id IN (SELECT patient_id FROM encounters WHERE provider_id = auth.uid())"}\n    OR auth.jwt() ->> 'role' IN ('admin', 'compliance')\n  );`,
      });
    }
    // Audit logs: append-only
    if (tName === "audit_log" || tName === "audit_logs") {
      result.push({
        tableName: t.name, policyName: `append_only_${t.name}`,
        description: `${t.name} is append-only; only admins can read`,
        sql: `ALTER TABLE ${t.name} ENABLE ROW LEVEL SECURITY;\nCREATE POLICY "insert_${t.name}" ON ${t.name}\n  FOR INSERT\n  WITH CHECK (auth.role() = 'authenticated');\nCREATE POLICY "read_${t.name}" ON ${t.name}\n  FOR SELECT\n  USING (auth.jwt() ->> 'role' IN ('admin', 'compliance'));`,
      });
    }
  }
  return result;
}

// ─── Export ──────────────────────────────────────────────

export const healthcareModule: DomainModule = {
  id: "healthcare",
  label: "Healthcare",
  detect,
  checkRules,
  crossColumnCheckRules,
  typeUpgrades,
  triggers,
  companionTables,
  rlsPolicies,
};
