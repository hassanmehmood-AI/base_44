"use client";

import { useState } from "react";
import { Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Select, Textarea } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { PageHeader } from "@/components/PageHeader";
import { useLanguage } from "@/context/LanguageContext";
import { tickets } from "@/lib/mock-data";
import { cn } from "@/lib/cn";

const priorityTone: Record<string, "amber" | "blue" | "red"> = {
  High: "amber",
  Medium: "blue",
  Critical: "red",
};

const statusTone: Record<string, "green" | "amber" | "gray"> = {
  Open: "green",
  "In progress": "amber",
  Resolved: "gray",
};

export default function SoportePage() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [selectedId, setSelectedId] = useState(tickets[0].id);
  const [reply, setReply] = useState("");

  const selected = tickets.find((t) => t.id === selectedId) ?? tickets[0];
  const list = tab === "all" ? tickets : tickets.filter((t) => t.createdBy === "You");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Technical Support", "Soporte Técnico")}
        subtitle={t("Create, view and respond to technical incidents", "Crea, visualiza y responde a incidencias técnicas")}
        actions={
          <Button>
            <Plus className="h-4 w-4" /> {t("Create ticket", "Crear ticket")}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
        <div className="flex flex-col gap-4">
          <div className="w-[220px]">
            <Select defaultValue="All companies">
              <option>{t("All companies", "Todas las empresas")}</option>
              <option>Contact-On</option>
              <option>Leyva</option>
            </Select>
          </div>

          <div className="flex rounded-lg bg-surface-muted p-1">
            <button
              onClick={() => setTab("all")}
              className={cn(
                "flex-1 rounded-md py-1.5 text-[13.5px] font-medium transition-colors",
                tab === "all" ? "bg-brand-50 text-brand-700" : "text-text-secondary hover:text-text-primary"
              )}
            >
              {t("All", "Todos")}
            </button>
            <button
              onClick={() => setTab("mine")}
              className={cn(
                "flex-1 rounded-md py-1.5 text-[13.5px] font-medium transition-colors",
                tab === "mine" ? "bg-brand-50 text-brand-700" : "text-text-secondary hover:text-text-primary"
              )}
            >
              {t("My tickets", "Mis tickets")}
            </button>
          </div>

          <div className="flex flex-col gap-2.5">
            {list.map((tk) => (
              <button
                key={tk.id}
                onClick={() => setSelectedId(tk.id)}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  selectedId === tk.id
                    ? "border-brand-100 bg-brand-50"
                    : "border-border bg-white hover:bg-surface-muted"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[12.5px] font-medium text-text-secondary">
                    #{tk.id} · {tk.company}
                  </p>
                  <Badge tone={priorityTone[tk.priority]}>{tk.priority}</Badge>
                </div>
                <p className="mt-1 text-[14.5px] font-semibold text-text-primary">{tk.subject}</p>
                <Badge tone={statusTone[tk.status]} className="mt-2">
                  {tk.status === "Open" ? t("Open", "Abierto") : tk.status === "In progress" ? t("In progress", "En proceso") : t("Resolved", "Resuelto")}
                </Badge>
              </button>
            ))}
          </div>
        </div>

        <Card className="flex flex-col gap-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
            <div>
              <h2 className="text-[18px] font-semibold text-text-primary">
                #{selected.id} · {selected.subject}
              </h2>
              <p className="mt-1 text-[13px] text-text-secondary">
                {selected.company} · {t("Created by", "Creado por")} {selected.createdBy}
              </p>
            </div>
            <div className="flex gap-2">
              <div className="w-[170px]">
                <Select defaultValue={selected.assignee}>
                  <option>{selected.assignee}</option>
                </Select>
              </div>
              <div className="w-[130px]">
                <Select defaultValue={selected.status}>
                  <option>{t("Open", "Abierto")}</option>
                  <option>{t("In progress", "En proceso")}</option>
                  <option>{t("Resolved", "Resuelto")}</option>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-4">
            <div className="flex items-start gap-3">
              <Avatar name={selected.createdBy} size={32} />
              <div>
                <div className="rounded-2xl rounded-tl-sm bg-surface-muted px-4 py-2.5 text-[13.5px] text-text-primary">
                  jbjkbh
                </div>
                <p className="mt-1 text-[11.5px] text-text-tertiary">{t("You", "Tú")} · {t("Now", "Ahora")}</p>
              </div>
            </div>

            <div className="ml-auto flex max-w-[80%] flex-col items-end gap-1">
              <div className="rounded-2xl rounded-tr-sm bg-brand-50 px-4 py-2.5 text-[13.5px] text-text-primary">
                erheh
              </div>
              <p className="text-[11.5px] text-text-tertiary">{t("Now", "Ahora")}</p>
            </div>
            <div className="ml-auto flex max-w-[80%] flex-col items-end gap-1">
              <div className="rounded-2xl rounded-tr-sm bg-brand-50 px-4 py-2.5 text-[13.5px] text-text-primary">
                rthrtjhwr
              </div>
              <p className="text-[11.5px] text-text-tertiary">{t("Now", "Ahora")}</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <Textarea
              rows={3}
              placeholder={t("Write a response or add information about the incident...", "Escribe una respuesta o añade información sobre la incidencia...")}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
            <Button className="w-fit self-end">
              <Send className="h-4 w-4" /> {t("Reply to ticket", "Responder ticket")}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
