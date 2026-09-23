"use client";

import { useMemo, useState } from "react";
import { Plus, Sparkles, Download, Search as SearchIcon, Compass, Layers, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, SearchInput, Select, Textarea } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { StageBadge } from "@/components/StageBadge";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLanguage } from "@/context/LanguageContext";
import { campaigns, companies, prospects } from "@/lib/mock-data";

export default function ProspeccionPage() {
  const { t } = useLanguage();
  const [campaignName, setCampaignName] = useState("");
  const [company, setCompany] = useState("");
  const [query, setQuery] = useState("");
  const [selectedCampaign, setSelectedCampaign] = useState(campaigns[0].id);
  const [tableSearch, setTableSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const suggestionChips = [
    t("Restaurants in Benidorm", "Restaurantes en Benidorm"),
    t("Fashion stores in Valencia", "Tiendas de moda en Valencia"),
    t("Companies with outdated website", "Empresas con web desactualizada"),
  ];

  const steps = [
    {
      icon: Compass,
      title: t("1 · Discovery", "1 · Descubrimiento"),
      desc: t("AI scans sources and finds candidate companies.", "La IA escanea fuentes y encuentra empresas candidatas."),
    },
    {
      icon: Layers,
      title: t("2 · Enrichment", "2 · Enriquecimiento"),
      desc: t("Completes contact data and verifies activity.", "Completa datos de contacto y verifica actividad."),
    },
    {
      icon: ShieldCheck,
      title: t("3 · Validation", "3 · Validación"),
      desc: t("Filters and validates leads before sending them to the CRM.", "Filtra y valida leads antes de enviarlos al CRM."),
    },
  ];

  const activeCampaign = campaigns.find((c) => c.id === selectedCampaign) ?? campaigns[0];

  const filteredRows = useMemo(
    () =>
      prospects.filter((p) =>
        p.empresa.toLowerCase().includes(tableSearch.toLowerCase())
      ),
    [tableSearch]
  );

  function toggleRow(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setChecked((prev) =>
      prev.size === filteredRows.length ? new Set() : new Set(filteredRows.map((r) => r.id))
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Client Prospecting", "Prospección de Clientes")}
        subtitle={t(
          "Find potential clients with AI and organize results by campaigns",
          "Encuentra clientes potenciales con IA y organiza resultados por campañas"
        )}
        actions={<LanguageSwitcher />}
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        <SearchInput placeholder={t("Search client, phone or email...", "Buscar cliente, teléfono o correo...")} />
        <Button className="sm:w-auto">
          <Plus className="h-4 w-4" /> {t("New search", "Nueva búsqueda")}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        {/* Left: AI assistant */}
        <Card className="p-6">
          <Badge tone="green" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> {t("AI PROSPECTING ASSISTANT", "ASISTENTE DE PROSPECCIÓN IA")}
          </Badge>

          <h2 className="mt-4 text-[20px] font-semibold text-text-primary">
            {t("What clients do you want to find?", "¿Qué clientes quieres encontrar?")}
          </h2>

          <div className="mt-5 flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
                {t("CAMPAIGN NAME *", "NOMBRE DE LA CAMPAÑA *")}
              </label>
              <Input
                placeholder={t("E.g. Digital Services · Alicante", "Ej. Servicios Digitales · Alicante")}
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
                {t("CAMPAIGN OWNER COMPANY", "EMPRESA PROPIETARIA DE LA CAMPAÑA")}
              </label>
              <Select value={company} onChange={(e) => setCompany(e.target.value)}>
                <option value="">{t("Select a company...", "Selecciona una empresa...")}</option>
                {companies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
                {t("QUERY", "CONSULTA")}
              </label>
              <Textarea
                rows={3}
                placeholder={t(
                  "Find shoe stores in Alicante with a physical store and no updated website, that buy from leather wholesalers...",
                  "Encuentra tiendas de calzado en Alicante con tienda física y sin web actualizada, que compren a mayoristas de piel..."
                )}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <Button className="w-fit">
              <Plus className="h-4 w-4" /> {t("Start search", "Iniciar búsqueda")}
            </Button>

            <div className="flex flex-wrap gap-2 pt-1">
              {suggestionChips.map((chip) => (
                <button
                  key={chip}
                  onClick={() => setQuery(chip)}
                  className="rounded-full border border-border bg-white px-3.5 py-1.5 text-[13px] text-text-primary transition-colors hover:border-brand hover:bg-brand-50"
                >
                  {chip}
                </button>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {steps.map((s) => (
                <div key={s.title} className="rounded-xl border border-border p-4">
                  <p className="text-[14px] font-semibold text-text-primary">{s.title}</p>
                  <p className="mt-1.5 text-[13px] leading-5 text-text-secondary">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Right: Campaigns */}
        <Card className="flex flex-col gap-4 p-6">
          <CardHeader>
            <CardTitle>{t("Campaigns", "Campañas")}</CardTitle>
            <Badge tone="green">{campaigns.length} {t("campaigns", "campañas")}</Badge>
          </CardHeader>

          <div className="flex flex-col gap-3">
            {campaigns.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCampaign(c.id)}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  selectedCampaign === c.id
                    ? "border-brand-100 bg-brand-50"
                    : "border-border bg-white hover:border-brand-100 hover:bg-brand-50/40"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[14.5px] font-semibold text-text-primary">{c.name}</p>
                  <Badge tone="outline" className="shrink-0">
                    {c.company}
                  </Badge>
                </div>
                <p className="mt-1 text-[12.5px] text-text-secondary">{c.subtitle}</p>

                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar name={c.assignedTo} size={22} />
                    <span className="text-[12.5px] text-text-secondary">
                      {t("Assigned to", "Asignado a")} {c.assignedTo}
                    </span>
                  </div>
                  <Badge tone={c.status === "Completed" ? "green" : "amber"}>
                    {c.status === "Completed" ? t("Completed", "Completada") : t("In progress", "En proceso")}
                  </Badge>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-white/70 border border-border/70 px-2.5 py-2">
                    <p className="text-[10px] font-semibold tracking-wide text-text-tertiary">
                      {t("FOUND", "ENCONTRADOS")}
                    </p>
                    <p className="text-[15px] font-semibold text-text-primary">{c.found}</p>
                  </div>
                  <div className="rounded-lg bg-white/70 border border-border/70 px-2.5 py-2">
                    <p className="text-[10px] font-semibold tracking-wide text-text-tertiary">
                      {t("VALIDATED", "VALIDADOS")}
                    </p>
                    <p className="text-[15px] font-semibold text-text-primary">{c.validated}</p>
                  </div>
                  <div className="rounded-lg bg-white/70 border border-border/70 px-2.5 py-2">
                    <p className="text-[10px] font-semibold tracking-wide text-text-tertiary">
                      {t("IN CRM", "EN CRM")}
                    </p>
                    <p className="text-[15px] font-semibold text-text-primary">{c.inCrm}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Results table */}
      <Card className="p-6">
        <CardTitle>{t("Results", "Resultados")} · {activeCampaign.name}</CardTitle>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SearchInput
            placeholder={t("Search company...", "Buscar empresa...")}
            className="max-w-xs"
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
          />
          <Button variant="outline" size="md">
            <Download className="h-4 w-4" /> {t("Export", "Exportar")}
          </Button>
          <Select className="max-w-[220px]">
            <option>{t("Assign to agent...", "Asignar a agente...")}</option>
            <option>Milagros</option>
            <option>Ana Victoria</option>
            <option>Solange</option>
          </Select>
          <Button
            className="ml-auto"
            disabled={checked.size === 0}
            title={checked.size === 0 ? t("Select at least one result", "Selecciona al menos un resultado") : undefined}
          >
            {t("Send selected to CRM", "Enviar seleccionados al CRM")}
          </Button>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="text-[11px] font-semibold tracking-wide text-text-tertiary">
                <th className="w-10 pb-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand"
                    checked={checked.size > 0 && checked.size === filteredRows.length}
                    onChange={toggleAll}
                  />
                </th>
                <th className="pb-3 pr-4">{t("COMPANY", "EMPRESA")}</th>
                <th className="pb-3 pr-4">{t("ACTIVITY", "ACTIVIDAD")}</th>
                <th className="pb-3 pr-4">{t("LOCATION", "LOCALIDAD")}</th>
                <th className="pb-3 pr-4">{t("CONTACT", "CONTACTO")}</th>
                <th className="pb-3 pr-4">{t("AI AFFINITY", "AFINIDAD IA")}</th>
                <th className="pb-3">{t("STATUS", "ESTADO")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[13px] text-text-tertiary">
                    <SearchIcon className="mx-auto mb-2 h-5 w-5" />
                    {t("No results found", "No se encontraron resultados")}
                  </td>
                </tr>
              )}
              {filteredRows.map((row) => (
                <tr key={row.id} className="border-t border-border text-[13.5px] transition-colors hover:bg-surface-muted/70">
                  <td className="py-3.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      checked={checked.has(row.id)}
                      onChange={() => toggleRow(row.id)}
                    />
                  </td>
                  <td className="py-3.5 pr-4 font-medium text-text-primary">{row.empresa}</td>
                  <td className="py-3.5 pr-4 text-text-secondary">{row.actividad}</td>
                  <td className="py-3.5 pr-4 text-text-secondary">{row.localidad}</td>
                  <td className="py-3.5 pr-4 text-text-secondary">{row.contacto}</td>
                  <td className="py-3.5 pr-4 text-text-secondary">{row.afinidad}% match</td>
                  <td className="py-3.5">
                    <StageBadge stage={row.estado} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
