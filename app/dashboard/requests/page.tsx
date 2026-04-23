"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState, Suspense } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { ListChecks, RotateCw, Search, X } from "lucide-react";
import { PortalFrame } from "@/components/dashboard/PortalFrame";
import { BlockCard } from "@/components/ui/blocks";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { getAlertTone } from "@/lib/alerts";
import { usePortalSession } from "@/lib/hooks/usePortalSession";
import { useRequestsData } from "@/lib/hooks/useRequestsData";
import { RequestItem, RequestStatus } from "@/lib/types";

function buildRejectedFieldKey(serviceId: string, question: string, fieldKey = "") {
  return JSON.stringify({
    serviceId: serviceId.trim(),
    question: question.trim(),
    fieldKey: fieldKey.trim(),
  });
}

function parseRejectedFieldKey(rawFieldKey: string) {
  try {
    const parsed = JSON.parse(rawFieldKey) as {
      serviceId?: string;
      question?: string;
      fieldKey?: string;
    };

    const serviceId = String(parsed.serviceId ?? "").trim();
    const question = String(parsed.question ?? "").trim();
    const fieldKey = String(parsed.fieldKey ?? "").trim();

    if (!serviceId || !question) {
      return null;
    }

    return { serviceId, question, fieldKey };
  } catch {
    return null;
  }
}

function toLocalDateKey(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const ENTERPRISE_REJECTION_WINDOW_MS = 10 * 60 * 1000;

function normalizeTimestamp(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function getEnterpriseDecisionWindow(item: RequestItem, nowMs: number) {
  if (item.status !== "approved") {
    return {
      isLocked: false,
      remainingMs: 0,
    };
  }

  if (item.enterpriseDecisionLocked || item.enterpriseDecisionLockedAt) {
    return {
      isLocked: true,
      remainingMs: 0,
    };
  }

  const approvedAt = normalizeTimestamp(item.enterpriseApprovedAt);
  if (!approvedAt) {
    return {
      isLocked: true,
      remainingMs: 0,
    };
  }

  const elapsedMs = nowMs - approvedAt.getTime();
  if (elapsedMs >= ENTERPRISE_REJECTION_WINDOW_MS) {
    return {
      isLocked: true,
      remainingMs: 0,
    };
  }

  return {
    isLocked: false,
    remainingMs: Math.max(0, ENTERPRISE_REJECTION_WINDOW_MS - elapsedMs),
  };
}

function formatRemainingWindow(ms: number) {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function getEnterpriseStatusLabel(status: RequestStatus) {
  if (status === "approved") {
    return "approved by enterprise";
  }

  if (status === "rejected") {
    return "rejected by enterprise";
  }

  if (status === "verified") {
    return "verified";
  }

  return status;
}

function getEnterpriseStatusClassName(status: RequestStatus) {
  if (status === "verified") {
    return "bg-emerald-200 text-emerald-900 border border-emerald-400 animate-pulse";
  }

  if (status === "approved") {
    return "bg-green-100 text-green-700 border border-green-200";
  }

  if (status === "rejected") {
    return "bg-red-100 text-red-700 border border-red-200";
  }

  return "bg-yellow-100 text-yellow-700 border border-yellow-200";
}

function canOpenSharedReport(item: RequestItem) {
  return (
    (item.status === "verified" || item.status === "completed") &&
    Boolean(item.reportData) &&
    Boolean(item.reportMetadata?.customerSharedAt)
  );
}

function canAppealReverification(item: RequestItem) {
  return item.status === "verified";
}

function canAccessCandidateLinkActions(item: RequestItem) {
  if (item.status === "completed") {
    return true;
  }

  return item.status !== "verified" && item.candidateFormStatus !== "submitted";
}

function getRequestStatusDisplay(item: RequestItem) {
  if (item.status === "verified" && item.reverificationAppeal?.status === "resolved") {
    return {
      label: "reverified",
      className: "bg-sky-100 text-sky-800 border border-sky-300",
    };
  }

  return {
    label: getEnterpriseStatusLabel(item.status),
    className: getEnterpriseStatusClassName(item.status),
  };
}

function resolveReverificationDate(item: RequestItem) {
  if (item.status !== "verified" || item.reverificationAppeal?.status !== "resolved") {
    return null;
  }

  return (
    item.reverificationAppeal.resolvedAt ||
    item.reportMetadata?.customerSharedAt ||
    item.reportMetadata?.generatedAt ||
    null
  );
}

const REPORT_NOTICE_PARAGRAPHS = [
  "The Cluso Report is provided by CLUSO INFOLINK, LLC. CLUSO INFOLINK, LLC does not warrant the completeness or correctness of this report or any of the information contained herein. CLUSO INFOLINK, LLC is not liable for any loss, damage or injury caused by negligence or other act or failure of CLUSO INFOLINK, LLC in procuring, collecting or communicating any such information. Reliance on any information contained herein shall be solely at the users risk and shall not constitute a waiver of any claim against, and a release of, CLUSO INFOLINK, LLC.",
  "This report is furnished in strict confidence for your exclusive use of legitimate business purposes and for no other purpose, and shall not be reproduced in whole or in part in any manner whatsoever. CLUSO INFOLINK is a private investigation company licensed by the Texas Private Security Bureau (TX License Number A16821). Contact the Texas PSB for regulatory information or complaints: TX Private Security, MSC 0241, PO Box 4087, Austin TX 78773-0001 Tel: 512-424-7298 Fax: 512-424-7728.",
] as const;

const REQUESTS_PER_PAGE = 15;
const MAX_APPEAL_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const APPEAL_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

type ReportPreviewAttempt = {
  attemptedAt: string;
  status: string;
  verificationMode: string;
  comment: string;
  verifierName: string;
  managerName: string;
  respondentName: string;
  respondentEmail: string;
  respondentComment: string;
};

type ReportPreviewCandidateAnswer = {
  question: string;
  value: string;
  fieldType: string;
  fileName: string;
  fileData: string;
};

type ReportPreviewService = {
  serviceId: string;
  serviceEntryIndex: number;
  serviceEntryCount: number;
  serviceInstanceKey: string;
  serviceName: string;
  status: string;
  verificationMode: string;
  comment: string;
  candidateAnswers: ReportPreviewCandidateAnswer[];
  attempts: ReportPreviewAttempt[];
};

type ReportPreviewPersonalDetail = ReportPreviewCandidateAnswer;

type ReportPreviewData = {
  reportNumber: string;
  generatedAt: string;
  generatedByName: string;
  candidate: {
    name: string;
    email: string;
    phone: string;
  };
  company: {
    name: string;
    email: string;
  };
  status: string;
  createdAt: string;
  personalDetails: ReportPreviewPersonalDetail[];
  services: ReportPreviewService[];
  createdByName: string;
  verifiedByName: string;
};

type CandidateLinkEmailPreview = {
  requestId: string;
  candidateName: string;
  recipientEmail: string;
  userId: string;
  temporaryPassword: string;
  subject: string;
  text: string;
  html: string;
  portalUrl: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function formatReportDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleString("en-IN", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function formatReportDate(value?: string | null) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

function toReportStatusLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "-";
  }

  if (normalized === "in-progress") {
    return "In Progress";
  }

  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function toReportAttemptStatusLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "verified") {
    return "Verified";
  }

  if (normalized === "unverified") {
    return "Unverified";
  }

  return "In Progress";
}

function toReportModeLabel(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "Manual";
  }

  if (normalized === normalized.toLowerCase()) {
    return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
  }

  return normalized;
}

function getReportStatusColor(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "verified") {
    return "#0A7D2A";
  }

  if (normalized === "unverified" || normalized === "rejected") {
    return "#C62828";
  }

  return "#111827";
}

function getReportAttemptStatusColor(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "verified") {
    return "#0A7D2A";
  }

  if (normalized === "unverified" || normalized === "rejected") {
    return "#C62828";
  }

  return "#A16207";
}

const PERSONAL_DETAILS_SERVICE_NAME = "personal details";
const PERSONAL_DETAILS_QUESTION_SEQUENCE = [
  "Full name (as per government ID)",
  "Date of birth",
  "Mobile number",
  "Current residential address",
  "Primary government ID number",
  "Email address",
  "Nationality",
  "Gender",
] as const;
const PERSONAL_DETAILS_QUESTION_ORDER = new Map(
  PERSONAL_DETAILS_QUESTION_SEQUENCE.map((question, index) => [
    question.trim().toLowerCase(),
    index,
  ]),
);

function normalizeQuestionKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

function normalizePositiveInteger(value: unknown, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function buildServiceInstanceKey(serviceId: string, serviceEntryIndex: number) {
  return `${serviceId}::${normalizePositiveInteger(serviceEntryIndex)}`;
}

function formatServiceInstanceName(
  serviceName: string,
  serviceEntryIndex: number,
  serviceEntryCount: number,
) {
  const trimmedName = serviceName.trim() || "Service";
  if (serviceEntryCount <= 1) {
    return trimmedName;
  }

  const suffix = ` ${serviceEntryIndex}`;
  if (trimmedName.endsWith(suffix)) {
    return trimmedName;
  }

  return `${trimmedName}${suffix}`;
}

function normalizePreviewAnswer(
  answer: Partial<ReportPreviewCandidateAnswer>,
): ReportPreviewCandidateAnswer {
  return {
    question: (answer.question ?? "").trim() || "Field",
    value: (answer.value ?? "").trim() || "-",
    fieldType: (answer.fieldType ?? "").trim() || "text",
    fileName: (answer.fileName ?? "").trim(),
    fileData: (answer.fileData ?? "").trim(),
  };
}

function isPersonalDetailsServiceName(serviceName: string) {
  const normalizedServiceName = normalizeQuestionKey(serviceName);
  return (
    normalizedServiceName === PERSONAL_DETAILS_SERVICE_NAME ||
    normalizedServiceName.includes("personal detail")
  );
}

function isLikelyPersonalDetailsQuestion(question: string) {
  const normalizedQuestion = normalizeQuestionKey(question);
  if (!normalizedQuestion) {
    return false;
  }

  if (PERSONAL_DETAILS_QUESTION_ORDER.has(normalizedQuestion)) {
    return true;
  }

  const looseQuestion = normalizedQuestion.replace(/[^a-z0-9\s]/g, " ");
  return /\b(date of birth|dob|nationality|gender|aadhar|aadhaar|pan|passport|government id|residential address)\b/.test(
    looseQuestion,
  );
}

function dedupePersonalDetailsAnswers(
  answers: ReportPreviewCandidateAnswer[],
): ReportPreviewPersonalDetail[] {
  const deduped = new Map<string, ReportPreviewPersonalDetail>();

  for (const rawAnswer of answers) {
    const answer = normalizePreviewAnswer(rawAnswer);
    const key = [
      normalizeQuestionKey(answer.question),
      answer.fieldType.trim().toLowerCase(),
      answer.value.trim().toLowerCase(),
      answer.fileName.trim().toLowerCase(),
      answer.fileData.trim().toLowerCase(),
    ].join("|");
    if (!key) {
      continue;
    }

    if (!deduped.has(key)) {
      deduped.set(key, answer);
    }
  }

  return Array.from(deduped.values()).sort((first, second) =>
    normalizeQuestionKey(first.question).localeCompare(
      normalizeQuestionKey(second.question),
    ),
  );
}

function dedupeReportPreviewAttempts(attempts: ReportPreviewAttempt[]) {
  const seen = new Set<string>();
  const deduped: ReportPreviewAttempt[] = [];

  for (const attempt of attempts) {
    const key = [
      attempt.attemptedAt,
      attempt.status,
      attempt.verificationMode,
      attempt.comment,
      attempt.verifierName,
      attempt.managerName,
      attempt.respondentName,
      attempt.respondentEmail,
      attempt.respondentComment,
    ]
      .map((value) => value.trim().toLowerCase())
      .join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(attempt);
  }

  return deduped;
}

function groupReportServicesForRender(services: ReportPreviewService[]) {
  const groupedByKey = new Map<string, ReportPreviewService>();
  const orderedKeys: string[] = [];

  for (let index = 0; index < services.length; index += 1) {
    const service = services[index];
    const serviceEntryIndex = normalizePositiveInteger(service.serviceEntryIndex, 1);
    const baseServiceId = (service.serviceId || `service-${index + 1}`).trim();
    const instanceKey =
      service.serviceInstanceKey.trim() ||
      buildServiceInstanceKey(baseServiceId, serviceEntryIndex);

    const mappedAnswers = (service.candidateAnswers ?? []).map((answer) =>
      normalizePreviewAnswer(answer),
    );
    const mappedAttempts = dedupeReportPreviewAttempts(service.attempts ?? []);

    const existing = groupedByKey.get(instanceKey);
    if (existing) {
      existing.status = service.status;
      existing.verificationMode = service.verificationMode;
      existing.comment = service.comment;
      existing.serviceEntryCount = Math.max(
        normalizePositiveInteger(existing.serviceEntryCount, 1),
        normalizePositiveInteger(service.serviceEntryCount, 1),
      );
      existing.candidateAnswers = dedupePersonalDetailsAnswers([
        ...existing.candidateAnswers,
        ...mappedAnswers,
      ]);
      existing.attempts = dedupeReportPreviewAttempts([
        ...existing.attempts,
        ...mappedAttempts,
      ]);
      continue;
    }

    orderedKeys.push(instanceKey);
    groupedByKey.set(instanceKey, {
      ...service,
      serviceId: baseServiceId,
      serviceEntryIndex,
      serviceEntryCount: Math.max(
        1,
        normalizePositiveInteger(service.serviceEntryCount, 1),
        serviceEntryIndex,
      ),
      serviceInstanceKey: instanceKey,
      serviceName: service.serviceName || "Service",
      candidateAnswers: mappedAnswers,
      attempts: mappedAttempts,
    });
  }

  return orderedKeys
    .map((instanceKey) => groupedByKey.get(instanceKey))
    .filter((service): service is ReportPreviewService => Boolean(service));
}

function splitReportSections(
  services: ReportPreviewService[],
): {
  services: ReportPreviewService[];
  personalDetails: ReportPreviewPersonalDetail[];
} {
  const groupedServices = groupReportServicesForRender(services);
  const filteredServices: ReportPreviewService[] = [];
  const personalDetails: ReportPreviewPersonalDetail[] = [];

  for (const service of groupedServices) {
    const answers = (service.candidateAnswers ?? []).map((answer) =>
      normalizePreviewAnswer(answer),
    );

    if (isPersonalDetailsServiceName(service.serviceName)) {
      personalDetails.push(...answers);
      continue;
    }

    const keptAnswers: ReportPreviewCandidateAnswer[] = [];
    for (const answer of answers) {
      if (isLikelyPersonalDetailsQuestion(answer.question)) {
        personalDetails.push(answer);
        continue;
      }

      keptAnswers.push(answer);
    }

    if (keptAnswers.length === 0 && (service.attempts ?? []).length === 0) {
      continue;
    }

    filteredServices.push({
      ...service,
      serviceName: service.serviceName || "Service",
      candidateAnswers: keptAnswers,
      attempts: dedupeReportPreviewAttempts(service.attempts ?? []),
    });
  }

  return {
    services: filteredServices,
    personalDetails: dedupePersonalDetailsAnswers(personalDetails),
  };
}

function parseStoredReportData(
  raw: unknown,
): Omit<ReportPreviewData, "createdByName" | "verifiedByName"> | null {
  const root = asRecord(raw);
  if (!root) {
    return null;
  }

  const candidate = asRecord(root.candidate);
  const company = asRecord(root.company);
  const personalDetailsRaw = Array.isArray(root.personalDetails)
    ? root.personalDetails
    : [];
  const personalDetailsFromPayload = personalDetailsRaw
    .map((answerEntry) => {
      const answer = asRecord(answerEntry);
      if (!answer) {
        return null;
      }

      return normalizePreviewAnswer({
        question: asString(answer.question),
        value: asString(answer.value),
        fieldType: asString(answer.fieldType, "text"),
        fileName: asString(answer.fileName),
        fileData: asString(answer.fileData),
      });
    })
    .filter(
      (
        answer,
      ): answer is ReportPreviewPersonalDetail => Boolean(answer),
    );

  const services = (Array.isArray(root.services) ? root.services : [])
    .map((serviceEntry, serviceIndex) => {
      const service = asRecord(serviceEntry);
      if (!service) {
        return null;
      }

      const serviceId = asString(service.serviceId);
      const serviceEntryCountRaw = Number(service.serviceEntryCount);
      const normalizedEntryCount =
        Number.isFinite(serviceEntryCountRaw) && serviceEntryCountRaw > 0
          ? Math.trunc(serviceEntryCountRaw)
          : 1;
      const serviceEntryIndexRaw = Number(service.serviceEntryIndex);
      const serviceEntryIndex =
        Number.isFinite(serviceEntryIndexRaw) && serviceEntryIndexRaw > 0
          ? Math.trunc(serviceEntryIndexRaw)
          : normalizedEntryCount > 1
            ? serviceIndex + 1
            : 1;
      const serviceEntryCount = Math.max(
        1,
        normalizedEntryCount,
        serviceEntryIndex,
      );
      const fallbackServiceId = serviceId || `service-${serviceIndex + 1}`;
      const serviceInstanceKey =
        asString(service.serviceInstanceKey) ||
        buildServiceInstanceKey(fallbackServiceId, serviceEntryIndex);

      const candidateAnswers = (
        Array.isArray(service.candidateAnswers) ? service.candidateAnswers : []
      )
        .map((answerEntry) => {
          const answer = asRecord(answerEntry);
          if (!answer) {
            return null;
          }

          return normalizePreviewAnswer({
            question: asString(answer.question),
            value: asString(answer.value),
            fieldType: asString(answer.fieldType, "text"),
            fileName: asString(answer.fileName),
            fileData: asString(answer.fileData),
          });
        })
        .filter(
          (
            answer,
          ): answer is ReportPreviewCandidateAnswer => Boolean(answer),
        );

      const attempts = (Array.isArray(service.attempts) ? service.attempts : [])
        .map((attemptEntry) => {
          const attempt = asRecord(attemptEntry);
          if (!attempt) {
            return null;
          }

          return {
            attemptedAt: asString(attempt.attemptedAt),
            status: asString(attempt.status, "pending"),
            verificationMode: asString(attempt.verificationMode),
            comment: asString(attempt.comment),
            verifierName: asString(attempt.verifierName),
            managerName: asString(attempt.managerName),
            respondentName: asString(attempt.respondentName),
            respondentEmail: asString(attempt.respondentEmail),
            respondentComment: asString(attempt.respondentComment),
          } satisfies ReportPreviewAttempt;
        })
        .filter((attempt): attempt is ReportPreviewAttempt => Boolean(attempt));

      return {
        serviceId,
        serviceEntryIndex,
        serviceEntryCount,
        serviceInstanceKey,
        serviceName: asString(service.serviceName, "Service"),
        status: asString(service.status, "pending"),
        verificationMode: asString(service.verificationMode),
        comment: asString(service.comment),
        candidateAnswers,
        attempts,
      } satisfies ReportPreviewService;
    })
    .filter((service): service is ReportPreviewService => Boolean(service));

  const splitSections = splitReportSections(services);
  const personalDetails =
    personalDetailsFromPayload.length > 0
      ? dedupePersonalDetailsAnswers(personalDetailsFromPayload)
      : splitSections.personalDetails;

  return {
    reportNumber: asString(root.reportNumber),
    generatedAt: asString(root.generatedAt),
    generatedByName: asString(root.generatedByName),
    candidate: {
      name: asString(candidate?.name),
      email: asString(candidate?.email),
      phone: asString(candidate?.phone),
    },
    company: {
      name: asString(company?.name),
      email: asString(company?.email),
    },
    status: asString(root.status, "pending"),
    createdAt: asString(root.createdAt),
    personalDetails,
    services: splitSections.services,
  };
}

type CandidateServiceResponse = NonNullable<RequestItem["candidateFormResponses"]>[number];
type CandidateServiceAnswer = CandidateServiceResponse["answers"][number];

function sortCandidateResponsesForDisplay(
  responses: CandidateServiceResponse[],
) {
  return responses
    .map((serviceResponse, index) => ({
      serviceResponse,
      index,
      isPersonalDetailsService: isPersonalDetailsServiceName(
        serviceResponse.serviceName,
      ),
    }))
    .sort((left, right) => {
      if (left.isPersonalDetailsService === right.isPersonalDetailsService) {
        return left.index - right.index;
      }

      return left.isPersonalDetailsService ? -1 : 1;
    })
    .map((entry) => entry.serviceResponse);
}

function resolveServiceResponseEntryCount(serviceResponse: CandidateServiceResponse) {
  const declaredCount = normalizePositiveInteger(serviceResponse.serviceEntryCount, 1);
  const maxRepeatableCount = serviceResponse.answers.reduce((maxCount, answer) => {
    const repeatableValues = parseRepeatableAnswerValues(answer.value, answer.repeatable);
    return Math.max(maxCount, repeatableValues.length || 1);
  }, 1);

  return Math.max(declaredCount, maxRepeatableCount, 1);
}

function getAnswerValueForEntry(answer: CandidateServiceAnswer, entryIndex: number) {
  const repeatableValues = parseRepeatableAnswerValues(answer.value, answer.repeatable);
  if (repeatableValues.length === 0) {
    return answer.value;
  }

  return repeatableValues[entryIndex] ?? "";
}

function resolveAnswerFileForEntry(answer: CandidateServiceAnswer, entryIndex: number) {
  const serviceEntryNumber = entryIndex + 1;
  const entryFile = (answer.entryFiles ?? [])
    .map((candidateEntryFile) => ({
      entryIndex: normalizePositiveInteger(candidateEntryFile.entryIndex, 1),
      fileName: (candidateEntryFile.fileName ?? "").trim(),
      fileData: (candidateEntryFile.fileData ?? "").trim(),
    }))
    .find(
      (candidateEntryFile) =>
        candidateEntryFile.entryIndex === serviceEntryNumber &&
        Boolean(candidateEntryFile.fileData),
    );

  if (entryFile) {
    return {
      fileName: entryFile.fileName,
      fileData: entryFile.fileData,
    };
  }

  return {
    fileName: (answer.fileName ?? "").trim(),
    fileData: (answer.fileData ?? "").trim(),
  };
}

function buildCandidateAnswersByServiceInstance(item: RequestItem) {
  const answersByServiceInstance = new Map<string, ReportPreviewCandidateAnswer[]>();

  for (const serviceResponse of item.candidateFormResponses ?? []) {
    const serviceId = serviceResponse.serviceId;
    if (!serviceId) {
      continue;
    }

    const serviceEntryCount = resolveServiceResponseEntryCount(serviceResponse);
    for (let entryIndex = 0; entryIndex < serviceEntryCount; entryIndex += 1) {
      const serviceEntryNumber = entryIndex + 1;
      const serviceInstanceKey = buildServiceInstanceKey(serviceId, serviceEntryNumber);
      const answers = serviceResponse.answers.map((answer) => {
        const fieldType = answer.fieldType;
        const resolvedFile = resolveAnswerFileForEntry(answer, entryIndex);
        const fileName = resolvedFile.fileName;
        const fileData = resolvedFile.fileData;
        const value =
          fieldType === "file" && fileData
            ? fileName || "Attachment"
            : getAnswerValueForEntry(answer, entryIndex).trim() || "-";

        return normalizePreviewAnswer({
          question: answer.question || "Field",
          value,
          fieldType,
          fileName,
          fileData,
        });
      });

      answersByServiceInstance.set(serviceInstanceKey, answers);
    }
  }

  return answersByServiceInstance;
}

function buildPersonalDetailsFromCandidateResponses(item: RequestItem) {
  const personalDetails: ReportPreviewCandidateAnswer[] = [];

  for (const serviceResponse of item.candidateFormResponses ?? []) {
    const isPersonalDetailsSection = isPersonalDetailsServiceName(
      serviceResponse.serviceName ?? "",
    );
    const serviceEntryCount = resolveServiceResponseEntryCount(serviceResponse);

    for (let entryIndex = 0; entryIndex < serviceEntryCount; entryIndex += 1) {
      for (const answer of serviceResponse.answers) {
        const fieldType = answer.fieldType;
        const resolvedFile = resolveAnswerFileForEntry(answer, entryIndex);
        const fileName = resolvedFile.fileName;
        const fileData = resolvedFile.fileData;
        const value =
          fieldType === "file" && fileData
            ? fileName || "Attachment"
            : getAnswerValueForEntry(answer, entryIndex).trim() || "-";

        const normalizedAnswer = normalizePreviewAnswer({
          question: answer.question || "Field",
          value,
          fieldType,
          fileName,
          fileData,
        });

        if (
          isPersonalDetailsSection ||
          isLikelyPersonalDetailsQuestion(normalizedAnswer.question)
        ) {
          personalDetails.push(normalizedAnswer);
        }
      }
    }
  }

  return dedupePersonalDetailsAnswers(personalDetails);
}

function buildReportPreviewData(item: RequestItem, viewerName: string) {
  const stored = parseStoredReportData(item.reportData);
  const hasSharedReport = Boolean(item.reportData);

  if (hasSharedReport && stored) {
    const services = splitReportSections(stored.services).services;
    const personalDetails =
      stored.personalDetails.length > 0
        ? dedupePersonalDetailsAnswers(stored.personalDetails)
        : splitReportSections(stored.services).personalDetails;
    const latestAttempt = services
      .flatMap((service) => service.attempts)
      .slice()
      .sort(
        (first, second) =>
          new Date(second.attemptedAt || 0).getTime() -
          new Date(first.attemptedAt || 0).getTime(),
      )[0];

    const generatedByName =
      stored.generatedByName ||
      item.reportMetadata?.generatedByName ||
      viewerName ||
      "Unknown";

    return {
      reportNumber: stored.reportNumber || `RPT-${item._id.slice(-8).toUpperCase()}`,
      generatedAt: stored.generatedAt || item.reportMetadata?.generatedAt || item.createdAt,
      generatedByName,
      candidate: {
        name: stored.candidate.name || "-",
        email: stored.candidate.email || "-",
        phone: stored.candidate.phone || "-",
      },
      company: {
        name: stored.company.name || "-",
        email: stored.company.email || "-",
      },
      status: stored.status || item.status,
      createdAt: stored.createdAt || item.createdAt,
      personalDetails,
      services,
      createdByName: generatedByName,
      verifiedByName:
        latestAttempt?.managerName ||
        latestAttempt?.verifierName ||
        generatedByName,
    } satisfies ReportPreviewData;
  }

  const candidateAnswersByServiceInstance =
    buildCandidateAnswersByServiceInstance(item);
  const personalDetailsFromCandidateResponses =
    buildPersonalDetailsFromCandidateResponses(item);

  const fallbackServices: ReportPreviewService[] =
    item.serviceVerifications && item.serviceVerifications.length > 0
      ? item.serviceVerifications.map((service) => {
          const serviceEntryIndex = normalizePositiveInteger(
            service.serviceEntryIndex,
            1,
          );
          const serviceEntryCount = Math.max(
            1,
            normalizePositiveInteger(service.serviceEntryCount, 1),
            serviceEntryIndex,
          );
          const serviceInstanceKey =
            service.serviceInstanceKey ||
            buildServiceInstanceKey(service.serviceId, serviceEntryIndex);

          return {
            serviceId: service.serviceId,
            serviceEntryIndex,
            serviceEntryCount,
            serviceInstanceKey,
            serviceName: formatServiceInstanceName(
              service.serviceName,
              serviceEntryIndex,
              serviceEntryCount,
            ),
            status: service.status,
            verificationMode: service.verificationMode,
            comment: service.comment,
            candidateAnswers:
              candidateAnswersByServiceInstance.get(serviceInstanceKey) ?? [],
            attempts: (service.attempts ?? []).map((attempt) => ({
              attemptedAt: attempt.attemptedAt,
              status: attempt.status,
              verificationMode: attempt.verificationMode,
              comment: attempt.comment,
              verifierName: attempt.verifierName ?? "",
              managerName: attempt.managerName ?? "",
              respondentName: attempt.respondentName ?? "",
              respondentEmail: attempt.respondentEmail ?? "",
              respondentComment: attempt.respondentComment ?? "",
            })),
          };
        })
      : (() => {
          const selectedServices = item.selectedServices ?? [];
          const totalCountByServiceId = new Map<string, number>();
          for (const selected of selectedServices) {
            totalCountByServiceId.set(
              selected.serviceId,
              (totalCountByServiceId.get(selected.serviceId) ?? 0) + 1,
            );
          }

          const entryIndexByServiceId = new Map<string, number>();
          return selectedServices.map((service) => {
            const serviceEntryIndex = (entryIndexByServiceId.get(service.serviceId) ?? 0) + 1;
            entryIndexByServiceId.set(service.serviceId, serviceEntryIndex);
            const serviceEntryCount = totalCountByServiceId.get(service.serviceId) ?? 1;
            const serviceInstanceKey = buildServiceInstanceKey(
              service.serviceId,
              serviceEntryIndex,
            );

            return {
              serviceId: service.serviceId,
              serviceEntryIndex,
              serviceEntryCount,
              serviceInstanceKey,
              serviceName: formatServiceInstanceName(
                service.serviceName,
                serviceEntryIndex,
                serviceEntryCount,
              ),
              status: "pending",
              verificationMode: "",
              comment: "",
              candidateAnswers:
                candidateAnswersByServiceInstance.get(serviceInstanceKey) ?? [],
              attempts: [],
            };
          });
        })();

  const sourceServices = stored?.services.length ? stored.services : fallbackServices;
  const splitSections = splitReportSections(sourceServices);
  const personalDetails =
    stored?.personalDetails && stored.personalDetails.length > 0
      ? dedupePersonalDetailsAnswers(stored.personalDetails)
      : dedupePersonalDetailsAnswers([
          ...splitSections.personalDetails,
          ...personalDetailsFromCandidateResponses,
        ]);
  const services = splitSections.services;
  const latestAttempt = services
    .flatMap((service) => service.attempts)
    .slice()
    .sort(
      (first, second) =>
        new Date(second.attemptedAt || 0).getTime() -
        new Date(first.attemptedAt || 0).getTime(),
    )[0];

  const generatedByName =
    item.reportMetadata?.generatedByName ||
    stored?.generatedByName ||
    item.createdByName ||
    viewerName ||
    "Unknown";

  return {
    reportNumber:
      item.reportMetadata?.reportNumber ||
      stored?.reportNumber ||
      `RPT-${item._id.slice(-8).toUpperCase()}`,
    generatedAt:
      item.reportMetadata?.generatedAt || stored?.generatedAt || item.createdAt,
    generatedByName,
    candidate: {
      name: stored?.candidate.name || item.candidateName || "-",
      email: stored?.candidate.email || item.candidateEmail || "-",
      phone: stored?.candidate.phone || item.candidatePhone || "-",
    },
    company: {
      name: stored?.company.name || item.invoiceSnapshot?.companyName || "-",
      email: stored?.company.email || item.invoiceSnapshot?.billingEmail || "-",
    },
    status: stored?.status || item.status,
    createdAt: stored?.createdAt || item.createdAt,
    personalDetails,
    services,
    createdByName: generatedByName,
    verifiedByName:
      latestAttempt?.managerName ||
      latestAttempt?.verifierName ||
      generatedByName,
  } satisfies ReportPreviewData;
}

function parseRepeatableAnswerValues(rawValue: string, repeatable?: boolean) {
  if (!repeatable) {
    return [];
  }

  const trimmedValue = rawValue.trim();
  if (!trimmedValue.startsWith("[")) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmedValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
  } catch {
    return [];
  }
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }

  return `${(kb / 1024).toFixed(2)} MB`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read attachment file."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not read attachment file."));
        return;
      }

      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function buildAppealServiceOptions(item: RequestItem | null) {
  if (!item) {
    return [] as Array<{ serviceId: string; serviceName: string }>;
  }

  const optionsMap = new Map<string, { serviceId: string; serviceName: string }>();

  for (const service of item.serviceVerifications ?? []) {
    const serviceId = String(service.serviceId || "").trim();
    if (!serviceId) {
      continue;
    }

    optionsMap.set(serviceId, {
      serviceId,
      serviceName: service.serviceName || "Service",
    });
  }

  for (const service of item.selectedServices ?? []) {
    const serviceId = String(service.serviceId || "").trim();
    if (!serviceId || optionsMap.has(serviceId)) {
      continue;
    }

    optionsMap.set(serviceId, {
      serviceId,
      serviceName: service.serviceName || "Service",
    });
  }

  return [...optionsMap.values()];
}

function resolveAppealServices(appeal: RequestItem["reverificationAppeal"] | null | undefined) {
  if (!appeal) {
    return [] as Array<{ serviceId: string; serviceName: string }>;
  }

  const fromList = (appeal.services ?? [])
    .map((service) => ({
      serviceId: String(service.serviceId || "").trim(),
      serviceName: (service.serviceName || "Service").trim(),
    }))
    .filter((service) => Boolean(service.serviceId));

  if (fromList.length > 0) {
    return fromList;
  }

  const fallbackServiceId = String(appeal.serviceId || "").trim();
  if (!fallbackServiceId) {
    return [] as Array<{ serviceId: string; serviceName: string }>;
  }

  return [
    {
      serviceId: fallbackServiceId,
      serviceName: (appeal.serviceName || "Service").trim() || "Service",
    },
  ];
}

function toAppealServiceLabel(appeal: RequestItem["reverificationAppeal"] | null | undefined) {
  const names = resolveAppealServices(appeal)
    .map((service) => service.serviceName)
    .filter(Boolean);
  if (names.length === 0) {
    return "-";
  }

  return names.join(", ");
}

type PendingExtraPaymentApprovalEntry = {
  serviceId: string;
  serviceEntryIndex: number;
  serviceInstanceKey: string;
  serviceName: string;
  attemptedAt: string;
  amount: number;
  currency: string;
  comment: string;
  verifierName: string;
  managerName: string;
  screenshotFileName: string;
  screenshotData: string;
};

function normalizeExtraPaymentApprovalStatus(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "not-requested" ||
    normalized === "pending" ||
    normalized === "approved" ||
    normalized === "rejected"
  ) {
    return normalized;
  }

  return "not-requested";
}

function resolveServiceCurrency(item: RequestItem, serviceId: string) {
  const selectedService = (item.selectedServices ?? []).find(
    (service) => String(service.serviceId || "").trim() === serviceId,
  );
  return selectedService?.currency ?? "INR";
}

function getPendingExtraPaymentApprovals(item: RequestItem) {
  const approvals: PendingExtraPaymentApprovalEntry[] = [];

  for (const service of item.serviceVerifications ?? []) {
    const serviceId = String(service.serviceId || "").trim();
    if (!serviceId) {
      continue;
    }

    const serviceEntryIndex = normalizePositiveInteger(service.serviceEntryIndex, 1);
    const serviceEntryCount = Math.max(
      1,
      normalizePositiveInteger(service.serviceEntryCount, 1),
      serviceEntryIndex,
    );
    const serviceInstanceKey =
      service.serviceInstanceKey || buildServiceInstanceKey(serviceId, serviceEntryIndex);
    const serviceName = formatServiceInstanceName(
      service.serviceName || "Service",
      serviceEntryIndex,
      serviceEntryCount,
    );
    const serviceCurrency = resolveServiceCurrency(item, serviceId);

    for (const attempt of service.attempts ?? []) {
      const approvalStatus = normalizeExtraPaymentApprovalStatus(
        attempt.extraPaymentApprovalStatus,
      );
      const amount =
        typeof attempt.extraPaymentAmount === "number" &&
        Number.isFinite(attempt.extraPaymentAmount) &&
        attempt.extraPaymentAmount > 0
          ? Math.round(attempt.extraPaymentAmount * 100) / 100
          : null;

      if (!attempt.extraPaymentApprovalRequested || approvalStatus !== "pending" || !amount) {
        continue;
      }

      approvals.push({
        serviceId,
        serviceEntryIndex,
        serviceInstanceKey,
        serviceName,
        attemptedAt: attempt.attemptedAt,
        amount,
        currency: serviceCurrency,
        comment: attempt.comment ?? "",
        verifierName: attempt.verifierName ?? "",
        managerName: attempt.managerName ?? "",
        screenshotFileName: attempt.screenshotFileName ?? "",
        screenshotData: attempt.screenshotData ?? "",
      });
    }
  }

  return approvals.sort(
    (first, second) =>
      new Date(second.attemptedAt || 0).getTime() -
      new Date(first.attemptedAt || 0).getTime(),
  );
}

function buildExtraPaymentDecisionKey(
  requestId: string,
  serviceId: string,
  serviceEntryIndex: number,
  attemptedAt: string,
) {
  return `${requestId}:${serviceId}:${serviceEntryIndex}:${attemptedAt}`;
}

function RequestsPageContent() {
  const { me, loading, logout } = usePortalSession();
  const searchParams = useSearchParams();
  const requestsEnabled = Boolean(me) && me?.companyAccessStatus !== "inactive";
  const { items, loading: requestsLoading, refreshRequests } = useRequestsData({
    enabled: requestsEnabled,
  });
  const [requestsReady, setRequestsReady] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [createdDateFrom, setCreatedDateFrom] = useState("");
  const [createdDateTo, setCreatedDateTo] = useState("");
  const [quickFilter, setQuickFilter] = useState<"all" | RequestStatus | "forms">("all");
  const [message, setMessage] = useState("");
  const [highlightedRequestId, setHighlightedRequestId] = useState("");
  const [selectedActionRowId, setSelectedActionRowId] = useState("");
  const [activeResponseRequestId, setActiveResponseRequestId] = useState("");
  const [activeReportRequestId, setActiveReportRequestId] = useState("");
  const [downloadingReportRequestId, setDownloadingReportRequestId] = useState("");
  const [isAppealFormOpen, setIsAppealFormOpen] = useState(false);
  const [appealSelectedServiceIds, setAppealSelectedServiceIds] = useState<string[]>([]);
  const [appealComment, setAppealComment] = useState("");
  const [appealAttachmentFileName, setAppealAttachmentFileName] = useState("");
  const [appealAttachmentMimeType, setAppealAttachmentMimeType] = useState("");
  const [appealAttachmentFileSize, setAppealAttachmentFileSize] = useState<number | null>(null);
  const [appealAttachmentData, setAppealAttachmentData] = useState("");
  const [submittingAppealRequestId, setSubmittingAppealRequestId] = useState("");
  const [isRejectSelectorOpen, setIsRejectSelectorOpen] = useState(false);
  const [selectedRejectedFieldKeys, setSelectedRejectedFieldKeys] = useState<string[]>([]);
  const [rejectionComment, setRejectionComment] = useState("");
  const [rejectingRequestId, setRejectingRequestId] = useState("");
  const [decisioningRequestId, setDecisioningRequestId] = useState("");
  const [paymentDecisioningKey, setPaymentDecisioningKey] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const [manualRefreshInProgress, setManualRefreshInProgress] = useState(false);
  const [resendingCandidateLinkRequestId, setResendingCandidateLinkRequestId] = useState("");
  const [loadingCandidateLinkPreviewRequestId, setLoadingCandidateLinkPreviewRequestId] = useState("");
  const [candidateLinkEmailPreview, setCandidateLinkEmailPreview] =
    useState<CandidateLinkEmailPreview | null>(null);

  const [editingRequestId, setEditingRequestId] = useState("");
  const [editCandidateName, setEditCandidateName] = useState("");
  const [editCandidateEmail, setEditCandidateEmail] = useState("");
  const [editCandidatePhone, setEditCandidatePhone] = useState("");
  const [editSelectedServiceIds, setEditSelectedServiceIds] = useState<string[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const focusRequestId = searchParams.get("requestId")?.trim() ?? "";

  useEffect(() => {
    if (!me) {
      return;
    }

    if (!requestsEnabled) {
      setRequestsReady(true);
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
  }, [me, refreshRequests, requestsEnabled]);

  const normalizedSearch = searchText.trim().toLowerCase();

  const baseFilteredRequests = useMemo(() => {
    return items.filter((item) => {
      const itemCreatedDate = toLocalDateKey(item.createdAt);

      if (normalizedSearch) {
        const searchable = [
          item.candidateName,
          item.candidateEmail,
          item.candidatePhone,
          item.status,
          item.rejectionNote,
          item.createdByName,
          item.delegateName,
          itemCreatedDate,
          (item.selectedServices ?? []).map((service) => service.serviceName).join(" "),
        ]
          .join(" ")
          .toLowerCase();

        if (!searchable.includes(normalizedSearch)) {
          return false;
        }
      }

      if (createdDateFrom && (!itemCreatedDate || itemCreatedDate < createdDateFrom)) {
        return false;
      }

      if (createdDateTo && (!itemCreatedDate || itemCreatedDate > createdDateTo)) {
        return false;
      }

      return true;
    });
  }, [items, normalizedSearch, createdDateFrom, createdDateTo]);

  const requestCounts = useMemo(
    () => ({
      pending: baseFilteredRequests.filter((item) => item.status === "pending").length,
      approved: baseFilteredRequests.filter((item) => item.status === "approved").length,
      verified: baseFilteredRequests.filter((item) => item.status === "verified").length,
      rejected: baseFilteredRequests.filter((item) => item.status === "rejected").length,
      forms: baseFilteredRequests.filter((item) => item.candidateFormStatus === "submitted").length,
    }),
    [baseFilteredRequests],
  );

  const filteredRequests = useMemo(() => {
    if (quickFilter === "all") {
      return baseFilteredRequests;
    }

    if (quickFilter === "forms") {
      return baseFilteredRequests.filter((item) => item.candidateFormStatus === "submitted");
    }

    return baseFilteredRequests.filter((item) => item.status === quickFilter);
  }, [baseFilteredRequests, quickFilter]);

  const totalTablePages = useMemo(
    () => Math.max(1, Math.ceil(filteredRequests.length / REQUESTS_PER_PAGE)),
    [filteredRequests.length],
  );

  const paginatedRequests = useMemo(() => {
    const startIndex = (tablePage - 1) * REQUESTS_PER_PAGE;
    return filteredRequests.slice(startIndex, startIndex + REQUESTS_PER_PAGE);
  }, [filteredRequests, tablePage]);

  const currentPageStart = filteredRequests.length
    ? (tablePage - 1) * REQUESTS_PER_PAGE + 1
    : 0;
  const currentPageEnd = Math.min(tablePage * REQUESTS_PER_PAGE, filteredRequests.length);

  useEffect(() => {
    if (tablePage > totalTablePages) {
      setTablePage(totalTablePages);
    }
  }, [tablePage, totalTablePages]);

  function toggleQuickFilter(nextFilter: "all" | RequestStatus | "forms") {
    setQuickFilter((current) => (current === nextFilter ? "all" : nextFilter));
  }

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
      setCreatedDateFrom("");
      setCreatedDateTo("");
      setQuickFilter("all");
      setHighlightedRequestId(focusRequestId);
      const focusedRequestIndex = items.findIndex((item) => item._id === focusRequestId);
      if (focusedRequestIndex >= 0) {
        setTablePage(Math.floor(focusedRequestIndex / REQUESTS_PER_PAGE) + 1);
      }
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

  async function manuallyRefreshRequestTable() {
    if (!requestsEnabled || manualRefreshInProgress) {
      return;
    }

    setMessage("");
    setManualRefreshInProgress(true);

    try {
      await refreshRequests();
      setMessage("Requests list refreshed.");
    } catch {
      setMessage("Could not refresh requests right now.");
    } finally {
      setManualRefreshInProgress(false);
    }
  }

  const activeResponseRequest = useMemo(
    () => items.find((item) => item._id === activeResponseRequestId) ?? null,
    [activeResponseRequestId, items],
  );

  const activeReportRequest = useMemo(
    () => items.find((item) => item._id === activeReportRequestId) ?? null,
    [activeReportRequestId, items],
  );

  const candidateLinkPreviewRequest = useMemo(
    () =>
      candidateLinkEmailPreview
        ? items.find((item) => item._id === candidateLinkEmailPreview.requestId) ?? null
        : null,
    [candidateLinkEmailPreview, items],
  );

  const activeReportAppealServiceOptions = useMemo(
    () => buildAppealServiceOptions(activeReportRequest),
    [activeReportRequest],
  );

  const activeReportAppeal = activeReportRequest?.reverificationAppeal ?? null;
  const activeReportCanAppeal = activeReportRequest
    ? canAppealReverification(activeReportRequest)
    : false;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const activeDecisionWindow = useMemo(() => {
    if (!activeResponseRequest) {
      return null;
    }

    return getEnterpriseDecisionWindow(activeResponseRequest, nowMs);
  }, [activeResponseRequest, nowMs]);

  const activePendingExtraPaymentApprovals = useMemo(
    () =>
      activeResponseRequest ? getPendingExtraPaymentApprovals(activeResponseRequest) : [],
    [activeResponseRequest],
  );

  function closeResponseModal() {
    setActiveResponseRequestId("");
    setIsRejectSelectorOpen(false);
    setSelectedRejectedFieldKeys([]);
    setRejectionComment("");
  }

  function clearAppealAttachment() {
    setAppealAttachmentFileName("");
    setAppealAttachmentMimeType("");
    setAppealAttachmentFileSize(null);
    setAppealAttachmentData("");
  }

  function resetAppealComposer() {
    setIsAppealFormOpen(false);
    setAppealSelectedServiceIds([]);
    setAppealComment("");
    clearAppealAttachment();
  }

  function openAppealComposer(item: RequestItem) {
    const options = buildAppealServiceOptions(item);
    setAppealSelectedServiceIds(options.length > 0 ? [options[0].serviceId] : []);
    setAppealComment("");
    clearAppealAttachment();
    setIsAppealFormOpen(true);
  }

  function toggleAppealServiceSelection(serviceId: string, checked: boolean) {
    setAppealSelectedServiceIds((prev) => {
      if (checked) {
        if (prev.includes(serviceId)) {
          return prev;
        }

        return [...prev, serviceId];
      }

      return prev.filter((id) => id !== serviceId);
    });
  }

  async function selectAppealAttachment(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const selectedFile = input.files?.[0];

    if (!selectedFile) {
      clearAppealAttachment();
      return;
    }

    const normalizedMimeType = selectedFile.type.trim().toLowerCase();
    if (!APPEAL_ATTACHMENT_MIME_TYPES.has(normalizedMimeType)) {
      setMessage("Attachment must be PDF, PNG, JPG, or WEBP.");
      input.value = "";
      return;
    }

    if (selectedFile.size > MAX_APPEAL_ATTACHMENT_BYTES) {
      setMessage("Attachment must be 5MB or smaller.");
      input.value = "";
      return;
    }

    try {
      const attachmentData = await readFileAsDataUrl(selectedFile);
      setAppealAttachmentFileName(selectedFile.name);
      setAppealAttachmentMimeType(normalizedMimeType);
      setAppealAttachmentFileSize(selectedFile.size);
      setAppealAttachmentData(attachmentData);
      setMessage(`Attachment selected: ${selectedFile.name} (${formatFileSize(selectedFile.size)}).`);
      input.value = "";
    } catch {
      setMessage("Could not read attachment file. Please try another file.");
      input.value = "";
    }
  }

  async function submitReverificationAppeal() {
    if (!activeReportRequest) {
      return;
    }

    if (!canAppealReverification(activeReportRequest)) {
      setMessage("Appeal is not allowed once validation is completed.");
      return;
    }

    if (activeReportRequest.reverificationAppeal?.status === "open") {
      setMessage("An appeal is already pending for this request.");
      return;
    }

    const trimmedComment = appealComment.trim();
    if (appealSelectedServiceIds.length === 0) {
      setMessage("Please select at least one service to appeal.");
      return;
    }

    if (trimmedComment.length < 3) {
      setMessage("Please enter at least 3 characters in the appeal comment.");
      return;
    }

    setMessage("");
    setSubmittingAppealRequestId(activeReportRequest._id);

    const response = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "appeal-reverification",
        requestId: activeReportRequest._id,
        serviceIds: appealSelectedServiceIds,
        comment: trimmedComment,
        attachmentFileName: appealAttachmentFileName,
        attachmentMimeType: appealAttachmentMimeType,
        attachmentFileSize: appealAttachmentFileSize,
        attachmentData: appealAttachmentData,
      }),
    });

    const data = (await response.json()) as { message?: string; error?: string };
    setSubmittingAppealRequestId("");

    if (!response.ok) {
      setMessage(data.error ?? "Could not submit reverification appeal.");
      return;
    }

    setMessage(data.message ?? "Appeal submitted for reverification.");
    resetAppealComposer();
    await refreshRequests();
  }

  function openSharedReport(item: RequestItem) {
    const canViewSharedReport = canOpenSharedReport(item);

    if (!canViewSharedReport) {
      setMessage("Report is not shared with customer portal yet.");
      return;
    }

    setActiveResponseRequestId("");
    resetAppealComposer();
    setActiveReportRequestId(item._id);
  }

  function closeSharedReportModal() {
    resetAppealComposer();
    setActiveReportRequestId("");
  }

  async function downloadSharedReport(item: RequestItem) {
    setMessage("");
    setDownloadingReportRequestId(item._id);

    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(item._id)}/report`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string; details?: string }
          | null;
        const base = data?.error ?? "Could not download report.";
        const details = data?.details?.trim();
        setMessage(details ? `${base} (${details})` : base);
        setDownloadingReportRequestId("");
        return;
      }

      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      const reportName = item.reportMetadata?.reportNumber?.trim() || item._id;
      link.download = `${reportName.replace(/[^a-zA-Z0-9_-]+/g, "_")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch {
      setMessage("Could not download report.");
    } finally {
      setDownloadingReportRequestId("");
    }
  }

  function openRejectSelector(item: RequestItem) {
    const preselected = (item.customerRejectedFields ?? []).map((field) =>
      buildRejectedFieldKey(field.serviceId, field.question, field.fieldKey ?? ""),
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

    const decisionWindow = getEnterpriseDecisionWindow(activeResponseRequest, Date.now());
    if (decisionWindow.isLocked) {
      setMessage(
        "Rejection window expired. This approved request is locked for enterprise corrections.",
      );
      return;
    }

    const rejectedFields = selectedRejectedFieldKeys
      .map((fieldKey) => parseRejectedFieldKey(fieldKey))
      .filter(
        (field): field is { serviceId: string; question: string; fieldKey: string } =>
          Boolean(field),
      );

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

  async function submitEnterpriseDecision(action: "enterprise-approve" | "enterprise-reject") {
    if (!activeResponseRequest) {
      return;
    }

    if (activeResponseRequest.candidateFormStatus !== "submitted") {
      setMessage("Candidate has not submitted form data yet.");
      return;
    }

    if (activeResponseRequest.status === "verified") {
      setMessage("Verified requests cannot be changed from enterprise portal.");
      return;
    }

    const decisionWindow = getEnterpriseDecisionWindow(activeResponseRequest, Date.now());
    if (action === "enterprise-reject" && decisionWindow.isLocked) {
      setMessage(
        "Rejection window expired. This approved request is locked and handed off for verification.",
      );
      return;
    }

    if (action === "enterprise-approve" && activeResponseRequest.status === "approved") {
      setMessage("This request is already approved by enterprise.");
      return;
    }

    if (action === "enterprise-approve") {
      const isConfirmed = window.confirm("Confirm approve this request?");
      if (!isConfirmed) {
        return;
      }
    }

    let rejectionNote = "";
    if (action === "enterprise-reject") {
      const note = window.prompt(
        "Optional rejection note for the team:",
        "Rejected by enterprise.",
      );

      if (note === null) {
        return;
      }

      rejectionNote = note.trim();

      const isConfirmed = window.confirm("Confirm reject this request?");
      if (!isConfirmed) {
        return;
      }
    }

    setMessage("");
    setDecisioningRequestId(activeResponseRequest._id);

    const res = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        requestId: activeResponseRequest._id,
        rejectionNote,
      }),
    });

    const data = (await res.json()) as { message?: string; error?: string };
    setDecisioningRequestId("");

    if (!res.ok) {
      setMessage(data.error ?? "Could not update request status.");
      return;
    }

    setMessage(data.message ?? "Request status updated.");
    closeResponseModal();
    await refreshRequests();
  }

  async function submitExtraPaymentDecision(
    item: RequestItem,
    approval: PendingExtraPaymentApprovalEntry,
    decision: "approve" | "reject",
  ) {
    const decisionKey = buildExtraPaymentDecisionKey(
      item._id,
      approval.serviceId,
      approval.serviceEntryIndex,
      approval.attemptedAt,
    );

    let rejectionNote = "";

    if (decision === "approve") {
      const isConfirmed = window.confirm(
        `Approve extra payment ${approval.currency} ${approval.amount.toFixed(2)} for ${approval.serviceName}?`,
      );
      if (!isConfirmed) {
        return;
      }
    } else {
      const note = window.prompt(
        "Optional note for rejection:",
        "Rejected by customer.",
      );
      if (note === null) {
        return;
      }

      rejectionNote = note.trim();
      const isConfirmed = window.confirm(
        `Reject extra payment ${approval.currency} ${approval.amount.toFixed(2)} for ${approval.serviceName}?`,
      );
      if (!isConfirmed) {
        return;
      }
    }

    setMessage("");
    setPaymentDecisioningKey(decisionKey);

    const response = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "extra-payment-approval-decision",
        requestId: item._id,
        serviceId: approval.serviceId,
        serviceEntryIndex: approval.serviceEntryIndex,
        attemptedAt: approval.attemptedAt,
        decision,
        rejectionNote,
      }),
    });

    const data = (await response.json()) as { message?: string; error?: string };
    setPaymentDecisioningKey("");

    if (!response.ok) {
      setMessage(data.error ?? "Could not update extra payment approval status.");
      return;
    }

    setMessage(
      data.message ??
        (decision === "approve"
          ? "Extra payment request approved."
          : "Extra payment request rejected."),
    );
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

  async function openCandidateLinkEmailPreview(item: RequestItem) {
    setMessage("");
    setLoadingCandidateLinkPreviewRequestId(item._id);

    const response = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "preview-candidate-link-email",
        requestId: item._id,
      }),
    });

    const data = (await response.json()) as {
      message?: string;
      error?: string;
      recipientEmail?: string;
      userId?: string;
      temporaryPassword?: string;
      subject?: string;
      text?: string;
      html?: string;
      portalUrl?: string;
    };
    setLoadingCandidateLinkPreviewRequestId("");

    if (!response.ok) {
      setMessage(data.error ?? "Could not generate candidate email preview.");
      return;
    }

    setCandidateLinkEmailPreview({
      requestId: item._id,
      candidateName: item.candidateName,
      recipientEmail: data.recipientEmail || item.candidateEmail || "-",
      userId: data.userId || data.recipientEmail || item.candidateEmail || "-",
      temporaryPassword: data.temporaryPassword || "",
      subject: data.subject || "Background Verification Request",
      text: data.text || "",
      html: data.html || "",
      portalUrl: data.portalUrl || "",
    });
  }

  async function resendCandidateLink(item: RequestItem) {
    setMessage("");
    setResendingCandidateLinkRequestId(item._id);

    const response = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "resend-candidate-link",
        requestId: item._id,
      }),
    });

    const data = (await response.json()) as {
      message?: string;
      error?: string;
      recipientEmail?: string;
      userId?: string;
      temporaryPassword?: string;
      subject?: string;
      text?: string;
      html?: string;
      portalUrl?: string;
    };
    setResendingCandidateLinkRequestId("");

    if (data.subject && data.text) {
      setCandidateLinkEmailPreview({
        requestId: item._id,
        candidateName: item.candidateName,
        recipientEmail: data.recipientEmail || item.candidateEmail || "-",
        userId: data.userId || data.recipientEmail || item.candidateEmail || "-",
        temporaryPassword: data.temporaryPassword || "",
        subject: data.subject,
        text: data.text,
        html: data.html || "",
        portalUrl: data.portalUrl || "",
      });
    }

    if (!response.ok) {
      setMessage(data.error ?? "Could not resend candidate link.");
      return;
    }

    setMessage(data.message ?? "Candidate form link resent successfully.");
    await refreshRequests();
  }

  function closeCandidateLinkEmailPreview() {
    setCandidateLinkEmailPreview(null);
  }

  async function copyCandidateLinkEmailPreview() {
    if (!candidateLinkEmailPreview) {
      return;
    }

    const composed = [
      `To: ${candidateLinkEmailPreview.recipientEmail}`,
      `Subject: ${candidateLinkEmailPreview.subject}`,
      "",
      candidateLinkEmailPreview.text,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(composed);
      setMessage("Candidate email content copied. You can paste and share it manually.");
    } catch {
      setMessage("Could not copy email content. Please copy the text manually.");
    }
  }

  async function copyCandidatePortalLink() {
    if (!candidateLinkEmailPreview) {
      return;
    }

    const portalLink = candidateLinkEmailPreview.portalUrl.trim();
    if (!portalLink) {
      setMessage("Candidate portal link is unavailable for this request.");
      return;
    }

    try {
      await navigator.clipboard.writeText(portalLink);
      setMessage("Candidate portal link copied.");
    } catch {
      setMessage("Could not copy portal link. Please copy it manually from the email body.");
    }
  }

  function renderResponseContent(item: RequestItem) {
    const serviceResponses = sortCandidateResponsesForDisplay(
      item.candidateFormResponses ?? [],
    );
    const serviceResponseEntries = serviceResponses.flatMap((serviceResponse) => {
      const serviceEntryCount = resolveServiceResponseEntryCount(serviceResponse);

      return Array.from({ length: serviceEntryCount }, (_, entryIndex) => {
        const serviceEntryNumber = entryIndex + 1;
        return {
          serviceId: serviceResponse.serviceId,
          serviceEntryNumber,
          serviceEntryCount,
          serviceDisplayName: formatServiceInstanceName(
            serviceResponse.serviceName,
            serviceEntryNumber,
            serviceEntryCount,
          ),
          answers: serviceResponse.answers,
          entryIndex,
        };
      });
    });

    const totalServices = serviceResponseEntries.length;
    const totalFields = serviceResponseEntries.reduce(
      (count, serviceResponseEntry) => count + serviceResponseEntry.answers.length,
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

        {serviceResponseEntries.map((serviceResponseEntry) => (
          <section
            key={`${item._id}-${serviceResponseEntry.serviceId}-${serviceResponseEntry.serviceEntryNumber}`}
            style={{
              border: "1px solid #DDE5EF",
              borderRadius: "10px",
              padding: "0.7rem",
              background: "#FFFFFF",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.7rem", flexWrap: "wrap" }}>
              <strong style={{ color: "#2D405E", fontSize: "0.95rem" }}>
                {serviceResponseEntry.serviceDisplayName}
              </strong>
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
                {serviceResponseEntry.answers.length} fields
              </span>
            </div>

            <div style={{ marginTop: "0.55rem" }}>
              {serviceResponseEntry.answers.length === 0 ? (
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
                      {serviceResponseEntry.answers.map((answer, answerIndex) => {
                        const resolvedFile = resolveAnswerFileForEntry(
                          answer,
                          serviceResponseEntry.entryIndex,
                        );
                        const answerValueForEntry = getAnswerValueForEntry(
                          answer,
                          serviceResponseEntry.entryIndex,
                        ).trim();
                        const valueText =
                          answer.fieldType === "file"
                            ? resolvedFile.fileName || "File uploaded"
                            : answerValueForEntry || "-";

                        return (
                          <tr
                            key={`${serviceResponseEntry.serviceId}-${serviceResponseEntry.serviceEntryNumber}-${answerIndex}`}
                            style={{ borderBottom: "1px solid #F0F3F8" }}
                          >
                            <td style={{ padding: "0.55rem 0.45rem", fontWeight: 600, color: "#2D405E" }}>{answer.question}</td>
                            <td style={{ padding: "0.55rem 0.45rem", color: "#334A67", maxWidth: "300px" }}>
                              <span style={{ whiteSpace: answer.fieldType === "long_text" ? "pre-wrap" : "normal", wordBreak: "break-word" }}>
                                {valueText}
                              </span>
                            </td>
                            <td style={{ padding: "0.55rem 0.45rem" }}>
                              {answer.fieldType === "file" && resolvedFile.fileData ? (
                                <a
                                  href={resolvedFile.fileData}
                                  download={
                                    resolvedFile.fileName ||
                                    `attachment-${serviceResponseEntry.serviceEntryNumber}-${answerIndex}`
                                  }
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

  function renderSharedReportPreview(item: RequestItem) {
    const report = buildReportPreviewData(item, me?.name ?? "Unknown");

    return (
      <div style={{ overflowX: "auto" }}>
        <article
          style={{
            minWidth: "880px",
            background: "#E8E8E8",
            border: "3px solid #8E1525",
            padding: "4px",
            boxShadow: "0 8px 30px rgba(15, 23, 42, 0.18)",
          }}
        >
          <div
            style={{
              border: "1px solid #BBB26A",
              padding: "2.4rem 2.7rem 1.6rem",
              color: "#111111",
              fontFamily: '"Times New Roman", Georgia, serif',
            }}
          >
            <header
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "2rem",
              }}
            >
              <div
                style={{
                  width: "200px",
                  height: "170px",
                  border: "1px solid #8A8A8A",
                  background: "#F4F4F4",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                <Image
                  src="/images/cluso-infolink-logo.png"
                  alt="Cluso Infolink"
                  width={176}
                  height={150}
                  style={{ width: "88%", height: "88%", objectFit: "contain" }}
                />
              </div>

              <div
                style={{
                  color: "#5A5A5A",
                  fontSize: "1.05rem",
                  lineHeight: 1.45,
                  textAlign: "right",
                  marginTop: "3.4rem",
                }}
              >
                <div>
                  <span style={{ fontWeight: 700, color: "#474747" }}>Report #:</span>{" "}
                  {report.reportNumber}
                </div>
                <div>
                  <span style={{ fontWeight: 700, color: "#474747" }}>Date:</span>{" "}
                  {formatReportDate(report.generatedAt)}
                </div>
              </div>
            </header>

            <h2
              style={{
                textAlign: "center",
                margin: "2.1rem 0 0.85rem",
                color: "#1F4597",
                fontWeight: 700,
                fontSize: "3.15rem",
                lineHeight: 1.1,
              }}
            >
              Verification Report
            </h2>

            <section
              style={{
                border: "1px solid #D1D1D1",
                borderRadius: "6px",
                padding: "0.8rem 1.05rem",
                background: "rgba(255,255,255,0.43)",
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                columnGap: "1.3rem",
                rowGap: "0.25rem",
                fontSize: "1.03rem",
              }}
            >
              <div>
                <div>
                  <strong>Report Number:</strong> {report.reportNumber}
                </div>
                <div>
                  <strong>Request Created:</strong>{" "}
                  {formatReportDateTime(report.createdAt)}
                </div>
                <div>
                  <strong>Overall Status:</strong>{" "}
                  <span
                    style={{
                      color: getReportStatusColor(report.status),
                      fontWeight: 700,
                    }}
                  >
                    {toReportStatusLabel(report.status)}
                  </span>
                </div>
              </div>
              <div>
                <div>
                  <strong>Generated At:</strong>{" "}
                  {formatReportDateTime(report.generatedAt)}
                </div>
                <div>
                  <strong>Generated By:</strong> {report.generatedByName || "-"}
                </div>
              </div>
            </section>

            <section
              style={{
                marginTop: "1.45rem",
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "2.2rem",
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    color: "#1F4597",
                    fontSize: "1.65rem",
                    fontWeight: 700,
                  }}
                >
                  Candidate Details
                </h3>
                <p
                  style={{
                    margin: "0.65rem 0 0",
                    fontSize: "1.14rem",
                    lineHeight: 1.4,
                  }}
                >
                  <strong>Name:</strong> {report.candidate.name || "-"}
                  <br />
                  <strong>Email:</strong> {report.candidate.email || "-"}
                  <br />
                  <strong>Phone:</strong> {report.candidate.phone || "-"}
                </p>
              </div>

              <div>
                <h3
                  style={{
                    margin: 0,
                    color: "#1F4597",
                    fontSize: "1.65rem",
                    fontWeight: 700,
                  }}
                >
                  Company Details
                </h3>
                <p
                  style={{
                    margin: "0.65rem 0 0",
                    fontSize: "1.14rem",
                    lineHeight: 1.4,
                  }}
                >
                  <strong>Company:</strong> {report.company.name || "-"}
                  <br />
                  <strong>Email:</strong> {report.company.email || "-"}
                </p>
              </div>
            </section>

            {report.personalDetails.length > 0 ? (
              <section style={{ marginTop: "1.05rem" }}>
                <h3
                  style={{
                    margin: 0,
                    color: "#1F4597",
                    fontSize: "1.52rem",
                    fontWeight: 700,
                  }}
                >
                  Personal Details
                </h3>
                <div style={{ overflowX: "auto", marginTop: "0.45rem" }}>
                  <table
                    style={{
                      width: "100%",
                      minWidth: "690px",
                      borderCollapse: "collapse",
                      fontSize: "0.94rem",
                      border: "1px solid #CBD5E1",
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#F8FAFC", textAlign: "left" }}>
                        <th style={{ padding: "0.3rem 0.35rem", width: "42%" }}>Field</th>
                        <th style={{ padding: "0.3rem 0.35rem" }}>Response</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.personalDetails.map((detail, detailIndex) => (
                        <tr
                          key={`${item._id}-preview-personal-detail-${detailIndex}`}
                          style={{ borderTop: "1px solid #E2E8F0", verticalAlign: "top" }}
                        >
                          <td style={{ padding: "0.35rem" }}>{detail.question || "Field"}</td>
                          <td style={{ padding: "0.35rem", lineHeight: 1.35 }}>
                            {detail.fieldType === "file" && detail.fileData ? (
                              <span style={{ display: "inline-flex", gap: "0.55rem", flexWrap: "wrap" }}>
                                <span>{detail.fileName || "Attachment"}</span>
                                <a
                                  href={detail.fileData}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: "#2563EB", textDecoration: "none" }}
                                  onMouseEnter={(event) =>
                                    (event.currentTarget.style.textDecoration = "underline")
                                  }
                                  onMouseLeave={(event) =>
                                    (event.currentTarget.style.textDecoration = "none")
                                  }
                                >
                                  View
                                </a>
                                <a
                                  href={detail.fileData}
                                  download={detail.fileName || `personal-detail-${detailIndex + 1}`}
                                  style={{ color: "#2563EB", textDecoration: "none" }}
                                  onMouseEnter={(event) =>
                                    (event.currentTarget.style.textDecoration = "underline")
                                  }
                                  onMouseLeave={(event) =>
                                    (event.currentTarget.style.textDecoration = "none")
                                  }
                                >
                                  Download
                                </a>
                              </span>
                            ) : (
                              detail.value || "-"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <div style={{ borderTop: "1px solid #717171", marginTop: "1.1rem" }} />

            <section style={{ marginTop: "1.35rem" }}>
              <h3
                style={{
                  margin: 0,
                  color: "#1F4597",
                  fontSize: "2.05rem",
                  fontWeight: 700,
                }}
              >
                Service Verification Summary
              </h3>

              <div style={{ marginTop: "0.75rem", display: "grid", gap: "1rem" }}>
                {report.services.map((service, serviceIndex) => {
                  const attempts = service.attempts
                    .slice()
                    .sort(
                      (first, second) =>
                        new Date(second.attemptedAt || 0).getTime() -
                        new Date(first.attemptedAt || 0).getTime(),
                    );

                  return (
                    <section key={`${item._id}-preview-service-${serviceIndex}`}>
                      <h4 style={{ margin: 0, fontWeight: 700, fontSize: "1.4rem" }}>
                        {serviceIndex + 1}. {service.serviceName}
                      </h4>
                      <p
                        style={{
                          margin: "0.4rem 0 0",
                          fontSize: "1.08rem",
                          lineHeight: 1.35,
                        }}
                      >
                        <strong>Final Status:</strong>{" "}
                        <span
                          style={{
                            color: getReportStatusColor(service.status),
                            fontWeight: 700,
                          }}
                        >
                          {toReportStatusLabel(service.status)}
                        </span>
                        <span style={{ marginLeft: "1.7rem" }}>
                          <strong>Mode:</strong>{" "}
                          {toReportModeLabel(service.verificationMode)}
                        </span>
                      </p>
                      {service.comment?.trim() ? (
                        <p style={{ margin: "0.15rem 0 0", fontSize: "1.08rem" }}>
                          <strong>Comment:</strong> {service.comment}
                        </p>
                      ) : null}

                      {service.candidateAnswers.length > 0 ? (
                        <div style={{ overflowX: "auto", marginTop: "0.45rem" }}>
                          <table
                            style={{
                              width: "100%",
                              minWidth: "690px",
                              borderCollapse: "collapse",
                              fontSize: "0.94rem",
                              border: "1px solid #CBD5E1",
                            }}
                          >
                            <thead>
                              <tr style={{ background: "#F8FAFC", textAlign: "left" }}>
                                <th style={{ padding: "0.3rem 0.35rem", width: "42%" }}>
                                  Candidate Answers
                                </th>
                                <th style={{ padding: "0.3rem 0.35rem" }}>Response</th>
                              </tr>
                            </thead>
                            <tbody>
                              {service.candidateAnswers.map((answer, answerIndex) => (
                                <tr
                                  key={`${item._id}-preview-service-${serviceIndex}-answer-${answerIndex}`}
                                  style={{ borderTop: "1px solid #E2E8F0", verticalAlign: "top" }}
                                >
                                  <td style={{ padding: "0.35rem" }}>
                                    {answer.question || "Field"}
                                  </td>
                                  <td style={{ padding: "0.35rem", lineHeight: 1.35 }}>
                                    {answer.fieldType === "file" && answer.fileData ? (
                                      <span style={{ display: "inline-flex", gap: "0.55rem", flexWrap: "wrap" }}>
                                        <span>{answer.fileName || "Attachment"}</span>
                                        <a
                                          href={answer.fileData}
                                          target="_blank"
                                          rel="noreferrer"
                                          style={{ color: "#2563EB", textDecoration: "none" }}
                                          onMouseEnter={(event) =>
                                            (event.currentTarget.style.textDecoration = "underline")
                                          }
                                          onMouseLeave={(event) =>
                                            (event.currentTarget.style.textDecoration = "none")
                                          }
                                        >
                                          View
                                        </a>
                                        <a
                                          href={answer.fileData}
                                          download={answer.fileName || `candidate-answer-${answerIndex + 1}`}
                                          style={{ color: "#2563EB", textDecoration: "none" }}
                                          onMouseEnter={(event) =>
                                            (event.currentTarget.style.textDecoration = "underline")
                                          }
                                          onMouseLeave={(event) =>
                                            (event.currentTarget.style.textDecoration = "none")
                                          }
                                        >
                                          Download
                                        </a>
                                      </span>
                                    ) : (
                                      answer.value || "-"
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}

                      <div style={{ overflowX: "auto", marginTop: "0.42rem" }}>
                        <table
                          style={{
                            width: "100%",
                            minWidth: "690px",
                            borderCollapse: "collapse",
                            fontSize: "0.98rem",
                          }}
                        >
                          <thead>
                            <tr
                              style={{
                                borderTop: "1px solid #232323",
                                borderBottom: "1px solid #666666",
                                textAlign: "left",
                              }}
                            >
                              <th style={{ padding: "0.3rem 0.2rem", width: "24%" }}>
                                Date & Time
                              </th>
                              <th style={{ padding: "0.3rem 0.2rem", width: "12%" }}>
                                Status
                              </th>
                              <th style={{ padding: "0.3rem 0.2rem", width: "10%" }}>
                                Mode
                              </th>
                              <th style={{ padding: "0.3rem 0.2rem" }}>
                                Attempt Details
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {attempts.length === 0 ? (
                              <tr style={{ borderBottom: "1px solid #666666" }}>
                                <td
                                  colSpan={4}
                                  style={{
                                    padding: "0.5rem 0.2rem",
                                    color: "#4B5563",
                                    fontStyle: "italic",
                                  }}
                                >
                                  No verification attempts logged for this service.
                                </td>
                              </tr>
                            ) : (
                              attempts.map((attempt, attemptIndex) => (
                                <tr
                                  key={`${item._id}-preview-service-${serviceIndex}-attempt-${attemptIndex}`}
                                  style={{
                                    borderBottom: "1px solid #666666",
                                    verticalAlign: "top",
                                  }}
                                >
                                  <td style={{ padding: "0.35rem 0.2rem" }}>
                                    {formatReportDateTime(attempt.attemptedAt)}
                                  </td>
                                  <td
                                    style={{
                                      padding: "0.35rem 0.2rem",
                                      color: getReportAttemptStatusColor(
                                        attempt.status,
                                      ),
                                      fontWeight: 700,
                                    }}
                                  >
                                    {toReportAttemptStatusLabel(attempt.status)}
                                  </td>
                                  <td style={{ padding: "0.35rem 0.2rem" }}>
                                    {toReportModeLabel(attempt.verificationMode)}
                                  </td>
                                  <td
                                    style={{
                                      padding: "0.35rem 0.2rem",
                                      lineHeight: 1.35,
                                    }}
                                  >
                                    {attempt.verifierName?.trim() ? (
                                      <div>
                                        <strong>Verifier:</strong>{" "}
                                        {attempt.verifierName}
                                      </div>
                                    ) : null}
                                    {attempt.managerName?.trim() ? (
                                      <div>
                                        <strong>Manager:</strong>{" "}
                                        {attempt.managerName}
                                      </div>
                                    ) : null}
                                    {attempt.respondentName?.trim() ? (
                                      <div>
                                        <strong>Respondent Name:</strong>{" "}
                                        {attempt.respondentName}
                                      </div>
                                    ) : null}
                                    {attempt.respondentEmail?.trim() ? (
                                      <div>
                                        <strong>Respondent Email:</strong>{" "}
                                        {attempt.respondentEmail}
                                      </div>
                                    ) : null}
                                    {attempt.respondentComment?.trim() ? (
                                      <div>
                                        <strong>Respondent Comment:</strong>{" "}
                                        {attempt.respondentComment}
                                      </div>
                                    ) : null}
                                    {attempt.comment?.trim() ? (
                                      <div>
                                        <strong>Note:</strong> {attempt.comment}
                                      </div>
                                    ) : null}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  );
                })}
              </div>
            </section>

            <section
              style={{
                marginTop: "1.6rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "1.2rem",
                fontSize: "1.1rem",
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>Created By:</div>
                <div>{report.createdByName || "-"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 700 }}>Verified By:</div>
                <div>{report.verifiedByName || "-"}</div>
              </div>
            </section>

            <section
              style={{
                marginTop: "1.4rem",
                border: "1px solid #777777",
                padding: "0.88rem 0.95rem",
                fontSize: "0.84rem",
                lineHeight: 1.35,
              }}
            >
              <p style={{ margin: 0, fontWeight: 700 }}>--END OF REPORT--</p>
              <p style={{ margin: "0.25rem 0 0", fontWeight: 700 }}>
                IMPORTANT NOTICE
              </p>
              {REPORT_NOTICE_PARAGRAPHS.map((paragraph) => (
                <p
                  key={`${item._id}-${paragraph.slice(0, 20)}`}
                  style={{ margin: "0.38rem 0 0" }}
                >
                  {paragraph}
                </p>
              ))}

              <div
                style={{
                  borderTop: "1px solid #777777",
                  marginTop: "0.66rem",
                  paddingTop: "0.5rem",
                }}
              >
                <p style={{ margin: 0, fontWeight: 700 }}>QUESTIONS?</p>
                <p style={{ margin: "0.2rem 0 0" }}>
                  If you have any questions about this report, please feel free to
                  contact us:
                </p>
                <p style={{ margin: "0.2rem 0 0" }}>
                  Toll Free: 866-685-5177&nbsp;&nbsp;&nbsp;&nbsp;Tel:
                  817-945-2289&nbsp;&nbsp;&nbsp;&nbsp;Fax:
                  817-945-2297&nbsp;&nbsp;&nbsp;&nbsp;Email: support@cluso.in
                </p>
              </div>

              <p
                style={{
                  margin: "0.45rem 0 0",
                  fontSize: "0.72rem",
                  textAlign: "right",
                }}
              >
                Rev 3.2 (15322)
              </p>
            </section>

            <p
              style={{
                margin: "1rem 0 0",
                textAlign: "center",
                color: "#555555",
                fontSize: "1.15rem",
              }}
            >
              Generated Report By ClusoInfolink
            </p>
          </div>
        </article>
      </div>
    );
  }

  function renderRequestSection(
    title: string,
    itemsByStatus: RequestItem[],
    emptyMessage: string,
    totalCount = itemsByStatus.length,
  ) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 style={{ fontSize: "0.98rem", color: "#2D405E", margin: 0, fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>
            {title}
            <span className="bg-blue-100/50 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">
              {totalCount}
            </span>
          </h3>
        </div>

        {totalCount === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm italic">
            {emptyMessage}
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <table className="w-full min-w-[980px] text-sm text-left">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase text-xs font-semibold tracking-wider">
                <tr>
                  <th className="px-3 sm:px-4 lg:px-5 py-3.5">Candidate</th>
                  <th className="px-3 sm:px-4 lg:px-5 py-3.5">Contact</th>
                  <th className="px-3 sm:px-4 lg:px-5 py-3.5">Services</th>
                  <th className="px-3 sm:px-4 lg:px-5 py-3.5">Status</th>
                  <th className="px-3 sm:px-4 lg:px-5 py-3.5">Timeline</th>
                  <th className="px-3 sm:px-4 lg:px-5 py-3.5">Team</th>
                  <th className="px-3 sm:px-4 lg:px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {itemsByStatus.map((item, index) => {
                  const hasResponses = Boolean(item.candidateFormResponses && item.candidateFormResponses.length > 0);
                  const formSubmitted = item.candidateFormStatus === "submitted";
                  const isActionRowActive = selectedActionRowId === item._id;
                  const decisionWindow = getEnterpriseDecisionWindow(item, nowMs);
                  const pendingExtraPaymentApprovals = getPendingExtraPaymentApprovals(item);
                  const pendingExtraPaymentCount = pendingExtraPaymentApprovals.length;
                  const appealServiceLabel = toAppealServiceLabel(item.reverificationAppeal);
                  const statusDisplay = getRequestStatusDisplay(item);
                  const reverificationDate = resolveReverificationDate(item);
                  const canViewSharedReport = canOpenSharedReport(item);
                  const canManageCandidateLink = canAccessCandidateLinkActions(item);

                  return (
                    <tr
                      key={item._id}
                      id={`request-${item._id}`}
                      onClick={() => setSelectedActionRowId(item._id)}
                      className={`transition-colors cursor-pointer ${
                        isActionRowActive
                          ? "bg-emerald-100/80 hover:bg-emerald-200/70"
                          : highlightedRequestId === item._id
                            ? "bg-blue-50/40 hover:bg-blue-50/70"
                            : index % 2 === 1
                              ? "bg-slate-50/70 hover:bg-slate-100/80"
                              : "hover:bg-slate-50/80"
                      }`}
                    >
                      <td className="px-3 sm:px-4 lg:px-5 py-4 whitespace-nowrap">
                        <div className="font-bold text-slate-800">{item.candidateName}</div>
                      </td>
                      <td className="px-3 sm:px-4 lg:px-5 py-4 whitespace-nowrap">
                        <div className="text-slate-700 font-medium">{item.candidateEmail || "-"}</div>
                        <div className="text-slate-500 text-xs mt-0.5">{item.candidatePhone || "-"}</div>
                      </td>
                      <td className="px-3 sm:px-4 lg:px-5 py-4 max-w-[200px] whitespace-normal">
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
                      <td className="px-3 sm:px-4 lg:px-5 py-4">
                        <div>
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold capitalize ${statusDisplay.className}`}>
                            {statusDisplay.label}
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
                             <strong className="text-red-700 block">Review Note:</strong>
                             {item.rejectionNote}
                          </div>
                        )}
                        {item.reverificationAppeal?.status === "open" ? (
                          <div className="mt-2 text-xs text-red-700 font-semibold max-w-[200px] whitespace-normal">
                            <strong className="block">Appeal Pending:</strong>
                            {appealServiceLabel}
                          </div>
                        ) : null}
                        {pendingExtraPaymentCount > 0 ? (
                          <div className="mt-2 text-xs text-amber-700 font-semibold max-w-[220px] whitespace-normal">
                            <strong className="block">Payment Approval Pending:</strong>
                            {pendingExtraPaymentCount === 1
                              ? "1 extra payment request"
                              : `${pendingExtraPaymentCount} extra payment requests`}
                          </div>
                        ) : null}
                        {item.status === "approved" && (
                          <div className="mt-2 text-xs font-semibold text-slate-600">
                            {decisionWindow.isLocked
                              ? "Decision lock: active"
                              : `Reject window: ${formatRemainingWindow(decisionWindow.remainingMs)}`}
                          </div>
                        )}
                      </td>
                      <td className="px-3 sm:px-4 lg:px-5 py-4 whitespace-nowrap">
                        <div className="text-xs text-slate-500">
                          <span className="font-semibold text-slate-700">Created: </span> 
                          {new Date(item.createdAt).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          <span className="font-semibold text-slate-700">Submitted: </span> 
                          {item.candidateSubmittedAt ? new Date(item.candidateSubmittedAt).toLocaleDateString() : "-"}
                        </div>
                        {reverificationDate ? (
                          <div className="text-xs text-slate-500 mt-1">
                            <span className="font-semibold text-slate-700">Reverified: </span>
                            {formatReportDateTime(reverificationDate)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 sm:px-4 lg:px-5 py-4">
                        <div className="text-xs">
                          <span className="font-semibold text-slate-700">By:</span> {item.createdByName || "Unknown"}
                        </div>
                        {item.delegateName && (
                          <div className="text-xs mt-1">
                             <span className="font-semibold text-slate-700">Del:</span> {item.delegateName}
                          </div>
                        )}
                      </td>
                      <td className="px-3 sm:px-4 lg:px-5 py-4 text-right">
                         <div className="flex flex-col items-end gap-2">
                           <button
                             type="button"
                             className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm ${
                               hasResponses
                                 ? isActionRowActive
                                   ? "bg-amber-100 border border-amber-300 text-amber-800 hover:-translate-y-0.5 hover:bg-amber-200 hover:border-amber-400 hover:text-amber-900 active:translate-y-0 active:scale-[0.98] active:bg-amber-300 active:border-amber-500 active:text-amber-950 focus:ring-2 focus:ring-amber-100"
                                   : "bg-white border border-slate-300 text-slate-700 hover:-translate-y-0.5 hover:bg-slate-50 hover:border-slate-400 hover:text-slate-800 active:translate-y-0 active:scale-[0.98] active:bg-slate-100 active:text-slate-900 focus:ring-2 focus:ring-slate-100"
                                 : isActionRowActive
                                   ? "bg-rose-50 border border-rose-200 text-rose-500 cursor-not-allowed"
                                   : "bg-slate-50 border border-slate-200 text-slate-400 cursor-not-allowed"
                             }`}
                             onClick={() => {
                               setActiveReportRequestId("");
                               setActiveResponseRequestId(item._id);
                               setIsRejectSelectorOpen(false);
                               setSelectedRejectedFieldKeys([]);
                               setRejectionComment("");
                             }}
                             disabled={!hasResponses}
                           >
                             {hasResponses ? "Review Data" : "No Data Yet"}
                           </button>

                           {pendingExtraPaymentCount > 0 ? (
                             <button
                               type="button"
                               className="px-3 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm bg-amber-100 border border-amber-300 text-amber-800 hover:-translate-y-0.5 hover:bg-amber-200 hover:border-amber-400 hover:text-amber-900 active:translate-y-0 active:scale-[0.98] active:bg-amber-300 active:border-amber-500 active:text-amber-950"
                               onClick={() => {
                                 setActiveReportRequestId("");
                                 setActiveResponseRequestId(item._id);
                                 setIsRejectSelectorOpen(false);
                                 setSelectedRejectedFieldKeys([]);
                                 setRejectionComment("");
                               }}
                             >
                               {pendingExtraPaymentCount === 1
                                 ? "Approve Extra Payment"
                                 : `Approve Extra Payments (${pendingExtraPaymentCount})`}
                             </button>
                           ) : null}

                           <button
                             type="button"
                             className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm ${
                               canViewSharedReport
                                 ? "bg-green-100 border border-green-300 text-green-800 hover:-translate-y-0.5 hover:bg-green-200 hover:border-green-400 hover:text-green-900 active:translate-y-0 active:scale-[0.98] active:bg-green-300 active:border-green-500 active:text-green-950"
                                 : "bg-slate-50 border border-slate-200 text-slate-400 cursor-not-allowed"
                             }`}
                             onClick={() => openSharedReport(item)}
                             disabled={!canViewSharedReport}
                           >
                             View Report
                           </button>

                           <button
                             type="button"
                             className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm ${
                               canManageCandidateLink
                                 ? "bg-sky-100 border border-sky-300 text-sky-800 hover:-translate-y-0.5 hover:bg-sky-200 hover:border-sky-400 hover:text-sky-900 active:translate-y-0 active:scale-[0.98] active:bg-sky-300 active:border-sky-500 active:text-sky-950"
                                 : "bg-slate-50 border border-slate-200 text-slate-400 cursor-not-allowed"
                             }`}
                             onClick={() => void openCandidateLinkEmailPreview(item)}
                             disabled={
                               !canManageCandidateLink ||
                               loadingCandidateLinkPreviewRequestId === item._id
                             }
                           >
                             {loadingCandidateLinkPreviewRequestId === item._id
                               ? "Loading..."
                               : "View Email"}
                           </button>

                           <button
                             type="button"
                             className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm ${
                               canManageCandidateLink
                                 ? "bg-indigo-100 border border-indigo-300 text-indigo-800 hover:-translate-y-0.5 hover:bg-indigo-200 hover:border-indigo-400 hover:text-indigo-900 active:translate-y-0 active:scale-[0.98] active:bg-indigo-300 active:border-indigo-500 active:text-indigo-950"
                                 : "bg-slate-50 border border-slate-200 text-slate-400 cursor-not-allowed"
                             }`}
                             onClick={() => void resendCandidateLink(item)}
                             disabled={
                               !canManageCandidateLink ||
                               resendingCandidateLinkRequestId === item._id
                             }
                           >
                             {resendingCandidateLinkRequestId === item._id
                               ? "Resending..."
                               : "Resend Link"}
                           </button>

                           {item.status === "rejected" && (
                             <button
                               className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm ${
                                 isActionRowActive
                                   ? "bg-blue-100 border border-blue-300 text-blue-800 hover:-translate-y-0.5 hover:bg-blue-200 hover:border-blue-400 hover:text-blue-900 active:translate-y-0 active:scale-[0.98] active:bg-blue-300 active:border-blue-500 active:text-blue-950"
                                   : "bg-white border border-slate-300 text-slate-700 hover:-translate-y-0.5 hover:bg-slate-50 hover:border-slate-400 hover:text-slate-800 active:translate-y-0 active:scale-[0.98] active:bg-slate-100 active:text-slate-900"
                               }`}
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

  if (loading || (requestsEnabled && requestsLoading) || !me || !requestsReady) {
    return (
      <LoadingScreen
        title="Loading request workspace..."
        subtitle="Preparing request tracking data"
      />
    );
  }

  return (
    <PortalFrame
      me={me}
      onLogout={logout}
      title="Request Tracking"
      subtitle="Tabular request workspace with quicker review and less scrolling."
      focusMode={Boolean(activeResponseRequest || activeReportRequest || candidateLinkEmailPreview)}
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <ListChecks size={20} />
              </span>
              <h2 style={{ fontSize: "0.98rem", color: "#2D405E", margin: 0, fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>Submitted Requests</h2>
              <span className="ml-2 px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-semibold rounded-full border border-slate-200">
                Table View
              </span>
            </div>
            <p className="text-slate-500 text-sm mt-1 md:ml-11">
              Search and monitor requests across pending, enterprise-approved, rejected, and verified states.
            </p>
          </div>

          <div className="flex w-full md:w-auto items-center gap-2">
            <div className="relative flex-1 md:w-80 lg:w-96">
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
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              onClick={() => {
                void manuallyRefreshRequestTable();
              }}
              disabled={!requestsEnabled || manualRefreshInProgress}
            >
              <RotateCw size={16} className={manualRefreshInProgress ? "animate-spin" : ""} />
              {manualRefreshInProgress ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="border-t border-slate-100 px-4 lg:px-6 py-4 bg-slate-50/70">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setQuickFilter("all")}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  quickFilter === "all"
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                }`}
              >
                All
                <span className={`px-1.5 py-0.5 rounded-full text-[11px] ${quickFilter === "all" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}>
                  {baseFilteredRequests.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => toggleQuickFilter("pending")}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  quickFilter === "pending"
                    ? "bg-amber-600 text-white border-amber-600"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                }`}
              >
                Pending
                <span className={`px-1.5 py-0.5 rounded-full text-[11px] ${quickFilter === "pending" ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600"}`}>
                  {requestCounts.pending}
                </span>
              </button>

              <button
                type="button"
                onClick={() => toggleQuickFilter("approved")}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  quickFilter === "approved"
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                }`}
              >
                Approved
                <span className={`px-1.5 py-0.5 rounded-full text-[11px] ${quickFilter === "approved" ? "bg-green-500 text-white" : "bg-slate-100 text-slate-600"}`}>
                  {requestCounts.approved}
                </span>
              </button>

              <button
                type="button"
                onClick={() => toggleQuickFilter("verified")}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  quickFilter === "verified"
                    ? "bg-emerald-700 text-white border-emerald-700"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                }`}
              >
                Verified
                <span className={`px-1.5 py-0.5 rounded-full text-[11px] ${quickFilter === "verified" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                  {requestCounts.verified}
                </span>
              </button>

              <button
                type="button"
                onClick={() => toggleQuickFilter("rejected")}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  quickFilter === "rejected"
                    ? "bg-rose-700 text-white border-rose-700"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                }`}
              >
                Rejected
                <span className={`px-1.5 py-0.5 rounded-full text-[11px] ${quickFilter === "rejected" ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                  {requestCounts.rejected}
                </span>
              </button>

              <button
                type="button"
                onClick={() => toggleQuickFilter("forms")}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  quickFilter === "forms"
                    ? "bg-blue-700 text-white border-blue-700"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                }`}
              >
                Forms Submitted
                <span className={`px-1.5 py-0.5 rounded-full text-[11px] ${quickFilter === "forms" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                  {requestCounts.forms}
                </span>
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <span className="font-medium">Created from</span>
                <input
                  type="date"
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded-md text-sm text-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  value={createdDateFrom}
                  max={createdDateTo || undefined}
                  onChange={(e) => setCreatedDateFrom(e.target.value)}
                />
              </label>

              <label className="flex items-center gap-2 text-sm text-slate-600">
                <span className="font-medium">Created to</span>
                <input
                  type="date"
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded-md text-sm text-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  value={createdDateTo}
                  min={createdDateFrom || undefined}
                  onChange={(e) => setCreatedDateTo(e.target.value)}
                />
              </label>

              <button
                type="button"
                className="px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 bg-white text-xs font-semibold hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => {
                  setSearchText("");
                  setCreatedDateFrom("");
                  setCreatedDateTo("");
                  setQuickFilter("all");
                }}
                disabled={!searchText && !createdDateFrom && !createdDateTo && quickFilter === "all"}
              >
                Clear filters
              </button>

              <span className="text-xs text-slate-500">
                Showing {filteredRequests.length} request{filteredRequests.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>
      </BlockCard>

      <div className="flex flex-col gap-6">
        {renderRequestSection(
          "All Requests",
          paginatedRequests,
          "No requests found for the selected filters.",
          filteredRequests.length,
        )}

        {filteredRequests.length > 0 ? (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-1 pb-2">
            <span className="text-xs text-slate-500">
              Showing {currentPageStart}-{currentPageEnd} of {filteredRequests.length} request
              {filteredRequests.length === 1 ? "" : "s"}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 bg-white text-xs font-semibold hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setTablePage((prev) => Math.max(1, prev - 1))}
                disabled={tablePage <= 1}
              >
                Previous
              </button>

              <span className="text-xs font-semibold text-slate-600 min-w-[92px] text-center">
                Page {tablePage} of {totalTablePages}
              </span>

              <button
                type="button"
                className="px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 bg-white text-xs font-semibold hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setTablePage((prev) => Math.min(totalTablePages, prev + 1))}
                disabled={tablePage >= totalTablePages}
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {candidateLinkEmailPreview ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Candidate link email preview"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.56)",
            zIndex: 1260,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            className="glass-card"
            style={{
              width: "min(860px, calc(100vw - 2rem))",
              maxHeight: "88vh",
              overflowY: "auto",
              padding: "1rem",
              background: "#FFFFFF",
              display: "grid",
              gap: "0.85rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.9rem", flexWrap: "wrap" }}>
              <div>
                <h3 style={{ margin: 0, color: "#1E293B" }}>Candidate Email Preview</h3>
                <p style={{ margin: "0.35rem 0 0", color: "#64748B" }}>
                  {candidateLinkEmailPreview.candidateName} • {candidateLinkEmailPreview.recipientEmail}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeCandidateLinkEmailPreview}
                style={{ padding: "0.42rem 0.72rem" }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: "grid", gap: "0.45rem" }}>
              <label className="label" htmlFor="candidate-link-email-subject">
                Subject
              </label>
              <input
                id="candidate-link-email-subject"
                className="input"
                value={candidateLinkEmailPreview.subject}
                readOnly
              />
            </div>

            <div
              style={{
                display: "grid",
                gap: "0.55rem",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              }}
            >
              <div style={{ display: "grid", gap: "0.35rem" }}>
                <label className="label" htmlFor="candidate-link-email-user-id">
                  User ID
                </label>
                <input
                  id="candidate-link-email-user-id"
                  className="input"
                  value={candidateLinkEmailPreview.userId}
                  readOnly
                />
              </div>
              <div style={{ display: "grid", gap: "0.35rem" }}>
                <label className="label" htmlFor="candidate-link-email-temp-password">
                  Temporary Password
                </label>
                <input
                  id="candidate-link-email-temp-password"
                  className="input"
                  value={candidateLinkEmailPreview.temporaryPassword || "Use existing password"}
                  readOnly
                />
              </div>
            </div>

            <div style={{ display: "grid", gap: "0.45rem" }}>
              <label className="label" htmlFor="candidate-link-email-text">
                Email Body (Text)
              </label>
              <textarea
                id="candidate-link-email-text"
                className="input"
                value={candidateLinkEmailPreview.text}
                rows={14}
                readOnly
                style={{ whiteSpace: "pre-wrap" }}
              />
            </div>

            <div style={{ display: "grid", gap: "0.45rem" }}>
              <label className="label" htmlFor="candidate-link-email-html-preview">
                Professional Email Layout Preview
              </label>
              <div
                id="candidate-link-email-html-preview"
                style={{
                  border: "1px solid #D7E2EE",
                  borderRadius: "12px",
                  background: "#F8FAFC",
                  padding: "0.65rem",
                  maxHeight: "320px",
                  overflow: "auto",
                }}
              >
                {candidateLinkEmailPreview.html ? (
                  <div
                    style={{ background: "#FFFFFF", borderRadius: "10px", overflow: "hidden" }}
                    dangerouslySetInnerHTML={{ __html: candidateLinkEmailPreview.html }}
                  />
                ) : (
                  <p style={{ margin: 0, color: "#64748B", fontSize: "0.85rem" }}>
                    No HTML preview available.
                  </p>
                )}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap" }}>
              <div style={{ color: "#64748B", fontSize: "0.82rem" }}>
                Copy this template and send manually if candidate email delivery fails.
              </div>
              <div style={{ display: "inline-flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                {candidateLinkPreviewRequest ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void resendCandidateLink(candidateLinkPreviewRequest)}
                    disabled={resendingCandidateLinkRequestId === candidateLinkPreviewRequest._id}
                    style={{ padding: "0.42rem 0.75rem", fontSize: "0.84rem" }}
                  >
                    {resendingCandidateLinkRequestId === candidateLinkPreviewRequest._id
                      ? "Resending..."
                      : "Resend Link"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void copyCandidatePortalLink()}
                  disabled={!candidateLinkEmailPreview.portalUrl.trim()}
                  style={{ padding: "0.42rem 0.75rem", fontSize: "0.84rem" }}
                >
                  Copy Portal Link
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void copyCandidateLinkEmailPreview()}
                  style={{ padding: "0.42rem 0.75rem", fontSize: "0.84rem" }}
                >
                  Copy Email
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeReportRequest ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Shared verification report"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.56)",
            zIndex: 1300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            className="glass-card"
            style={{
              width: "min(1200px, calc(100vw - 2rem))",
              maxHeight: "88vh",
              overflowY: "auto",
              padding: "1rem",
              background: "#FFFFFF",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", marginBottom: "0.95rem", flexWrap: "wrap" }}>
              <div>
                <h3 style={{ margin: 0, color: "#1E293B" }}>Generated Report Preview</h3>
                <p style={{ margin: "0.35rem 0 0", color: "#64748B" }}>
                  {activeReportRequest.candidateName} • {activeReportRequest.candidateEmail}
                </p>
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    if (isAppealFormOpen) {
                      setIsAppealFormOpen(false);
                      return;
                    }

                    if (!activeReportCanAppeal) {
                      setMessage("After 10 days of report given, appeal is not allowed.");
                      return;
                    }

                    openAppealComposer(activeReportRequest);
                  }}
                  disabled={Boolean(
                    activeReportAppeal?.status === "open" ||
                      !activeReportCanAppeal ||
                      submittingAppealRequestId === activeReportRequest._id,
                  )}
                  style={{ padding: "0.42rem 0.75rem", fontSize: "0.84rem" }}
                >
                  {!activeReportCanAppeal
                    ? "Appeal Not Allowed"
                    : activeReportAppeal?.status === "open"
                    ? "Appeal Submitted"
                    : isAppealFormOpen
                      ? "Hide Appeal Form"
                      : "Appeal Reverification"}
                </button>
                {!activeReportCanAppeal ? (
                  <span style={{ fontSize: "0.8rem", color: "#B91C1C", fontWeight: 600 }}>
                    After 10 days of report given, appeal is not allowed.
                  </span>
                ) : null}

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => downloadSharedReport(activeReportRequest)}
                  disabled={downloadingReportRequestId === activeReportRequest._id}
                  style={{ padding: "0.42rem 0.75rem", fontSize: "0.84rem" }}
                >
                  {downloadingReportRequestId === activeReportRequest._id
                    ? "Downloading..."
                    : "Download PDF"}
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={closeSharedReportModal}
                  style={{ padding: "0.42rem 0.72rem" }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {activeReportAppeal?.status === "open" ? (
              <section
                style={{
                  border: "1px solid #FCA5A5",
                  background: "#FEF2F2",
                  borderRadius: "10px",
                  padding: "0.85rem",
                  marginBottom: "0.9rem",
                  display: "grid",
                  gap: "0.45rem",
                }}
              >
                <strong style={{ color: "#B91C1C" }}>Appeal Pending Reverification</strong>
                <div style={{ color: "#7F1D1D", fontSize: "0.85rem" }}>
                  <strong>Services:</strong> {toAppealServiceLabel(activeReportAppeal)}
                </div>
                <div style={{ color: "#7F1D1D", fontSize: "0.85rem" }}>
                  <strong>Submitted:</strong> {formatReportDateTime(activeReportAppeal.submittedAt)}
                </div>
                <div style={{ color: "#7F1D1D", fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>
                  <strong>Comment:</strong> {activeReportAppeal.comment || "-"}
                </div>
                {activeReportAppeal.attachmentData ? (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap" }}>
                    <strong style={{ color: "#7F1D1D", fontSize: "0.85rem" }}>Attachment:</strong>
                    <a
                      href={activeReportAppeal.attachmentData}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#B91C1C", fontWeight: 700, fontSize: "0.84rem", textDecoration: "none" }}
                    >
                      View
                    </a>
                    <a
                      href={activeReportAppeal.attachmentData}
                      download={activeReportAppeal.attachmentFileName || "appeal-attachment"}
                      style={{ color: "#B91C1C", fontWeight: 700, fontSize: "0.84rem", textDecoration: "none" }}
                    >
                      Download
                    </a>
                  </div>
                ) : null}
              </section>
            ) : null}

            {isAppealFormOpen && activeReportAppeal?.status !== "open" && activeReportCanAppeal ? (
              <section
                style={{
                  border: "1px solid #FECACA",
                  background: "#FFF7ED",
                  borderRadius: "10px",
                  padding: "0.85rem",
                  marginBottom: "0.9rem",
                  display: "grid",
                  gap: "0.75rem",
                }}
              >
                <strong style={{ color: "#9A3412" }}>Appeal For Reverification</strong>

                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label style={{ fontSize: "0.82rem", color: "#7C2D12", fontWeight: 600 }}>
                    Services to appeal
                  </label>
                  {activeReportAppealServiceOptions.length === 0 ? (
                    <div className="input" style={{ background: "#F8FAFC", color: "#94A3B8" }}>
                      No services available
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gap: "0.35rem",
                        border: "1px solid #E2E8F0",
                        borderRadius: "8px",
                        background: "#FFFFFF",
                        padding: "0.6rem",
                        maxHeight: "180px",
                        overflowY: "auto",
                      }}
                    >
                      {activeReportAppealServiceOptions.map((service) => {
                        const checked = appealSelectedServiceIds.includes(service.serviceId);
                        return (
                          <label
                            key={`appeal-service-${service.serviceId}`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.45rem",
                              color: "#374151",
                              fontSize: "0.86rem",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                toggleAppealServiceSelection(service.serviceId, event.target.checked)
                              }
                            />
                            <span>{service.serviceName}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <span style={{ color: "#7C2D12", fontSize: "0.78rem" }}>
                    Selected: {appealSelectedServiceIds.length}
                  </span>
                </div>

                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label style={{ fontSize: "0.82rem", color: "#7C2D12", fontWeight: 600 }}>
                    Comment
                  </label>
                  <textarea
                    className="input"
                    rows={3}
                    placeholder="Explain what should be reverified"
                    value={appealComment}
                    onChange={(event) => setAppealComment(event.target.value)}
                    style={{ background: "#FFFFFF" }}
                  />
                </div>

                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label style={{ fontSize: "0.82rem", color: "#7C2D12", fontWeight: 600 }}>
                    Add attachment (PDF or image)
                  </label>
                  <input
                    type="file"
                    className="input"
                    accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp"
                    onChange={(event) => void selectAppealAttachment(event)}
                    style={{ background: "#FFFFFF" }}
                  />
                  {appealAttachmentData ? (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap", fontSize: "0.79rem", color: "#7C2D12" }}>
                      <span style={{ fontWeight: 700 }}>{appealAttachmentFileName || "Attachment selected"}</span>
                      {typeof appealAttachmentFileSize === "number" ? (
                        <span>({formatFileSize(appealAttachmentFileSize)})</span>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: "0.2rem 0.5rem", fontSize: "0.72rem" }}
                        onClick={clearAppealAttachment}
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                </div>

                <div style={{ display: "flex", gap: "0.55rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void submitReverificationAppeal()}
                    disabled={
                      submittingAppealRequestId === activeReportRequest._id ||
                      activeReportAppealServiceOptions.length === 0
                    }
                    style={{ padding: "0.42rem 0.75rem", fontSize: "0.84rem" }}
                  >
                    {submittingAppealRequestId === activeReportRequest._id
                      ? "Submitting..."
                      : "Submit Appeal"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsAppealFormOpen(false)}
                    disabled={submittingAppealRequestId === activeReportRequest._id}
                    style={{ padding: "0.42rem 0.75rem", fontSize: "0.84rem" }}
                  >
                    Cancel
                  </button>
                </div>
              </section>
            ) : null}

            {renderSharedReportPreview(activeReportRequest)}
          </div>
        </div>
      ) : null}

      {activeResponseRequest ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Candidate responses"
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[1200] flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[86vh] overflow-y-auto p-4 sm:p-6 relative">
            <div className="flex justify-between items-start gap-3 mb-6">
              <div>
                <h3 style={{ fontSize: "0.98rem", color: "#2D405E", margin: 0, fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>Candidate Responses</h3>
                <p className="mt-1 text-slate-600 font-medium whitespace-normal">
                  {activeResponseRequest.candidateName} <span className="text-slate-400 mx-1">•</span> {activeResponseRequest.candidateEmail}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-500 flex items-center gap-1.5 whitespace-normal">
                  <span className={`w-1.5 h-1.5 rounded-full ${activeResponseRequest.candidateFormStatus === "submitted" ? "bg-green-500" : "bg-orange-400"}`}></span>
                  Status: {activeResponseRequest.candidateFormStatus === "submitted" ? "Submitted" : "Pending"}
                </p>
                {activeResponseRequest.status === "approved" && activeDecisionWindow ? (
                  <p className="mt-1 text-sm font-semibold text-slate-500 whitespace-normal">
                    {activeDecisionWindow.isLocked
                      ? "Enterprise decision window is locked. Request is now with verification team."
                      : `Enterprise reject window closes in ${formatRemainingWindow(activeDecisionWindow.remainingMs)}.`}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 active:bg-slate-200 active:text-slate-700 rounded-lg transition-all duration-200"
                onClick={closeResponseModal}
              >
                <X size={20} />
              </button>
            </div>

            {activePendingExtraPaymentApprovals.length > 0 ? (
              <section
                style={{
                  border: "1px solid #FCD34D",
                  background: "#FFFBEB",
                  borderRadius: "12px",
                  padding: "0.85rem",
                  marginBottom: "1rem",
                  display: "grid",
                  gap: "0.6rem",
                }}
              >
                <div>
                  <strong style={{ color: "#92400E" }}>Extra Payment Approval Window</strong>
                  <p style={{ margin: "0.35rem 0 0", color: "#92400E", fontSize: "0.84rem" }}>
                    Verification team requested additional payment. Approve or reject each pending request.
                  </p>
                </div>

                <div style={{ display: "grid", gap: "0.55rem" }}>
                  {activePendingExtraPaymentApprovals.map((approval) => {
                    const decisionKey = buildExtraPaymentDecisionKey(
                      activeResponseRequest._id,
                      approval.serviceId,
                      approval.serviceEntryIndex,
                      approval.attemptedAt,
                    );
                    const isDecisioning = paymentDecisioningKey === decisionKey;
                    const hasScreenshotData = Boolean(approval.screenshotData);
                    const canPreviewScreenshot =
                      hasScreenshotData && approval.screenshotData.startsWith("data:image/");

                    return (
                      <article
                        key={decisionKey}
                        style={{
                          border: "1px solid #FDE68A",
                          borderRadius: "10px",
                          background: "#FFFFFF",
                          padding: "0.72rem",
                          display: "grid",
                          gap: "0.45rem",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap" }}>
                          <strong style={{ color: "#334155" }}>{approval.serviceName}</strong>
                          <span style={{ color: "#92400E", fontWeight: 700 }}>
                            {approval.currency} {approval.amount.toFixed(2)}
                          </span>
                        </div>

                        <div style={{ color: "#475569", fontSize: "0.82rem" }}>
                          <strong>Requested At:</strong> {formatReportDateTime(approval.attemptedAt)}
                        </div>

                        {approval.comment.trim() ? (
                          <div style={{ color: "#475569", fontSize: "0.82rem", whiteSpace: "pre-wrap" }}>
                            <strong>Verifier Note:</strong> {approval.comment}
                          </div>
                        ) : null}

                        {(approval.verifierName || approval.managerName) ? (
                          <div style={{ color: "#475569", fontSize: "0.82rem" }}>
                            <strong>Team:</strong>{" "}
                            {[approval.verifierName, approval.managerName].filter(Boolean).join(" / ")}
                          </div>
                        ) : null}

                        {hasScreenshotData ? (
                          <div
                            style={{
                              border: "1px solid #E2E8F0",
                              background: "#F8FAFC",
                              borderRadius: "10px",
                              padding: "0.5rem",
                              display: "grid",
                              gap: "0.45rem",
                            }}
                          >
                            <div style={{ color: "#334155", fontSize: "0.8rem", fontWeight: 600 }}>
                              Verifier Screenshot
                            </div>
                            <a
                              href={approval.screenshotData}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-secondary"
                              style={{ padding: "0.3rem 0.58rem", fontSize: "0.78rem", width: "fit-content" }}
                            >
                              View Screenshot
                            </a>
                            {canPreviewScreenshot ? (
                              <img
                                src={approval.screenshotData}
                                alt={approval.screenshotFileName || `${approval.serviceName} verifier proof screenshot`}
                                style={{
                                  width: "100%",
                                  maxWidth: "340px",
                                  borderRadius: "8px",
                                  border: "1px solid #CBD5E1",
                                  background: "#FFFFFF",
                                }}
                              />
                            ) : null}
                          </div>
                        ) : null}

                        <div style={{ display: "inline-flex", gap: "0.45rem", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ padding: "0.32rem 0.62rem", fontSize: "0.78rem" }}
                            disabled={isDecisioning}
                            onClick={() =>
                              void submitExtraPaymentDecision(
                                activeResponseRequest,
                                approval,
                                "approve",
                              )
                            }
                          >
                            {isDecisioning ? "Updating..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{
                              padding: "0.32rem 0.62rem",
                              fontSize: "0.78rem",
                              borderColor: "#FCA5A5",
                              color: "#B91C1C",
                              background: "#FEF2F2",
                            }}
                            disabled={isDecisioning}
                            onClick={() =>
                              void submitExtraPaymentDecision(
                                activeResponseRequest,
                                approval,
                                "reject",
                              )
                            }
                          >
                            {isDecisioning ? "Updating..." : "Reject"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              {renderResponseContent(activeResponseRequest)}
            </div>

            <div className="flex justify-end gap-3 mt-6 flex-wrap">
              <button
                type="button"
                className="w-full sm:w-auto px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:-translate-y-0.5 hover:bg-green-700 active:translate-y-0 active:scale-[0.98] active:bg-green-800 transition-all duration-200 focus:ring-2 focus:ring-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => submitEnterpriseDecision("enterprise-approve")}
                disabled={Boolean(
                  decisioningRequestId === activeResponseRequest._id ||
                    activeResponseRequest.candidateFormStatus !== "submitted" ||
                    activeResponseRequest.status === "approved" ||
                    activeResponseRequest.status === "verified",
                )}
              >
                {decisioningRequestId === activeResponseRequest._id ? "Updating..." : "Approve"}
              </button>

              <button
                type="button"
                className="w-full sm:w-auto px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:-translate-y-0.5 hover:bg-red-700 active:translate-y-0 active:scale-[0.98] active:bg-red-800 transition-all duration-200 focus:ring-2 focus:ring-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => submitEnterpriseDecision("enterprise-reject")}
                disabled={Boolean(
                  decisioningRequestId === activeResponseRequest._id ||
                    activeResponseRequest.candidateFormStatus !== "submitted" ||
                    (activeResponseRequest.status === "approved" && activeDecisionWindow?.isLocked) ||
                    activeResponseRequest.status === "verified",
                )}
              >
                {decisioningRequestId === activeResponseRequest._id ? "Updating..." : "Reject"}
              </button>

              <button
                type="button"
                className="w-full sm:w-auto px-4 py-2 bg-white border border-red-200 text-red-600 font-semibold rounded-lg hover:-translate-y-0.5 hover:bg-red-50 hover:text-red-700 active:translate-y-0 active:scale-[0.98] active:bg-red-100 transition-all duration-200 focus:ring-2 focus:ring-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => openRejectSelector(activeResponseRequest)}
                disabled={Boolean(
                  decisioningRequestId === activeResponseRequest._id ||
                  !activeResponseRequest.candidateFormResponses ||
                    activeResponseRequest.candidateFormResponses.length === 0 ||
                    (activeResponseRequest.status === "approved" && activeDecisionWindow?.isLocked) ||
                    activeResponseRequest.status === "verified",
                )}
              >
                Reject Candidate Data For Correction
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
                  {sortCandidateResponsesForDisplay(
                    activeResponseRequest.candidateFormResponses ?? [],
                  )
                    .flatMap((serviceResponse) => {
                      const serviceEntryCount = resolveServiceResponseEntryCount(serviceResponse);

                      return Array.from({ length: serviceEntryCount }, (_, entryIndex) => {
                        const serviceEntryNumber = entryIndex + 1;

                        return {
                          serviceResponse,
                          entryIndex,
                          serviceEntryNumber,
                          serviceDisplayName: formatServiceInstanceName(
                            serviceResponse.serviceName,
                            serviceEntryNumber,
                            serviceEntryCount,
                          ),
                        };
                      });
                    })
                    .map((serviceResponseEntry) => (
                    <fieldset
                      key={`${activeResponseRequest._id}-${serviceResponseEntry.serviceResponse.serviceId}-${serviceResponseEntry.serviceEntryNumber}`}
                      className="border border-slate-200 rounded-xl p-4 m-0 grid gap-3 bg-white shadow-sm"
                    >
                      <legend className="font-bold text-slate-800 px-2 text-sm bg-white">
                        {serviceResponseEntry.serviceDisplayName}
                      </legend>

                      {serviceResponseEntry.serviceResponse.answers.length === 0 ? (
                        <span className="text-slate-500 text-sm">No answer fields available.</span>
                      ) : (
                        serviceResponseEntry.serviceResponse.answers.map((answer, answerIndex) => {
                          const fieldKey = buildRejectedFieldKey(
                            serviceResponseEntry.serviceResponse.serviceId,
                            answer.question,
                            answer.fieldKey ?? "",
                          );
                          const isChecked = selectedRejectedFieldKeys.includes(fieldKey);
                          const resolvedFile = resolveAnswerFileForEntry(
                            answer,
                            serviceResponseEntry.entryIndex,
                          );
                          const answerValueForEntry = getAnswerValueForEntry(
                            answer,
                            serviceResponseEntry.entryIndex,
                          ).trim();
                          const answerPreview =
                            answer.fieldType === "file"
                              ? resolvedFile.fileName || "File uploaded"
                              : answerValueForEntry || "-";

                          return (
                            <label
                              key={`${serviceResponseEntry.serviceResponse.serviceId}-${serviceResponseEntry.serviceEntryNumber}-${answerIndex}`}
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

                <div className="flex items-center gap-3 pt-2 flex-wrap">
                  <button
                    type="button"
                    className="w-full sm:w-auto px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:-translate-y-0.5 hover:bg-red-700 active:translate-y-0 active:scale-[0.98] active:bg-red-800 transition-all duration-200 focus:ring-2 focus:ring-red-200 disabled:opacity-50"
                    onClick={submitSelectedFieldRejection}
                    disabled={rejectingRequestId === activeResponseRequest._id}
                  >
                    {rejectingRequestId === activeResponseRequest._id ? "Rejecting..." : "Confirm Rejection"}
                  </button>
                  <button
                    type="button"
                    className="w-full sm:w-auto px-4 py-2 bg-white border border-slate-300 text-slate-700 font-semibold rounded-lg hover:-translate-y-0.5 hover:bg-slate-50 active:translate-y-0 active:scale-[0.98] active:bg-slate-100 transition-all duration-200 disabled:opacity-50"
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
    <Suspense fallback={<LoadingScreen />}>
      <RequestsPageContent />
    </Suspense>
  );
}
