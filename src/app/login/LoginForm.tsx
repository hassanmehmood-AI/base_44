"use client";

import { useActionState } from "react";
import { Sprout } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useLanguage } from "@/context/LanguageContext";
import { loginAction } from "./actions";

export function LoginForm() {
  const { t } = useLanguage();
  const [error, formAction, isPending] = useActionState(loginAction, undefined);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand">
            <Sprout className="h-5 w-5 text-white" strokeWidth={2.2} />
          </div>
          <h1 className="text-[19px] font-bold tracking-tight text-text-primary">GROWTH-ON</h1>
          <p className="text-[13.5px] text-text-secondary">{t("Sign in to continue", "Inicia sesión para continuar")}</p>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
              {t("EMAIL", "CORREO")}
            </label>
            <Input type="email" name="email" required autoComplete="email" />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
              {t("PASSWORD", "CONTRASEÑA")}
            </label>
            <Input type="password" name="password" required autoComplete="current-password" />
          </div>

          {error && <p className="text-[13px] text-danger">{error}</p>}

          <Button type="submit" disabled={isPending} className="mt-1 w-full">
            {isPending ? t("Signing in...", "Iniciando sesión...") : t("Sign in", "Iniciar sesión")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
