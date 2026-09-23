"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Upload,
  Phone,
  Mail,
  MessageCircle,
  Building2,
  Clock,
  ArrowRight,
  Pencil,
  Sparkles,
  Globe,
  CheckSquare,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SearchInput, Select, Textarea } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { StageBadge } from "@/components/StageBadge";
import { useLanguage } from "@/context/LanguageContext";
import { contacts, contactHistory } from "@/lib/mock-data";
import { STAGE_TONE, Stage } from "@/lib/pipeline";
import { cn } from "@/lib/cn";

const toneDot: Record<string, string> = {
  green: "bg-success",
  amber: "bg-warning",
  blue: "bg-info",
  gray: "bg-text-tertiary",
};

const channelIcon: Record<string, React.ElementType> = {
  WhatsApp: MessageCircle,
  Call: Phone,
  Email: Mail,
  "Social Media": Globe,
  Notes: CheckSquare,
};

export default function CrmPage() {
  const { t } = useLanguage();
  const [activeTag, setActiveTag] = useState("Linmania");
  const [selectedId, setSelectedId] = useState(contacts[0].id);
  const [historyTab, setHistoryTab] = useState("All");
  const [search, setSearch] = useState("");

  const filterTags = [t("All", "Todos"), "Linmania", "Rockstar", "Contact-On", "Leyva", "Vulcan", "Meca"];
  const historyTabs = [
    t("All", "Todos"),
    "WhatsApp",
    t("Calls", "Llamadas"),
    t("Email", "Correo"),
    t("Social Media", "Redes Sociales"),
    t("Tasks / Notes", "Tareas / Notas"),
  ];

  const selected = contacts.find((c) => c.id === selectedId) ?? contacts[0];

  const filteredContacts = useMemo(
    () =>
      contacts.filter((c) => {
        const matchesTag = activeTag === t("All", "Todos") || c.tag === activeTag;
        const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());
        return matchesTag && matchesSearch;
      }),
    [activeTag, search, t]
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("CRM", "CRM")}
        subtitle={t("View, organize and classify all client contacts", "Visualiza, organiza y clasifica todos los contactos de clientes")}
      />

      <div className="flex flex-wrap gap-3">
        <SearchInput placeholder={t("Search...", "Buscar...")} className="max-w-sm" />
        <Button>
          <Plus className="h-4 w-4" /> {t("New contact", "Nuevo contacto")}
        </Button>
        <Button variant="outline">
          <Upload className="h-4 w-4" /> {t("Import Excel/CSV", "Importar Excel/CSV")}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr_300px]">
        {/* Contacts list */}
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <CardTitle>{t("Contacts", "Contactos")}</CardTitle>
            <Badge tone="green">{filteredContacts.length}</Badge>
          </div>

          <div className="flex flex-wrap gap-2">
            {filterTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(tag)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  activeTag === tag
                    ? "bg-text-primary text-white"
                    : "bg-surface-muted text-text-secondary hover:bg-gray-200"
                )}
              >
                {tag}
              </button>
            ))}
          </div>

          <SearchInput
            placeholder={t("Search client, phone", "Buscar cliente, teléfono")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="flex flex-col gap-1.5 -mx-1">
            {filteredContacts.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                  selectedId === c.id ? "bg-brand-50" : "hover:bg-surface-muted"
                )}
              >
                <Avatar name={c.name} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-text-primary">{c.name}</p>
                  <p className="truncate text-[12px] text-text-secondary">{c.tag}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", toneDot[STAGE_TONE[c.status as Stage] ?? "gray"])}
                    aria-hidden
                  />
                  <span className="text-[11px] text-text-tertiary">{c.lastActivity}</span>
                </div>
              </button>
            ))}
            {filteredContacts.length === 0 && (
              <p className="px-3 py-6 text-center text-[13px] text-text-tertiary">
                {t("No contacts for this filter.", "No hay contactos para este filtro.")}
              </p>
            )}
          </div>
        </Card>

        {/* Contact detail */}
        <Card className="flex flex-col gap-6 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-4">
              <Avatar name={selected.name} size={52} />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[19px] font-semibold text-text-primary">{selected.name}</h2>
                  <StageBadge stage={selected.status} />
                </div>
                <p className="mt-1 text-[13.5px] text-text-secondary">{selected.subtitle}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm">
                <Plus className="h-3.5 w-3.5" /> {t("New Task", "Nueva Tarea")}
              </Button>
              <Button variant="outline" size="sm">
                <Pencil className="h-3.5 w-3.5" /> {t("Edit contact", "Editar contacto")}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <InfoField icon={Phone} label={t("PHONE", "TELÉFONO")} value={selected.phone} />
            <InfoField icon={Mail} label={t("EMAIL", "EMAIL")} value={selected.email} />
            <InfoField icon={MessageCircle} label={t("AGENT", "AGENTE")} value={selected.agente} />
            <InfoField icon={Building2} label={t("SOURCE", "ORIGEN")} value={selected.origen} />
            <InfoField icon={Clock} label={t("LAST CONTACT", "ÚLTIMO CONTACTO")} value={selected.ultimoContacto} />
            <InfoField icon={ArrowRight} label={t("NEXT ACTION", "PRÓXIMA ACCIÓN")} value={selected.proximaAccion} />
          </div>

          <div className="rounded-xl border border-brand-100 bg-brand-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-text-primary">
                <Sparkles className="h-4 w-4 text-brand" /> {t("AI Smart Analysis", "Análisis Inteligente IA")}
              </div>
              <Button size="sm">
                <Sparkles className="h-3.5 w-3.5" /> {t("Analyze activity with AI", "Analizar actividad con IA")}
              </Button>
            </div>
          </div>

          <div>
            <p className="mb-3 text-[15px] font-semibold text-text-primary">{t("Omnichannel history", "Historial omnicanal")}</p>
            <div className="flex flex-wrap gap-2">
              {historyTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setHistoryTab(tab)}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors",
                    historyTab === tab
                      ? "bg-text-primary text-white"
                      : "bg-white border border-border text-text-secondary hover:bg-surface-muted"
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {contactHistory.map((h) => {
                const Icon = channelIcon[h.channel] ?? MessageCircle;
                return (
                  <div
                    key={h.id}
                    className="flex items-center gap-3 rounded-xl border border-border p-3.5"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold text-text-primary">{h.label}</p>
                      <p className="text-[12px] text-text-secondary">{h.author}</p>
                    </div>
                    <span className="shrink-0 text-[12px] text-text-tertiary">{h.time}</span>
                  </div>
                );
              })}
              {contactHistory.length === 0 && (
                <p className="rounded-xl border border-dashed border-border py-6 text-center text-[13px] text-text-tertiary">
                  {t("No activity recorded for this contact.", "No hay actividad registrada para este contacto.")}
                </p>
              )}
            </div>
          </div>
        </Card>

        {/* Typify panel */}
        <Card className="flex flex-col gap-4 p-6">
          <Badge tone="green" className="w-fit">
            {t("New interaction", "Nueva interacción")}
          </Badge>
          <h3 className="text-[16px] font-semibold text-text-primary">{t("Classify contact", "Clasificar contacto")}</h3>

          <Field label={t("CHANNEL USED", "CANAL UTILIZADO")}>
            <Select defaultValue="Call">
              <option>{t("Call", "Llamada")}</option>
              <option>WhatsApp</option>
              <option>{t("Email", "Correo")}</option>
              <option>{t("Social media", "Redes sociales")}</option>
            </Select>
          </Field>

          <Field label={t("CONTACT RESULT", "RESULTADO DE CONTACTO")}>
            <Select defaultValue="NEW LEAD">
              <option>{t("NEW LEAD", "NUEVO LEAD")}</option>
              <option>{t("CONTACTED", "CONTACTADO")}</option>
              <option>{t("INTERESTED", "INTERESADO")}</option>
              <option>{t("OPPORTUNITY", "OPORTUNIDAD")}</option>
              <option>{t("CLIENT", "CLIENTE")}</option>
            </Select>
          </Field>

          <Field label={t("NEXT ACTION", "PRÓXIMA ACCIÓN")}>
            <Select defaultValue="Call back">
              <option>{t("Call back", "Volver a llamar")}</option>
              <option>{t("Send catalog", "Enviar catálogo")}</option>
              <option>{t("Sales visit", "Visita comercial")}</option>
              <option>{t("Send quote", "Enviar presupuesto")}</option>
            </Select>
          </Field>

          <Field label={t("RESPONSIBLE", "RESPONSABLE")}>
            <Select defaultValue="Unassigned">
              <option>{t("Unassigned", "Sin asignar")}</option>
              <option>Milagros</option>
              <option>Ana Victoria</option>
              <option>Gabriel</option>
            </Select>
          </Field>

          <Field label={t("NOTES", "NOTAS")}>
            <Textarea rows={3} placeholder={t("Interaction notes...", "Notas de la interacción...")} />
          </Field>

          <Field label={t("FOLLOW-UP DATE", "FECHA DE SEGUIMIENTO")}>
            <input
              type="datetime-local"
              className="h-10 w-full rounded-lg border border-border bg-white px-3.5 text-[14px] text-text-primary outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </Field>

          <Button className="mt-1 w-full">{t("Save classification", "Guardar clasificación")}</Button>
        </Card>
      </div>
    </div>
  );
}

function InfoField({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-text-tertiary">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="mt-1 truncate text-[14px] font-medium text-text-primary">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}
