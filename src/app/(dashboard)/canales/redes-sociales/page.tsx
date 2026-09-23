"use client";

import { useState } from "react";
import { Plus, Send, AtSign } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SearchInput, Select, Textarea } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { PageHeader } from "@/components/PageHeader";
import { useLanguage } from "@/context/LanguageContext";
import { socialInbox } from "@/lib/mock-data";
import { cn } from "@/lib/cn";

export default function RedesSocialesPage() {
  const { t } = useLanguage();
  const [platform, setPlatform] = useState("All");
  const [selectedId, setSelectedId] = useState(socialInbox[0].id);

  const platformTabs = [t("All", "Todas"), "IG", "FB", "MSG"];
  const selected = socialInbox.find((s) => s.id === selectedId) ?? socialInbox[0];

  const filtered = socialInbox.filter((s) => platform === t("All", "Todas") || platform === "All" || s.platform === platform);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Social Media", "Redes Sociales")}
        subtitle={t("Social inbox and comment responses", "Bandeja social y respuesta a comentarios")}
        actions={
          <>
            <SearchInput placeholder={t("Search client, phone or email...", "Buscar cliente, teléfono o correo...")} className="max-w-sm" />
            <Button>
              <Plus className="h-4 w-4" /> {t("New post", "Nueva publicación")}
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
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <CardTitle>{t("Social inbox", "Bandeja social")}</CardTitle>
            <Badge tone="green">{socialInbox.length} {t("new", "nuevos")}</Badge>
          </div>

          <div className="flex gap-1.5">
            {platformTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setPlatform(tab)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  platform === tab
                    ? "bg-text-primary text-white"
                    : "bg-surface-muted text-text-secondary hover:bg-gray-200"
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            {filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors",
                  selectedId === s.id ? "bg-brand-50" : "hover:bg-surface-muted"
                )}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand shrink-0">
                  <AtSign className="h-4 w-4" />
                </div>
                <span className="truncate text-[13.5px] font-medium text-text-primary">{s.handle}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div>
            <p className="text-[15px] font-semibold text-text-primary">{selected.handle}</p>
            <p className="text-[12.5px] text-text-secondary">Instagram · {t("Comment", "Comentario")}</p>
          </div>

          <div className="rounded-2xl bg-surface-muted px-4 py-3 text-[14px] text-text-primary">
            {selected.preview}
          </div>
          <p className="text-[12px] text-text-tertiary">{selected.handle} · {t("20 min ago", "hace 20 min")}</p>

          <div className="ml-auto max-w-[70%] rounded-2xl bg-brand px-4 py-3 text-[14px] text-white">
            {t("Yes, we have it available. Here's the link 🔥", "Sí, lo tenemos disponible. Aquí está el enlace 🔥")}
          </div>
          <p className="ml-auto text-[12px] text-text-tertiary">{t("You", "Tú")} · {t("15 min ago", "hace 15 min")}</p>

          <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
            <Textarea rows={3} placeholder={t("Write a reply...", "Escribe una respuesta...")} />
            <Button className="w-fit self-end">
              <Send className="h-4 w-4" /> {t("Post reply", "Publicar respuesta")}
            </Button>
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-3">
            <Avatar name={selected.handle.replace("@", "")} size={44} />
            <div>
              <p className="text-[14.5px] font-semibold text-text-primary">
                {selected.handle.replace("@", "").replace(/_/g, " ")}
              </p>
              <p className="text-[12.5px] text-text-secondary">{selected.handle}</p>
            </div>
          </div>

          <div className="flex justify-between text-[13.5px]">
            <span className="text-text-secondary">{t("Followers", "Seguidores")}</span>
            <span className="font-semibold text-text-primary">2.480</span>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
              {t("COMMERCIAL STATUS", "ESTADO COMERCIAL")}
            </label>
            <Select defaultValue="New contact">
              <option>{t("New contact", "Nuevo contacto")}</option>
              <option>{t("Interested", "Interesado")}</option>
              <option>{t("Client", "Cliente")}</option>
            </Select>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
              {t("ASSIGNED TO", "ASIGNADO A")}
            </label>
            <Select defaultValue="Ana Victoria">
              <option>Ana Victoria</option>
              <option>Milagros</option>
              <option>Gabriel</option>
            </Select>
          </div>

          <Button className="w-full">
            <Plus className="h-4 w-4" /> {t("Create task", "Crear tarea")}
          </Button>
        </Card>
      </div>
    </div>
  );
}
