"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ChevronDown, ListChecks, Search } from "lucide-react";
import { PortalFrame } from "@/components/dashboard/PortalFrame";
import { BlockCard, BlockTitle } from "@/components/ui/blocks";
import { getAlertTone } from "@/lib/alerts";
import { usePortalSession } from "@/lib/hooks/usePortalSession";
import { useRequestsData } from "@/lib/hooks/useRequestsData";
import { RequestItem, RequestStatus } from "@/lib/types";

type RequestSectionProps = {
  title: string;
  items: RequestItem[];
  statusType: RequestStatus;
  emptyMessage: string;
  collapsed: boolean;
  onToggleSection: (status: RequestStatus) => void;
  expandedRequestIds: Record<string, boolean>;
  onToggleExpand: (id: string) => void;
  editingRequestId: string;
  onStartRejectedEdit: (item: RequestItem) => void;
  editForm: {
    candidateName: string;
    candidateEmail: string;
    candidatePhone: string;
    selectedServiceIds: string[];
  };
  onEditFieldChange: (field: "candidateName" | "candidateEmail" | "candidatePhone", value: string) => void;
  onToggleEditService: (serviceId: string, checked: boolean) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  availableServices: { serviceId: string; serviceName: string }[];
};

function RequestSection({
  title,
  items,
  statusType,
  emptyMessage,
  collapsed,
  onToggleSection,
  expandedRequestIds,
  onToggleExpand,
  editingRequestId,
  onStartRejectedEdit,
  editForm,
  onEditFieldChange,
  onToggleEditService,
  onCancelEdit,
  onSubmitEdit,
  availableServices,
}: RequestSectionProps) {
  return (
    <BlockCard interactive>
      <button
        type="button"
        className="request-panel-header"
        onClick={() => onToggleSection(statusType)}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
      >
        <h3 className="request-panel-title">
          {title} ({items.length})
        </h3>
        <span className={`request-panel-arrow ${collapsed ? "collapsed" : ""}`} aria-hidden="true">
          <ChevronDown size={18} />
        </span>
      </button>

      {!collapsed && statusType === "rejected" && editingRequestId ? (
        <form onSubmit={onSubmitEdit} className="request-edit-form">
          <strong>Edit Rejected Request</strong>
          <div>
            <label className="label">Candidate Name</label>
            <input
              className="input"
              value={editForm.candidateName}
              onChange={(e) => onEditFieldChange("candidateName", e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Email ID</label>
            <input
              className="input"
              type="email"
              value={editForm.candidateEmail}
              onChange={(e) => onEditFieldChange("candidateEmail", e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Phone Number (Optional)</label>
            <input
              className="input"
              value={editForm.candidatePhone}
              onChange={(e) => onEditFieldChange("candidatePhone", e.target.value)}
            />
          </div>
          {availableServices.length ? (
            <div>
              <label className="label">Select Services</label>
              <div className="service-check-grid">
                {availableServices.map((service) => (
                  <label key={`edit-${service.serviceId}`} className="service-check">
                    <input
                      type="checkbox"
                      checked={editForm.selectedServiceIds.includes(service.serviceId)}
                      onChange={(e) => onToggleEditService(service.serviceId, e.target.checked)}
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
            <button className="btn btn-secondary" type="button" onClick={onCancelEdit}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {!collapsed && items.length === 0 ? <p className="block-subtitle">{emptyMessage}</p> : null}

      {!collapsed && items.length > 0 ? (
        <div className="request-accordion-list">
          {items.map((item) => {
            const expanded = Boolean(expandedRequestIds[item._id]);

            return (
              <article key={item._id} className="request-accordion-item">
                <button
                  type="button"
                  className="request-accordion-toggle"
                  onClick={() => onToggleExpand(item._id)}
                >
                  <div className="request-accordion-main">
                    <div className="request-accordion-candidate">{item.candidateName}</div>
                    <div className={`status-pill request-accordion-status status-pill-${item.status}`} style={{ textTransform: "capitalize" }}>
                      {item.status}
                    </div>
                  </div>
                  <span className={`request-accordion-arrow ${expanded ? "expanded" : ""}`}>
                    <ChevronDown size={16} />
                  </span>
                </button>

                {expanded ? (
                  <div className="request-accordion-details">
                    <div className="request-square-label">Email</div>
                    <div className="request-square-value">{item.candidateEmail}</div>

                    <div className="request-square-label">Phone</div>
                    <div className="request-square-value">{item.candidatePhone || "-"}</div>

                    <div className="request-square-label">Admin Note</div>
                    <div className="request-square-value">
                      {item.status === "rejected" ? item.rejectionNote || "Rejected by admin" : "-"}
                    </div>

                    <div className="request-square-label">Created</div>
                    <div className="request-square-value">{new Date(item.createdAt).toLocaleString()}</div>

                    <div className="request-square-label">Submitted By</div>
                    <div className="request-square-value">{item.createdByName || "Unknown"}</div>

                    <div className="request-square-label">Delegate Name</div>
                    <div className="request-square-value">{item.delegateName || "-"}</div>

                    <div className="request-square-label">Services</div>
                    <div className="request-square-value">
                      {item.selectedServices && item.selectedServices.length > 0
                        ? item.selectedServices.map((service) => service.serviceName).join(", ")
                        : "-"}
                    </div>

                    {statusType === "rejected" ? (
                      <div className="card-controls">
                        <button className="btn btn-secondary" type="button" onClick={() => onStartRejectedEdit(item)}>
                          Edit and Resubmit
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </BlockCard>
  );
}

export default function RequestsPage() {
  const { me, loading, logout } = usePortalSession();
  const { items, loading: requestsLoading, refreshRequests } = useRequestsData();
  const [requestsReady, setRequestsReady] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [message, setMessage] = useState("");
  const [expandedRequestIds, setExpandedRequestIds] = useState<Record<string, boolean>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<RequestStatus, boolean>>({
    pending: false,
    approved: false,
    rejected: false,
  });

  const [editingRequestId, setEditingRequestId] = useState("");
  const [editCandidateName, setEditCandidateName] = useState("");
  const [editCandidateEmail, setEditCandidateEmail] = useState("");
  const [editCandidatePhone, setEditCandidatePhone] = useState("");
  const [editSelectedServiceIds, setEditSelectedServiceIds] = useState<string[]>([]);

  useEffect(() => {
    if (!me) {
      return;
    }

    let active = true;

    (async () => {
      await refreshRequests();
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

      const searchable = [item.candidateName, item.candidateEmail, item.candidatePhone, item.status, item.rejectionNote]
        .join(" ")
        .toLowerCase();

      return searchable.includes(normalizedSearch);
    });
  }, [items, normalizedSearch]);

  const pendingRequests = filteredRequests.filter((item) => item.status === "pending");
  const approvedRequests = filteredRequests.filter((item) => item.status === "approved");
  const rejectedRequests = filteredRequests.filter((item) => item.status === "rejected");

  function toggleRequestExpand(requestId: string) {
    setExpandedRequestIds((prev) => ({
      ...prev,
      [requestId]: !prev[requestId],
    }));
  }

  function toggleRequestSection(statusType: RequestStatus) {
    setCollapsedSections((prev) => ({
      ...prev,
      [statusType]: !prev[statusType],
    }));
  }

  function startRejectedEdit(item: RequestItem) {
    setEditingRequestId(item._id);
    setEditCandidateName(item.candidateName);
    setEditCandidateEmail(item.candidateEmail);
    setEditCandidatePhone(item.candidatePhone || "");
    setEditSelectedServiceIds((item.selectedServices ?? []).map((service) => String(service.serviceId)));
    setMessage("");
  }

  function cancelRejectedEdit() {
    setEditingRequestId("");
    setEditCandidateName("");
    setEditCandidateEmail("");
    setEditCandidatePhone("");
    setEditSelectedServiceIds([]);
  }

  function onEditFieldChange(field: "candidateName" | "candidateEmail" | "candidatePhone", value: string) {
    if (field === "candidateName") {
      setEditCandidateName(value);
      return;
    }

    if (field === "candidateEmail") {
      setEditCandidateEmail(value);
      return;
    }

    setEditCandidatePhone(value);
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
      subtitle="Search, review, and resubmit requests from a dedicated focused screen."
    >
      {message ? <p className={`inline-alert ${getAlertTone(message)}`}>{message}</p> : null}

      <BlockCard className="request-toolbar" interactive>
        <BlockTitle
          icon={<ListChecks size={14} />}
          title="Submitted Requests"
          subtitle="Search and monitor requests across pending, approved, and rejected states."
          action={<span className="neo-badge">Focused View</span>}
        />

        <div className="search-input-wrap">
          <label className="sr-only" htmlFor="request-search">
            Search requests
          </label>
          <span className="search-input-icon" aria-hidden="true">
            <Search size={18} />
          </span>
          <input
            id="request-search"
            className="input"
            placeholder="Search by candidate, email, phone, status or admin note"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
      </BlockCard>

      <div className="request-sections">
        <RequestSection
          title="Pending Requests"
          items={pendingRequests}
          statusType="pending"
          emptyMessage="No pending requests found."
          collapsed={collapsedSections.pending}
          onToggleSection={toggleRequestSection}
          expandedRequestIds={expandedRequestIds}
          onToggleExpand={toggleRequestExpand}
          editingRequestId={editingRequestId}
          onStartRejectedEdit={startRejectedEdit}
          editForm={{
            candidateName: editCandidateName,
            candidateEmail: editCandidateEmail,
            candidatePhone: editCandidatePhone,
            selectedServiceIds: editSelectedServiceIds,
          }}
          onEditFieldChange={onEditFieldChange}
          onToggleEditService={toggleEditServiceSelection}
          onCancelEdit={cancelRejectedEdit}
          onSubmitEdit={submitRejectedEdit}
          availableServices={me.availableServices}
        />

        <RequestSection
          title="Approved Requests"
          items={approvedRequests}
          statusType="approved"
          emptyMessage="No approved requests found."
          collapsed={collapsedSections.approved}
          onToggleSection={toggleRequestSection}
          expandedRequestIds={expandedRequestIds}
          onToggleExpand={toggleRequestExpand}
          editingRequestId={editingRequestId}
          onStartRejectedEdit={startRejectedEdit}
          editForm={{
            candidateName: editCandidateName,
            candidateEmail: editCandidateEmail,
            candidatePhone: editCandidatePhone,
            selectedServiceIds: editSelectedServiceIds,
          }}
          onEditFieldChange={onEditFieldChange}
          onToggleEditService={toggleEditServiceSelection}
          onCancelEdit={cancelRejectedEdit}
          onSubmitEdit={submitRejectedEdit}
          availableServices={me.availableServices}
        />

        <RequestSection
          title="Rejected Requests"
          items={rejectedRequests}
          statusType="rejected"
          emptyMessage="No rejected requests found."
          collapsed={collapsedSections.rejected}
          onToggleSection={toggleRequestSection}
          expandedRequestIds={expandedRequestIds}
          onToggleExpand={toggleRequestExpand}
          editingRequestId={editingRequestId}
          onStartRejectedEdit={startRejectedEdit}
          editForm={{
            candidateName: editCandidateName,
            candidateEmail: editCandidateEmail,
            candidatePhone: editCandidatePhone,
            selectedServiceIds: editSelectedServiceIds,
          }}
          onEditFieldChange={onEditFieldChange}
          onToggleEditService={toggleEditServiceSelection}
          onCancelEdit={cancelRejectedEdit}
          onSubmitEdit={submitRejectedEdit}
          availableServices={me.availableServices}
        />
      </div>
    </PortalFrame>
  );
}
