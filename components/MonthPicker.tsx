"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  value: string; // YYYY-MM
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", 
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

export function MonthPicker({ value, onChange, id, disabled }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  const parseValue = (val: string) => {
    if (!val) return { year: currentYear, month: currentMonth };
    const [y, m] = val.split("-");
    const py = parseInt(y, 10);
    const pm = parseInt(m, 10) - 1;
    return { 
      year: Number.isNaN(py) ? currentYear : py, 
      month: Number.isNaN(pm) ? currentMonth : pm 
    };
  };

  const { year: selectedYear, month: selectedMonth } = parseValue(value);
  const [viewYear, setViewYear] = useState(selectedYear);

  useEffect(() => {
    if (isOpen) {
      setViewYear(parseValue(value).year);
    }
  }, [isOpen, value]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      window.addEventListener("mousedown", handleOutsideClick);
    }
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, [isOpen]);

  const handleSelect = (m: number) => {
    const yStr = viewYear.toString();
    const mStr = (m + 1).toString().padStart(2, "0");
    onChange(`${yStr}-${mStr}`);
    setIsOpen(false);
  };

  const handlePresent = () => {
    const today = new Date();
    const yStr = today.getFullYear().toString();
    const mStr = (today.getMonth() + 1).toString().padStart(2, "0");
    onChange(`${yStr}-${mStr}`);
    setIsOpen(false);
  };

  return (
    <div className="month-picker-container" ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.6rem 0.8rem",
          background: disabled ? "#F8FAFC" : "#FFFFFF",
          border: isOpen ? "1px solid #3B82F6" : "1px solid #CBD5E1",
          borderRadius: "8px",
          color: disabled ? "#94A3B8" : "#1E293B",
          fontSize: "0.95rem",
          outline: "none",
          boxShadow: isOpen ? "0 0 0 3px rgba(59, 130, 246, 0.15)" : "none",
          transition: "all 0.2s ease-in-out",
          cursor: disabled ? "not-allowed" : "pointer"
        }}
      >
        <span>
          {value ? `${MONTH_NAMES[selectedMonth]}, ${selectedYear}` : "Select Month"}
        </span>
        <Calendar size={18} color={isOpen ? "#3B82F6" : "#64748B"} />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 0.5rem)",
            left: 0,
            zIndex: 50,
            width: "280px",
            background: "#FFFFFF",
            border: "1px solid #E2E8F0",
            borderRadius: "12px",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
            padding: "1rem",
            animation: "fadeIn 0.2s ease-out"
          }}
        >
          {/* Header Controls */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <button
              type="button"
              onClick={() => setViewYear(viewYear - 1)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "32px", height: "32px", borderRadius: "6px",
                border: "1px solid #E2E8F0", background: "#F8FAFC",
                color: "#475569", cursor: "pointer", transition: "background 0.2s"
              }}
              onMouseOver={(e) => e.currentTarget.style.background = "#F1F5F9"}
              onMouseOut={(e) => e.currentTarget.style.background = "#F8FAFC"}
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: "1.05rem", fontWeight: 700, color: "#1E293B" }}>
              {viewYear}
            </span>
            <button
              type="button"
              onClick={() => setViewYear(viewYear + 1)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "32px", height: "32px", borderRadius: "6px",
                border: "1px solid #E2E8F0", background: "#F8FAFC",
                color: "#475569", cursor: "pointer", transition: "background 0.2s"
              }}
              onMouseOver={(e) => e.currentTarget.style.background = "#F1F5F9"}
              onMouseOut={(e) => e.currentTarget.style.background = "#F8FAFC"}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Month Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem" }}>
            {MONTH_NAMES.map((name, idx) => {
              const isSelected = selectedYear === viewYear && selectedMonth === idx;
              const isCurrent = currentYear === viewYear && currentMonth === idx;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => handleSelect(idx)}
                  style={{
                    padding: "0.6rem 0",
                    borderRadius: "8px",
                    border: isSelected ? "1px solid #2563EB" : "1px solid transparent",
                    background: isSelected ? "#EFF6FF" : isCurrent ? "#F8FAFC" : "transparent",
                    color: isSelected ? "#1D4ED8" : isCurrent ? "#0F172A" : "#475569",
                    fontWeight: isSelected || isCurrent ? 600 : 500,
                    fontSize: "0.9rem",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                  onMouseOver={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = "#F1F5F9";
                      e.currentTarget.style.color = "#0F172A";
                    }
                  }}
                  onMouseOut={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = isCurrent ? "#F8FAFC" : "transparent";
                      e.currentTarget.style.color = isCurrent ? "#0F172A" : "#475569";
                    }
                  }}
                >
                  {name}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: "1rem", paddingTop: "0.8rem", borderTop: "1px solid #E2E8F0" }}>
            <button
              type="button"
              onClick={handlePresent}
              style={{
                width: "100%", padding: "0.6rem", borderRadius: "8px",
                background: "#F1F5F9", border: "1px solid transparent",
                color: "#334155", fontWeight: 600, fontSize: "0.9rem",
                cursor: "pointer", transition: "all 0.2s"
              }}
              onMouseOver={(e) => e.currentTarget.style.background = "#E2E8F0"}
              onMouseOut={(e) => e.currentTarget.style.background = "#F1F5F9"}
            >
              Select Present Month
            </button>
          </div>
        </div>
      )}
      
      {/* We use a string tag for style to avoid react dangerouslySetInnerHTML warning when unused */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}