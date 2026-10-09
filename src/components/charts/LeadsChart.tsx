"use client";

import { useId, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";

const WIDTH = 900;
const HEIGHT = 300;
const PAD_L = 44;
const PAD_B = 28;
const PAD_T = 10;
const PAD_R = 10;

export type LeadsChartPoint = { month: string; leads: number; conversiones: number };

function niceTicks(max: number): number[] {
  const top = Math.max(4, Math.ceil(max / 4) * 4);
  return [0, top * 0.25, top * 0.5, top * 0.75, top].map(Math.round);
}

export function LeadsChart({ data }: { data: LeadsChartPoint[] }) {
  const { t } = useLanguage();
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const leadsLabel = t("Leads", "Leads");
  const conversionsLabel = t("Conversions", "Conversiones");

  const maxLeads = Math.max(...data.map((d) => d.leads), 1);
  const ticks = niceTicks(maxLeads);
  const maxTick = ticks[ticks.length - 1];

  const plotW = WIDTH - PAD_L - PAD_R;
  const plotH = HEIGHT - PAD_T - PAD_B;
  const bandW = plotW / Math.max(data.length, 1);
  const barW = bandW * 0.5;

  const yFor = (v: number) => PAD_T + plotH * (1 - v / maxTick);
  const xFor = (i: number) => PAD_L + bandW * i + bandW / 2;

  const linePoints = data.map((d, i) => `${xFor(i)},${yFor(d.conversiones)}`).join(" ");

  return (
    <div>
      <div className="flex items-center gap-5 text-[13px] text-text-secondary">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand" /> {leadsLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-text-primary" /> {conversionsLabel}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-3 w-full"
        role="img"
        aria-label={t("Monthly leads and conversions chart", "Gráfico mensual de leads y conversiones")}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-lime)" />
            <stop offset="100%" stopColor="var(--brand)" />
          </linearGradient>
        </defs>

        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={WIDTH - PAD_R}
              y1={yFor(t)}
              y2={yFor(t)}
              stroke="var(--border-soft)"
              strokeWidth={1}
              style={{ transition: "y1 500ms ease, y2 500ms ease" }}
            />
            <text
              x={PAD_L - 10}
              y={yFor(t) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--text-tertiary)"
              style={{ transition: "y 500ms ease" }}
            >
              {t}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const x = xFor(i) - barW / 2;
          const y = yFor(d.leads);
          const h = PAD_T + plotH - y;
          return (
            <g
              key={d.month}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className="cursor-pointer"
            >
              <rect x={x} y={PAD_T} width={barW} height={plotH} fill="transparent" />
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={6}
                fill={`url(#${gradientId})`}
                opacity={hover === null || hover === i ? 1 : 0.45}
                style={{ transition: "y 500ms ease, height 500ms ease, opacity 150ms ease" }}
              />
              <text
                x={xFor(i)}
                y={HEIGHT - 6}
                textAnchor="middle"
                fontSize={12}
                fill="var(--text-secondary)"
              >
                {d.month}
              </text>
              {hover === i && (
                <g>
                  <rect
                    x={xFor(i) - 58}
                    y={y - 46}
                    width={116}
                    height={36}
                    rx={8}
                    fill="var(--text-primary)"
                  />
                  <text x={xFor(i)} y={y - 30} textAnchor="middle" fontSize={11} fill="white">
                    {d.leads} {leadsLabel.toLowerCase()}
                  </text>
                  <text x={xFor(i)} y={y - 16} textAnchor="middle" fontSize={11} fill="var(--brand-light)">
                    {d.conversiones} {conversionsLabel.toLowerCase()}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        <polyline points={linePoints} fill="none" stroke="var(--text-primary)" strokeWidth={2} />
        {data.map((d, i) => (
          <circle
            key={d.month}
            cx={xFor(i)}
            cy={yFor(d.conversiones)}
            r={4}
            fill="white"
            stroke="var(--text-primary)"
            strokeWidth={2}
            style={{ transition: "cy 500ms ease" }}
          />
        ))}
      </svg>
    </div>
  );
}
