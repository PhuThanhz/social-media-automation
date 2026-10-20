import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  devtools(
    persist(
      (set) => ({
        token: null,
        isAuthenticated: false,
        login: (token) => {
          localStorage.setItem('access_token', token);
          set({ token, isAuthenticated: true });
        },
        logout: () => {
          localStorage.removeItem('access_token');
          set({ token: null, isAuthenticated: false });
        },
      }),
      { name: 'auth-storage' }
    )
  )
);
