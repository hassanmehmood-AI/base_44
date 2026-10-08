"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, MessageCircle, Mail, Phone, ArrowRight } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select, Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/PageHeader";
import { useLanguage } from "@/context/LanguageContext";
import { useCompany, ALL_COMPANIES } from "@/context/CompanyContext";
import { cn } from "@/lib/cn";
import type { AssignedClient, ChannelSummaryByCompany } from "@/server/services/activeCampaigns";
import { createAssignedContactAction } from "./actions";

const ALL_AGENTS = "__all__";
const UNASSIGNED = "__unassigned__";

type CompanyOption = { id: string; name: string };

export function CampanasActivasClient({
  companies,
  clients,
  channelSummary,
  entryStageId,
  currentUserName,
}: {
  companies: CompanyOption[];
  clients: AssignedClient[];
  channelSummary: ChannelSummaryByCompany[];
  entryStageId: string | null;
  currentUserName: string | null;
}) {
  const { t } = useLanguage();
  const { activeCompany } = useCompany();
  const [createOpen, setCreateOpen] = useState(false);

  const agentOptions = useMemo(() => {
    const names = new Set(clients.map((c) => c.assignedUserName).filter((n): n is string => !!n));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [clients]);

  const [selectedAgent, setSelectedAgent] = useState<string>(
    currentUserName && agentOptions.includes(currentUserName) ? currentUserName : ALL_AGENTS
  );
  const [selectedClientId, setSelectedClientId] = useState<string | null>(clients[0]?.id ?? null);

  const companyFilteredClients = useMemo(
    () => clients.filter((c) => activeCompany === ALL_COMPANIES || c.companyName === activeCompany),
    [clients, activeCompany]
  );

  const filteredClients = useMemo(() => {
    if (selectedAgent === ALL_AGENTS) return companyFilteredClients;
    if (selectedAgent === UNASSIGNED) return companyFilteredClients.filter((c) => !c.assignedUserName);
    return companyFilteredClients.filter((c) => c.assignedUserName === selectedAgent);
  }, [companyFilteredClients, selectedAgent]);

  const totals = useMemo(() => {
    const scoped = channelSummary.filter((s) => activeCompany === ALL_COMPANIES || s.companyName === activeCompany);
    return scoped.reduce(
      (acc, s) => ({
        whatsapp: {
          unread: acc.whatsapp.unread + s.whatsapp.unread,
          repliesToday: acc.whatsapp.repliesToday + s.whatsapp.repliesToday,
          pending: acc.whatsapp.pending + s.whatsapp.pending,
        },
        email: {
          unread: acc.email.unread + s.email.unread,
          repliesToday: acc.email.repliesToday + s.email.repliesToday,
          pending: acc.email.pending + s.email.pending,
        },
        calls: {
          callsToday: acc.calls.callsToday + s.calls.callsToday,
          answered: acc.calls.answered + s.calls.answered,
          callbacks: acc.calls.callbacks + s.calls.callbacks,
        },
      }),
      {
        whatsapp: { unread: 0, repliesToday: 0, pending: 0 },
        email: { unread: 0, repliesToday: 0, pending: 0 },
        calls: { callsToday: 0, answered: 0, callbacks: 0 },
      }
    );
  }, [channelSummary, activeCompany]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Active Campaigns", "Campañas Activas")}
        subtitle={t("Manage your assigned clients and contact channels", "Gestiona tus clientes asignados y canales de contacto")}
        actions={
          <>
            <div className="w-[160px]">
              <Select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}>
                <option value={ALL_AGENTS}>{t("All agents", "Todos los agentes")}</option>
                {agentOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value={UNASSIGNED}>{t("Unassigned", "Sin asignar")}</option>
              </Select>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> {t("New contact", "Nuevo contacto")}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
        <Card className="p-5">
          <CardTitle>{t("My assigned clients", "Mis clientes asignados")}</CardTitle>
          <div className="mt-4 flex flex-col gap-2">
            {filteredClients.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-text-tertiary">
                {t("No clients match this filter.", "Ningún cliente coincide con este filtro.")}
              </p>
            ) : (
              filteredClients.map((c) => (
                // Opens this exact contact's record in the CRM (reuses its
                // existing /crm?contact= deep link) rather than just
                // highlighting the card with nowhere to go.
                <a
                  key={c.id}
                  href={`/crm?contact=${c.id}`}
                  onClick={() => setSelectedClientId(c.id)}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-3.5 py-2.5 text-left text-[14px] font-medium transition-colors",
                    selectedClientId === c.id
                      ? "bg-brand-50 text-text-primary"
                      : "text-text-secondary hover:bg-surface-muted"
                  )}
                >
                  <span className="min-w-0 truncate">{c.name}</span>
                  {c.needsFollowUp && (
                    <span
                      title={t("Follow-up due", "Seguimiento pendiente")}
                      className="h-2 w-2 shrink-0 rounded-full bg-brand"
                    />
                  )}
                </a>
              ))
            )}
          </div>
        </Card>

        <ChannelCard
          icon={MessageCircle}
          iconTone="text-brand bg-brand-50"
          title="WhatsApp"
          rows={[
            [t("Unread", "Sin leer"), totals.whatsapp.unread],
            [t("Replies today", "Respuestas hoy"), totals.whatsapp.repliesToday],
            [t("Pending", "Pendientes"), totals.whatsapp.pending],
          ]}
          cta={t("Open WhatsApp", "Abrir WhatsApp")}
          href="/canales/whatsapp"
        />
        <ChannelCard
          icon={Mail}
          iconTone="text-info bg-info-50"
          title={t("Email", "Correo")}
          rows={[
            [t("Unread", "Sin leer"), totals.email.unread],
            [t("Replies today", "Respuestas hoy"), totals.email.repliesToday],
            [t("Pending", "Pendientes"), totals.email.pending],
          ]}
          cta={t("Open email", "Abrir correo")}
          href="/canales/correo"
        />
        <ChannelCard
          icon={Phone}
          iconTone="text-warning bg-warning-50"
          title={t("Calls", "Llamadas")}
          rows={[
            [t("Calls today", "Llamadas hoy"), totals.calls.callsToday],
            [t("Answered", "Contestadas"), totals.calls.answered],
            [t("Callbacks", "Rellamadas"), totals.calls.callbacks],
          ]}
          cta={t("Open calls", "Abrir llamadas")}
          href="/canales/llamadas"
        />
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t("New contact", "Nuevo contacto")}>
        <NewContactForm companies={companies} entryStageId={entryStageId} onClose={() => setCreateOpen(false)} />
      </Modal>
    </div>
  );
}

function ChannelCard({
  icon: Icon,
  iconTone,
  title,
  rows,
  cta,
  href,
}: {
  icon: React.ElementType;
  iconTone: string;
  title: string;
  rows: [string, number][];
  cta: string;
  href: string;
}) {
  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", iconTone)}>
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-[17px] font-semibold text-text-primary">{title}</h3>

      <div className="flex flex-col gap-2.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between text-[13.5px]">
            <span className="text-text-secondary">{label}</span>
            <span className="font-semibold text-text-primary">{value}</span>
          </div>
        ))}
      </div>

      <a href={href}>
        <Button variant="dark" className="w-full">
          {cta} <ArrowRight className="h-4 w-4" />
        </Button>
      </a>
    </Card>
  );
}

function NewContactForm({
  companies,
  entryStageId,
  onClose,
}: {
  companies: CompanyOption[];
  entryStageId: string | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!entryStageId) {
      setError(t("No pipeline stage configured.", "No hay una etapa de pipeline configurada."));
      return;
    }
    setSaving(true);
    setError(undefined);
    const result = await createAssignedContactAction({ companyId, name, businessName, phone, email });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
          {t("COMPANY", "EMPRESA")}
        </label>
        <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
          {t("NAME", "NOMBRE")}
        </label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
          {t("BUSINESS NAME", "NOMBRE DE EMPRESA")}
        </label>
        <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
          {t("PHONE", "TELÉFONO")}
        </label>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
          {t("EMAIL", "EMAIL")}
        </label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <Button type="submit" disabled={saving} className="mt-1 w-full">
        {saving ? t("Creating...", "Creando...") : t("Create contact", "Crear contacto")}
      </Button>
    </form>
  );
}
