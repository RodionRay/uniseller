'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

type ErrorFallbackProps = {
  /** Re-render the failed subtree (Next error boundary reset or local boundary reset). */
  onRetry: () => void;
  /** Section name for a panel-level failure; omitted for a whole-page failure. */
  section?: string;
  className?: string;
};

/** Recoverable error state: what happened, retry in place, or a full reload as the fallback. */
export function ErrorFallback({ onRetry, section, className }: ErrorFallbackProps) {
  return (
    <Empty role="alert" className={className ?? 'empty-state border-0 py-10'}>
      <EmptyHeader>
        <div className="icon-box mx-auto mb-3">
          <AlertTriangle size={22} />
        </div>
        <EmptyTitle>Что-то пошло не так</EmptyTitle>
        <EmptyDescription>
          {section
            ? `Раздел «${section}» не отобразился. Остальной кабинет работает — повторите или перезагрузите страницу.`
            : 'Страница не отобразилась. Данные не потеряны — повторите или перезагрузите страницу.'}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        <Button onClick={onRetry}>
          <RefreshCw size={16} />
          Повторить
        </Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Перезагрузить страницу
        </Button>
      </EmptyContent>
    </Empty>
  );
}

type PanelErrorBoundaryProps = {
  section: string;
  children: ReactNode;
};

type PanelErrorBoundaryState = { failed: boolean };

/** Isolates one cabinet section: a render throw shows ErrorFallback instead of blanking the cabinet. */
export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): PanelErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[panel:${this.props.section}]`, error, info.componentStack);
  }

  private retry = () => this.setState({ failed: false });

  render() {
    if (this.state.failed) return <ErrorFallback section={this.props.section} onRetry={this.retry} />;
    return this.props.children;
  }
}
