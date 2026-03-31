"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { BlockCard, BlockTitle } from "@/components/ui/blocks";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Login failed");
      return;
    }

    router.push("/dashboard");
  }

  return (
    <main className="min-h-screen flex items-center justify-center relative bg-[#F5F5F0] overflow-hidden">
      <div className="relative z-10 w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 p-6 items-stretch">
        {/* Info & Image panel */}
        <div className="hidden md:flex flex-col relative w-full h-full rounded-2xl overflow-hidden bg-white/70 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-white">
          {/* Vertical Text Section */}
          <div className="p-8 md:p-10 pb-4 shrink-0 flex flex-col z-10 relative">
            <div className="mb-6">
              <img src="/images/cluso-infolink-logo.png" alt="Cluso Infolink Verification Network" className="h-10 w-auto object-contain" />
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-[#171717] mb-4 leading-tight">
              Partner Workspace
            </h1>
            <p className="text-[#666] text-base leading-relaxed pr-8">
              Securely submit candidate requests, manage delegates, and track status updates in one centralized command center.
            </p>
          </div>
          
          {/* Filled Image Section */}
          <div className="relative flex-1 w-full min-h-[350px]">
            <img
              src="/images/Login-sitiing.jpg"
              alt="Partner Workspace"
              className="absolute inset-0 w-full h-full object-contain object-bottom p-4"
            />
          </div>
        </div>

        {/* Login Form panel */}
        <div className="backdrop-blur-xl bg-white/90 border border-white p-8 sm:p-10 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.06)] relative flex flex-col justify-center">
          {/* Subtle glowing orb effect behind the form */}
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-[#FFBDE0]/20 rounded-full blur-3xl pointer-events-none"></div>
          
          <div className="mb-8 relative z-10">
            <div className="inline-flex p-3 rounded-xl bg-gradient-to-br from-[#FFBDE0] to-[#FFE2C6] mb-6 shadow-[0_4px_14px_rgba(255,189,224,0.4)] border border-white/50">
              <img src="/images/cluso-logo.png" alt="Cluso Logo" className="w-7 h-7 object-contain drop-shadow-sm" />
            </div>
            <h2 className="text-3xl font-bold text-[#171717] mb-2 tracking-tight">Access Portal</h2>
            <p className="text-[#666] text-sm leading-relaxed">No self-signup is enabled. Use your company account created by an admin.</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-6 relative z-10">
            <div className="space-y-2 group">
              <label className="text-xs font-bold uppercase tracking-widest text-[#666] group-focus-within:text-[#171717] transition-colors flex items-center gap-2" htmlFor="email">
                <Mail size={14} /> Partner Email
              </label>
              <div className="relative">
                <input
                  id="email"
                  className="w-full bg-[#fcfcfc] border border-gray-200 rounded-lg px-4 py-3.5 text-[#171717] placeholder-[#666]/40 focus:outline-none focus:ring-2 focus:ring-[#FFBDE0]/50 focus:border-[#FFBDE0] transition-all font-medium"
                  type="email"
                  placeholder="partner@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2 group">
              <label className="text-xs font-bold uppercase tracking-widest text-[#666] group-focus-within:text-[#171717] transition-colors flex items-center gap-2" htmlFor="password">
                <LockKeyhole size={14} /> Security Key
              </label>
              <input
                id="password"
                className="w-full bg-[#fcfcfc] border border-gray-200 rounded-lg px-4 py-3.5 text-[#171717] placeholder-[#666]/40 focus:outline-none focus:ring-2 focus:ring-[#FFBDE0]/50 focus:border-[#FFBDE0] transition-all font-medium"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-center gap-3 text-red-600 text-sm animate-in fade-in zoom-in-95 duration-200">
                <LockKeyhole size={16} className="text-red-500" />
                {error}
              </div>
            )}

            <button 
              className="w-full py-4 px-4 bg-[#5CB85C] hover:bg-[#4cae4c] text-white font-semibold rounded-lg shadow-[0_4px_14px_rgba(92,184,92,0.25)] hover:shadow-[0_6px_20px_rgba(92,184,92,0.35)] transition-all transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mt-4 flex items-center justify-center gap-2 tracking-wide" 
              disabled={loading}
            >
              <Sparkles size={18} className={loading ? "animate-spin" : ""} />
              {loading ? "Authenticating Session..." : "Initialize Session"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
