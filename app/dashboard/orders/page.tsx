"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardPlus, Sparkles } from "lucide-react";
import { PortalFrame } from "@/components/dashboard/PortalFrame";
import { BlockCard, BlockTitle } from "@/components/ui/blocks";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { getAlertTone } from "@/lib/alerts";
import { usePortalSession } from "@/lib/hooks/usePortalSession";

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const DEFAULT_VERIFICATION_COUNTRY = "Default";
const VERIFICATION_COUNTRY_OPTIONS = [
  DEFAULT_VERIFICATION_COUNTRY,
  "Afghanistan",
  "Armenia",
  "Australia",
  "Azerbaijan",
  "Bangladesh",
  "Bhutan",
  "Brunei",
  "Cambodia",
  "China",
  "Fiji",
  "Georgia",
  "Hong Kong",
  "India",
  "Indonesia",
  "Japan",
  "Kazakhstan",
  "Kiribati",
  "Kyrgyzstan",
  "Laos",
  "Macau",
  "Malaysia",
  "Maldives",
  "Marshall Islands",
  "Micronesia",
  "Mongolia",
  "Myanmar",
  "Nauru",
  "Nepal",
  "New Zealand",
  "Pakistan",
  "Palau",
  "Papua New Guinea",
  "Philippines",
  "Samoa",
  "Singapore",
  "Solomon Islands",
  "South Korea",
  "Sri Lanka",
  "Taiwan",
  "Tajikistan",
  "Thailand",
  "Timor-Leste",
  "Tonga",
  "Turkmenistan",
  "Tuvalu",
  "Uzbekistan",
  "Vanuatu",
  "Vietnam",
  "United Arab Emirates",
  "United States",
  "United Kingdom",
];

type OrderSubmissionPayload = {
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string;
  verificationCountry: string;
  selectedServiceIds: string[];
  serviceConfigs: Record<string, string>;
};

type DuplicateServiceMatch = {
  requestId: string;
  serviceId: string;
  serviceName: string;
  requestedByName: string;
  requestedAt: string;
  requestStatus: string;
};

type SubmitOrderResponse = {
  message?: string;
  error?: string;
  duplicateCheck?: {
    candidateEmail?: string;
    matches?: DuplicateServiceMatch[];
  };
};

function formatDuplicateRequestedAt(value: string) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "-";
  }

  return parsedDate.toLocaleString();
}

export default function OrdersPage() {
  const { me, loading, logout } = usePortalSession();
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidatePhone, setCandidatePhone] = useState("");
  const [verificationCountry, setVerificationCountry] = useState(DEFAULT_VERIFICATION_COUNTRY);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [serviceConfigs, setServiceConfigs] = useState<Record<string, string>>({});
  const [serviceSearch, setServiceSearch] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [duplicatePopupOpen, setDuplicatePopupOpen] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateServiceMatch[]>([]);
  const [pendingOrderPayload, setPendingOrderPayload] =
    useState<OrderSubmissionPayload | null>(null);
  const [continuingAfterDuplicateWarning, setContinuingAfterDuplicateWarning] = useState(false);

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

  const getIncludedServiceNames = useCallback(
    (service: { includedServiceIds?: string[]; includedServiceNames?: string[] }) => {
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
    },
    [serviceNameById],
  );

  const normalizedServiceSearch = serviceSearch.trim().toLowerCase();
  const filteredVisibleServices = useMemo(() => {
    if (!normalizedServiceSearch) {
      return visibleServices;
    }

    return visibleServices.filter((service) => {
      const includedServiceNamesText = getIncludedServiceNames(service)
        .join(" ")
        .toLowerCase();
      const searchableText = `${service.serviceName} ${includedServiceNamesText}`.toLowerCase();
      return searchableText.includes(normalizedServiceSearch);
    });
  }, [getIncludedServiceNames, normalizedServiceSearch, visibleServices]);

  if (loading || !me) {
    return (
      <LoadingScreen
        title="Loading order workspace..."
        subtitle="Preparing service order creation"
      />
    );
  }

  function resetOrderForm() {
    setCandidateName("");
    setCandidateEmail("");
    setCandidatePhone("");
    setVerificationCountry(DEFAULT_VERIFICATION_COUNTRY);
    setSelectedServiceIds([]);
    setServiceConfigs({});
  }

  async function submitOrderPayload(
    payload: OrderSubmissionPayload,
    allowDuplicateSubmission: boolean,
  ) {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        allowDuplicateSubmission,
      }),
    });

    let data: SubmitOrderResponse = {};
    try {
      data = (await res.json()) as SubmitOrderResponse;
    } catch {
      data = {};
    }

    return { res, data };
  }

  function closeDuplicatePopup() {
    if (continuingAfterDuplicateWarning) {
      return;
    }

    setDuplicatePopupOpen(false);
    setDuplicateMatches([]);
    setPendingOrderPayload(null);
  }

  async function continueWithDuplicateSubmission() {
    if (!pendingOrderPayload) {
      return;
    }

    setMessage("");
    setContinuingAfterDuplicateWarning(true);

    const { res, data } = await submitOrderPayload(pendingOrderPayload, true);

    setContinuingAfterDuplicateWarning(false);

    if (!res.ok) {
      setMessage(data.error ?? "Could not submit request.");
      return;
    }

    setDuplicatePopupOpen(false);
    setDuplicateMatches([]);
    setPendingOrderPayload(null);
    resetOrderForm();
    setMessage(data.message ?? "Request submitted.");
  }

  async function submitOrder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");
    setSubmitting(true);

    const payload: OrderSubmissionPayload = {
      candidateName,
      candidateEmail,
      candidatePhone,
      verificationCountry,
      selectedServiceIds,
      serviceConfigs,
    };

    const { res, data } = await submitOrderPayload(payload, false);
    setSubmitting(false);

    if (!res.ok) {
      const duplicateList = data.duplicateCheck?.matches ?? [];
      if (res.status === 409 && duplicateList.length > 0) {
        setPendingOrderPayload(payload);
        setDuplicateMatches(duplicateList);
        setDuplicatePopupOpen(true);
        setMessage(
          "Potential duplicate found for this candidate email. Review details before continuing.",
        );
        return;
      }

      setMessage(data.error ?? "Could not submit request.");
      return;
    }

    setDuplicatePopupOpen(false);
    setDuplicateMatches([]);
    setPendingOrderPayload(null);
    resetOrderForm();
    setMessage(data.message ?? "Request submitted.");
  }

  const submitBusy = submitting || continuingAfterDuplicateWarning;

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

            <div>
              <label className="label" htmlFor="verification-country">
                Verification Country
              </label>
              <select
                id="verification-country"
                className="input"
                value={verificationCountry}
                onChange={(e) => setVerificationCountry(e.target.value)}
                required
              >
                {VERIFICATION_COUNTRY_OPTIONS.map((country) => (
                  <option key={country} value={country}>
                    {country}
                  </option>
                ))}
              </select>
            </div>

            {visibleServices.length ? (
              <div style={{ marginTop: "1rem" }}>
                <label className="label">Select Services</label>
                <input
                  className="input"
                  placeholder="Search services by name"
                  value={serviceSearch}
                  onChange={(e) => setServiceSearch(e.target.value)}
                  style={{ marginTop: "0.5rem" }}
                />

                {filteredVisibleServices.length === 0 ? (
                  <div style={{ marginTop: "0.7rem", color: "#6B7280", fontSize: "0.9rem" }}>
                    No services match your search.
                  </div>
                ) : null}

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                    marginTop: "0.7rem",
                    maxHeight: "30rem",
                    overflowY: "auto",
                    paddingRight: "0.4rem",
                  }}
                >
                  {filteredVisibleServices.map((service) => (
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

            <button className="btn btn-primary" type="submit" disabled={submitBusy}>
              {submitBusy ? "Submitting..." : "Submit Verification Request"}
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

      {duplicatePopupOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.48)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            zIndex: 1000,
          }}
          onClick={closeDuplicatePopup}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Duplicate verification warning"
            style={{
              width: "min(860px, 100%)",
              maxHeight: "85vh",
              overflowY: "auto",
              backgroundColor: "#FFFFFF",
              borderRadius: "14px",
              border: "1px solid #E5E7EB",
              boxShadow: "0 24px 60px rgba(15, 23, 42, 0.24)",
              padding: "1rem 1rem 0.9rem",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#1F2937" }}>
              Potential Duplicate Verification Request
            </h2>

            <p style={{ marginTop: "0.65rem", marginBottom: "0.75rem", color: "#4B5563" }}>
              We found existing requests for this candidate email with the same service(s). Review the
              duplicate details below and choose whether to continue.
            </p>

            <div
              style={{
                border: "1px solid #E5E7EB",
                borderRadius: "10px",
                overflow: "hidden",
                maxHeight: "42vh",
                overflowY: "auto",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead>
                  <tr style={{ backgroundColor: "#F8FAFC", color: "#1F2937" }}>
                    <th style={{ textAlign: "left", padding: "0.6rem 0.7rem", fontWeight: 700 }}>
                      Service
                    </th>
                    <th style={{ textAlign: "left", padding: "0.6rem 0.7rem", fontWeight: 700 }}>
                      Requested By
                    </th>
                    <th style={{ textAlign: "left", padding: "0.6rem 0.7rem", fontWeight: 700 }}>
                      Requested On
                    </th>
                    <th style={{ textAlign: "left", padding: "0.6rem 0.7rem", fontWeight: 700 }}>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {duplicateMatches.map((match, index) => (
                    <tr
                      key={`${match.requestId}-${match.serviceId}-${index}`}
                      style={{ borderTop: "1px solid #E5E7EB" }}
                    >
                      <td style={{ padding: "0.62rem 0.7rem", color: "#111827" }}>
                        {match.serviceName}
                      </td>
                      <td style={{ padding: "0.62rem 0.7rem", color: "#111827" }}>
                        {match.requestedByName || "Unknown user"}
                      </td>
                      <td style={{ padding: "0.62rem 0.7rem", color: "#111827" }}>
                        {formatDuplicateRequestedAt(match.requestedAt)}
                      </td>
                      <td style={{ padding: "0.62rem 0.7rem", color: "#111827", textTransform: "capitalize" }}>
                        {match.requestStatus || "pending"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p style={{ marginTop: "0.78rem", marginBottom: "0.82rem", color: "#374151" }}>
              Do you want to continue and submit this verification request anyway?
            </p>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "0.55rem",
                paddingBottom: "0.05rem",
              }}
            >
              <button
                className="btn"
                type="button"
                onClick={closeDuplicatePopup}
                disabled={continuingAfterDuplicateWarning}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void continueWithDuplicateSubmission()}
                disabled={continuingAfterDuplicateWarning}
              >
                {continuingAfterDuplicateWarning ? "Submitting..." : "Continue Anyway"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PortalFrame>
  );
}

