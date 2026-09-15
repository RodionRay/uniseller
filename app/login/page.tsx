import { Suspense } from "react";
import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="login-shell">
          <div className="login-card">
            <p className="muted">Загрузка…</p>
          </div>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
