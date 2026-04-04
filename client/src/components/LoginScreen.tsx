import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Eye, EyeOff } from "lucide-react";
import logoWhite from "@assets/logo-white.jpg";

interface LoginScreenProps {
  onLogin: (password: string) => Promise<boolean>;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError("Please enter a password");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const success = await onLogin(password);
      if (!success) {
        setError("Incorrect password");
        setPassword("");
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-[hsl(220,22%,10%)] px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="flex justify-center">
          <img
            src={logoWhite}
            alt="Fitzpatrick Warranty Service, LLC"
            className="h-20 w-auto"
          />
        </div>

        {/* Login Card */}
        <div className="bg-[hsl(220,22%,16%)] rounded-xl border border-[hsl(220,22%,20%)] p-6 space-y-5">
          <div className="text-center space-y-1">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-blue-600/20 mb-2">
              <Lock className="w-5 h-5 text-blue-400" />
            </div>
            <h1 className="text-lg font-bold text-white">Service Tracker</h1>
            <p className="text-sm text-slate-400">Enter password to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                className="bg-[hsl(220,22%,14%)] border-[hsl(220,22%,22%)] text-white placeholder:text-slate-500 h-11 pr-10"
                data-testid="input-password"
                autoFocus
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {error && (
              <p className="text-sm text-red-400 text-center" data-testid="text-login-error">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-medium"
              data-testid="button-login"
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-500">
          Fitzpatrick Warranty Service, LLC
        </p>
      </div>
    </div>
  );
}
