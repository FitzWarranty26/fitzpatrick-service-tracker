import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff } from "lucide-react";
import logoWhite from "@assets/logo-white.jpg";

interface LoginScreenProps {
  onLogin: (username: string, password: string) => Promise<{ success: boolean; mustChangePassword?: boolean; error?: string }>;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
}

export function LoginScreen({ onLogin, onChangePassword }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Password change state
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError("Please enter username and password");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const result = await onLogin(username.trim(), password);
      if (!result.success) {
        setError(result.error || "Invalid username or password");
        setPassword("");
      } else if (result.mustChangePassword) {
        setCurrentPw(password);
        setMustChangePassword(true);
        setPassword("");
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPw !== confirmPw) {
      setError("Passwords do not match");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const result = await onChangePassword(currentPw, newPw);
      if (!result.success) {
        setError(result.error || "Failed to change password");
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
          <div className="bg-[hsl(220,24%,16%)] rounded-2xl p-4 shadow-lg shadow-black/20 border border-white/[0.06]">
            <img
              src={logoWhite}
              alt="Fitzpatrick Warranty Service, LLC"
              className="h-14 w-auto object-contain"
            />
          </div>
        </div>

        {/* Login or Password Change Card */}
        <div className="bg-[hsl(220,22%,16%)] rounded-xl border border-[hsl(220,22%,20%)] p-6 space-y-5">
          {!mustChangePassword ? (
            <>
              <div className="text-center space-y-1">
                <h1 className="text-lg font-bold text-white tracking-[-0.01em]">Warranty Service Tracker</h1>
                <p className="text-sm text-slate-400">Sign in to continue</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <Input
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(""); }}
                  className="bg-[hsl(220,22%,14%)] border-[hsl(220,22%,22%)] text-white placeholder:text-slate-500 h-11"
                  data-testid="input-username"
                  autoFocus
                  autoComplete="username"
                />

                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(""); }}
                    className="bg-[hsl(220,22%,14%)] border-[hsl(220,22%,22%)] text-white placeholder:text-slate-500 h-11 pr-10"
                    data-testid="input-password"
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
                  className="w-full h-11 bg-[hsl(200,72%,40%)] hover:bg-[hsl(200,72%,35%)] text-white font-medium"
                  data-testid="button-login"
                >
                  {loading ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            </>
          ) : (
            <>
              <div className="text-center space-y-1">
                <h1 className="text-lg font-bold text-white tracking-[-0.01em]">Password Change Required</h1>
                <p className="text-sm text-slate-400">Please set a new password to continue</p>
              </div>

              <form onSubmit={handleChangePassword} className="space-y-4">
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="New Password (8+ characters)"
                    value={newPw}
                    onChange={(e) => { setNewPw(e.target.value); setError(""); }}
                    className="bg-[hsl(220,22%,14%)] border-[hsl(220,22%,22%)] text-white placeholder:text-slate-500 h-11 pr-10"
                    data-testid="input-new-password"
                    autoFocus
                    autoComplete="new-password"
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

                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Confirm New Password"
                  value={confirmPw}
                  onChange={(e) => { setConfirmPw(e.target.value); setError(""); }}
                  className="bg-[hsl(220,22%,14%)] border-[hsl(220,22%,22%)] text-white placeholder:text-slate-500 h-11"
                  data-testid="input-confirm-password"
                  autoComplete="new-password"
                />

                {error && (
                  <p className="text-sm text-red-400 text-center" data-testid="text-change-error">
                    {error}
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 bg-[hsl(200,72%,40%)] hover:bg-[hsl(200,72%,35%)] text-white font-medium"
                  data-testid="button-change-password"
                >
                  {loading ? "Updating..." : "Set New Password"}
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-500 tracking-wide">
          © {new Date().getFullYear()} Fitzpatrick Warranty Service, LLC
        </p>
      </div>
    </div>
  );
}
