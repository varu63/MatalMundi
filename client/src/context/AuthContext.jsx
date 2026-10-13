import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { endpoints, handleError } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    try {
      const res = await endpoints.auth.me();
      setUser(res.data.data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const login = async (email, password) => {
    const res = await endpoints.auth.login({ email, password });
    setUser(res.data.data.user);
    return res.data.data.user;
  };

  const register = async (payload) => {
    const res = await endpoints.auth.register(payload);
    setUser(res.data.data.user);
    return res.data.data.user;
  };

  const logout = async () => {
    try {
      await endpoints.auth.logout();
    } catch {
      // session may already be gone
    }
    setUser(null);
  };

  const errorKey = (err) => ({ msg: handleError(err), key: Date.now() });

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshMe, errorKey }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
