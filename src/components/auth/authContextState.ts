import { createContext, useContext } from 'react';

export type User = { name: string; email: string; userType?: string | null };
export type AuthStatus = 'checking' | 'authenticated' | 'anonymous';

export type AuthContextValue = {
  user: User | null;
  status: AuthStatus;
  openAuth: () => void;
  closeAuth: () => void;
  logout: () => void;
  loginWithCredentials: (usernameOrEmail: string, password: string) => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
