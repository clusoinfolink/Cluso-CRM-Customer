"use client";

import { FormEvent, useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ListChecks, Search, X } from "lucide-react";
import { PortalFrame } from "@/components/dashboard/PortalFrame";
import { BlockCard } from "@/components/ui/blocks";
import { getAlertTone } from "@/lib/alerts";
import { usePortalSession } from "@/lib/hooks/usePortalSession";
import { useRequestsData } from "@/lib/hooks/useRequestsData";
import { RequestItem, RequestStatus } from "@/lib/types";

function buildRejectedFieldKey(serviceId: string, question: string) {
  return `${serviceId}::${question.trim()}`;
}

function parseRejectedFieldKey(fieldKey: string) {
  const separatorIndex = fieldKey.indexOf("::");
  if (separatorIndex === -1) {
    return null;
  }

  const serviceId = fieldKey.slice(0, separatorIndex).trim();
  const question = fieldKey.slice(separatorIndex + 2).trim();
  if (!serviceId || !question) {
    return null;
  }

  return { serviceId, question };
}

function RequestsPageContent() {
  const { me, loading, logout } = usePortalSession();
  const searchParams = useSearchParams();
  const { items, loading: requestsLoading, refreshRequests } = useRequestsData();
  const [requestsReady, setRequestsReady] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [message, setMessage] = useState("");
  const [highlightedRequestId, setHighlightedRequestId] = useState("");
  const [activeResponseRequestId, setActiveResponseRequestId] = useState("");
  const [isRejectSelectorOpen, setIsRejectSelectorOpen] = useState(false);
  const [selectedRejectedFieldKeys, setSelectedRejectedFieldKeys] = useState<string[]>([]);
  const [rejectionComment, setRejectionComment] = useState("");
  const [rejectingRequestId, setRejectingRequestId] = useState("");

  const [editingRequestId, setEditingRequestId] = useState("");
  const [editCandidateName, setEditCandidateName] = useState("");
  const [editCandidateEmail, setEditCandidateEmail] = useState("");
  const [editCandidatePhone, setEditCandidatePhone] = useState("");
  const [editSelectedServiceIds, setEditSelectedServiceIds] = useState<string[]>([]);

  const focusRequestId = searchParams.get("requestId")?.trim() ?? "";

  useEffect(() => {
    if (!me) {
      return;
    }

    let active = true;

    (async () => {
      await refreshRequests(false);
      if (active) {
        setRequestsReady(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [me, refreshRequests]);

  const normalizedSearch = searchText.trim().toLowerCase();

  const filteredRequests = useMemo(() => {
    return items.filter((item) => {
      if (!normalizedSearch) {
        return true;
      }

      const searchable = [
        item.candidateName,
        item.candidateEmail,
        item.candidatePhone,
        item.status,
        item.rejectionNote,
        item.createdByName,
        item.delegateName,
        (item.selectedServices ?? []).map((service) => service.serviceName).join(" "),
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(normalizedSearch);
    });
  }, [items, normalizedSearch]);

  const pendingRequests = filteredRequests.filter((item) => item.status === "pending");
  const approvedRequests = filteredRequests.filter((item) => item.status === "approved");
  const rejectedRequests = filteredRequests.filter((item) => item.status === "rejected");

  useEffect(() => {
    if (!focusRequestId || items.length === 0) {
      return;
    }

    const targetRequest = items.find((item) => item._id === focusRequestId);
    if (!targetRequest) {
      return;
    }

    const stateUpdateTimer = window.setTimeout(() => {
      setSearchText("");
      setHighlightedRequestId(focusRequestId);
    }, 0);

    const scrollTimer = window.setTimeout(() => {
      document.getElementById(`request-${focusRequestId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 80);

    return () => {
      window.clearTimeout(stateUpdateTimer);
      window.clearTimeout(scrollTimer);
    };
  }, [focusRequestId, items]);

  const activeResponseRequest = useMemo(
    () => items.find((item) => item._id === activeResponseRequestId) ?? null,
    [activeResponseRequestId, items],
  );

  function closeResponseModal() {
    setActiveResponseRequestId("");
    setIsRejectSelectorOpen(false);
    setSelectedRejectedFieldKeys([]);
    setRejectionComment("");
  }

  function openRejectSelector(item: RequestItem) {
    const preselected = (item.customerRejectedFields ?? []).map((field) =>
      buildRejectedFieldKey(field.serviceId, field.question),
    );
    setSelectedRejectedFieldKeys(preselected);
    setRejectionComment("");
    setIsRejectSelectorOpen(true);
  }

  function toggleRejectedFieldSelection(fieldKey: string, checked: boolean) {
    setSelectedRejectedFieldKeys((prev) => {
      if (checked) {
        if (prev.includes(fieldKey)) {
          return prev;
        }

        return [...prev, fieldKey];
      }

      return prev.filter((key) => key !== fieldKey);
    });
  }

  async function submitSelectedFieldRejection() {
    if (!activeResponseRequest) {
      return;
    }

    const rejectedFields = selectedRejectedFieldKeys
      .map((fieldKey) => parseRejectedFieldKey(fieldKey))
      .filter((field): field is { serviceId: string; question: string } => Boolean(field));

    if (rejectedFields.length === 0) {
      setMessage("Please select at least one field to reject.");
      return;
    }

    setMessage("");
    setRejectingRequestId(activeResponseRequest._id);

    const res = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reject-candidate-data",
        requestId: activeResponseRequest._id,
        rejectedFields,
        rejectionComment,
      }),
    });

    const data = (await res.json()) as { message?: string; error?: string };
    setRejectingRequestId("");

    if (!res.ok) {
      setMessage(data.error ?? "Could not reject selected candidate data.");
      return;
    }

    setMessage(data.message ?? "Candidate data rejected and marked for correction.");
    closeResponseModal();
    await refreshRequests();
  }

  function startRejectedEdit(item: RequestItem) {
    setEditingRequestId(item._id);
    setEditCandidateName(item.candidateName);
    setEditCandidateEmail(item.candidateEmail);
    setEditCandidatePhone(item.candidatePhone || "");
    setEditSelectedServiceIds((item.selectedServices ?? []).map((service) => String(service.serviceId)));
    setMessage("");

    window.setTimeout(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 0);
  }

  function cancelRejectedEdit() {
    setEditingRequestId("");
    setEditCandidateName("");
    setEditCandidateEmail("");
    setEditCandidatePhone("");
    setEditSelectedServiceIds([]);
  }

  function toggleEditServiceSelection(serviceId: string, checked: boolean) {
    setEditSelectedServiceIds((prev) => {
      if (checked) {
        if (prev.includes(serviceId)) {
          return prev;
        }
        return [...prev, serviceId];
      }

      return prev.filter((id) => id !== serviceId);
    });
  }

  async function submitRejectedEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!editingRequestId) {
      return;
    }

    setMessage("");

    const res = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: editingRequestId,
        candidateName: editCandidateName,
        candidateEmail: editCandidateEmail,
        candidatePhone: editCandidatePhone,
        selectedServiceIds: editSelectedServiceIds,
      }),
    });

    const data = (await res.json()) as { message?: string; error?: string };
    if (!res.ok) {
      setMessage(data.error ?? "Could not update rejected request.");
      return;
    }

    setMessage(data.message ?? "Rejected request updated and resubmitted.");
    cancelRejectedEdit();
    await refreshRequests();
  }

  function renderResponseContent(item: RequestItem) {
    const serviceResponses = item.candidateFormResponses ?? [];
    const totalServices = serviceResponses.length;
    const totalFields = serviceResponses.reduce(
      (count, serviceResponse) => count + serviceResponse.answers.length,
      0,
    );

    if (serviceResponses.length === 0) {
      return <p style={{ margin: 0, color: "#667892" }}>Candidate has not submitted form responses yet.</p>;
    }

    return (
      <div style={{ display: "grid", gap: "0.85rem" }}>
        <div
          style={{
            border: "1px solid #DDE5EF",
            borderRadius: "10px",
            background: "#F6FAFF",
            padding: "0.7rem 0.8rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "0.65rem",
          }}
        >
          <div>
            <div style={{ color: "#667892", fontSize: "0.8rem", fontWeight: 600 }}>Total Services</div>
            <div style={{ color: "#1F3552", fontSize: "1rem", fontWeight: 800 }}>{totalServices}</div>
          </div>
          <div>
            <div style={{ color: "#667892", fontSize: "0.8rem", fontWeight: 600 }}>Total Fields</div>
            <div style={{ color: "#1F3552", fontSize: "1rem", fontWeight: 800 }}>{totalFields}</div>
          </div>
          <div>
            <div style={{ color: "#667892", fontSize: "0.8rem", fontWeight: 600 }}>Submitted At</div>
            <div style={{ color: "#1F3552", fontSize: "0.95rem", fontWeight: 700 }}>
              {item.candidateSubmittedAt ? new Date(item.candidateSubmittedAt).toLocaleString() : "-"}
            </div>
          </div>
        </div>

        {serviceResponses.map((serviceResponse) => (
          <section
            key={`${item._id}-${serviceResponse.serviceId}`}
            style={{
              border: "1px solid #DDE5EF",
              borderRadius: "10px",
              padding: "0.7rem",
              background: "#FFFFFF",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.7rem", flexWrap: "wrap" }}>
              <strong style={{ color: "#2D405E", fontSize: "0.95rem" }}>{serviceResponse.serviceName}</strong>
              <span
                style={{
                  border: "1px solid #DDE5EF",
                  borderRadius: "999px",
                  padding: "0.15rem 0.55rem",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  color: "#4A5E79",
                  background: "#F8FAFD",
                }}
              >
                {serviceResponse.answers.length} fields
              </span>
            </div>

            <div style={{ marginTop: "0.55rem" }}>
              {serviceResponse.answers.length === 0 ? (
                <span style={{ color: "#667892" }}>No answers available.</span>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", minWidth: "600px", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #E6ECF3", textAlign: "left" }}>
                        <th style={{ padding: "0.5rem 0.45rem", color: "#667892", fontSize: "0.78rem" }}>Field</th>
                        <th style={{ padding: "0.5rem 0.45rem", color: "#667892", fontSize: "0.78rem" }}>Submitted Value</th>
                        <th style={{ padding: "0.5rem 0.45rem", color: "#667892", fontSize: "0.78rem" }}>Attachment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {serviceResponse.answers.map((answer, answerIndex) => {
                        const valueText =
                          answer.fieldType === "file"
                            ? answer.fileName || "File uploaded"
                            : answer.value || "-";

                        return (
                          <tr key={`${serviceResponse.serviceId}-${answerIndex}`} style={{ borderBottom: "1px solid #F0F3F8" }}>
                            <td style={{ padding: "0.55rem 0.45rem", fontWeight: 600, color: "#2D405E" }}>{answer.question}</td>
                            <td style={{ padding: "0.55rem 0.45rem", color: "#334A67", maxWidth: "300px" }}>
                              <span style={{ whiteSpace: answer.fieldType === "long_text" ? "pre-wrap" : "normal", wordBreak: "break-word" }}>
                                {valueText}
                              </span>
                            </td>
                            <td style={{ padding: "0.55rem 0.45rem" }}>
                              {answer.fieldType === "file" && answer.fileData ? (
                                <a
                                  href={answer.fileData}
                                  download={answer.fileName || `attachment-${answerIndex}`}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    border: "1px solid #C9D9EE",
                                    borderRadius: "8px",
                                    padding: "0.32rem 0.58rem",
                                    color: "#2D5F99",
                                    background: "#EEF4FF",
                                    fontWeight: 700,
                                    fontSize: "0.78rem",
                                    textDecoration: "none",
                                  }}
                                >
                                  Download
                                </a>
                              ) : (
                                <span style={{ color: "#95A2B5" }}>-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    );
  }

  function renderRequestSection(
    title: string,
    itemsByStatus: RequestItem[],
    statusType: RequestStatus,
    emptyMessage: string,
  ) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 className="text-lg font-bold text-slate-800 m-0 flex items-center gap-2">
            {title}
            <span className="bg-blue-100/50 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">
              {itemsByStatus.length}
            </span>
          </h3>
        </div>

        {itemsByStatus.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm italic">
            {emptyMessage}
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase text-xs font-semibold tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Candidate</th>
                  <th className="px-5 py-3.5">Contact</th>
                  <th className="px-5 py-3.5">Services</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5">Timeline</th>
                  <th className="px-5 py-3.5">Team</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {itemsByStatus.map((item) => {
                  const hasResponses = Boolean(item.candidateFormResponses && item.candidateFormResponses.length > 0);
                  const formSubmitted = item.candidateFormStatus === "submitted";

                  return (
                    <tr
                      key={`${statusType}-${item._id}`}
                      id={`request-${item._id}`}
                      className={`hover:bg-slate-50/80 transition-colors ${highlightedRequestId === item._id ? "bg-blue-50/40" : ""}`}
                    >
                      <td className="px-5 py-4">
                        <div className="font-bold text-slate-800">{item.candidateName}</div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-slate-700 font-medium">{item.candidateEmail || "-"}</div>
                        <div className="text-slate-500 text-xs mt-0.5">{item.candidatePhone || "-"}</div>
                      </td>
                      <td className="px-5 py-4 max-w-[200px] whitespace-normal">
                        <div className="flex flex-wrap gap-1">
                          {item.selectedServices && item.selectedServices.length > 0
                            ? item.selectedServices.map((service, idx) => (
                                <span key={idx} className="inline-flex bg-slate-100 border border-slate-200 text-slate-600 text-xs px-2 py-0.5 rounded-md">
                                  {service.serviceName}
                                </span>
                              ))
                            : <span className="text-slate-400">-</span>}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div>
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold capitalize ${
                            item.status === 'approved' ? 'bg-green-100 text-green-700 border border-green-200' :
                            item.status === 'rejected' ? 'bg-red-100 text-red-700 border border-red-200' :
                            'bg-yellow-100 text-yellow-700 border border-yellow-200'
                          }`}>
                            {item.status}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5 text-xs font-medium">
                           <span className={`w-1.5 h-1.5 rounded-full ${formSubmitted ? "bg-green-500" : "bg-orange-400"}`}></span>
                           <span className={formSubmitted ? "text-green-700" : "text-orange-600"}>
                             {formSubmitted ? "Form Submitted" : "Pending Form"}
                           </span>
                        </div>
                        {item.rejectionNote && (
                          <div className="mt-2 text-xs text-red-600 font-medium max-w-[180px] whitespace-normal">
                             <strong className="text-red-700 block">Admin Note:</strong>
                             {item.rejectionNote}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-xs text-slate-500">
                          <span className="font-semibold text-slate-700">Created: </span> 
                          {new Date(item.createdAt).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          <span className="font-semibold text-slate-700">Submitted: </span> 
                          {item.candidateSubmittedAt ? new Date(item.candidateSubmittedAt).toLocaleDateString() : "-"}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-xs">
                          <span className="font-semibold text-slate-700">By:</span> {item.createdByName || "Unknown"}
                        </div>
                        {item.delegateName && (
                          <div className="text-xs mt-1">
                             <span className="font-semibold text-slate-700">Del:</span> {item.delegateName}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                         <div className="flex flex-col items-end gap-2">
                           <button
                             type="button"
                             className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm ${
                               hasResponses
                                 ? "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:text-blue-600 focus:ring-2 focus:ring-blue-100"
                                 : "bg-slate-50 border border-slate-200 text-slate-400 cursor-not-allowed"
                             }`}
                             onClick={() => {
                               setActiveResponseRequestId(item._id);
                               setIsRejectSelectorOpen(false);
                               setSelectedRejectedFieldKeys([]);
                               setRejectionComment("");
                             }}
                             disabled={!hasResponses}
                           >
                             {hasResponses ? "Review Data" : "No Data Yet"}
                           </button>

                           {statusType === "rejected" && (
                             <button 
                               className="px-3 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100" 
                               type="button" 
                               onClick={() => startRejectedEdit(item)}
                             >
                               Edit & Resubmit
                             </button>
                           )}
                         </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (loading || requestsLoading || !me || !requestsReady) {
    return (
      <main className="portal-shell">
        <BlockCard tone="muted">
          <p className="block-subtitle">Loading request workspace...</p>
        </BlockCard>
      </main>
    );
  }

  return (
    <PortalFrame
      me={me}
      onLogout={logout}
      title="Request Tracking"
      subtitle="Tabular request workspace with quicker review and less scrolling."
    >
      {message ? <p className={`inline-alert ${getAlertTone(message)}`}>{message}</p> : null}

      {editingRequestId ? (
        <BlockCard interactive>
          <form onSubmit={submitRejectedEdit} className="request-edit-form">
            <strong>Edit Rejected Request</strong>

            <div>
              <label className="label">Candidate Name</label>
              <input
                className="input"
                value={editCandidateName}
                onChange={(e) => setEditCandidateName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label">Email ID</label>
              <input
                className="input"
                type="email"
                value={editCandidateEmail}
                onChange={(e) => setEditCandidateEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label">Phone Number (Optional)</label>
              <input
                className="input"
                value={editCandidatePhone}
                onChange={(e) => setEditCandidatePhone(e.target.value)}
              />
            </div>

            {me.availableServices.length ? (
              <div>
                <label className="label">Select Services</label>
                <div className="service-check-grid">
                  {me.availableServices.map((service) => (
                    <label key={`edit-${service.serviceId}`} className="service-check">
                      <input
                        type="checkbox"
                        checked={editSelectedServiceIds.includes(service.serviceId)}
                        onChange={(e) => toggleEditServiceSelection(service.serviceId, e.target.checked)}
                      />
                      <span>
                        <strong>{service.serviceName}</strong>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="card-controls">
              <button className="btn btn-primary" type="submit">
                Save and Resubmit
              </button>
              <button className="btn btn-secondary" type="button" onClick={cancelRejectedEdit}>
                Cancel
              </button>
            </div>
          </form>
        </BlockCard>
      ) : null}

      <BlockCard className="request-toolbar border border-gray-100 shadow-sm rounded-xl overflow-hidden mb-6" interactive>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 lg:p-6 bg-white">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <ListChecks size={20} />
              </span>
              <h2 className="text-xl font-bold text-slate-800">Submitted Requests</h2>
              <span className="ml-2 px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-semibold rounded-full border border-slate-200">
                Table View
              </span>
            </div>
            <p className="text-slate-500 text-sm mt-1 ml-11">
              Search and monitor requests across pending, approved, and rejected states.
            </p>
          </div>

          <div className="relative w-full md:w-80 lg:w-96">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search size={18} />
            </div>
            <input
              type="text"
              className="block w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all duration-200"
              placeholder="Search by candidate, email, phone..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
        </div>
      </BlockCard>

      <div className="flex flex-col gap-6">
        {renderRequestSection("Pending Requests", pendingRequests, "pending", "No pending requests currently actively waiting.")}
        {renderRequestSection("Approved Requests", approvedRequests, "approved", "No approved requests found.")}
        {renderRequestSection("Rejected Requests", rejectedRequests, "rejected", "No rejected requests requiring action.")}
      </div>

      {activeResponseRequest ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Candidate responses"
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[1200] flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[86vh] overflow-y-auto p-6 relative">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xl font-bold text-slate-800 m-0">Candidate Responses</h3>
                <p className="mt-1 text-slate-600 font-medium whitespace-normal">
                  {activeResponseRequest.candidateName} <span className="text-slate-400 mx-1">•</span> {activeResponseRequest.candidateEmail}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-500 flex items-center gap-1.5 whitespace-normal">
                  <span className={`w-1.5 h-1.5 rounded-full ${activeResponseRequest.candidateFormStatus === "submitted" ? "bg-green-500" : "bg-orange-400"}`}></span>
                  Status: {activeResponseRequest.candidateFormStatus === "submitted" ? "Submitted" : "Pending"}
                </p>
              </div>
              <button 
                type="button" 
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors" 
                onClick={closeResponseModal}
              >
                <X size={20} />
              </button>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              {renderResponseContent(activeResponseRequest)}
            </div>

            <div className="flex justify-end gap-3 mt-6 flex-wrap">
              <button
                type="button"
                className="px-4 py-2 bg-white border border-red-200 text-red-600 font-semibold rounded-lg hover:bg-red-50 hover:text-red-700 transition-colors focus:ring-2 focus:ring-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => openRejectSelector(activeResponseRequest)}
                disabled={Boolean(
                  !activeResponseRequest.candidateFormResponses ||
                    activeResponseRequest.candidateFormResponses.length === 0,
                )}
              >
                Reject Candidate Data
              </button>
            </div>

            {isRejectSelectorOpen && (
              <section className="mt-6 pt-6 border-t border-slate-200 grid gap-5">
                <div>
                  <strong className="text-lg text-slate-800">Select data to reject</strong>
                  <p className="mt-1 text-sm text-slate-500">
                    Choose the exact fields the candidate needs to correct.
                  </p>
                </div>

                <div className="grid gap-4 max-h-[36vh] overflow-y-auto pr-2 custom-scrollbar">
                  {(activeResponseRequest.candidateFormResponses ?? []).map((serviceResponse) => (
                    <fieldset
                      key={`${activeResponseRequest._id}-${serviceResponse.serviceId}`}
                      className="border border-slate-200 rounded-xl p-4 m-0 grid gap-3 bg-white shadow-sm"
                    >
                      <legend className="font-bold text-slate-800 px-2 text-sm bg-white">
                        {serviceResponse.serviceName}
                      </legend>

                      {serviceResponse.answers.length === 0 ? (
                        <span className="text-slate-500 text-sm">No answer fields available.</span>
                      ) : (
                        serviceResponse.answers.map((answer, answerIndex) => {
                          const fieldKey = buildRejectedFieldKey(serviceResponse.serviceId, answer.question);
                          const isChecked = selectedRejectedFieldKeys.includes(fieldKey);
                          const answerPreview =
                            answer.fieldType === "file"
                              ? answer.fileName || "File uploaded"
                              : answer.value || "-";

                          return (
                            <label
                              key={`${serviceResponse.serviceId}-${answerIndex}`}
                              className="flex gap-3 items-start p-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors"
                            >
                              <input
                                type="checkbox"
                                className="mt-1 w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                                checked={isChecked}
                                onChange={(e) => toggleRejectedFieldSelection(fieldKey, e.target.checked)}
                              />
                              <div className="grid gap-0.5">
                                <span className="font-semibold text-slate-700 text-sm">{answer.question}</span>
                                <span className="text-slate-500 text-xs break-words">{answerPreview}</span>
                              </div>
                            </label>
                          );
                        })
                      )}
                    </fieldset>
                  ))}
                </div>

                <div className="grid gap-2 mt-2">
                  <label className="text-sm font-semibold text-slate-700" htmlFor="rejection-comment">
                    Additional note (optional)
                  </label>
                  <textarea
                    id="rejection-comment"
                    className="w-full p-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                    rows={3}
                    placeholder="Add extra instructions for candidate corrections"
                    value={rejectionComment}
                    onChange={(e) => setRejectionComment(e.target.value)}
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors focus:ring-2 focus:ring-red-200 disabled:opacity-50"
                    onClick={submitSelectedFieldRejection}
                    disabled={rejectingRequestId === activeResponseRequest._id}
                  >
                    {rejectingRequestId === activeResponseRequest._id ? "Rejecting..." : "Confirm Rejection"}
                  </button>
                  <button
                    type="button"
                    className="px-4 py-2 bg-white border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                    onClick={() => setIsRejectSelectorOpen(false)}
                    disabled={rejectingRequestId === activeResponseRequest._id}
                  >
                    Cancel
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      ) : null}
    </PortalFrame>
  );
}

export default function RequestsPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="text-slate-500 font-medium flex items-center gap-2">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          Loading workspace...
        </div>
      </main>
    }>
      <RequestsPageContent />
    </Suspense>
  );
}
