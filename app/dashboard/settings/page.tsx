"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { Building2, FileText, KeyRound, Save, ShieldCheck } from "lucide-react";
import { PortalFrame } from "@/components/dashboard/PortalFrame";
import { BlockCard, BlockTitle } from "@/components/ui/blocks";
import { getAlertTone } from "@/lib/alerts";
import { usePortalSession } from "@/lib/hooks/usePortalSession";
import type { PartnerProfile, PartnerProfileResponse } from "@/lib/types";

const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENT_COUNT = 5;

const COUNTRY_OPTIONS = ["India", "United Arab Emirates", "United States", "United Kingdom", "Singapore"];

const PHONE_CODE_OPTIONS = ["India (+91)", "UAE (+971)", "US (+1)", "UK (+44)", "Singapore (+65)"];

function createEmptyProfile(): PartnerProfile {
  return {
    companyInformation: {
      companyName: "",
      gstin: "",
      cinRegistrationNumber: "",
      address: {
        line1: "",
        line2: "",
        city: "",
        state: "",
        postalCode: "",
        country: "India",
      },
      documents: [],
    },
    invoicingInformation: {
      billingSameAsCompany: true,
      invoiceEmail: "",
      address: {
        line1: "",
        line2: "",
        city: "",
        state: "",
        postalCode: "",
        country: "India",
      },
    },
    primaryContactInformation: {
      firstName: "",
      lastName: "",
      designation: "",
      email: "",
      officePhone: {
        countryCode: "India (+91)",
        number: "",
      },
      mobilePhone: {
        countryCode: "India (+91)",
        number: "",
      },
      whatsappPhone: {
        countryCode: "India (+91)",
        number: "",
      },
    },
    additionalQuestions: {
      heardAboutUs: "",
      referredBy: "",
      yearlyBackgroundsExpected: "",
      promoCode: "",
      primaryIndustry: "",
    },
    updatedAt: null,
  };
}

function isEmailLike(value: string) {
  const trimmed = value.trim();
  return trimmed.includes("@") && trimmed.includes(".");
}

function isProfileComplete(profile: PartnerProfile) {
  const companyAddress = profile.companyInformation.address;
  const invoiceAddress = profile.invoicingInformation.billingSameAsCompany
    ? companyAddress
    : profile.invoicingInformation.address;

  return Boolean(
    profile.companyInformation.companyName.trim().length >= 2 &&
      companyAddress.line1.trim() &&
      companyAddress.city.trim() &&
      companyAddress.state.trim() &&
      companyAddress.postalCode.trim() &&
      companyAddress.country.trim() &&
      profile.companyInformation.documents.length > 0 &&
      isEmailLike(profile.invoicingInformation.invoiceEmail) &&
      invoiceAddress.line1.trim() &&
      invoiceAddress.city.trim() &&
      invoiceAddress.state.trim() &&
      invoiceAddress.postalCode.trim() &&
      invoiceAddress.country.trim() &&
      profile.primaryContactInformation.firstName.trim() &&
      profile.primaryContactInformation.lastName.trim() &&
      profile.primaryContactInformation.designation.trim() &&
      isEmailLike(profile.primaryContactInformation.email) &&
      profile.primaryContactInformation.mobilePhone.number.trim(),
  );
}

export default function SettingsPage() {
  const { me, loading, logout } = usePortalSession();

  const [profile, setProfile] = useState<PartnerProfile>(createEmptyProfile);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileMessage, setProfileMessage] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const selectedDocumentLabel = useMemo(() => {
    const count = profile.companyInformation.documents.length;
    if (count === 0) {
      return "No file chosen";
    }

    return `${count} file${count === 1 ? "" : "s"} selected`;
  }, [profile.companyInformation.documents.length]);

  const profileSaveState = useMemo(() => {
    if (!profile.updatedAt) {
      return "not_saved" as const;
    }

    return isProfileComplete(profile) ? ("complete" as const) : ("draft" as const);
  }, [profile]);

  useEffect(() => {
    if (!me) {
      return;
    }

    let cancelled = false;

    async function loadProfile() {
      setProfileLoading(true);
      setProfileMessage("");

      try {
        const res = await fetch("/api/settings/profile", { cache: "no-store" });
        const data = (await res.json()) as PartnerProfileResponse & { error?: string };

        if (!res.ok) {
          if (!cancelled) {
            setProfileMessage(data.error ?? "Could not load profile settings.");
          }
          return;
        }

        if (!cancelled) {
          setProfile(data.profile ?? createEmptyProfile());
        }
      } catch {
        if (!cancelled) {
          setProfileMessage("Could not load profile settings.");
        }
      } finally {
        if (!cancelled) {
          setProfileLoading(false);
        }
      }
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [me]);

  if (loading || !me || profileLoading) {
    return (
      <main className="portal-shell">
        <BlockCard tone="muted">
          <p className="block-subtitle">Loading settings...</p>
        </BlockCard>
      </main>
    );
  }

  function updateCompanyAddress(
    field: keyof PartnerProfile["companyInformation"]["address"],
    value: string,
  ) {
    setProfile((prev) => {
      const nextCompanyAddress = {
        ...prev.companyInformation.address,
        [field]: value,
      };

      return {
        ...prev,
        companyInformation: {
          ...prev.companyInformation,
          address: nextCompanyAddress,
        },
        invoicingInformation: {
          ...prev.invoicingInformation,
          address: prev.invoicingInformation.billingSameAsCompany
            ? nextCompanyAddress
            : prev.invoicingInformation.address,
        },
      };
    });
  }

  function updateInvoicingAddress(
    field: keyof PartnerProfile["invoicingInformation"]["address"],
    value: string,
  ) {
    setProfile((prev) => ({
      ...prev,
      invoicingInformation: {
        ...prev.invoicingInformation,
        address: {
          ...prev.invoicingInformation.address,
          [field]: value,
        },
      },
    }));
  }

  function updatePhone(
    field: "officePhone" | "mobilePhone" | "whatsappPhone",
    key: "countryCode" | "number",
    value: string,
  ) {
    setProfile((prev) => ({
      ...prev,
      primaryContactInformation: {
        ...prev.primaryContactInformation,
        [field]: {
          ...prev.primaryContactInformation[field],
          [key]: value,
        },
      },
    }));
  }

  function onCompanyDocumentsChange(e: ChangeEvent<HTMLInputElement>) {
    const pickedFiles = Array.from(e.target.files ?? []);
    if (pickedFiles.length === 0) {
      e.target.value = "";
      return;
    }

    let skippedOversize = false;
    let skippedOverflow = false;

    setProfile((prev) => {
      const nextDocuments = [...prev.companyInformation.documents];

      for (const file of pickedFiles) {
        if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
          skippedOversize = true;
          continue;
        }

        const fileType = file.type || "application/octet-stream";
        const exists = nextDocuments.some(
          (doc) =>
            doc.fileName === file.name && doc.fileType === fileType && doc.fileSize === file.size,
        );

        if (exists) {
          continue;
        }

        if (nextDocuments.length >= MAX_DOCUMENT_COUNT) {
          skippedOverflow = true;
          continue;
        }

        nextDocuments.push({
          fileName: file.name,
          fileSize: file.size,
          fileType,
        });
      }

      return {
        ...prev,
        companyInformation: {
          ...prev.companyInformation,
          documents: nextDocuments,
        },
      };
    });

    if (skippedOversize) {
      setProfileMessage("Some files were skipped because they exceed 10 MB.");
    } else if (skippedOverflow) {
      setProfileMessage("Only 5 company documents are allowed.");
    } else {
      setProfileMessage("");
    }

    e.target.value = "";
  }

  function removeDocument(index: number) {
    setProfile((prev) => ({
      ...prev,
      companyInformation: {
        ...prev.companyInformation,
        documents: prev.companyInformation.documents.filter((_, docIndex) => docIndex !== index),
      },
    }));
  }

  function onBillingSameChange(checked: boolean) {
    setProfile((prev) => ({
      ...prev,
      invoicingInformation: {
        ...prev.invoicingInformation,
        billingSameAsCompany: checked,
        address: checked ? prev.companyInformation.address : prev.invoicingInformation.address,
      },
    }));
  }

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProfileMessage("");

    setSavingProfile(true);

    const payloadProfile: PartnerProfile = {
      ...profile,
      invoicingInformation: {
        ...profile.invoicingInformation,
        address: profile.invoicingInformation.billingSameAsCompany
          ? profile.companyInformation.address
          : profile.invoicingInformation.address,
      },
    };

    const res = await fetch("/api/settings/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: payloadProfile }),
    });

    const data = (await res.json()) as PartnerProfileResponse & { message?: string; error?: string };
    setSavingProfile(false);

    if (!res.ok) {
      setProfileMessage(data.error ?? "Could not save profile.");
      return;
    }

    const nextProfile = data.profile ?? payloadProfile;
    setProfile(nextProfile);
    if (isProfileComplete(nextProfile)) {
      setProfileMessage(data.message ?? "Profile updated successfully.");
      return;
    }

    setProfileMessage("Saved as draft. You can complete the remaining fields later.");
  }

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordMessage("");

    if (newPassword !== confirmPassword) {
      setPasswordMessage("New password and confirm password must match.");
      return;
    }

    setChangingPassword(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    const data = (await res.json()) as { message?: string; error?: string };
    setChangingPassword(false);

    if (!res.ok) {
      setPasswordMessage(data.error ?? "Could not change password.");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordMessage(data.message ?? "Password changed successfully.");
  }

  return (
    <PortalFrame
      me={me}
      onLogout={logout}
      title="Enterprise Settings"
      subtitle="Maintain company profile details, invoicing data, and account security."
    >
      <BlockCard as="article" interactive className="settings-profile-card">
        <BlockTitle
          icon={<Building2 size={14} />}
          title="Enterprise Profile"
          subtitle="Keep your organization profile complete for faster request processing and billing compliance."
          action={
            <span className="neo-badge">
              {profileSaveState === "not_saved"
                ? "Not saved yet"
                : profileSaveState === "draft"
                  ? `Saved as Draft · ${new Date(profile.updatedAt as string).toLocaleDateString()}`
                  : `Profile Complete · ${new Date(profile.updatedAt as string).toLocaleDateString()}`}
            </span>
          }
        />

        <p className="settings-form-note" style={{ marginTop: "0.65rem", marginBottom: "0.15rem" }}>
          Draft save is enabled. You can save now and complete remaining fields later.
        </p>

        <form onSubmit={saveProfile} className="settings-profile-form" noValidate>
          <section className="settings-form-section">
            <h3 className="settings-form-heading" style={{ fontSize: "0.98rem", color: "#2D405E", margin: 0, fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>Company Information</h3>
            <div className="settings-grid two-col">
              <div>
                <label className="label" htmlFor="company-name">
                  Company Name *
                </label>
                <input
                  id="company-name"
                  className="input"
                  placeholder="Registered company name"
                  value={profile.companyInformation.companyName}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      companyInformation: {
                        ...prev.companyInformation,
                        companyName: e.target.value,
                      },
                    }))
                  }
                  required
                />
              </div>

              <div>
                <label className="label" htmlFor="company-gstin">
                  GSTIN (if applicable)
                </label>
                <input
                  id="company-gstin"
                  className="input"
                  placeholder="22AAAAA0000A1Z5"
                  value={profile.companyInformation.gstin}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      companyInformation: {
                        ...prev.companyInformation,
                        gstin: e.target.value.toUpperCase(),
                      },
                    }))
                  }
                />
              </div>
            </div>

            <div className="settings-grid one-col">
              <div>
                <label className="label" htmlFor="company-line1">
                  Street Address 1 *
                </label>
                <input
                  id="company-line1"
                  className="input"
                  placeholder="Building no., street name"
                  value={profile.companyInformation.address.line1}
                  onChange={(e) => updateCompanyAddress("line1", e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label" htmlFor="company-line2">
                  Street Address 2
                </label>
                <input
                  id="company-line2"
                  className="input"
                  placeholder="Area, locality, landmark (optional)"
                  value={profile.companyInformation.address.line2}
                  onChange={(e) => updateCompanyAddress("line2", e.target.value)}
                />
              </div>
            </div>

            <div className="settings-grid two-col">
              <div>
                <label className="label" htmlFor="company-city">
                  City *
                </label>
                <input
                  id="company-city"
                  className="input"
                  placeholder="City"
                  value={profile.companyInformation.address.city}
                  onChange={(e) => updateCompanyAddress("city", e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label" htmlFor="company-state">
                  State / Province / Region *
                </label>
                <input
                  id="company-state"
                  className="input"
                  placeholder="State / Province / Region"
                  value={profile.companyInformation.address.state}
                  onChange={(e) => updateCompanyAddress("state", e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="settings-grid two-col">
              <div>
                <label className="label" htmlFor="company-postal">
                  Postal / ZIP Code *
                </label>
                <input
                  id="company-postal"
                  className="input"
                  placeholder="Postal / ZIP code"
                  value={profile.companyInformation.address.postalCode}
                  onChange={(e) => updateCompanyAddress("postalCode", e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label" htmlFor="company-country">
                  Country *
                </label>
                <select
                  id="company-country"
                  className="input"
                  value={profile.companyInformation.address.country}
                  onChange={(e) => updateCompanyAddress("country", e.target.value)}
                  required
                >
                  {COUNTRY_OPTIONS.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="company-cin">
                CIN / Registration Number
              </label>
              <input
                id="company-cin"
                className="input"
                placeholder="Company Identification Number"
                value={profile.companyInformation.cinRegistrationNumber}
                onChange={(e) =>
                  setProfile((prev) => ({
                    ...prev,
                    companyInformation: {
                      ...prev.companyInformation,
                      cinRegistrationNumber: e.target.value,
                    },
                  }))
                }
              />
            </div>
          </section>

          <section className="settings-form-section">
            <h3 className="settings-form-heading" style={{ fontSize: "0.98rem", color: "#2D405E", margin: 0, fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>Company Documents</h3>
            <p className="settings-form-note">
              Upload any one of the following: GST Certificate, Certificate of Incorporation, MOA/AOA,
              Trade License, or MSME/Udyam Registration.
            </p>

            <div className="settings-upload-panel">
              <label className="settings-upload-label" htmlFor="company-documents-input">
                Click to upload document(s)
              </label>
              <input
                id="company-documents-input"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                multiple
                onChange={onCompanyDocumentsChange}
              />
              <p className="settings-upload-meta">{selectedDocumentLabel}</p>

              {profile.companyInformation.documents.length > 0 ? (
                <ul className="settings-document-list">
                  {profile.companyInformation.documents.map((doc, index) => (
                    <li key={`${doc.fileName}-${doc.fileSize}-${index}`} className="settings-document-item">
                      <span>
                        <FileText size={14} /> {doc.fileName} ({(doc.fileSize / 1024 / 1024).toFixed(2)} MB)
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => removeDocument(index)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <p className="settings-form-note">PDF, JPG, PNG - max 10 MB each, up to 5 files</p>
            </div>
          </section>

          <section className="settings-form-section">
            <h3 className="settings-form-heading" style={{ fontSize: "0.98rem", color: "#2D405E", margin: 0, fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>Invoicing Information</h3>

            <label className="settings-checkbox-row" htmlFor="billing-same-as-company">
              <input
                id="billing-same-as-company"
                type="checkbox"
                checked={profile.invoicingInformation.billingSameAsCompany}
                onChange={(e) => onBillingSameChange(e.target.checked)}
              />
              Billing address same as company address
            </label>

            <div>
              <label className="label" htmlFor="invoice-email">
                Invoice Email Address *
              </label>
              <input
                id="invoice-email"
                className="input"
                type="email"
                placeholder="accounts@yourcompany.com"
                value={profile.invoicingInformation.invoiceEmail}
                onChange={(e) =>
                  setProfile((prev) => ({
                    ...prev,
                    invoicingInformation: {
                      ...prev.invoicingInformation,
                      invoiceEmail: e.target.value,
                    },
                  }))
                }
                required
              />
            </div>

            <div className="settings-grid one-col">
              <div>
                <label className="label" htmlFor="invoice-line1">
                  Street Address 1 *
                </label>
                <input
                  id="invoice-line1"
                  className="input"
                  placeholder="Building no., street name"
                  value={profile.invoicingInformation.address.line1}
                  onChange={(e) => updateInvoicingAddress("line1", e.target.value)}
                  disabled={profile.invoicingInformation.billingSameAsCompany}
                  required
                />
              </div>

              <div>
                <label className="label" htmlFor="invoice-line2">
                  Street Address 2
                </label>
                <input
                  id="invoice-line2"
                  className="input"
                  placeholder="Area, locality, landmark (optional)"
                  value={profile.invoicingInformation.address.line2}
                  onChange={(e) => updateInvoicingAddress("line2", e.target.value)}
                  disabled={profile.invoicingInformation.billingSameAsCompany}
                />
              </div>
            </div>

            <div className="settings-grid two-col">
              <div>
                <label className="label" htmlFor="invoice-city">
                  City *
                </label>
                <input
                  id="invoice-city"
                  className="input"
                  placeholder="City"
                  value={profile.invoicingInformation.address.city}
                  onChange={(e) => updateInvoicingAddress("city", e.target.value)}
                  disabled={profile.invoicingInformation.billingSameAsCompany}
                  required
                />
              </div>

              <div>
                <label className="label" htmlFor="invoice-state">
                  State / Province / Region *
                </label>
                <input
                  id="invoice-state"
                  className="input"
                  placeholder="State / Province / Region"
                  value={profile.invoicingInformation.address.state}
                  onChange={(e) => updateInvoicingAddress("state", e.target.value)}
                  disabled={profile.invoicingInformation.billingSameAsCompany}
                  required
                />
              </div>
            </div>

            <div className="settings-grid two-col">
              <div>
                <label className="label" htmlFor="invoice-postal">
                  Postal / ZIP Code *
                </label>
                <input
                  id="invoice-postal"
                  className="input"
                  placeholder="Postal / ZIP code"
                  value={profile.invoicingInformation.address.postalCode}
                  onChange={(e) => updateInvoicingAddress("postalCode", e.target.value)}
                  disabled={profile.invoicingInformation.billingSameAsCompany}
                  required
                />
              </div>

              <div>
                <label className="label" htmlFor="invoice-country">
                  Country *
                </label>
                <select
                  id="invoice-country"
                  className="input"
                  value={profile.invoicingInformation.address.country}
                  onChange={(e) => updateInvoicingAddress("country", e.target.value)}
                  disabled={profile.invoicingInformation.billingSameAsCompany}
                  required
                >
                  {COUNTRY_OPTIONS.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="settings-highlight-note">
              For GST compliance, invoice will include your GSTIN. Ensure billing state matches your GST
              registration state.
            </p>
          </section>

          <section className="settings-form-section">
            <h3 className="settings-form-heading" style={{ fontSize: "0.98rem", color: "#2D405E", margin: 0, fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>Primary Contact Information</h3>

            <div className="settings-grid two-col">
              <div>
                <label className="label" htmlFor="contact-first-name">
                  First Name *
                </label>
                <input
                  id="contact-first-name"
                  className="input"
                  placeholder="First name"
                  value={profile.primaryContactInformation.firstName}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      primaryContactInformation: {
                        ...prev.primaryContactInformation,
                        firstName: e.target.value,
                      },
                    }))
                  }
                  required
                />
              </div>

              <div>
                <label className="label" htmlFor="contact-last-name">
                  Last Name *
                </label>
                <input
                  id="contact-last-name"
                  className="input"
                  placeholder="Last name"
                  value={profile.primaryContactInformation.lastName}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      primaryContactInformation: {
                        ...prev.primaryContactInformation,
                        lastName: e.target.value,
                      },
                    }))
                  }
                  required
                />
              </div>
            </div>

            <div className="settings-grid two-col">
              <div>
                <label className="label" htmlFor="contact-designation">
                  Designation / Title *
                </label>
                <input
                  id="contact-designation"
                  className="input"
                  placeholder="e.g., HR Manager, Director"
                  value={profile.primaryContactInformation.designation}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      primaryContactInformation: {
                        ...prev.primaryContactInformation,
                        designation: e.target.value,
                      },
                    }))
                  }
                  required
                />
              </div>

              <div>
                <label className="label" htmlFor="contact-email">
                  Email Address *
                </label>
                <input
                  id="contact-email"
                  className="input"
                  type="email"
                  placeholder="name@company.com"
                  value={profile.primaryContactInformation.email}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      primaryContactInformation: {
                        ...prev.primaryContactInformation,
                        email: e.target.value,
                      },
                    }))
                  }
                  required
                />
              </div>
            </div>

            <div className="settings-grid two-col">
              <div>
                <label className="label" htmlFor="office-phone-number">
                  Office Phone (with STD)
                </label>
                <div className="settings-phone-row">
                  <select
                    className="input"
                    value={profile.primaryContactInformation.officePhone.countryCode}
                    onChange={(e) => updatePhone("officePhone", "countryCode", e.target.value)}
                  >
                    {PHONE_CODE_OPTIONS.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                  <input
                    id="office-phone-number"
                    className="input"
                    placeholder="Phone number"
                    value={profile.primaryContactInformation.officePhone.number}
                    onChange={(e) => updatePhone("officePhone", "number", e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="label" htmlFor="mobile-phone-number">
                  Mobile Number *
                </label>
                <div className="settings-phone-row">
                  <select
                    className="input"
                    value={profile.primaryContactInformation.mobilePhone.countryCode}
                    onChange={(e) => updatePhone("mobilePhone", "countryCode", e.target.value)}
                  >
                    {PHONE_CODE_OPTIONS.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                  <input
                    id="mobile-phone-number"
                    className="input"
                    placeholder="Phone number"
                    value={profile.primaryContactInformation.mobilePhone.number}
                    onChange={(e) => updatePhone("mobilePhone", "number", e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="whatsapp-phone-number">
                WhatsApp Number (if different)
              </label>
              <div className="settings-phone-row">
                <select
                  className="input"
                  value={profile.primaryContactInformation.whatsappPhone.countryCode}
                  onChange={(e) => updatePhone("whatsappPhone", "countryCode", e.target.value)}
                >
                  {PHONE_CODE_OPTIONS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                <input
                  id="whatsapp-phone-number"
                  className="input"
                  placeholder="Phone number"
                  value={profile.primaryContactInformation.whatsappPhone.number}
                  onChange={(e) => updatePhone("whatsappPhone", "number", e.target.value)}
                />
              </div>
            </div>
          </section>

          {profileMessage ? <p className={`inline-alert ${getAlertTone(profileMessage)}`}>{profileMessage}</p> : null}

          <div className="settings-submit-row">
            {profileSaveState === "draft" ? (
              <span className="neo-badge" style={{ marginRight: "0.55rem" }}>
                Saved as Draft
              </span>
            ) : null}
            <button className="btn btn-primary settings-save-btn" type="submit" disabled={savingProfile}>
              <Save size={16} />
              {savingProfile ? "Saving..." : "Save Profile"}
            </button>
          </div>
        </form>
      </BlockCard>

      <BlockCard as="article" interactive>
        <BlockTitle
          icon={<ShieldCheck size={14} />}
          title="Security Settings"
          subtitle="Use a strong password and avoid reusing old credentials."
        />

        <form onSubmit={changePassword} className="form-grid">
          <div>
            <label className="label" htmlFor="current-password">
              Current Password
            </label>
            <input
              id="current-password"
              className="input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="new-password">
              New Password
            </label>
            <input
              id="new-password"
              className="input"
              type="password"
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="confirm-password">
              Confirm New Password
            </label>
            <input
              id="confirm-password"
              className="input"
              type="password"
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {passwordMessage ? (
            <p className={`inline-alert ${getAlertTone(passwordMessage)}`}>{passwordMessage}</p>
          ) : null}

          <button className="btn btn-primary" type="submit" disabled={changingPassword}>
            <KeyRound size={16} />
            {changingPassword ? "Updating..." : "Change Password"}
          </button>
        </form>
      </BlockCard>
    </PortalFrame>
  );
}
