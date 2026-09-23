"use client";

import { useId, useState } from "react";
import { kpiMonthly } from "@/lib/mock-data";

const WIDTH = 900;
const HEIGHT = 300;
const PAD_L = 44;
const PAD_B = 28;
const PAD_T = 10;
const PAD_R = 10;

const MAX_LEADS = 1400;
const TICKS = [0, 350, 700, 1050, 1400];

export function LeadsChart() {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const plotW = WIDTH - PAD_L - PAD_R;
  const plotH = HEIGHT - PAD_T - PAD_B;
  const bandW = plotW / kpiMonthly.length;
  const barW = bandW * 0.5;

  const yFor = (v: number) => PAD_T + plotH * (1 - v / MAX_LEADS);
  const xFor = (i: number) => PAD_L + bandW * i + bandW / 2;

  const linePoints = kpiMonthly
    .map((d, i) => `${xFor(i)},${yFor(d.conversiones * 6)}`)
    .join(" ");

  return (
    <div>
      <div className="flex items-center gap-5 text-[13px] text-text-secondary">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand" /> Leads
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-text-primary" /> Conversions
        </span>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-3 w-full"
        role="img"
        aria-label="Monthly leads and conversions chart"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand-light)" />
            <stop offset="100%" stopColor="var(--brand)" />
          </linearGradient>
        </defs>

        {TICKS.map((t) => (
          <g key={t}>
            <line
              x1={PAD_L}
              x2={WIDTH - PAD_R}
              y1={yFor(t)}
              y2={yFor(t)}
              stroke="var(--border-soft)"
              strokeWidth={1}
            />
            <text x={PAD_L - 10} y={yFor(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-tertiary)">
              {t}
            </text>
          </g>
        ))}

        {kpiMonthly.map((d, i) => {
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
                    {d.leads} leads
                  </text>
                  <text x={xFor(i)} y={y - 16} textAnchor="middle" fontSize={11} fill="var(--brand-light)">
                    {d.conversiones} conversions
                  </text>
                </g>
              )}
            </g>
          );
        })}

        <polyline points={linePoints} fill="none" stroke="var(--text-primary)" strokeWidth={2} />
        {kpiMonthly.map((d, i) => (
          <circle
            key={d.month}
            cx={xFor(i)}
            cy={yFor(d.conversiones * 6)}
            r={4}
            fill="white"
            stroke="var(--text-primary)"
            strokeWidth={2}
          />
        ))}
      </svg>
    </div>
  );
}
