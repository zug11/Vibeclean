import { createContext, useContext, ReactNode } from "react";

interface SubscriptionState {
  subscribed: boolean;
  tier: "none" | "standard" | "pro";
  credits: number;
  subscription_end: string | null;
}

interface AuthContextType {
  user: { id: string; email: string } | null;
  session: null;
  loading: boolean;
  profile: { display_name: string | null; avatar_url: string | null; trial_start: string } | null;
  subscription: SubscriptionState;
  refreshSubscription: () => Promise<void>;
  signOut: () => Promise<void>;
}

const guestUser = { id: "local-user", email: "guest@vibedb.local" };

const guestContext: AuthContextType = {
  user: guestUser,
  session: null,
  loading: false,
  profile: { display_name: "Local User", avatar_url: null, trial_start: new Date().toISOString() },
  subscription: { subscribed: true, tier: "pro", credits: 999, subscription_end: null },
  refreshSubscription: async () => {},
  signOut: async () => {},
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  return (
    <AuthContext.Provider value={guestContext}>
      {children}
    </AuthContext.Provider>
  );
};
