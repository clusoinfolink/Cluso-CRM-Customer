"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ClipboardPlus, Sparkles } from "lucide-react";
import { PortalFrame } from "@/components/dashboard/PortalFrame";
import { BlockCard, BlockTitle } from "@/components/ui/blocks";
import { getAlertTone } from "@/lib/alerts";
import { usePortalSession } from "@/lib/hooks/usePortalSession";

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

export default function OrdersPage() {
  const { me, loading, logout } = usePortalSession();
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidatePhone, setCandidatePhone] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [serviceConfigs, setServiceConfigs] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const availableServices = useMemo(() => me?.availableServices ?? [], [me?.availableServices]);
  const serviceNameById = useMemo(
    () => new Map(availableServices.map((service) => [service.serviceId, service.serviceName])),
    [availableServices],
  );
  const serviceIdsCoveredByPackages = useMemo(
    () =>
      new Set(
        availableServices.flatMap((service) =>
          service.isPackage ? service.includedServiceIds ?? [] : [],
        ),
      ),
    [availableServices],
  );

  const visibleServices = useMemo(
    () =>
      availableServices.filter(
        (service) => service.isPackage || !serviceIdsCoveredByPackages.has(service.serviceId),
      ),
    [availableServices, serviceIdsCoveredByPackages],
  );

  useEffect(() => {
    const visibleIds = new Set(visibleServices.map((service) => service.serviceId));

    const timer = window.setTimeout(() => {
      setSelectedServiceIds((prev) => prev.filter((serviceId) => visibleIds.has(serviceId)));
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [visibleServices]);

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

  function handleConfigChange(serviceId: string, val: string) {
    setServiceConfigs((prev) => ({ ...prev, [serviceId]: val }));
  }

  function getIncludedServiceNames(service: {
    includedServiceIds?: string[];
    includedServiceNames?: string[];
  }) {
    const explicitNames = (service.includedServiceNames ?? [])
      .map((name) => name.trim())
      .filter((name) => name.length > 0);

    if (explicitNames.length > 0) {
      return [...new Set(explicitNames)];
    }

    const resolvedNames = (service.includedServiceIds ?? [])
      .map((includedServiceId) => {
        const mappedName = serviceNameById.get(includedServiceId);
        if (mappedName) {
          return mappedName.trim();
        }

        if (OBJECT_ID_PATTERN.test(includedServiceId)) {
          return null;
        }

        const fallbackName = includedServiceId.trim();
        return fallbackName.length > 0 ? fallbackName : null;
      })
      .filter((name): name is string => Boolean(name));

    return [...new Set(resolvedNames)];
  }

  async function submitOrder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");
    setSubmitting(true);

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        candidateName, 
        candidateEmail, 
        candidatePhone, 
        selectedServiceIds,
        serviceConfigs 
      }),
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
    setServiceConfigs({});
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

            {visibleServices.length ? (
              <div style={{ marginTop: "1rem" }}>
                <label className="label">Select Services</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
                  {visibleServices.map((service) => (
                    (() => {
                      const includedServiceNames = getIncludedServiceNames(service);

                      return (
                    <div 
                      key={service.serviceId} 
                      style={{ 
                        border: "1px solid #E5E7EB", 
                        borderRadius: "0.5rem", 
                        padding: "1rem", 
                        backgroundColor: "#FFFFFF",
                        boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
                        transition: "border-color 0.15s ease-in-out"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.borderColor = "#93C5FD"}
                      onMouseLeave={(e) => e.currentTarget.style.borderColor = "#E5E7EB"}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
                        <label style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", cursor: "pointer", flex: 1 }}>
                          <input
                            type="checkbox"
                            style={{ marginTop: "0.25rem" }}
                            checked={selectedServiceIds.includes(service.serviceId)}
                            onChange={(e) => toggleServiceSelection(service.serviceId, e.target.checked)}
                          />
                          <div>
                            <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: "0.5rem", color: "#111827" }}>
                              {service.serviceName}
                              {service.isPackage ? (
                                <span style={{ backgroundColor: "#DBEAFE", color: "#1D4ED8", fontSize: "0.75rem", padding: "0.125rem 0.375rem", borderRadius: "0.25rem", fontWeight: 700 }}>
                                  PACKAGE
                                </span>
                              ) : null}
                            </div>
                            
                            {service.isPackage && includedServiceNames.length > 0 ? (
                              <div style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#4B5563" }}>
                                <span style={{ fontWeight: 500 }}>Included Services:</span>
                                <ul style={{ listStyleType: "disc", paddingLeft: "1.25rem", marginTop: "0.25rem" }}>
                                  {includedServiceNames.map((name) => (
                                    <li key={`${service.serviceId}-${name}`}>{name}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </div>
                        </label>
                        
                        {selectedServiceIds.includes(service.serviceId) && (
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
                            <label htmlFor={`years-${service.serviceId}`} style={{ color: "#4B5563", whiteSpace: "nowrap" }}>Duration:</label>
                            <select 
                              id={`years-${service.serviceId}`}
                              style={{ 
                                border: "1px solid #D1D5DB", 
                                borderRadius: "0.375rem", 
                                padding: "0.25rem 0.5rem", 
                                backgroundColor: "#F9FAFB", 
                                color: "#1F2937",
                                outline: "none"
                              }}
                              value={serviceConfigs[service.serviceId] || "default"}
                              onChange={(e) => handleConfigChange(service.serviceId, e.target.value)}
                            >
                              <option value="default">Default</option>
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                                <option key={num} value={`${num} year${num > 1 ? 's' : ''}`}>
                                  {num} {num > 1 ? 'years' : 'year'}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                      );
                    })()
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

