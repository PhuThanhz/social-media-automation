import api from '../config/axios';
import { LoginRequest, RegisterRequest, AuthResponse } from '../types/auth';

export const authService = {
  login: async (data: LoginRequest): Promise<AuthResponse> => {
    const response = await api.post<AuthResponse>('/auth/login', data);
    return response.data;
  },

  register: async (data: RegisterRequest): Promise<string> => {
    const response = await api.post('/auth/register', data);
    return response.data;
  }
};
