"use client";

import { useState } from "react";
import { Plus, Send, MoreHorizontal, Building2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SearchInput, Select } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { useLanguage } from "@/context/LanguageContext";
import { whatsappPipeline } from "@/lib/mock-data";
import { Stage, STAGE_LABEL, STAGE_LABEL_ES } from "@/lib/pipeline";
import { cn } from "@/lib/cn";

const columns: Stage[] = [
  "NUEVO_LEAD",
  "CONTACTADO",
  "INTERESADO",
  "OPORTUNIDAD",
  "PEDIDO_EN_CURSO",
  "CLIENTE",
  "SEGUIMIENTO",
];

const allConversations = columns.flatMap((stage) =>
  whatsappPipeline[stage].map((c) => ({ ...c, stage }))
);

export default function WhatsAppPage() {
  const { t, language } = useLanguage();
  const [view, setView] = useState<"pipeline" | "chat">("pipeline");
  const [selectedId, setSelectedId] = useState(allConversations[0]?.id);
  const selected = allConversations.find((c) => c.id === selectedId) ?? allConversations[0];

  const getStageLabel = (stage: Stage) =>
    language === "es" ? STAGE_LABEL_ES[stage] : STAGE_LABEL[stage];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="WhatsApp"
        subtitle={t("Manage conversations and move each one according to its commercial stage", "Gestiona conversaciones y mueve cada una según su estado comercial")}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg bg-text-primary p-1">
          <button
            onClick={() => setView("pipeline")}
            className={cn(
              "rounded-md px-4 py-1.5 text-[13.5px] font-medium transition-colors",
              view === "pipeline" ? "bg-white text-text-primary" : "text-white/70 hover:text-white"
            )}
          >
            {t("Pipeline View", "Vista Pipeline")}
          </button>
          <button
            onClick={() => setView("chat")}
            className={cn(
              "rounded-md px-4 py-1.5 text-[13.5px] font-medium transition-colors",
              view === "chat" ? "bg-white text-text-primary" : "text-white/70 hover:text-white"
            )}
          >
            {t("Chat View", "Vista Chat")}
          </button>
        </div>
        <SearchInput placeholder={t("Search client, phone or email...", "Buscar cliente, teléfono o correo...")} className="max-w-sm" />
        <Button className="ml-auto">
          <Plus className="h-4 w-4" /> {t("New conversation", "Nueva conversación")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-text-secondary">
          {t("Active company on this channel:", "Empresa activa en este canal:")} <span className="font-semibold text-text-primary">{t("none selected", "ninguna seleccionada")}</span>
        </p>
        <div className="w-[200px]">
          <Select defaultValue="All companies">
            <option>{t("All companies", "Todas las empresas")}</option>
            <option>Contact-On</option>
            <option>Leyva</option>
            <option>Rockstar</option>
          </Select>
        </div>
      </div>

      {view === "pipeline" ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {columns.map((stage) => (
            <div key={stage} className="w-[260px] shrink-0 rounded-xl bg-surface-muted/60 p-2.5">
              <div className="mb-3 flex items-center gap-2 px-0.5">
                <p className="text-[11px] font-semibold tracking-wide text-text-secondary">
                  {getStageLabel(stage).toUpperCase()}
                </p>
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-semibold text-text-secondary">
                  {whatsappPipeline[stage].length}
                </span>
              </div>

              <div className="flex flex-col gap-2.5">
                {whatsappPipeline[stage].map((card) => (
                  <Card
                    key={card.id}
                    className="cursor-pointer p-3.5 transition-shadow hover:shadow-md"
                    onClick={() => {
                      setSelectedId(card.id);
                      setView("chat");
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={card.agent} size={30} />
                        <div>
                          <p className="text-[13.5px] font-semibold text-text-primary">{card.name}</p>
                          <p className="text-[11.5px] text-text-tertiary">
                            {t("Last message", "Último mensaje")} · {card.time}
                          </p>
                        </div>
                      </div>
                      <button className="text-text-tertiary hover:text-text-primary">
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </Card>
                ))}
                {whatsappPipeline[stage].length === 0 && (
                  <div className="rounded-xl border border-dashed border-border bg-white/60 py-6 text-center text-[12.5px] text-text-tertiary">
                    {t("No conversations", "Sin conversaciones")}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card className="flex h-[640px] overflow-hidden p-0">
          <div className="flex w-[300px] shrink-0 flex-col border-r border-border">
            <div className="border-b border-border p-4">
              <p className="text-[15px] font-semibold text-text-primary">{t("Conversations", "Conversaciones")}</p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {allConversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors",
                    selectedId === c.id ? "bg-brand-50" : "hover:bg-surface-muted"
                  )}
                >
                  <Avatar name={c.agent} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold text-text-primary">{c.name}</p>
                    <p className="truncate text-[12px] text-text-tertiary">{getStageLabel(c.stage)}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-text-tertiary">{c.time}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-1 flex-col">
            {selected ? (
              <>
                <div className="flex items-center gap-3 border-b border-border p-4">
                  <Avatar name={selected.agent} size={38} />
                  <div>
                    <p className="text-[14.5px] font-semibold text-text-primary">{selected.name}</p>
                    <p className="text-[12px] text-text-secondary">{getStageLabel(selected.stage)}</p>
                  </div>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto bg-surface-muted/60 p-5">
                  <div className="max-w-[70%] rounded-2xl rounded-tl-sm bg-white px-4 py-2.5 text-[13.5px] shadow-sm">
                    {t("Hi, could you send me more information about your products?", "Hola, ¿podrían enviarme más información sobre sus productos?")}
                  </div>
                  <div className="ml-auto max-w-[70%] rounded-2xl rounded-tr-sm bg-brand px-4 py-2.5 text-[13.5px] text-white shadow-sm">
                    {t("Of course! I'll send you the updated catalog right now 👍", "¡Por supuesto! Te envío el catálogo actualizado ahora mismo 👍")}
                  </div>
                </div>
                <div className="flex items-center gap-3 border-t border-border p-4">
                  <input
                    placeholder={t("Write a message...", "Escribe un mensaje...")}
                    className="h-10 flex-1 rounded-full border border-border px-4 text-[14px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                  />
                  <Button size="md" className="rounded-full !px-3">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-text-tertiary">
                <div className="text-center">
                  <Building2 className="mx-auto mb-2 h-6 w-6" />
                  {t("Select a conversation", "Selecciona una conversación")}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
