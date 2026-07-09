import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { flushSync } from 'react-dom'
import type { User, LoginRequest, RegisterRequest } from '../types'
import { authAPI } from '../lib/api'
import { isInternalDashboardEmail } from '../lib/adminConfig'

interface AuthContextValue {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  isAdmin: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: RegisterRequest) => Promise<{ needsVerification: boolean }>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const isAdmin = isInternalDashboardEmail(user?.email)

  // Decode JWT payload (no verify — server validates)
  const decodeToken = (t: string): Record<string, unknown> | null => {
    try {
      const parts = t.split('.')
      if (parts.length < 2) return null
      return JSON.parse(atob(parts[1]))
    } catch {
      return null
    }
  }

  const isTokenExpired = (t: string): boolean => {
    const payload = decodeToken(t)
    if (!payload || typeof payload.exp !== 'number') return false
    return Date.now() / 1000 > payload.exp
  }

  const refreshUser = useCallback(async () => {
    try {
      const res = await authAPI.me()
      setUser(res.data)
      localStorage.setItem('user', JSON.stringify(res.data))
    } catch {
      // Token invalid — clear
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      setToken(null)
      setUser(null)
    }
  }, [])

  useEffect(() => {
    const savedToken = localStorage.getItem('token')
    const savedUser = localStorage.getItem('user')

    if (savedToken && !isTokenExpired(savedToken)) {
      setToken(savedToken)
      if (savedUser) {
        try {
          setUser(JSON.parse(savedUser))
        } catch {
          // ignore
        }
      }
      // Refresh user data from server
      refreshUser().finally(() => setIsLoading(false))
    } else {
      if (savedToken) {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
      }
      setIsLoading(false)
    }
  }, [refreshUser])

  const login = async (email: string, password: string) => {
    const res = await authAPI.login(email, password)
    const { access_token, user: userData } = res.data
    localStorage.setItem('token', access_token)
    localStorage.setItem('user', JSON.stringify(userData))
    // flushSync ensures state is committed before login() returns,
    // so RequireAuth sees isAuthenticated=true when navigate() fires.
    flushSync(() => {
      setToken(access_token)
      setUser(userData)
    })
  }

  const register = async (data: RegisterRequest): Promise<{ needsVerification: boolean }> => {
    const res = await authAPI.register(data as unknown as Record<string, unknown>)
    const { access_token, user: userData } = res.data
    localStorage.setItem('token', access_token)
    localStorage.setItem('user', JSON.stringify(userData))
    flushSync(() => {
      setToken(access_token)
      setUser(userData)
    })
    return { needsVerification: !userData.email_verified }
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setToken(null)
    setUser(null)
    window.location.href = '/'
  }

  return (
    <AuthContext.Provider value={{
      user,
      token,
      isAuthenticated: !!token && !!user,
      isLoading,
      isAdmin,
      login,
      register,
      logout,
      refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
