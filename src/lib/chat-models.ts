export interface ChatModel {
  id: string;
  name: string;
  apiModel: string;
}

export const CHAT_MODELS: ChatModel[] = [
  { id: "fable-5", name: "Fable 5", apiModel: "claude-fable-5" },
  { id: "opus-4-8", name: "Opus 4.8", apiModel: "claude-opus-4-8" },
  { id: "sonnet-4-6", name: "Sonnet 4.6", apiModel: "claude-sonnet-4-6" },
  { id: "haiku-4-5", name: "Haiku 4.5", apiModel: "claude-haiku-4-5-20251001" },
];

export const DEFAULT_CHAT_MODEL_ID = "sonnet-4-6";

const ALLOWED_API_MODELS = new Set(CHAT_MODELS.map(m => m.apiModel).concat(["claude-haiku-4-5"]));

export function getDefaultChatModel(): string {
  const stored = localStorage.getItem("vibedb_chat_model");
  if (stored && CHAT_MODELS.some(m => m.id === stored)) return stored;
  return DEFAULT_CHAT_MODEL_ID;
}

export function setDefaultChatModel(id: string): void {
  localStorage.setItem("vibedb_chat_model", id);
}

export function getChatModelApiId(id: string): string {
  return CHAT_MODELS.find(m => m.id === id)?.apiModel ?? CHAT_MODELS.find(m => m.id === DEFAULT_CHAT_MODEL_ID)!.apiModel;
}

export function isAllowedChatApiModel(model: string): boolean {
  return ALLOWED_API_MODELS.has(model);
}
