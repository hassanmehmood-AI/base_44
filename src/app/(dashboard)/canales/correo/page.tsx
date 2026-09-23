"use client";

import { useState } from "react";
import { Bold, Italic, Link2, Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SearchInput, Select, Textarea } from "@/components/ui/Input";
import { PageHeader } from "@/components/PageHeader";
import { useLanguage } from "@/context/LanguageContext";
import { emailThreads, emailResources } from "@/lib/mock-data";
import { cn } from "@/lib/cn";

export default function CorreoPage() {
  const { t } = useLanguage();
  const [selectedId, setSelectedId] = useState(emailThreads[0].id);
  const selected = emailThreads.find((t) => t.id === selectedId) ?? emailThreads[0];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Email Inbox", "Bandeja de Correo")}
        subtitle={t("Email conversations and templates", "Conversaciones por correo y plantillas")}
        actions={
          <>
            <SearchInput placeholder={t("Search client, phone or email...", "Buscar cliente, teléfono o correo...")} className="max-w-sm" />
            <Button>
              <Send className="h-4 w-4" /> {t("Compose email", "Redactar correo")}
            </Button>
          </>
        }
      />

      <div className="w-[220px]">
        <Select defaultValue="All companies">
          <option>{t("All companies", "Todas las empresas")}</option>
          <option>Contact-On</option>
          <option>Leyva</option>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr_280px]">
        <Card className="flex flex-col gap-1 p-5">
          <div className="mb-2 flex items-center justify-between">
            <CardTitle>{t("Conversations", "Conversaciones")}</CardTitle>
            <Badge tone="green">{emailThreads.length} {t("new", "nuevas")}</Badge>
          </div>
          {emailThreads.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={cn(
                "rounded-xl px-3.5 py-3 text-left transition-colors",
                selectedId === t.id ? "bg-brand-50" : "hover:bg-surface-muted"
              )}
            >
              <p className="text-[14px] font-semibold text-text-primary">{t.company}</p>
              <p className="mt-0.5 truncate text-[12.5px] text-text-secondary">{t.preview}</p>
            </button>
          ))}
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-[18px] font-semibold text-text-primary">{selected.subject}</h2>
            <p className="mt-1 text-[13px] text-text-secondary">
              {t("From:", "De:")} {selected.from} · {selected.email}
            </p>
          </div>

          <p className="whitespace-pre-line rounded-xl bg-surface-muted p-4 text-[14px] leading-6 text-text-primary">
            {selected.body}
          </p>

          <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
            <div className="flex items-center gap-3 text-text-secondary">
              <Bold className="h-4 w-4 cursor-pointer hover:text-text-primary" />
              <Italic className="h-4 w-4 cursor-pointer hover:text-text-primary" />
              <Link2 className="h-4 w-4 cursor-pointer hover:text-text-primary" />
              <Paperclip className="h-4 w-4 cursor-pointer hover:text-text-primary" />
            </div>
            <Textarea rows={3} placeholder={t("Write a reply...", "Escribe una respuesta...")} />
            <Button className="w-fit self-end">
              <Send className="h-4 w-4" /> {t("Send reply", "Enviar respuesta")}
            </Button>
          </div>
        </Card>

        <Card className="flex flex-col gap-2.5 p-5">
          <CardTitle>{t("Processes and resources", "Procesos y recursos")}</CardTitle>
          {emailResources.map((r) => (
            <button
              key={r}
              className="rounded-xl border border-border px-3.5 py-3 text-left text-[13.5px] font-medium text-text-primary transition-colors hover:border-brand hover:bg-brand-50/40"
            >
              {r}
            </button>
          ))}
        </Card>
      </div>
    </div>
  );
}
