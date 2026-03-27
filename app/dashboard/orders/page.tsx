"use client";

import { FormEvent, useState } from "react";
import { ClipboardPlus, Sparkles } from "lucide-react";
import { PortalFrame } from "@/components/dashboard/PortalFrame";
import { BlockCard, BlockTitle } from "@/components/ui/blocks";
import { getAlertTone } from "@/lib/alerts";
import { usePortalSession } from "@/lib/hooks/usePortalSession";

export default function OrdersPage() {
  const { me, loading, logout } = usePortalSession();
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidatePhone, setCandidatePhone] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading || !me) {
    return (
      <main className="portal-shell">
        <BlockCard tone="muted">
          <p className="block-subtitle">Loading order workspace...</p>
        </BlockCard>
      </main>
    );
  }

  function toggleServiceSelection(serviceId: string, checked: boolean) {
    setSelectedServiceIds((prev) => {
      if (checked) {
        if (prev.includes(serviceId)) {
          return prev;
        }
        return [...prev, serviceId];
      }
      return prev.filter((id) => id !== serviceId);
    });
  }

  async function submitOrder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");
    setSubmitting(true);

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateName, candidateEmail, candidatePhone, selectedServiceIds }),
    });

    const data = (await res.json()) as { message?: string; error?: string };
    setSubmitting(false);

    if (!res.ok) {
      setMessage(data.error ?? "Could not submit request.");
      return;
    }

    setCandidateName("");
    setCandidateEmail("");
    setCandidatePhone("");
    setSelectedServiceIds([]);
    setMessage(data.message ?? "Request submitted.");
  }

  return (
    <PortalFrame
      me={me}
      onLogout={logout}
      title="Orders Workspace"
      subtitle="Submit requests in a focused form without extra distractions."
    >
      {message ? <p className={`inline-alert ${getAlertTone(message)}`}>{message}</p> : null}

      <section className="dashboard-grid">
        <BlockCard as="article" interactive>
          <BlockTitle
            icon={<ClipboardPlus size={14} />}
            title="New Verification Order"
            subtitle="Fill candidate details, choose services, and submit."
          />

          <form onSubmit={submitOrder} className="form-grid">
            <div>
              <label className="label" htmlFor="candidate-name">
                Candidate Name
              </label>
              <input
                id="candidate-name"
                className="input"
                value={candidateName}
                onChange={(e) => setCandidateName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="candidate-phone">
                Phone Number (Optional)
              </label>
              <input
                id="candidate-phone"
                className="input"
                value={candidatePhone}
                onChange={(e) => setCandidatePhone(e.target.value)}
              />
            </div>

            <div>
              <label className="label" htmlFor="candidate-email">
                Email ID
              </label>
              <input
                id="candidate-email"
                className="input"
                type="email"
                value={candidateEmail}
                onChange={(e) => setCandidateEmail(e.target.value)}
                required
              />
            </div>

            {me.availableServices.length ? (
              <div>
                <label className="label">Select Services</label>
                <div className="service-check-grid">
                  {me.availableServices.map((service) => (
                    <label key={service.serviceId} className="service-check">
                      <input
                        type="checkbox"
                        checked={selectedServiceIds.includes(service.serviceId)}
                        onChange={(e) => toggleServiceSelection(service.serviceId, e.target.checked)}
                      />
                      <span>
                        <strong>{service.serviceName}</strong>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="inline-alert inline-alert-warning">
                No services are assigned to your company. Ask admin to assign services.
              </p>
            )}

            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Verification Request"}
            </button>
          </form>
        </BlockCard>

        <BlockCard as="article" tone="muted" interactive>
          <BlockTitle
            icon={<Sparkles size={14} />}
            title="Flow Tip"
            subtitle="Use this sequence for faster completion and fewer mistakes."
          />
          <ol className="flow-list">
            <li>Enter candidate details first.</li>
            <li>Select only required services.</li>
            <li>Submit and review status from Requests page.</li>
          </ol>
        </BlockCard>
      </section>
    </PortalFrame>
  );
}
