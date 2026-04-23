import { Loader2 } from "lucide-react";

type LoadingScreenProps = {
  title?: string;
  subtitle?: string;
};

export function LoadingScreen({
  title = "Loading workspace...",
  subtitle = "Preparing your dashboard data",
}: LoadingScreenProps) {
  return (
    <main className="portal-shell" style={{ padding: "4rem 0" }}>
      <section
        className="glass-card"
        style={{
          maxWidth: "520px",
          margin: "0 auto",
          padding: "2rem 1.25rem",
          display: "grid",
          gap: "0.9rem",
          justifyItems: "center",
          textAlign: "center",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "999px",
            display: "grid",
            placeItems: "center",
            background:
              "radial-gradient(circle at 30% 30%, rgba(59,130,246,0.24), rgba(14,165,233,0.14))",
            boxShadow: "0 18px 42px rgba(15, 23, 42, 0.16)",
          }}
        >
          <Loader2 size={30} style={{ color: "#0F766E" }} className="animate-spin" />
        </div>

        <h2 style={{ margin: 0, color: "#0F172A", fontSize: "1.05rem" }}>{title}</h2>
        <p style={{ margin: 0, color: "#475569", fontSize: "0.9rem" }}>{subtitle}</p>

        <div
          aria-hidden="true"
          style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}
        >
          <span className="animate-pulse" style={{ width: "8px", height: "8px", borderRadius: "999px", background: "#0EA5E9", animationDelay: "0ms" }} />
          <span className="animate-pulse" style={{ width: "8px", height: "8px", borderRadius: "999px", background: "#0EA5E9", animationDelay: "180ms" }} />
          <span className="animate-pulse" style={{ width: "8px", height: "8px", borderRadius: "999px", background: "#0EA5E9", animationDelay: "360ms" }} />
        </div>
      </section>
    </main>
  );
}
